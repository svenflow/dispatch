import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { getChats, createChat, deleteChat, markChatAsUnread as apiMarkChatAsUnread } from "../api/chats";
import type { Conversation } from "../api/types";
import { notifyUnreadChatCount } from "../state/unreadChats";
import { makeLayoutAnim, safeConfigureNext, backoffDelay } from "../utils/animation";
import { getApiBaseUrl } from "../config/constants";
import { getDeviceToken } from "../api/client";

/** Smooth reorder animation for chat list updates */
const chatListAnim = makeLayoutAnim(250);

// ---------------------------------------------------------------------------
// Unified optimistic read/unread tracking (module-level, persists across navigations)
// ---------------------------------------------------------------------------

/** Optimistic override: 'read' = user opened it, 'unread' = user manually marked unread */
const _optimisticState = new Map<string, "read" | "unread">();

/** Map of chat ID -> last_message content when read (to detect new messages) */
const _readAtMessage = new Map<string, string | null>();

/** Mark a chat as read (call from chat detail screen) */
export function markChatAsRead(chatId: string): void {
  _optimisticState.set(chatId, "read");
}

/** Get the optimistic override for a chat */
export function getChatOptimisticState(
  chatId: string,
): "read" | "unread" | undefined {
  return _optimisticState.get(chatId);
}

// Legacy export — used by index.tsx for backward compat
export function isChatRead(chatId: string): boolean {
  return _optimisticState.get(chatId) === "read";
}

/** Update read tracking when new data arrives — clear overrides once reconciled */
function _updateReadTracking(conversations: Conversation[]): void {
  for (const conv of conversations) {
    const state = _optimisticState.get(conv.id);
    if (state === "read") {
      const prevMessage = _readAtMessage.get(conv.id);
      if (prevMessage === undefined) {
        // First time seeing this after marking read — record current last_message
        _readAtMessage.set(conv.id, conv.last_message);
      } else if (conv.last_message !== prevMessage) {
        // New message arrived since we read it — no longer "read"
        _optimisticState.delete(conv.id);
        _readAtMessage.delete(conv.id);
      }
    } else if (state === "unread") {
      // Clear optimistic unread once server confirms marked_unread = true
      if (conv.marked_unread) {
        _optimisticState.delete(conv.id);
      }
    }
  }
}

/** Check if a chat is unread based on server data (no optimistic overrides) */
function _isServerUnread(c: Conversation): boolean {
  if (c.marked_unread) return true;
  if (c.last_message_role !== "assistant" || !c.last_message_at) return false;
  if (c.last_opened_at) {
    return new Date(c.last_message_at) > new Date(c.last_opened_at);
  }
  return true; // No last_opened_at — assistant message is unread
}

