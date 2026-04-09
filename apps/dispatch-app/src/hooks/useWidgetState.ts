/**
 * useWidgetState — generic persistent state hook for widgets.
 *
 * Uses expo-file-system File/Paths API (same pattern as outbox.ts) to persist
 * widget-local state to disk. State survives app kills and restarts.
 *
 * Usage:
 *   const [state, setState, loaded] = useWidgetState<MyState>(messageId, "cooking", defaultState);
 *   if (!loaded) return null;
 *
 * File layout: Paths.document/widget-state/<widgetType>_<messageId>.json
 * Atomic writes: tmp file → rename, fallback to direct write + cleanup.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { File, Paths } from "expo-file-system";

// ---------------------------------------------------------------------------
// File helpers (matches outbox.ts pattern)
// ---------------------------------------------------------------------------

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function stateFile(widgetType: string, messageId: string): File {
  return new File(
    Paths.document,
    `ws_${sanitizeId(widgetType)}_${sanitizeId(messageId)}.json`,
  );
}

function tmpStateFile(widgetType: string, messageId: string): File {
  return new File(
    Paths.document,
    `ws_${sanitizeId(widgetType)}_${sanitizeId(messageId)}.tmp.json`,
  );
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

async function loadState<T>(widgetType: string, messageId: string): Promise<T | null> {
  try {
    const file = stateFile(widgetType, messageId);
    if (!file.exists) return null;
    const raw = await file.text();
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[widgetState] load failed (${widgetType}/${messageId}):`, err);
    return null;
  }
}

async function saveState<T>(widgetType: string, messageId: string, state: T): Promise<void> {
  try {
    const json = JSON.stringify(state);
    const tmp = tmpStateFile(widgetType, messageId);
    const target = stateFile(widgetType, messageId);

    await tmp.write(json);
    try {
      tmp.move(target);
    } catch {
      // Rename failed — write directly as fallback
      await target.write(json);
      try { tmp.delete(); } catch {}
    }
  } catch (err) {
    console.warn(`[widgetState] save failed (${widgetType}/${messageId}):`, err);
    try { tmpStateFile(widgetType, messageId).delete(); } catch {}
  }
}

/** Delete persisted state for a widget instance. */
export async function clearWidgetState(widgetType: string, messageId: string): Promise<void> {
  try {
    const file = stateFile(widgetType, messageId);
    if (file.exists) file.delete();
  } catch (err) {
    console.warn(`[widgetState] clear failed (${widgetType}/${messageId}):`, err);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type SetWidgetState<T> = (updater: T | ((prev: T) => T)) => void;

/**
 * Persistent widget state hook.
 *
 * @param messageId  Unique message ID (or widget key)
 * @param widgetType Widget type string (e.g. "cooking", "ask_question")
 * @param defaultState Default state when nothing is persisted
 * @returns [state, setState, loaded] — loaded is false until disk read completes
 */
export function useWidgetState<T>(
  messageId: string,
  widgetType: string,
  defaultState: T | (() => T),
): [T, SetWidgetState<T>, boolean] {
  const [state, setStateInternal] = useState<T>(
    typeof defaultState === "function" ? (defaultState as () => T)() : defaultState,
  );
  const [loaded, setLoaded] = useState(false);
  const stateRef = useRef(state);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync
  stateRef.current = state;

  // Load on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadState<T>(widgetType, messageId);
      if (cancelled) return;
      if (saved !== null) {
        setStateInternal(saved);
        stateRef.current = saved;
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [widgetType, messageId]);

  // Debounced save — writes at most once per 500ms to avoid thrashing disk
  const scheduleSave = useCallback(
    (newState: T) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveState(widgetType, messageId, newState);
      }, 500);
    },
    [widgetType, messageId],
  );

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Synchronous flush of latest state
        saveState(widgetType, messageId, stateRef.current);
      }
    };
  }, [widgetType, messageId]);

  // Wrapped setState that also triggers persistence
  const setState: SetWidgetState<T> = useCallback(
    (updater) => {
      setStateInternal((prev) => {
        const next = typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater;
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  return [state, setState, loaded];
}
