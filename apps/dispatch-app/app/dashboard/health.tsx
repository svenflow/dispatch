import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { getDashboardHealthEvents } from "@/src/api/dashboard";
import { getDashboardHealth } from "@/src/api/dashboard";
import type { HealthEvent, DashboardHealth, DegradedSession } from "@/src/api/types";
import { timeAgoMs, formatDateMs } from "@/src/utils/time";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function verdictColor(verdict: string): string {
  switch (verdict) {
    case "FATAL":
    case "STUCK":
      return "#ef4444";
    case "HEALTHY":
    case "WORKING":
      return "#22c55e";
    default:
      return "#71717a";
  }
}

function transitionColor(transition: string): string {
  return transition === "opened" ? "#ef4444" : "#22c55e";
}

function eventIcon(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "health.haiku_verdict": {
      const verdict = payload.verdict as string;
      if (verdict === "FATAL" || verdict === "STUCK") return "\u26a0\ufe0f";
      return "\u2705";
    }
    case "health.circuit_breaker":
      return payload.transition === "opened" ? "\ud83d\udea8" : "\u2705";
    case "health.quota_alert":
      return "\ud83d\udcca";
    case "health.bus_check":
      return "\ud83d\udce1";
    default:
      return "\u2022";
  }
}

function eventTitle(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "health.haiku_verdict": {
      const verdict = payload.verdict as string;
      const checkType = payload.check_type as string;
      const session = payload.session_name as string;
      const shortSession = session?.split("/").pop() ?? session;
      return `${checkType} check: ${verdict} \u2014 ${shortSession}`;
    }
    case "health.circuit_breaker": {
      const transition = payload.transition as string;
      const count = payload.restart_count as number;
      return `Circuit breaker ${transition} (${count} failures)`;
    }
    case "health.quota_alert": {
      const quotaType = payload.quota_type as string;
      const util = payload.utilization as number;
      return `${quotaType} at ${Math.round(util)}%`;
    }
    case "health.bus_check":
      return "Bus writability check: OK";
    default:
      return type;
  }
}

function eventSubtitle(type: string, payload: Record<string, unknown>): string | null {
  switch (type) {
    case "health.haiku_verdict": {
      const action = payload.action_taken as string;
      return action !== "none" ? `Action: ${action}` : null;
    }
    case "health.circuit_breaker":
      return payload.session_name as string ?? null;
    case "health.quota_alert": {
      const threshold = payload.threshold as number;
      return `Threshold: ${threshold}%`;
    }
    default:
      return null;
  }
}

function eventReasoning(type: string, payload: Record<string, unknown>): string | null {
  if (type === "health.haiku_verdict") {
    return (payload.reasoning as string) || null;
  }
  return null;
}

function statusDotColor(status: string): string {
  switch (status) {
    case "healthy":
      return "#22c55e";
    case "degraded":
      return "#eab308";
    case "down":
    case "unhealthy":
      return "#ef4444";
    default:
      return "#71717a";
  }
}

