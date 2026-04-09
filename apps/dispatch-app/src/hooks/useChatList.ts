// ---------------------------------------------------------------------------
// Performance optimization stack (see also: ChatRow.tsx, chat/[id].tsx)
//
// Problem: WebSocket pushes + 1.5s polling create new Conversation objects
// on every update. Without mitigation, every push re-renders every row.
//
// 1. Per-item fingerprinting: applyChats() compares a string fingerprint
//    per item to preserve object references for unchanged rows — avoids
//    deep-equal on every render cycle.
// 2. React.memo: ChatRow, MessageBubble, SimpleMarkdown skip re-render
//    when props are referentially equal (which fingerprinting guarantees).
// 3. Stable callbacks: parent passes callbacks that accept Conversation;
//    ChatRow composes per-item handlers internally via useCallback —
//    avoids external callback caches and stale-closure risks.
// 4. FlatList tuning: windowSize=7 reduces off-screen renders from ~21
//    screens to ~3. removeClippedSubviews reclaims memory (Android only —
//    causes blank cells on iOS).
// 5. Proxy refs: audioPlayer and lastDeliveredUserMsgId use ref shadows
//    to keep renderItem's useCallback stable even when derived state
//    changes every frame.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { getChats, createChat, deleteChat, markChatAsUnread as apiMarkChatAsUnread } from "../api/chats";
import type { Conversation } from "../api/types";
import { notifyUnreadChatCount } from "../state/unreadChats";
import { makeLayoutAnim, safeConfigureNext, backoffDelay } from "../utils/animation";
import { getApiBaseUrl } from "../config/constants";
import { getDeviceToken } from "../api/client";
import { getCachedChatList, setCachedChatList } from "../utils/messageCache";

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

/** Check if a chat is unread based on server data (no optimistic overrides).
 *  NOTE: This logic is mirrored in server.py GET /unread-count and
 *  send-push UNREAD_COUNT_SQL. All three must stay in sync.
 *  Relies on timestamps being ISO 8601 strings (JS Date comparison matches SQLite string ordering). */
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
// WebSocket helpers
// ---------------------------------------------------------------------------

interface WSChatsEvent {
  type: "chats";
  chats: Conversation[];
}
interface WSKeepalive {
  type: "keepalive";
}
type WSEvent = WSChatsEvent | WSKeepalive;

