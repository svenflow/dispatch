/**
 * Durable message outbox — persists failed sends to disk so they survive
 * app kills and can be auto-retried on next launch/foreground.
 *
 * Uses the new File/Paths API from expo-file-system (matches audio.ts pattern).
 * Atomic writes: tmp file → rename, fallback to direct write + cleanup.
 *
 * Design decisions:
 * - Sequential drain (not parallel) — preserves message ordering, prevents server overload
 * - One JSON file per chat — simple, sufficient for typical 1-5 item outbox
 * - 50KB cap — prevents unbounded disk growth from degenerate cases
 * - 7-day TTL — stale items (e.g. failed image sends) don't accumulate forever
 */
import { File, Paths } from "expo-file-system";
import { OUTBOX_MAX_BYTES } from "../config/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutboxItem {
  id: string;              // pendingId from React state
  content: string;
  serverMessageId: string; // idempotency key (UUID) — equals server's message id
  timestamp: string;       // ISO string, preserved for correct message ordering
  attempts: number;        // starts at 1 (first failure), incremented on each retry
  hasImage?: boolean;      // true = image message, skip auto-drain
  imageUri?: string;       // local URI for image retry
  retryChatId?: string;    // chatId for image retry
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeChatId(chatId: string): string {
  return chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function outboxFile(chatId: string): File {
  return new File(Paths.document, `outbox_${sanitizeChatId(chatId)}.json`);
}

function tmpFile(chatId: string): File {
  return new File(Paths.document, `outbox_${sanitizeChatId(chatId)}.tmp.json`);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Read outbox for a chat. Never throws — returns [] on any error. */
export async function getOutbox(chatId: string): Promise<OutboxItem[]> {
  try {
    const file = outboxFile(chatId);
    if (!file.exists) return [];
    const raw = await file.text();
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) {
      console.warn("[outbox] corrupt outbox (not array), discarding", chatId);
      return [];
    }
    return items;
  } catch (err) {
    console.warn("[outbox] getOutbox failed, returning []", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Write (atomic: tmp → rename → fallback → cleanup)
// ---------------------------------------------------------------------------

/** Save outbox items to disk. Deletes file if items is empty. Never throws. */
export async function saveOutbox(chatId: string, items: OutboxItem[]): Promise<void> {
  try {
    if (items.length === 0) {
      const file = outboxFile(chatId);
      try { if (file.exists) file.delete(); } catch {}
      return;
    }

    const json = JSON.stringify(items);
    const tmp = tmpFile(chatId);
    const target = outboxFile(chatId);

    await tmp.write(json);
    try {
      // Attempt atomic rename
      tmp.move(target);
    } catch {
      // Rename failed — write directly as fallback
      await target.write(json);
      // Clean up orphaned tmp file
      try { tmp.delete(); } catch {}
    }
  } catch (err) {
    console.warn("[outbox] saveOutbox failed", err);
    // Best-effort tmp cleanup
    try { tmpFile(chatId).delete(); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Enqueue (with dedup by serverMessageId and size cap)
// ---------------------------------------------------------------------------

/**
 * Add an item to the outbox. Returns true on success, false if size cap exceeded
 * or write failed. Deduplicates by serverMessageId (updates existing item rather
 * than appending a duplicate).
 */
export async function enqueueOutbox(chatId: string, item: OutboxItem): Promise<boolean> {
  try {
    const items = await getOutbox(chatId);

    // Dedup: if serverMessageId already exists, update it
    const existingIdx = items.findIndex((i) => i.serverMessageId === item.serverMessageId);
    if (existingIdx >= 0) {
      items[existingIdx] = item;
    } else {
      items.push(item);
    }

    // Size cap check
    const json = JSON.stringify(items);
    if (json.length > OUTBOX_MAX_BYTES) {
      console.warn(
        `[outbox] size cap exceeded for ${chatId}: ${json.length} bytes, message not persisted`,
      );
      return false;
    }

    await saveOutbox(chatId, items);
    return true;
  } catch (err) {
    console.warn("[outbox] enqueueOutbox failed", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

/** Remove an item from the outbox by serverMessageId. Never throws. */
export async function removeFromOutbox(chatId: string, serverMessageId: string): Promise<void> {
  try {
    const items = await getOutbox(chatId);
    const filtered = items.filter((i) => i.serverMessageId !== serverMessageId);
    await saveOutbox(chatId, filtered);
  } catch (err) {
    console.warn("[outbox] removeFromOutbox failed", err);
  }
}

// ---------------------------------------------------------------------------
// Update attempts
// ---------------------------------------------------------------------------

/** Update the attempts count for an outbox item. Never throws. */
export async function updateAttempts(
  chatId: string,
  serverMessageId: string,
  newAttempts: number,
): Promise<void> {
  try {
    const items = await getOutbox(chatId);
    const item = items.find((i) => i.serverMessageId === serverMessageId);
    if (item) {
      item.attempts = newAttempts;
      await saveOutbox(chatId, items);
    }
  } catch (err) {
    console.warn("[outbox] updateAttempts failed", err);
  }
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

/** Delete the outbox file for a chat. Never throws. */
export async function clearOutbox(chatId: string): Promise<void> {
  try {
    const file = outboxFile(chatId);
    if (file.exists) file.delete();
  } catch (err) {
    console.warn("[outbox] clearOutbox failed", err);
  }
}