function formatSeconds(s: number | null): string {
  if (s == null) return "\u2014";
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({ summary, health }: {
  summary: { total: number; verdicts: number; fatal_count: number; stuck_count: number; circuit_breaker_events: number; quota_alerts: number };
  health: DashboardHealth | null;
}) {
  const sh = health?.session_health;
  return (
    <View style={styles.card}>
      <Text style={styles.cardHeader}>OVERVIEW</Text>

      {/* Session health */}
      {sh && (
        <View style={styles.sessionHealthRow}>
          <View style={styles.healthPill}>
            <View style={[styles.pillDot, { backgroundColor: "#22c55e" }]} />
            <Text style={styles.pillText}>{sh.healthy} healthy</Text>
          </View>
          {sh.degraded > 0 && (
            <View style={styles.healthPill}>
              <View style={[styles.pillDot, { backgroundColor: "#eab308" }]} />
              <Text style={styles.pillText}>{sh.degraded} degraded</Text>
            </View>
          )}
          {sh.unhealthy > 0 && (
            <View style={styles.healthPill}>
              <View style={[styles.pillDot, { backgroundColor: "#ef4444" }]} />
              <Text style={styles.pillText}>{sh.unhealthy} unhealthy</Text>
            </View>
          )}
        </View>
      )}

      {/* Subsystem status */}
      {health && (
        <View style={styles.subsystemRow}>
          <View style={styles.subsystemItem}>
            <View style={[styles.miniDot, { backgroundColor: health.watchdog_running ? "#22c55e" : "#ef4444" }]} />
            <Text style={styles.subsystemLabel}>Watchdog</Text>
          </View>
          <View style={styles.subsystemItem}>
            <View style={[styles.miniDot, { backgroundColor: health.signal_running ? "#22c55e" : "#ef4444" }]} />
            <Text style={styles.subsystemLabel}>Signal</Text>
          </View>
          {health.watchdog_crash_count > 0 && (
            <Text style={styles.crashCount}>{health.watchdog_crash_count} crashes</Text>
          )}
        </View>
      )}

      <View style={styles.separator} />

      {/* Event counts */}
      <View style={styles.statsRow}>
        <StatBadge label="Verdicts" value={summary.verdicts} />
        <StatBadge label="Fatal" value={summary.fatal_count} color={summary.fatal_count > 0 ? "#ef4444" : undefined} />
        <StatBadge label="Stuck" value={summary.stuck_count} color={summary.stuck_count > 0 ? "#eab308" : undefined} />
        <StatBadge label="CB" value={summary.circuit_breaker_events} />
        <StatBadge label="Quota" value={summary.quota_alerts} />
      </View>
    </View>
  );
}

function StatBadge({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.statBadge}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DegradedSessionRow({ session }: { session: DegradedSession }) {
  return (
    <View style={styles.degradedRow}>
      <View style={styles.degradedLeft}>
        <View style={[styles.miniDot, { backgroundColor: statusDotColor(session.status) }]} />
        <Text style={styles.degradedName}>{session.contact || session.name}</Text>
      </View>
      <Text style={styles.degradedIssue}>{session.issue}</Text>
    </View>
  );
}

function EventRow({ event }: { event: HealthEvent }) {
  const icon = eventIcon(event.type, event.payload);
  const title = eventTitle(event.type, event.payload);
  const subtitle = eventSubtitle(event.type, event.payload);
  const reasoning = eventReasoning(event.type, event.payload);
  const time = timeAgoMs(event.timestamp);
  const [expanded, setExpanded] = useState(false);

  const row = (
    <View style={styles.eventRow}>
      <Text style={styles.eventIcon}>{icon}</Text>
      <View style={styles.eventContent}>
        <View style={styles.eventTitleRow}>
          <Text style={styles.eventTitle}>{title}</Text>
          {reasoning && (
            <Text style={styles.expandChevron}>{expanded ? "\u25B4" : "\u25BE"}</Text>
          )}
        </View>
        {subtitle && <Text style={styles.eventSubtitle}>{subtitle}</Text>}
        {expanded && reasoning && (
          <Text style={styles.eventReasoning}>{reasoning}</Text>
        )}
      </View>
      <Text style={styles.eventTime}>{time}</Text>
    </View>
  );

  if (reasoning) {
    return (
      <Pressable onPress={() => setExpanded(!expanded)}>
        {row}
      </Pressable>
    );
  }
  return row;
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function HealthDetailScreen() {
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [summary, setSummary] = useState({ total: 0, verdicts: 0, fatal_count: 0, stuck_count: 0, circuit_breaker_events: 0, quota_alerts: 0 });
  const [health, setHealth] = useState<DashboardHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const [healthData, eventsData] = await Promise.all([
        getDashboardHealth(),
        getDashboardHealthEvents(48, 100),
      ]);
      if (mountedRef.current) {
        setHealth(healthData);
        setEvents(eventsData.events);
        setSummary(eventsData.summary);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const degradedSessions = health?.session_health?.degraded_sessions ?? [];

  const renderEvent = useCallback(
    ({ item }: { item: HealthEvent }) => <EventRow event={item} />,
    [],
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "Health Checks" }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#71717a" />
        </View>
      </View>
    );
  }

  if (error && events.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "Health Checks" }} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorEmoji}>{"\u26a0\ufe0f"}</Text>
          <Text style={styles.errorTitle}>Unable to load health data</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Health Checks" }} />
      <FlatList
        data={events}
        renderItem={renderEvent}
        keyExtractor={(item, index) => `${item.type}-${item.timestamp}-${index}`}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={load}
            tintColor="#71717a"
          />
        }
        ListHeaderComponent={
          <>
            {error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{"\u26a0\ufe0f"} {error}</Text>
              </View>
            )}

            <SummaryCard summary={summary} health={health} />

            {/* Degraded sessions */}
            {degradedSessions.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardHeader}>DEGRADED SESSIONS</Text>
                {degradedSessions.map((s, i) => (
                  <DegradedSessionRow key={s.name ?? i} session={s} />
                ))}
              </View>
            )}

            <Text style={styles.timelineHeader}>EVENT TIMELINE (48h)</Text>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No health events in the last 48 hours</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.eventSeparator} />}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
  },
  listContent: {
    paddingBottom: 48,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  // Cards
  card: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
  },
  cardHeader: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 12,
  },

  // Session health pills
  sessionHealthRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  healthPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#27272a",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    color: "#fafafa",
    fontSize: 13,
    fontWeight: "500",
  },

  // Subsystem status
  subsystemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 12,
  },
  subsystemItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  miniDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  subsystemLabel: {
    color: "#a1a1aa",
    fontSize: 13,
  },
  crashCount: {
    color: "#ef4444",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#27272a",
    marginVertical: 12,
  },

  // Stats row
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statBadge: {
    alignItems: "center",
    flex: 1,
  },
  statValue: {
    color: "#fafafa",
    fontSize: 20,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  statLabel: {
    color: "#71717a",
    fontSize: 10,
    fontWeight: "500",
    marginTop: 2,
  },

  // Degraded sessions
  degradedRow: {
    paddingVertical: 8,
  },
  degradedLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  degradedName: {
    color: "#fafafa",
    fontSize: 14,
    fontWeight: "500",
  },
  degradedIssue: {
    color: "#71717a",
    fontSize: 12,
    marginLeft: 12,
  },

  // Event timeline
  timelineHeader: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
    marginHorizontal: 20,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  eventIcon: {
    fontSize: 16,
    marginRight: 10,
    marginTop: 1,
  },
  eventContent: {
    flex: 1,
  },
  eventTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  eventTitle: {
    color: "#fafafa",
    fontSize: 14,
    flex: 1,
  },
  expandChevron: {
    color: "#52525b",
    fontSize: 12,
  },
  eventSubtitle: {
    color: "#71717a",
    fontSize: 12,
    marginTop: 2,
  },
  eventReasoning: {
    color: "#a1a1aa",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 6,
    backgroundColor: "#1c1c1e",
    borderRadius: 6,
    padding: 8,
    overflow: "hidden",
  },
  eventTime: {
    color: "#52525b",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginLeft: 8,
  },
  eventSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#27272a",
    marginLeft: 42,
  },

  // Empty state
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyText: {
    color: "#52525b",
    fontSize: 14,
  },

  // Error states
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    color: "#fafafa",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  errorMessage: {
    color: "#71717a",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: "#27272a",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: "#fafafa",
    fontSize: 14,
    fontWeight: "500",
  },
  errorBanner: {
    backgroundColor: "#7f1d1d",
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 8,
  },
  errorBannerText: {
    color: "#fca5a5",
    fontSize: 13,
  },
});
