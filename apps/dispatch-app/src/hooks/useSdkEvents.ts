import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { getAgentSdkEvents } from "../api/agents";
import type { SdkEvent } from "../api/types";

const POLL_INTERVAL = 1000;

export interface UseSdkEventsReturn {
  events: SdkEvent[];
  isLoading: boolean;
  error: string | null;
  /** True when the last SDK event is a "result" (turn complete) */
  isComplete: boolean;
  refresh: () => Promise<void>;
}

/**
 * Stateless SDK events hook — fetches ALL events since the last completed turn.
 * Uses the timestamp of the last "result" event as the boundary, so sending a
 * new message doesn't clear the events list mid-turn.
 */
export function useSdkEvents(
  sessionId: string,
  enabled: boolean,
): UseSdkEventsReturn {
  const [events, setEvents] = useState<SdkEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  const mountedRef = useRef(true);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Timestamp of the last "result" event we saw — used as since_ts boundary */
  const lastResultTsRef = useRef<number | undefined>(undefined);

  /**
   * Fetch all events since the cutoff timestamp.
   * Replaces the entire events array each time for true statelessness.
   */
  const fetchEvents = useCallback(async () => {
    try {
      const res = await getAgentSdkEvents(sessionId, {
        since_ts: lastResultTsRef.current,
        limit: 200,
      });
      if (!mountedRef.current) return;

      // Server returns newest-first, reverse for chronological order
      const sorted = [...res.events].reverse();
      setEvents(sorted);

      // Check if the newest event is a "result" (turn complete)
      if (res.events.length > 0 && res.events[0].event_type === "result") {
        setIsComplete(true);
        // Store the result event's timestamp for the next turn boundary
        lastResultTsRef.current = res.events[0].timestamp;
      } else {
        setIsComplete(false);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // Only set error on first load, silently ignore poll errors
      if (events.length === 0) {
        setError(
          err instanceof Error ? err.message : "Failed to load events",
        );
      }
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(fetchEvents, POLL_INTERVAL);
  }, [fetchEvents]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchEvents();
    setIsLoading(false);
  }, [fetchEvents]);

  // Main effect: start/stop based on enabled
  useEffect(() => {
    if (!enabled) {
      stopPolling();
      // Don't clear events — avoids visual flash when isThinking briefly
      // toggles off/on during server state transitions. Events naturally
      // repopulate from lastResultTsRef when polling resumes.
      return;
    }

    // Reset completion state — prevents stale sdkComplete from prior turn
    setIsComplete(false);

    mountedRef.current = true;
    setIsLoading(true);
    fetchEvents().then(() => {
      if (mountedRef.current) {
        setIsLoading(false);
        startPolling();
      }
    });

    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [enabled, fetchEvents, startPolling, stopPolling]);

  // Pause/resume on app state change
  useEffect(() => {
    if (!enabled) return;
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        fetchEvents();
        startPolling();
      } else {
        stopPolling();
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, [enabled, fetchEvents, startPolling, stopPolling]);

  return { events, isLoading, error, isComplete, refresh };
}