function parseWSMessage(data: string): WSEvent | null {
  try {
    return JSON.parse(data) as WSEvent;
  } catch {
    console.warn("[useChatList] Malformed WS JSON:", data);
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
  /** Per-item fingerprint for referential stability — React.memo on ChatRow
   *  only helps if unchanged items keep the same object reference.
   *  The FingerprintFields type ensures compile-time enforcement: if a new
   *  render-relevant field is added to Conversation, adding it here produces
   *  a type error until the fingerprint string is also updated. */
  // MUST include every Conversation field that affects ChatRow visual output.
  // If a new render-relevant field is added to Conversation, add it here —
  // TypeScript will enforce the Pick, and the fingerprint string below must
  // also be updated. Intentionally excluded: created_at, updated_at, model,
  // forked_from, fork_message_id, has_notes (not rendered in ChatRow).
  type FingerprintFields = Pick<Conversation,
    "id" | "title" | "last_message" | "last_message_at" | "last_message_role" |
    "is_thinking" | "marked_unread" | "image_url" | "image_status" |
    "last_opened_at" | "status"
  >;
  const itemFingerprintFn = (c: FingerprintFields) =>
    `${c.id}:${c.title}:${c.last_message ?? ""}:${c.last_message_at ?? ""}:${c.last_message_role ?? ""}:${c.is_thinking}:${c.marked_unread}:${c.image_url ?? ""}:${c.image_status ?? ""}:${c.last_opened_at ?? ""}:${c.status ?? ""}`;
  const prevItemFingerprints = useRef(new Map<string, string>());

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

    // Preserve referential stability for unchanged items so React.memo on
    // ChatRow can skip re-rendering rows whose data hasn't changed.
    setConversations((prev) => {
      const prevMap = new Map(prev.map((c) => [c.id, c]));
      const nextFingerprints = new Map<string, string>();
      let changedCount = 0;
      const merged = chats.map((c) => {
        const fp = itemFingerprintFn(c);
        nextFingerprints.set(c.id, fp);
        const existing = prevMap.get(c.id);
        if (existing && prevItemFingerprints.current.get(c.id) === fp) {
          return existing; // Same data — keep existing reference
        }
        if (__DEV__ && prevItemFingerprints.current.has(c.id)) {
          changedCount++;
          if (changedCount <= 3) {
            console.debug(`[useChatList] fingerprint changed: ${c.title}`);
          }
        }
        return c;
      });
      if (__DEV__ && changedCount > 3) {
        const remaining = changedCount - 3;
        console.debug(`[useChatList] ...and ${remaining} more ${remaining === 1 ? "item" : "items"} changed this cycle`);
      }
      // NOTE: mutating the ref inside the updater is safe — React runs
      // updaters synchronously and exactly once in production.
      prevItemFingerprints.current = nextFingerprints;
      return merged;
    });
    setError(null);
    setIsLoading(false);

    // Write-through: update cache with latest data
    setCachedChatList(chats); // fire-and-forget
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
  // WebSocket connection (replaces SSE — React Native has native WS support)
  // ---------------------------------------------------------------------------
  const wsRef = useRef<WebSocket | null>(null);
  const wsActiveRef = useRef(false);
  const wsReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsFailCountRef = useRef(0);

  const stopSSE = useCallback(() => {
    wsActiveRef.current = false;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (wsReconnectTimerRef.current) {
      clearTimeout(wsReconnectTimerRef.current);
      wsReconnectTimerRef.current = null;
    }
  }, []);

  const scheduleSSEReconnect = useCallback(() => {
    if (!mountedRef.current || !wsActiveRef.current) return;
    if (wsReconnectTimerRef.current) return;

    const delay = backoffDelay(2000, wsFailCountRef.current);
    wsReconnectTimerRef.current = setTimeout(() => {
      wsReconnectTimerRef.current = null;
      if (mountedRef.current && wsActiveRef.current) {
        connectSSE();
      }
    }, delay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectSSE = useCallback(() => {
    if (!mountedRef.current) return false;

    const token = getDeviceToken();
    if (!token) return false;

    wsActiveRef.current = true;

    // Build WebSocket URL: http→ws, https→wss
    const httpBase = getApiBaseUrl();
    const wsBase = httpBase.replace(/^http/, "ws");
    const url = `${wsBase}/chats/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      wsFailCountRef.current = 0;
    };

    ws.onmessage = (event) => {
      const msg = parseWSMessage(event.data);
      if (!msg) return;
      if (msg.type === "chats") {
        applyChats(msg.chats);
      }
      // keepalive — nothing to do
    };

    ws.onerror = (err) => {
      console.warn("[useChatList] WS error, will reconnect:", err);
    };

    ws.onclose = () => {
      if (!wsActiveRef.current) return; // Intentional close

      wsFailCountRef.current += 1;
      wsRef.current = null;

      if (mountedRef.current) {
        // Poll once so we don't miss data during reconnect gap
        loadConversations();
        scheduleSSEReconnect();
      }
    };

    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyChats, loadConversations, scheduleSSEReconnect]);

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
    if (wsActiveRef.current) return; // WS is handling updates
    const delay = backoffDelay(3000, pollFailCountRef.current);
    pollTimerRef.current = setTimeout(async () => {
      pollTimerRef.current = null;
      const ok = await loadConversations();
      if (ok) {
        pollFailCountRef.current = 0;
      } else {
        pollFailCountRef.current += 1;
      }
      if (mountedRef.current && !wsActiveRef.current) schedulePoll();
    }, delay);
  }, [loadConversations]);

  // ---------------------------------------------------------------------------
  // Lifecycle: try SSE first, fall back to polling
  // ---------------------------------------------------------------------------

  // Initial load: try cache first for instant display, then fetch from server
  useEffect(() => {
    // Phase 1: Load cached chat list instantly
    getCachedChatList<Conversation>().then((cached) => {
      if (cached && cached.length > 0 && mountedRef.current) {
        // Show cached data immediately — applyChats handles sorting + fingerprinting
        applyChats(cached);
      }
    });

    // Phase 2: Fetch fresh data from server
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

  // Refresh on app foreground — also reconciles iOS app icon badge via
  // loadConversations() → notifyUnreadChatCount() → setBadgeCountAsync()
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        loadConversations();
        // Reconnect WS if it was dropped while backgrounded
        if (wsActiveRef.current && !wsRef.current) {
          connectSSE();
        } else if (!wsActiveRef.current) {
          // Restart WS attempt on foreground
          const wsStarted = connectSSE();
          if (wsStarted) {
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
      // Optimistic: set module-level state + update the conversation object
      // with marked_unread: true so the fingerprint changes and React.memo
      // on ChatRow correctly re-renders only this row.
      _optimisticState.set(chatId, "unread");
      _readAtMessage.delete(chatId);
      setConversations((prev) => prev.map((c) =>
        c.id === chatId ? { ...c, marked_unread: true } : c
      ));

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
