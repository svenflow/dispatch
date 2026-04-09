/**
 * Web fallback for outbox — uses localStorage instead of expo-file-system.
 * Same interface as outbox.ts (native).
 */
import { OUTBOX_MAX_BYTES } from "../config/constants";

export interface OutboxItem {
  id: string;
  content: string;
  serverMessageId: string;
  timestamp: string;
  attempts: number;
  hasImage?: boolean;
  imageUri?: string;
  retryChatId?: string;
}

function sanitizeChatId(chatId: string): string {
  return chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function storageKey(chatId: string): string {
  return `outbox_${sanitizeChatId(chatId)}`;
}

export async function getOutbox(chatId: string): Promise<OutboxItem[]> {
  try {
    const raw = localStorage.getItem(storageKey(chatId));
    if (!raw) return [];
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.warn("[outbox.web] getOutbox failed, returning []", err);
    return [];
  }
}

export async function saveOutbox(chatId: string, items: OutboxItem[]): Promise<void> {
  try {
    if (items.length === 0) {
      localStorage.removeItem(storageKey(chatId));
    } else {
      localStorage.setItem(storageKey(chatId), JSON.stringify(items));
    }
  } catch (err) {
    console.warn("[outbox.web] saveOutbox failed", err);
  }
}

export async function enqueueOutbox(chatId: string, item: OutboxItem): Promise<boolean> {
  try {
    const items = await getOutbox(chatId);
    const existingIdx = items.findIndex((i) => i.serverMessageId === item.serverMessageId);
    if (existingIdx >= 0) {
      items[existingIdx] = item;
    } else {
      items.push(item);
    }
    const json = JSON.stringify(items);
    if (json.length > OUTBOX_MAX_BYTES) {
      console.warn("[outbox.web] size cap exceeded, message not persisted");
      return false;
    }
    await saveOutbox(chatId, items);
    return true;
  } catch (err) {
    console.warn("[outbox.web] enqueueOutbox failed", err);
    return false;
  }
}

export async function removeFromOutbox(chatId: string, serverMessageId: string): Promise<void> {
  try {
    const items = await getOutbox(chatId);
    await saveOutbox(chatId, items.filter((i) => i.serverMessageId !== serverMessageId));
  } catch (err) {
    console.warn("[outbox.web] removeFromOutbox failed", err);
  }
}

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
    console.warn("[outbox.web] updateAttempts failed", err);
  }
}

export async function clearOutbox(chatId: string): Promise<void> {
  try {
    localStorage.removeItem(storageKey(chatId));
  } catch (err) {
    console.warn("[outbox.web] clearOutbox failed", err);
  }
}
