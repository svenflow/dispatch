import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { SdkEvent } from "../api/types";
import { PulsingDots } from "./PulsingDots";
import { isReduceMotionEnabled } from "../utils/animation";

/**
 * Map SDK tool names to human-readable descriptions.
 */
const TOOL_LABELS: Record<string, string> = {
  Bash: "Running command",
  Read: "Reading file",
  Write: "Writing file",
  Edit: "Editing file",
  Grep: "Searching code",
  Glob: "Finding files",
  Agent: "Running subagent",
  WebSearch: "Searching the web",
  WebFetch: "Fetching webpage",
  Skill: "Using skill",
  NotebookEdit: "Editing notebook",
};

interface ThinkingIndicatorProps {
  /** SDK events to display when expanded */
  events?: SdkEvent[];
  /** Whether the indicator is visible — animates in/out */
  visible?: boolean;
}

/**
 * Animated "thinking" indicator shown as a left-aligned bubble with 3 pulsing dots.
 * Tap to expand into a scrolling list of SDK events showing what the agent is doing.
 * Fades in/out smoothly instead of appearing/disappearing instantly.
 */
export function ThinkingIndicator({ events = [], visible = true }: ThinkingIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  const [shouldRender, setShouldRender] = useState(visible);
  const scrollRef = useRef<ScrollView>(null);

  // Entrance/exit animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimeRef = useRef<number>(0); // When the indicator became visible
  const MIN_SHOW_MS = 2000; // Don't hide within this window — prevents flicker from rapid is_thinking toggling

  useEffect(() => {
    if (visible) {
      // Cancel any pending exit animation
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      showTimeRef.current = Date.now();
      setShouldRender(true);
      setExpanded(false); // Reset expanded state on new thinking
      if (isReduceMotionEnabled()) {
        fadeAnim.setValue(1);
        scaleAnim.setValue(1);
      } else {
        Animated.parallel([
          Animated.spring(fadeAnim, {
            toValue: 1,
            tension: 120,
            friction: 14,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            tension: 120,
            friction: 14,
            useNativeDriver: true,
          }),
        ]).start();
      }
    } else {
      // Ensure minimum display time to prevent flicker
      const elapsed = Date.now() - showTimeRef.current;
      const delay = Math.max(100, MIN_SHOW_MS - elapsed);

      const doExit = () => {
        exitTimerRef.current = null;
        if (isReduceMotionEnabled()) {
          fadeAnim.setValue(0);
          scaleAnim.setValue(0.8);
          setShouldRender(false);
        } else {
          Animated.parallel([
            Animated.timing(fadeAnim, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
              toValue: 0.8,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start(({ finished }) => {
            if (finished) setShouldRender(false);
          });
        }
      };

      exitTimerRef.current = setTimeout(doExit, delay);
    }
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [visible, fadeAnim, scaleAnim]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (expanded && events.length > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [expanded, events.length]);

  if (!shouldRender) return null;

  const animatedWrapperStyle = {
    opacity: fadeAnim,
    transform: [{ scale: scaleAnim }],
  };

  if (!expanded) {
    return (
      <Animated.View
        style={[styles.wrapper, animatedWrapperStyle]}
        accessibilityLiveRegion="polite"
        accessibilityLabel="Assistant is thinking"
      >
        <Pressable
          onPress={() => setExpanded(true)}
          style={styles.bubble}
          accessibilityRole="button"
          accessibilityHint="Expand to see thinking details"
        >
          <PulsingDots size={8} gap={5} />
          <Text style={styles.chevron}>▾</Text>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.wrapper, animatedWrapperStyle]}>
      <View style={styles.expandedBubble}>
        <Pressable
          onPress={() => setExpanded(false)}
          style={styles.expandedHeader}
        >
          <PulsingDots size={8} gap={5} />
          <Text style={styles.chevron}>▴</Text>
        </Pressable>
        <ScrollView
          ref={scrollRef}
          style={styles.eventsList}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled={true}
        >
          {events.length === 0 ? (
            <Text style={styles.emptyText}>Waiting for events...</Text>
          ) : (
            mergeEvents(events).map((ev, i) => (
              <EventRow key={ev.id ?? i} event={ev} />
            ))
          )}
        </ScrollView>
      </View>
    </Animated.View>
  );
}

/** Merged event — tool_use + tool_result collapsed into one entry. */
interface MergedEvent extends SdkEvent {
  /** True when tool_result has arrived for this tool_use. */
  completed?: boolean;
}

/**
 * Merge tool_use and tool_result events by tool_use_id into single entries.
 * The tool_use row stays, gains duration_ms and completed flag from tool_result.
 * Non-tool events (text, result, error) pass through unchanged.
 */
function mergeEvents(events: SdkEvent[]): MergedEvent[] {
  const merged: MergedEvent[] = [];
  const toolUseIndex = new Map<string, number>(); // tool_use_id → index in merged[]

  for (const ev of events) {
    if (ev.event_type === "tool_use" && ev.tool_use_id) {
      const idx = merged.length;
      toolUseIndex.set(ev.tool_use_id, idx);
      merged.push({ ...ev, completed: false });
    } else if (ev.event_type === "tool_result" && ev.tool_use_id) {
      const idx = toolUseIndex.get(ev.tool_use_id);
      if (idx !== undefined) {
        // Merge into the existing tool_use row
        merged[idx] = {
          ...merged[idx],
          completed: true,
          duration_ms: ev.duration_ms,
          is_error: ev.is_error,
        };
      } else {
        // Orphan tool_result — show as-is
        merged.push({ ...ev, completed: true });
      }
    } else {
      merged.push({ ...ev });
    }
  }

  return merged;
}

function EventRow({ event }: { event: MergedEvent }) {
  const { event_type, tool_name, payload } = event;
  const completed = event.completed ?? false;

  let label: string;
  let detail: string | null = null;
  let isInProgress = false;
  let isTextEvent = false;

  if (tool_name) {
    const toolLabel = TOOL_LABELS[tool_name] || tool_name;
    if (event_type === "tool_use") {
      label = toolLabel;
      if (completed && event.duration_ms) {
        label += ` (${(event.duration_ms / 1000).toFixed(1)}s)`;
      }
      isInProgress = !completed;
      if (payload) detail = payload;
    } else if (event_type === "tool_result") {
      // Orphan tool_result (no matching tool_use)
      const durationStr = event.duration_ms
        ? ` (${(event.duration_ms / 1000).toFixed(1)}s)`
        : "";
      label = `${toolLabel}${durationStr}`;
    } else {
      label = `${toolLabel} — ${event_type}`;
    }
  } else if (event_type === "result") {
    label = "Turn complete";
  } else if (event_type === "text") {
    label = payload || "Thinking";
    isTextEvent = true;
  } else if (event_type === "error") {
    label = "Error";
    if (payload) detail = payload;
  } else {
    label = event_type;
  }

  return (
    <View style={styles.eventRow}>
      {isTextEvent ? null : completed ? (
        <CheckIcon />
      ) : (
        <View
          style={[
            styles.eventDot,
            isInProgress && styles.eventDotActive,
            event.is_error && styles.eventDotError,
          ]}
        />
      )}
      <View style={styles.eventTextCol}>
        <Text
          style={[
            styles.eventText,
            isInProgress && styles.eventTextActive,
            isTextEvent && styles.eventTextThinking,
            event.is_error && styles.eventTextError,
          ]}
        >
          {label}
        </Text>
        {detail ? (
          <Text style={styles.eventDetail}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Small blue check icon (✓) for completed tools */
function CheckIcon() {
  return (
    <Text style={styles.checkText}>✓</Text>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 12,
    marginTop: 3,
    marginBottom: 8,
    alignItems: "flex-start",
  },
  bubble: {
    backgroundColor: "#27272a",
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  thinkingLabel: {
    color: "#71717a",
    fontSize: 13,
    fontWeight: "500",
    marginLeft: 4,
  },
  chevron: {
    color: "#52525b",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 2,
  },
  expandedBubble: {
    backgroundColor: "#27272a",
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "85%",
    minWidth: "85%",
    gap: 8,
  },
  expandedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  headerLabel: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "500",
  },
  eventsList: {
    maxHeight: 200,
  },
  emptyText: {
    color: "#52525b",
    fontSize: 12,
    fontStyle: "italic",
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 3,
  },
  eventDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#52525b",
    marginTop: 5,
  },
  eventDotActive: {
    backgroundColor: "#a78bfa",
  },
  eventDotError: {
    backgroundColor: "#ef4444",
  },
  eventTextCol: {
    flex: 1,
  },
  eventText: {
    color: "#71717a",
    fontSize: 12,
    flexShrink: 1,
  },
  eventDetail: {
    color: "#52525b",
    fontSize: 11,
    marginTop: 1,
  },
  eventTextActive: {
    color: "#a78bfa",
  },
  eventTextThinking: {
    color: "#d4d4d8",
  },
  eventTextError: {
    color: "#ef4444",
  },
  checkText: {
    color: "#60a5fa",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
    width: 8,
    textAlign: "center",
  },
});
