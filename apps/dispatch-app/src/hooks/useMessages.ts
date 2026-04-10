import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, InteractionManager, type AppStateStatus } from "react-native";
import { getMessages, sendPrompt, sendPromptWithImage } from "../api/chats";
import { getAgentMessages, sendAgentMessage } from "../api/agents";
import type { ChatMessage, AgentMessage, WidgetData, WidgetResponse } from "../api/types";
import { MESSAGE_POLL_INTERVAL, OUTBOX_MAX_RETRIES, OUTBOX_TTL_MS, DRAIN_ITEM_TIMEOUT_MS } from "../config/constants";
import { generateUUID } from "../utils/uuid";
import { makeLayoutAnim, safeConfigureNext, backoffDelay } from "../utils/animation";
import {
  getOutbox,
  saveOutbox,
  enqueueOutbox,
  removeFromOutbox,
  updateAttempts,
  type OutboxItem,
} from "../utils/outbox";
import { getCachedMessages, setCachedMessages } from "../utils/messageCache";

/** iMessage-like eased animation for new messages — no bounce, just smooth */
const messageEaseAnim = makeLayoutAnim(300);

// ---------------------------------------------------------------------------
// Unified message type used by the UI layer
// ---------------------------------------------------------------------------

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO string
  isPending?: boolean;
  sendFailed?: boolean; // true when send failed — shows "Not Delivered" + retry
  attempts?: number; // number of send attempts — used for maxedOut display (>= OUTBOX_MAX_RETRIES)
  serverMessageId?: string; // idempotency key sent to server — reused on retry to prevent duplicates
  audioUrl?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  localImageUri?: string | null; // optimistic preview (local file URI)
  retryChatId?: string; // chatId for image message retry
  status?: string; // "generating" | "complete" | "failed"
  reactions?: string[]; // emoji reactions
  widgetData?: WidgetData | null;
  widgetResponse?: WidgetResponse | null;
  respondedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Adapter interface — lets useMessages work with chats OR agents
// ---------------------------------------------------------------------------

export interface FetchResult {
  messages: DisplayMessage[];
  is_thinking?: boolean;
}

export interface MessageAdapter {
  /** Fetch messages, optionally only those after `sinceTs` (ISO string) */
  fetchMessages(opts: {
    sinceTs?: string;
  }): Promise<FetchResult>;

  /** Send a new message, returns a temporary id. messageId is an idempotency key for dedup. */
  sendMessage(text: string, messageId?: string): Promise<{ id: string }>;

  /** Polling interval in ms */
  pollInterval: number;
}

// ---------------------------------------------------------------------------
// Chat adapter — wraps src/api/chats.ts
// ---------------------------------------------------------------------------

export function chatAdapter(chatId: string): MessageAdapter {
  return {
    pollInterval: MESSAGE_POLL_INTERVAL,

    async fetchMessages({ sinceTs }) {
      const res = await getMessages(chatId, sinceTs);
      return {
        messages: (res.messages ?? []).map(chatMessageToDisplay),
        is_thinking: res.is_thinking,
      };
    },

    async sendMessage(text: string, messageId?: string) {
      const res = await sendPrompt(text, chatId, messageId);
      return { id: res.request_id };
    },
  };
}

function chatMessageToDisplay(m: ChatMessage): DisplayMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.created_at,
    audioUrl: m.audio_url,
    imageUrl: m.image_url,
    videoUrl: m.video_url,
    status: m.status,
    reactions: m.reactions,
    widgetData: m.widget_data ?? null,
    widgetResponse: m.widget_response ?? null,
    respondedAt: m.responded_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Agent adapter — wraps src/api/agents.ts
// ---------------------------------------------------------------------------

