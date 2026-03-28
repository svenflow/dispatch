import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { getDashboardTasks } from "@/src/api/dashboard";
import { relativeTime } from "@/src/utils/time";
import { humanSchedule } from "@/src/utils/schedule";

interface TaskEvent {
  type: string;
  timestamp: number;
  key: string;
  task_id: string | null;
  title: string | null;
}

function eventTypeColor(type: string): string {
  switch (type) {
    case "task.completed":
      return "#22c55e";
    case "task.started":
      return "#3b82f6";
    case "task.requested":
      return "#a1a1aa";
    case "task.timeout":
      return "#ef4444";
    default:
      return "#71717a";
  }
}

function eventTypeLabel(type: string): string {
  switch (type) {
    case "task.completed":
      return "Completed";
    case "task.started":
      return "Started";
    case "task.requested":
      return "Requested";
    case "task.timeout":
      return "Timed out";
    default:
      return type.replace("task.", "");
  }
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function TaskDetailScreen() {
  const params = useLocalSearchParams<{
    id: string;
    title: string;
    schedule: string;
    status: string;
    next_fire: string;
    last_fired: string;
    fired_count: string;
    last_error: string;
  }>();

  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  // Fetch events and match by title similarity
  const load = useCallback(async () => {
    try {
      const data = await getDashboardTasks();
      if (!mountedRef.current) return;

      // Match events by task_id or title similarity
      const taskId = params.id ?? "";
      const taskTitle = (params.title ?? "").toLowerCase();
      // Filter out common/short words that cause false matches
      const stopWords = new Set(["every", "night", "daily", "check", "with", "from", "that", "this", "the", "and", "for"]);
      const titleWords = taskTitle
        .split(/\s+/)
        .filter((w) => w.length > 4 && !stopWords.has(w));

      const matched = data.recent_task_events.filter((e) => {
        if (!e.task_id && !e.title) return false;
        // Exact task_id match (best)
        if (e.task_id && taskId && e.task_id === taskId) return true;
        // Title exact match
        if (e.title && e.title.toLowerCase() === taskTitle) return true;
        // Fuzzy: require ALL significant words to match (not just any one)
        if (e.task_id && titleWords.length >= 2) {
          const tid = e.task_id.toLowerCase();
          return titleWords.every((w) => tid.includes(w));
        }
        return false;
      });

      // Sort newest first
      matched.sort((a, b) => b.timestamp - a.timestamp);
      setEvents(matched);
    } catch {
      // Non-critical
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [params.id, params.title]);

  useEffect(() => {
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const renderEvent = useCallback(
    ({ item }: { item: TaskEvent }) => (
      <View style={styles.eventRow}>
        <View style={styles.eventDotCol}>
          <View
            style={[
              styles.eventDot,
              { backgroundColor: eventTypeColor(item.type) },
            ]}
          />
          <View style={styles.eventLine} />
        </View>
        <View style={styles.eventContent}>
          <View style={styles.eventHeader}>
            <Text
              style={[
                styles.eventType,
                { color: eventTypeColor(item.type) },
              ]}
            >
              {eventTypeLabel(item.type)}
            </Text>
            <Text style={styles.eventTime}>
              {formatTimestamp(item.timestamp)}
            </Text>
          </View>
          {item.key && (
            <Text style={styles.eventKey} numberOfLines={1}>
              {item.key}
            </Text>
          )}
        </View>
      </View>
    ),
    [],
  );

  const firedCount = parseInt(params.fired_count ?? "0", 10);

  return (
    <>
      <Stack.Screen
        options={{
          title: params.title ?? "Task Detail",
          headerBackTitle: "Tasks",
        }}
      />
      <View style={styles.container}>
        {/* Config card */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Status</Text>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      params.status === "healthy"
                        ? "#22c55e"
                        : params.status === "error"
                          ? "#ef4444"
                          : "#71717a",
                  },
                ]}
              />
              <Text style={styles.cardValue}>
                {params.status ?? "unknown"}
              </Text>
            </View>
          </View>
          <View style={styles.cardSep} />
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Schedule</Text>
            <Text style={styles.cardValue} numberOfLines={2}>
              {params.schedule ? humanSchedule(params.schedule) : "—"}
            </Text>
          </View>
          {params.next_fire && (
            <>
              <View style={styles.cardSep} />
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Next Fire</Text>
                <Text style={styles.cardValueBlue}>
                  {relativeTime(params.next_fire)}
                </Text>
              </View>
            </>
          )}
          {params.last_fired && (
            <>
              <View style={styles.cardSep} />
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Last Fired</Text>
                <Text style={styles.cardValue}>
                  {relativeTime(params.last_fired)}
                </Text>
              </View>
            </>
          )}
          <View style={styles.cardSep} />
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Times Fired</Text>
            <Text style={styles.cardValue}>{firedCount}</Text>
          </View>
          {params.last_error && (
            <>
              <View style={styles.cardSep} />
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Last Error</Text>
                <Text style={styles.cardValueError} numberOfLines={3}>
                  {params.last_error}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Event timeline */}
        <Text style={styles.sectionHeader}>RECENT ACTIVITY</Text>
        {isLoading ? (
          <ActivityIndicator
            size="small"
            color="#71717a"
            style={{ marginTop: 20 }}
          />
        ) : events.length === 0 ? (
          <Text style={styles.emptyText}>No recent events found</Text>
        ) : (
          <FlatList
            data={events}
            keyExtractor={(e, i) => `${e.timestamp}-${i}`}
            renderItem={renderEvent}
            contentContainerStyle={styles.timelineContent}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
  },
  card: {
    backgroundColor: "#18181b",
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    overflow: "hidden",
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardSep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#27272a",
    marginLeft: 16,
  },
  cardLabel: {
    color: "#a1a1aa",
    fontSize: 14,
    flexShrink: 0,
  },
  cardValue: {
    color: "#fafafa",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "right",
    flex: 1,
    marginLeft: 16,
  },
  cardValueBlue: {
    color: "#3b82f6",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    flex: 1,
    marginLeft: 16,
  },
  cardValueError: {
    color: "#ef4444",
    fontSize: 13,
    textAlign: "right",
    flex: 1,
    marginLeft: 16,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    justifyContent: "flex-end",
    marginLeft: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionHeader: {
    color: "#52525b",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
  },
  timelineContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  eventRow: {
    flexDirection: "row",
    minHeight: 48,
  },
  eventDotCol: {
    width: 24,
    alignItems: "center",
  },
  eventDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  eventLine: {
    width: 1,
    flex: 1,
    backgroundColor: "#27272a",
    marginTop: 2,
  },
  eventContent: {
    flex: 1,
    paddingBottom: 16,
    paddingLeft: 8,
  },
  eventHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eventType: {
    fontSize: 14,
    fontWeight: "600",
  },
  eventTime: {
    color: "#52525b",
    fontSize: 12,
  },
  eventKey: {
    color: "#71717a",
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    color: "#52525b",
    fontSize: 14,
    textAlign: "center",
    marginTop: 24,
  },
});