/** Check if a chat is currently unread (server data + optimistic overrides) */
export function isCurrentlyUnread(conversation: Conversation): boolean {
  const opt = _optimisticState.get(conversation.id);
  if (opt === "read") return false;
  if (opt === "unread") return true;
  return _isServerUnread(conversation);
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

interface SSEChatsEvent {
  type: "chats";
  chats: Conversation[];
}
interface SSEKeepalive {
  type: "keepalive";
}
type SSEEvent = SSEChatsEvent | SSEKeepalive;

function parseSSELine(line: string): SSEEvent | null {
  if (!line.startsWith("data: ")) return null;
  const jsonStr = line.slice(6).trim();
  if (!jsonStr || jsonStr === "[DONE]") return null;
  try {
    return JSON.parse(jsonStr) as SSEEvent;
  } catch {
    console.warn("[useChatList] Malformed SSE JSON:", jsonStr);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseChatListReturn {
  conversations: Conversation[];
  isLoading: boolean;
  error: string | null;
  loadConversations: () => Promise<boolean>;
  createConversation: (title?: string) => Promise<Conversation | null>;
  deleteConversation: (chatId: string) => Promise<boolean>;
  markAsUnread: (chatId: string) => Promise<void>;
}

export function useChatList(): UseChatListReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const prevOrderRef = useRef<string[]>([]);
  /** Fingerprint of last result — skip setState when unchanged to avoid re-renders */
  const prevFingerprintRef = useRef<string>("");

  // ---------------------------------------------------------------------------
  // Shared: apply a chat list update (used by both SSE and polling)
  // ---------------------------------------------------------------------------
  const applyChats = useCallback((chats: Conversation[]) => {
    // Sort by last message time descending (most recent first)
    chats.sort((a, b) => {
      const timeA = a.last_message_at || a.created_at;
      const timeB = b.last_message_at || b.created_at;
      return timeB.localeCompare(timeA);
    });

    if (!mountedRef.current) return;

    _updateReadTracking(chats);

    // Build lightweight fingerprint — includes unread-relevant fields
    const fingerprint = chats
      .map((c) => `${c.id}:${c.last_message_at ?? ""}:${c.is_thinking}:${c.marked_unread}:${c.image_status}:${c.last_opened_at ?? ""}:${c.status ?? ""}`)
      .join("|");

    // Skip state update AND badge notification when nothing changed
    if (fingerprint === prevFingerprintRef.current) return;
    prevFingerprintRef.current = fingerprint;

    // Count unread chats for tab badge (only on actual changes)
    const unreadCount = chats.filter((c) => isCurrentlyUnread(c)).length;
    notifyUnreadChatCount(unreadCount);

    // Animate if order or count changed
    const newOrder = chats.map((c) => c.id);
    const orderChanged =
      newOrder.length !== prevOrderRef.current.length ||
      newOrder.some((id, i) => id !== prevOrderRef.current[i]);
    if (orderChanged && prevOrderRef.current.length > 0) {
      safeConfigureNext(chatListAnim);
    }
    prevOrderRef.current = newOrder;

    setConversations(chats);
    setError(null);
    setIsLoading(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Polling fallback (same as before)
  // ---------------------------------------------------------------------------
  const loadConversations = useCallback(async (): Promise<boolean> => {
    try {
      const chats = await getChats();
      applyChats(chats);
      return true;
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err instanceof Error ? err.message : "Failed to load conversations",
        );
      }
      return false;
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [applyChats]);

  // ---------------------------------------------------------------------------
  // SSE connection
  // ---------------------------------------------------------------------------
  const sseAbortRef = useRef<AbortController | null>(null);
  const sseActiveRef = useRef(false);
  const sseReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseFailCountRef = useRef(0);

  const stopSSE = useCallback(() => {
    sseActiveRef.current = false;
    sseAbortRef.current?.abort();
    sseAbortRef.current = null;
    if (sseReconnectTimerRef.current) {
      clearTimeout(sseReconnectTimerRef.current);
      sseReconnectTimerRef.current = null;
    }
  }, []);

  const connectSSE = useCallback(() => {
    if (!mountedRef.current) return;

    const token = getDeviceToken();
    if (!token) {
      // No token — fall back to polling
      return false;
    }

    sseActiveRef.current = true;
    const abortController = new AbortController();
    sseAbortRef.current = abortController;

    const url = `${getApiBaseUrl()}/chats/stream?token=${encodeURIComponent(token)}`;

    (async () => {
      try {
        const response = await fetch(url, {
          signal: abortController.signal,
          headers: { Accept: "text/event-stream" },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        // Connected successfully — reset fail count
        sseFailCountRef.current = 0;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const event = parseSSELine(line);
            if (!event) continue;

            if (event.type === "chats") {
              applyChats(event.chats);
            }
            // keepalive — nothing to do
          }
        }

        // Stream ended cleanly — reconnect
        if (mountedRef.current && sseActiveRef.current) {
          scheduleSSEReconnect();
        }
      } catch (err: unknown) {
        if (abortController.signal.aborted) return; // Intentional abort

        console.warn("[useChatList] SSE error, will reconnect:", err);
        sseFailCountRef.current += 1;

        if (mountedRef.current && sseActiveRef.current) {
          // Do one poll immediately so we don't miss data during reconnect gap
          loadConversations();
          scheduleSSEReconnect();
        }
      }
    })();

    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyChats, loadConversations]);

  const scheduleSSEReconnect = useCallback(() => {
    if (!mountedRef.current || !sseActiveRef.current) return;
    if (sseReconnectTimerRef.current) return;

    const delay = backoffDelay(2000, sseFailCountRef.current);
    sseReconnectTimerRef.current = setTimeout(() => {
      sseReconnectTimerRef.current = null;
      if (mountedRef.current && sseActiveRef.current) {
        connectSSE();
      }
    }, delay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectSSE]);

  // ---------------------------------------------------------------------------
  // Polling fallback (used when SSE is not active)
  // ---------------------------------------------------------------------------
  const pollFailCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const schedulePoll = useCallback(() => {
    if (pollTimerRef.current) return;
    if (sseActiveRef.current) return; // SSE is handling updates
    const delay = backoffDelay(3000, pollFailCountRef.current);
    pollTimerRef.current = setTimeout(async () => {
      pollTimerRef.current = null;
      const ok = await loadConversations();
      if (ok) {
        pollFailCountRef.current = 0;
      } else {
        pollFailCountRef.current += 1;
      }
      if (mountedRef.current && !sseActiveRef.current) schedulePoll();
    }, delay);
  }, [loadConversations]);

  // ---------------------------------------------------------------------------
  // Lifecycle: try SSE first, fall back to polling
  // ---------------------------------------------------------------------------

  // Initial load + start SSE or polling
  useEffect(() => {
    loadConversations();

    const sseStarted = connectSSE();
    if (!sseStarted) {
      // No token or SSE failed to start — use polling
      schedulePoll();
    }

    return () => {
      stopSSE();
      stopPolling();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh on app foreground
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        loadConversations();
        // Reconnect SSE if it was dropped while backgrounded
        if (sseActiveRef.current && !sseAbortRef.current) {
          connectSSE();
        } else if (!sseActiveRef.current) {
          // Restart SSE attempt on foreground
          const sseStarted = connectSSE();
          if (sseStarted) {
            stopPolling();
          }
        }
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );

    return () => {
      subscription.remove();
    };
  }, [loadConversations, connectSSE, stopPolling]);

  // Cleanup
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createConversation = useCallback(
    async (title?: string): Promise<Conversation | null> => {
      try {
        const chat = await createChat(title);
        if (mountedRef.current) {
          setConversations((prev) => [chat, ...prev]);
        }
        return chat;
      } catch (err) {
        if (mountedRef.current) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to create conversation",
          );
        }
        return null;
      }
    },
    [],
  );

  /** Snapshot ref for rollback — safe under concurrent React */
  const deleteSnapshotRef = useRef<Conversation[]>([]);

  const deleteConversation = useCallback(
    async (chatId: string): Promise<boolean> => {
      // Optimistically remove from list immediately with animation
      safeConfigureNext(chatListAnim);
      setConversations((prev) => {
        deleteSnapshotRef.current = prev; // Capture full list for rollback
        return prev.filter((c) => c.id !== chatId);
      });

      try {
        await deleteChat(chatId);
        return true;
      } catch (err) {
        if (mountedRef.current) {
          // Restore to original order on failure
          safeConfigureNext(chatListAnim);
          setConversations(deleteSnapshotRef.current);
          setError(
            err instanceof Error
              ? err.message
              : "Failed to delete conversation",
          );
        }
        return false;
      }
    },
    [],
  );

  const markAsUnread = useCallback(
    async (chatId: string): Promise<void> => {
      // Optimistic: set module-level state + force re-render
      _optimisticState.set(chatId, "unread");
      _readAtMessage.delete(chatId);
      setConversations((prev) => [...prev]);

      try {
        await apiMarkChatAsUnread(chatId);
      } catch {
        // Rollback: clear optimistic state and re-fetch
        _optimisticState.delete(chatId);
        if (mountedRef.current) {
          await loadConversations();
        }
      }
    },
    [loadConversations],
  );

  return {
    conversations,
    isLoading,
    error,
    loadConversations,
    createConversation,
    deleteConversation,
    markAsUnread,
  };
}