export function agentAdapter(sessionId: string): MessageAdapter {
  return {
    pollInterval: 2000,

    async fetchMessages({ sinceTs }) {
      const opts: { after_ts?: number } = {};
      if (sinceTs) {
        opts.after_ts = new Date(sinceTs).getTime();
      }
      const res = await getAgentMessages(sessionId, opts);
      return {
        messages: (res.messages ?? []).map(agentMessageToDisplay),
        is_thinking: res.is_thinking,
      };
    },

    async sendMessage(text: string, messageId?: string) {
      const res = await sendAgentMessage(sessionId, text, messageId);
      return { id: res.message_id ?? generateUUID() };
    },
  };
}

function agentMessageToDisplay(m: AgentMessage): DisplayMessage {
  return {
    id: m.id,
    role: m.role === "user" ? "user" : "assistant",
    content: m.text,
    timestamp: new Date(m.timestamp_ms).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// useMessages hook
// ---------------------------------------------------------------------------

export interface UseMessagesReturn {
  messages: DisplayMessage[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  isThinking: boolean;
  sendMessage: (text: string) => Promise<void>;
  sendMessageWithImage: (text: string, imageUri: string, chatId: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  refresh: () => Promise<void>;
  toggleReaction: (messageId: string, emoji: string) => void;
}

export function useMessages(adapter: MessageAdapter, cacheKey?: string, outboxChatId?: string): UseMessagesReturn {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isThinking, _setIsThinking] = useState(false);
  const isThinkingRef = useRef(false);

  // Wrapper that logs is_thinking transitions for debugging intermittent bubble issues
  const setIsThinking = useCallback((value: boolean) => {
    if (value !== isThinkingRef.current) {
      console.log(`[useMessages] is_thinking: ${isThinkingRef.current} → ${value}`);
      isThinkingRef.current = value;
    }
    _setIsThinking(value);
  }, []);

  const mountedRef = useRef(true);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  // Track the latest timestamp we've seen for incremental polling
  const latestTsRef = useRef<string | undefined>(undefined);

  // Track consecutive poll failures to surface persistent connection issues
  const pollFailCountRef = useRef(0);
  const MAX_SILENT_POLL_FAILURES = 5;

  // Outbox: guard against concurrent drain runs
  const isDrainingRef = useRef(false);

  // Ref mirror of messages for non-stale access in callbacks
  const messagesRef = useRef(messages);
  messagesRef.current = messages;


  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  const updateLatestTs = useCallback((msgs: DisplayMessage[]) => {
    if (msgs.length === 0) return;
    const newest = msgs.reduce((a, b) =>
      a.timestamp > b.timestamp ? a : b,
    );
    if (
      !latestTsRef.current ||
      newest.timestamp > latestTsRef.current
    ) {
      latestTsRef.current = newest.timestamp;
    }
  }, []);

  // -----------------------------------------------------------------------
  // Initial load — try cache first for instant display, then refresh from server
  // -----------------------------------------------------------------------

  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const loadInitial = useCallback(async () => {
    setError(null);

    // Phase 1: Load from cache for instant display
    if (cacheKeyRef.current) {
      try {
        const cached = await getCachedMessages<DisplayMessage>(cacheKeyRef.current);
        if (cached && cached.length > 0 && mountedRef.current) {
          setMessages(cached);
          updateLatestTs(cached);
          setIsLoading(false);
          // Show bottom spinner while refreshing from server
          setIsRefreshing(true);
        }
      } catch {
        // Cache read failed — continue to server fetch with full spinner
      }
    }

    // Phase 2: Fetch fresh data from server
    try {
      const result = await adapterRef.current.fetchMessages({});
      if (!mountedRef.current) return;

      // Animate the cache→server transition so new messages don't "pop in"
      if (messagesRef.current.length > 0) {
        safeConfigureNext(messageEaseAnim);
      }
      setMessages(result.messages);
      updateLatestTs(result.messages);

      // Use server-reported thinking status if available, otherwise infer from last message role
      if (result.is_thinking !== undefined) {
        setIsThinking(result.is_thinking);
      } else if (result.messages.length > 0 && result.messages[result.messages.length - 1].role === "user") {
        setIsThinking(true);
      }

      // Write-through: update cache with fresh data
      if (cacheKeyRef.current) {
        setCachedMessages(cacheKeyRef.current, result.messages); // fire-and-forget
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // Only show error if we have no cached data to display
      if (messagesRef.current.length === 0) {
        setError(err instanceof Error ? err.message : "Failed to load messages");
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [updateLatestTs]);

  // -----------------------------------------------------------------------
  // Outbox: convert persisted item to display message
  // -----------------------------------------------------------------------

  function outboxItemToDisplayMessage(item: OutboxItem): DisplayMessage {
    return {
      id: item.id,
      role: "user",
      content: item.content,
      timestamp: item.timestamp,
      isPending: false,
      sendFailed: true,
      serverMessageId: item.serverMessageId,
      attempts: item.attempts,
      localImageUri: item.imageUri,
      retryChatId: item.retryChatId,
    };
  }

  // -----------------------------------------------------------------------
  // Outbox: merge persisted outbox items after loadInitial
  // -----------------------------------------------------------------------

  const mergeOutbox = useCallback(async () => {
    if (!outboxChatId) return;

    const outboxItems = await getOutbox(outboxChatId);
    if (outboxItems.length === 0) return;

    // TTL purge: drop items older than 7 days
    const now = Date.now();
    const fresh = outboxItems.filter((i) => now - new Date(i.timestamp).getTime() < OUTBOX_TTL_MS);
    const purged = outboxItems.length - fresh.length;
    if (purged > 0) {
      console.info(`[outbox] TTL purged ${purged} items for ${outboxChatId}`);
      await saveOutbox(outboxChatId, fresh);
    }

    if (fresh.length === 0) return;

    // Get current server messages — server id === client serverMessageId
    const currentMessages = messagesRef.current;
    const serverIds = new Set(
      currentMessages.map((m) => m.serverMessageId ?? m.id),
    );

    // Partition: delivered (server has it) vs pending (server doesn't)
    const delivered = fresh.filter((i) => serverIds.has(i.serverMessageId));
    const pending = fresh.filter((i) => !serverIds.has(i.serverMessageId));

    // Remove delivered from disk
    if (delivered.length > 0) {
      await saveOutbox(outboxChatId, pending);
    }

    // Inject pending into React state (dedup by serverMessageId)
    if (pending.length > 0) {
      const existingServerMsgIds = new Set(
        currentMessages
          .filter((m) => m.serverMessageId)
          .map((m) => m.serverMessageId),
      );
      const toInject = pending.filter(
        (i) => !existingServerMsgIds.has(i.serverMessageId),
      );

      if (toInject.length > 0) {
        console.info(`[outbox] injected ${toInject.length} items for ${outboxChatId}`);
        safeConfigureNext(messageEaseAnim);
        setMessages((prev) => [...prev, ...toInject.map(outboxItemToDisplayMessage)]);
      }
    }
  }, [outboxChatId]);

  // -----------------------------------------------------------------------
  // Outbox: drain — auto-retry non-image items with attempts < MAX_RETRIES
  // -----------------------------------------------------------------------

  const drainOutbox = useCallback(async () => {
    if (!outboxChatId) return;
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;

    let drained = 0;
    let total = 0;

    try {
      const items = await getOutbox(outboxChatId);
      const drainable = items.filter(
        (i) => !i.hasImage && i.attempts < OUTBOX_MAX_RETRIES,
      );
      total = drainable.length;

      for (const item of drainable) {
        if (!mountedRef.current) break;
        try {
          await Promise.race([
            adapterRef.current.sendMessage(item.content, item.serverMessageId),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("drain item timeout")), DRAIN_ITEM_TIMEOUT_MS),
            ),
          ]);
          // Success — remove from outbox, mark as pending in state (poll will confirm)
          await removeFromOutbox(outboxChatId, item.serverMessageId);
          setMessages((prev) =>
            prev.map((m) =>
              m.serverMessageId === item.serverMessageId
                ? { ...m, isPending: true, sendFailed: false, attempts: undefined }
                : m,
            ),
          );
          drained++;
        } catch {
          // Failed — increment attempts on disk AND in React state
          const newAttempts = item.attempts + 1;
          try {
            await updateAttempts(outboxChatId, item.serverMessageId, newAttempts);
          } catch (diskErr) {
            console.warn("[outbox] updateAttempts disk write failed during drain", diskErr);
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.serverMessageId === item.serverMessageId
                ? { ...m, attempts: newAttempts }
                : m,
            ),
          );
        }
      }
    } catch (err) {
      console.warn("[outbox] drainOutbox unexpected error", err);
    } finally {
      isDrainingRef.current = false;
      if (drained > 0) {
        console.info(`[outbox] drained ${drained}/${total} items for ${outboxChatId}`);
      }
    }
  }, [outboxChatId]);

  // -----------------------------------------------------------------------
  // Poll for new messages
  // -----------------------------------------------------------------------

  const poll = useCallback(async () => {
    try {
      const sinceTs = latestTsRef.current;
      const result = await adapterRef.current.fetchMessages({
        sinceTs,
      });
      if (!mountedRef.current) return;

      // Reset failure count and clear connection error on success
      if (pollFailCountRef.current >= MAX_SILENT_POLL_FAILURES) {
        setError(null);
      }
      pollFailCountRef.current = 0;

      const newMsgs = result.messages;

      // Update thinking status from server — no optimistic override
      if (result.is_thinking !== undefined) {
        setIsThinking(result.is_thinking);
      }

      if (newMsgs.length === 0) return;

      // Schedule animation before state update — configureNext applies to the next layout commit
      safeConfigureNext(messageEaseAnim);

      setMessages((prev) => {
        // Merge: remove pending duplicates, add new, dedup by id
        const existingIds = new Set(prev.map((m) => m.id));
        const truly_new = newMsgs.filter((m) => !existingIds.has(m.id));

        if (truly_new.length === 0) return prev;

        // Remove pending/failed messages that match incoming server messages by serverMessageId
        // This handles both optimistic inserts (isPending) and outbox-hydrated items (sendFailed)
        const newIds = new Set(truly_new.map((m) => m.id));
        const filtered = prev.filter(
          (m) => (!m.isPending && !m.sendFailed) || !m.serverMessageId || !newIds.has(m.serverMessageId),
        );

        // Fallback: also match by content for messages without serverMessageId.
        // Safe because user-typed chat messages are unique in practice.
        const newContents = new Set(truly_new.map((m) => m.content));
        const deduped = filtered.filter(
          (m) => !m.isPending || m.serverMessageId || !newContents.has(m.content),
        );

        // Final dedup: ensure no duplicate IDs (prevents React key warnings)
        const merged = [...deduped, ...truly_new];
        const seen = new Set<string>();
        return merged.filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
      });

      updateLatestTs(newMsgs);

      // Clean up outbox items confirmed by server
      if (outboxChatId) {
        for (const msg of newMsgs) {
          // Server message id matches outbox serverMessageId
          removeFromOutbox(outboxChatId, msg.id); // fire-and-forget
        }
      }

      // Write-through: update cache with current state
      if (cacheKeyRef.current) {
        // Grab latest state after merge — messagesRef is updated synchronously
        setTimeout(() => {
          if (cacheKeyRef.current) {
            setCachedMessages(cacheKeyRef.current, messagesRef.current); // fire-and-forget
          }
        }, 0);
      }

      // Fallback: check if assistant has responded — stop thinking indicator
      // (only used when server doesn't provide is_thinking)
      if (result.is_thinking === undefined) {
        const hasAssistantReply = newMsgs.some((m) => m.role === "assistant");
        if (hasAssistantReply) {
          setIsThinking(false);
        }
      }
    } catch (err) {
      // Surface persistent connection issues after repeated failures
      console.warn(`[useMessages] poll failed (${pollFailCountRef.current + 1})`, err);
      pollFailCountRef.current += 1;
      if (
        mountedRef.current &&
        pollFailCountRef.current >= MAX_SILENT_POLL_FAILURES
      ) {
        setError("Connection lost — retrying...");
      }
    }
  }, [updateLatestTs]);

  // -----------------------------------------------------------------------
  // Start / stop polling — exponential backoff on repeated failures
  // -----------------------------------------------------------------------

  const schedulePoll = useCallback(() => {
    if (pollingRef.current) return;
    const delay = backoffDelay(adapterRef.current.pollInterval, pollFailCountRef.current);
    pollingRef.current = setTimeout(async () => {
      pollingRef.current = null;
      await poll();
      if (mountedRef.current) schedulePoll();
    }, delay);
  }, [poll]);

  const startPolling = useCallback(() => {
    schedulePoll();
  }, [schedulePoll]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // -----------------------------------------------------------------------
  // Send message — optimistic insert
  // -----------------------------------------------------------------------

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const serverMessageId = generateUUID();
      const pendingId = `pending-${Date.now()}-${Math.random()}`;
      const pendingMsg: DisplayMessage = {
        id: pendingId,
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
        isPending: true,
        serverMessageId,
      };

      safeConfigureNext(messageEaseAnim);
      setMessages((prev) => [...prev, pendingMsg]);
      // Don't set isThinking optimistically — let the server drive it
      setError(null);

      try {
        await adapterRef.current.sendMessage(trimmed, serverMessageId);
      } catch {
        if (!mountedRef.current) return;
        // Mark message as failed instead of removing — user can retry
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { ...m, isPending: false, sendFailed: true, attempts: 1 }
              : m,
          ),
        );
        setIsThinking(false);

        // Persist to outbox for durability across app kills
        if (outboxChatId) {
          const ok = await enqueueOutbox(outboxChatId, {
            id: pendingId,
            content: trimmed,
            serverMessageId,
            timestamp: pendingMsg.timestamp,
            attempts: 1,
          });
          if (!ok) {
            console.warn("[outbox] enqueue failed — message not durable");
          }
        }
      }
    },
    [outboxChatId],
  );

  // -----------------------------------------------------------------------
  // Retry a failed message
  // -----------------------------------------------------------------------

  const retryMessage = useCallback(
    async (messageId: string) => {
      const failedMsg = messagesRef.current.find((m) => m.id === messageId && m.sendFailed);
      if (!failedMsg) return;

      // If maxedOut (attempts >= MAX_RETRIES), user intent = fresh start — reset attempts
      if (outboxChatId && failedMsg.serverMessageId && (failedMsg.attempts ?? 0) >= OUTBOX_MAX_RETRIES) {
        await updateAttempts(outboxChatId, failedMsg.serverMessageId, 0);
      }

      // Mark as pending again — keep attempts undefined to suppress failure label during retry
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, isPending: true, sendFailed: false, attempts: undefined }
            : m,
        ),
      );

      try {
        // Retry with image if the original message had one
        if (failedMsg.localImageUri && failedMsg.retryChatId) {
          await sendPromptWithImage(failedMsg.content, failedMsg.localImageUri, failedMsg.retryChatId);
        } else {
          await adapterRef.current.sendMessage(failedMsg.content, failedMsg.serverMessageId);
        }
        // Success — remove from outbox
        if (outboxChatId && failedMsg.serverMessageId) {
          await removeFromOutbox(outboxChatId, failedMsg.serverMessageId);
        }
      } catch {
        if (!mountedRef.current) return;
        const newAttempts = (failedMsg.attempts ?? 0) + 1;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, isPending: false, sendFailed: true, attempts: newAttempts }
              : m,
          ),
        );
        setIsThinking(false);

        // Update attempts in outbox
        if (outboxChatId && failedMsg.serverMessageId) {
          try {
            await updateAttempts(outboxChatId, failedMsg.serverMessageId, newAttempts);
          } catch (diskErr) {
            console.warn("[outbox] updateAttempts failed during retry", diskErr);
          }
        }
      }
    },
    [outboxChatId],
  );

  // -----------------------------------------------------------------------
  // Send message with image — optimistic insert with local preview
  // -----------------------------------------------------------------------

  const sendMessageWithImage = useCallback(
    async (text: string, imageUri: string, chatId: string) => {
      const trimmed = text.trim();

      const serverMessageId = generateUUID();
      const pendingId = `pending-img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const pendingMsg: DisplayMessage = {
        id: pendingId,
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
        isPending: true,
        localImageUri: imageUri,
        serverMessageId,
        retryChatId: chatId,
      };

      safeConfigureNext(messageEaseAnim);
      setMessages((prev) => [...prev, pendingMsg]);
      // Don't set isThinking optimistically — let the server drive it
      setError(null);

      try {
        await sendPromptWithImage(trimmed, imageUri, chatId, serverMessageId);
      } catch {
        if (!mountedRef.current) return;
        // Mark as failed — consistent with text send failure UX
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { ...m, isPending: false, sendFailed: true, attempts: 1 }
              : m,
          ),
        );
        setIsThinking(false);

        // Persist to outbox — hasImage:true means skip auto-drain (manual retry only)
        if (outboxChatId) {
          await enqueueOutbox(outboxChatId, {
            id: pendingId,
            content: trimmed,
            serverMessageId,
            timestamp: pendingMsg.timestamp,
            attempts: 1,
            hasImage: true,
            imageUri,
            retryChatId: chatId,
          });
        }
      }
    },
    [outboxChatId],
  );

  // -----------------------------------------------------------------------
  // Refresh (pull to refresh or manual)
  // -----------------------------------------------------------------------

  const refresh = useCallback(async () => {
    latestTsRef.current = undefined;
    await loadInitial();
  }, [loadInitial]);

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    // Defer heavy init until navigation animation settles — prevents
    // JS thread contention that makes keyboard/UI animations janky.
    const task = InteractionManager.runAfterInteractions(() => {
      if (!mountedRef.current) return;
      loadInitial()
        .then(() => { if (mountedRef.current) return mergeOutbox(); })
        .then(() => { if (mountedRef.current) return drainOutbox(); })
        .then(() => { if (mountedRef.current) startPolling(); });
    });

    return () => {
      mountedRef.current = false;
      task.cancel();
      stopPolling();
    };
  }, [loadInitial, mergeOutbox, drainOutbox, startPolling, stopPolling]);

  // Pause polling when app backgrounds, resume when foregrounded
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        // Full reload on foreground, then merge outbox + drain + resume polling
        loadInitial()
          .then(() => { if (mountedRef.current) return mergeOutbox(); })
          .then(() => { if (mountedRef.current) return drainOutbox(); })
          .then(() => { if (mountedRef.current) startPolling(); });
      } else {
        stopPolling();
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, [loadInitial, mergeOutbox, drainOutbox, startPolling, stopPolling]);

  const toggleReaction = useCallback((messageId: string, emoji: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const current = m.reactions ?? [];
        const has = current.includes(emoji);
        return { ...m, reactions: has ? current.filter((r) => r !== emoji) : [...current, emoji] };
      }),
    );
  }, []);

  return {
    messages,
    isLoading,
    isRefreshing,
    error,
    isThinking,
    sendMessage,
    sendMessageWithImage,
    retryMessage,
    refresh,
    toggleReaction,
  };
}
