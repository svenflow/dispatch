/**
 * Local message cache — persists messages and chat list to device storage
 * so they load instantly on app open, then refresh from server in background.
 *
 * Uses expo-file-system File/Paths API (same pattern as outbox.ts).
 * Atomic writes: tmp → rename → fallback → cleanup.
 *
 * Design decisions:
 * - One JSON file per chat for messages — simple, fast reads
 * - Single JSON file for chat list — small payload, fast read
 * - Write-through on every poll — keeps cache fresh without extra logic
 * - Never throws — returns null/[] on any error (cache is best-effort)
 * - 2MB cap per cache file — prevents unbounded growth for very long chats
 */
import { File, Paths } from "expo-file-system";

/** Max cache file size (2MB — covers ~5000+ messages) */
const MAX_CACHE_BYTES = 2_000_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitize(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function cacheFile(name: string): File {
  return new File(Paths.document, `cache_${name}.json`);
}

function tmpCacheFile(name: string): File {
  return new File(Paths.document, `cache_${name}.tmp.json`);
}

async function atomicWrite(name: string, json: string): Promise<void> {
  const tmp = tmpCacheFile(name);
  const target = cacheFile(name);

  await tmp.write(json);
  try {
    tmp.move(target);
  } catch {
    await target.write(json);
    try { tmp.delete(); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Messages cache
// ---------------------------------------------------------------------------

/** Read cached messages for a chat. Never throws. */
export async function getCachedMessages<T>(chatId: string): Promise<T[] | null> {
  try {
    const file = cacheFile(`msgs_${sanitize(chatId)}`);
    if (!file.exists) return null;
    const raw = await file.text();
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return data;
  } catch (err) {
    console.warn("[messageCache] getCachedMessages failed", err);
    return null;
  }
}

/** Save messages to cache. Never throws. */
export async function setCachedMessages<T>(chatId: string, messages: T[]): Promise<void> {
  try {
    const json = JSON.stringify(messages);
    if (json.length > MAX_CACHE_BYTES) {
      // Cache only the most recent messages that fit
      const trimmed = messages.slice(-Math.floor(messages.length * 0.8));
      const trimmedJson = JSON.stringify(trimmed);
      if (trimmedJson.length > MAX_CACHE_BYTES) return; // Still too large
      await atomicWrite(`msgs_${sanitize(chatId)}`, trimmedJson);
      return;
    }
    await atomicWrite(`msgs_${sanitize(chatId)}`, json);
  } catch (err) {
    console.warn("[messageCache] setCachedMessages failed", err);
  }
}

// ---------------------------------------------------------------------------
// Chat list cache
// ---------------------------------------------------------------------------

/** Read cached chat list. Never throws. */
export async function getCachedChatList<T>(): Promise<T[] | null> {
  try {
    const file = cacheFile("chatlist");
    if (!file.exists) return null;
    const raw = await file.text();
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return data;
  } catch (err) {
    console.warn("[messageCache] getCachedChatList failed", err);
    return null;
  }
}

/** Save chat list to cache. Never throws. */
export async function setCachedChatList<T>(chats: T[]): Promise<void> {
  try {
    const json = JSON.stringify(chats);
    if (json.length > MAX_CACHE_BYTES) return;
    await atomicWrite("chatlist", json);
  } catch (err) {
    console.warn("[messageCache] setCachedChatList failed", err);
  }
}
