import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { getDashboardUsage, getDashboardCcu } from "@/src/api/dashboard";
import type { UsageResponse, UsageSession, DashboardCcuResponse } from "@/src/api/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function costBarWidth(cost: number, maxCost: number): number {
  if (maxCost <= 0) return 0;
  return Math.min(Math.max((cost / maxCost) * 100, 2), 100);
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Time range options
type TimeRange = "today" | "7d" | "30d";

function sinceForRange(range: TimeRange): string {
  const now = new Date();
  switch (range) {
    case "today": {
      return now.toISOString().slice(0, 10).replace(/-/g, "");
    }
    case "7d": {
      const d = new Date(now.getTime() - 7 * 86_400_000);
      return d.toISOString().slice(0, 10).replace(/-/g, "");
    }
    case "30d": {
      const d = new Date(now.getTime() - 30 * 86_400_000);
      return d.toISOString().slice(0, 10).replace(/-/g, "");
    }
  }
}

// ---------------------------------------------------------------------------
// Time Range Picker
// ---------------------------------------------------------------------------

function TimeRangePicker({
  selected,
  onSelect,
}: {
  selected: TimeRange;
  onSelect: (range: TimeRange) => void;
}) {
  const ranges: { label: string; value: TimeRange }[] = [
    { label: "Today", value: "today" },
    { label: "7 Days", value: "7d" },
    { label: "30 Days", value: "30d" },
  ];

  return (
    <View style={styles.rangePicker}>
      {ranges.map((r) => (
        <Pressable
          key={r.value}
          style={[styles.rangeBtn, selected === r.value && styles.rangeBtnActive]}
          onPress={() => onSelect(r.value)}
        >
          <Text style={[styles.rangeBtnText, selected === r.value && styles.rangeBtnTextActive]}>
            {r.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Summary Card
// ---------------------------------------------------------------------------

function SummaryCard({
  totalCost,
  sessionCount,
  totalTokens,
  burnRate,
}: {
  totalCost: number;
  sessionCount: number;
  totalTokens: number;
  burnRate: number | null;
}) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{formatCost(totalCost)}</Text>
          <Text style={styles.summaryLabel}>Total Cost</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{sessionCount}</Text>
          <Text style={styles.summaryLabel}>Sessions</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{formatTokens(totalTokens)}</Text>
          <Text style={styles.summaryLabel}>Tokens</Text>
        </View>
      </View>
      {burnRate != null && burnRate > 0 && (
        <View style={styles.burnRateRow}>
          <Text style={styles.burnRateText}>
            🔥 {formatCost(burnRate)}/hr
          </Text>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Session Cost Row (Leaderboard)
// ---------------------------------------------------------------------------

function SessionCostRow({
  session,
  rank,
  maxCost,
}: {
  session: UsageSession;
  rank: number;
  maxCost: number;
}) {
  const barWidth = costBarWidth(session.total_cost, maxCost);
  const models = session.models?.length ? session.models : Object.keys(session.model_breakdown || {});

  return (
    <View style={styles.sessionRow}>
      <View style={styles.sessionHeader}>
        <View style={styles.sessionLeft}>
          <Text style={styles.sessionRank}>#{rank}</Text>
          <Text style={styles.sessionName} numberOfLines={1}>
            {session.contact_name || session.session_id}
          </Text>
        </View>
        <Text style={styles.sessionCost}>{formatCost(session.total_cost)}</Text>
      </View>

      {/* Cost bar */}
      <View style={styles.barContainer}>
        <View style={[styles.bar, { width: `${barWidth}%` }]} />
      </View>

      {/* Token breakdown */}
      <View style={styles.sessionMeta}>
        <Text style={styles.metaText}>
          {formatTokens(session.total_input_tokens)} in / {formatTokens(session.total_output_tokens)} out
        </Text>
        {session.total_cache_read_tokens > 0 && (
          <Text style={styles.metaCacheText}>
            {formatTokens(session.total_cache_read_tokens)} cached
          </Text>
        )}
        {models.length > 0 && (
          <Text style={styles.metaModels}>
            {models.join(", ")}
          </Text>
        )}
        {session.last_activity && (
          <Text style={styles.metaText}>
            {formatDateLabel(session.last_activity)}
          </Text>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Daily Cost Chart (simple bar chart)
// ---------------------------------------------------------------------------

function DailyCostChart({ daily }: { daily: Array<Record<string, unknown>> }) {
  if (!daily || daily.length === 0) return null;

  // Extract dates and costs
  const items = daily
    .map((d) => ({
      date: String(d.date ?? d.day ?? ""),
      cost: Number(d.totalCost ?? d.total_cost ?? d.cost ?? 0),
    }))
    .filter((d) => d.date)
    .slice(-14); // last 14 days

  if (items.length === 0) return null;

  const maxCost = Math.max(...items.map((d) => d.cost), 0.01);

  return (
    <View style={styles.chartSection}>
      <Text style={styles.chartTitle}>Daily Cost</Text>
      <View style={styles.chartContainer}>
        {items.map((item, i) => {
          const height = Math.max((item.cost / maxCost) * 80, 2);
          return (
            <View key={i} style={styles.chartCol}>
              <Text style={styles.chartBarLabel}>{item.cost > 0 ? formatCost(item.cost) : ""}</Text>
              <View style={styles.chartBarWrapper}>
                <View style={[styles.chartBar, { height }]} />
              </View>
              <Text style={styles.chartDateLabel}>
                {new Date(item.date + "T00:00:00").toLocaleDateString("en-US", {
                  weekday: "narrow",
                })}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function CostsScreen() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [ccu, setCcu] = useState<DashboardCcuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(
    async (range: TimeRange) => {
      try {
        const since = sinceForRange(range);
        const [usageData, ccuData] = await Promise.all([
          getDashboardUsage(since),
          getDashboardCcu(),
        ]);
        setUsage(usageData);
        setCcu(ccuData);
        setError(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load cost data");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    setLoading(true);
    fetchData(timeRange);
  }, [timeRange, fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(timeRange);
  }, [timeRange, fetchData]);

  // Sort sessions by cost descending (leaderboard)
  const sortedSessions = useMemo(() => {
    if (!usage?.sessions) return [];
    return [...usage.sessions].sort((a, b) => b.total_cost - a.total_cost);
  }, [usage]);

  const maxCost = sortedSessions.length > 0 ? sortedSessions[0].total_cost : 1;

  // Burn rate from CCU data
  const burnRate = useMemo(() => {
    if (!ccu?.daily_totals) return null;
    const rate = (ccu.daily_totals as Record<string, unknown>).costPerHour;
    return typeof rate === "number" ? rate : null;
  }, [ccu]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading && !usage) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Cost Analytics" }} />
        <ActivityIndicator color="#a1a1aa" size="large" />
      </View>
    );
  }

  if (error && !usage) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Cost Analytics" }} />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryBtn} onPress={() => fetchData(timeRange)}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#71717a" />
      }
    >
      <Stack.Screen options={{ title: "Cost Analytics", headerBackTitle: "Dashboard" }} />

      {/* Time range picker */}
      <TimeRangePicker selected={timeRange} onSelect={setTimeRange} />

      {/* Loading indicator for background refresh */}
      {usage?._loading && (
        <View style={styles.loadingBanner}>
          <ActivityIndicator color="#3b82f6" size="small" />
          <Text style={styles.loadingBannerText}>Refreshing usage data...</Text>
        </View>
      )}

      {/* Summary card */}
      {usage && (
        <SummaryCard
          totalCost={usage.total_cost}
          sessionCount={usage.session_count}
          totalTokens={usage.total_tokens}
          burnRate={burnRate}
        />
      )}

      {/* Daily cost chart */}
      {ccu?.daily && <DailyCostChart daily={ccu.daily} />}

      {/* Session cost leaderboard */}
      <View style={styles.leaderboardSection}>
        <Text style={styles.sectionHeader}>COST BY SESSION</Text>
        <Text style={styles.sectionSubheader}>Ranked by total cost</Text>

        {sortedSessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No usage data</Text>
            <Text style={styles.emptySubtitle}>
              Cost data will appear as sessions use tokens
            </Text>
          </View>
        ) : (
          sortedSessions.map((session, i) => (
            <SessionCostRow
              key={session.session_id}
              session={session}
              rank={i + 1}
              maxCost={maxCost}
            />
          ))
        )}
      </View>

      {/* Footer */}
      {usage?._updated_at && (
        <Text style={styles.footer}>
          Data from ccusage · Updated{" "}
          {new Date(usage._updated_at).toLocaleTimeString()}
        </Text>
      )}
      {usage?._error && (
        <Text style={styles.footerError}>⚠️ {usage._error}</Text>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
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
  content: {
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    backgroundColor: "#09090b",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 16,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#27272a",
    borderRadius: 8,
  },
  retryText: {
    color: "#fafafa",
    fontSize: 15,
  },

  // Time range
  rangePicker: {
    flexDirection: "row",
    margin: 16,
    backgroundColor: "#18181b",
    borderRadius: 10,
    padding: 3,
  },
  rangeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  rangeBtnActive: {
    backgroundColor: "#27272a",
  },
  rangeBtnText: {
    color: "#71717a",
    fontSize: 14,
    fontWeight: "500",
  },
  rangeBtnTextActive: {
    color: "#fafafa",
  },

  // Loading banner
  loadingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    gap: 8,
  },
  loadingBannerText: {
    color: "#3b82f6",
    fontSize: 13,
  },

  // Summary card
  summaryCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#18181b",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#27272a",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  summaryItem: {
    alignItems: "center",
  },
  summaryValue: {
    color: "#fafafa",
    fontSize: 22,
    fontWeight: "700",
  },
  summaryLabel: {
    color: "#71717a",
    fontSize: 12,
    marginTop: 2,
  },
  burnRateRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#27272a",
    alignItems: "center",
  },
  burnRateText: {
    color: "#eab308",
    fontSize: 14,
    fontWeight: "500",
  },

  // Chart
  chartSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#18181b",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#27272a",
  },
  chartTitle: {
    color: "#a1a1aa",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  chartContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 120,
  },
  chartCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  chartBarLabel: {
    color: "#71717a",
    fontSize: 9,
    marginBottom: 2,
  },
  chartBarWrapper: {
    width: "60%",
    justifyContent: "flex-end",
    alignItems: "stretch",
  },
  chartBar: {
    backgroundColor: "#3b82f6",
    borderRadius: 3,
    minHeight: 2,
    width: "100%",
  },
  chartDateLabel: {
    color: "#52525b",
    fontSize: 10,
    marginTop: 4,
  },

  // Leaderboard
  leaderboardSection: {
    marginHorizontal: 16,
  },
  sectionHeader: {
    color: "#a1a1aa",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  sectionSubheader: {
    color: "#52525b",
    fontSize: 12,
    marginBottom: 12,
  },

  // Session row
  sessionRow: {
    backgroundColor: "#18181b",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#27272a",
  },
  sessionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  sessionLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 12,
  },
  sessionRank: {
    color: "#52525b",
    fontSize: 13,
    fontWeight: "700",
    width: 28,
  },
  sessionName: {
    color: "#fafafa",
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
  sessionCost: {
    color: "#fafafa",
    fontSize: 17,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },

  // Cost bar
  barContainer: {
    height: 6,
    backgroundColor: "#27272a",
    borderRadius: 3,
    marginBottom: 8,
    overflow: "hidden",
  },
  bar: {
    height: 6,
    backgroundColor: "#3b82f6",
    borderRadius: 3,
  },

  // Session meta
  sessionMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaText: {
    color: "#71717a",
    fontSize: 12,
  },
  metaCacheText: {
    color: "#22c55e",
    fontSize: 12,
  },
  metaModels: {
    color: "#52525b",
    fontSize: 12,
  },

  // Empty state
  emptyState: {
    alignItems: "center",
    paddingTop: 40,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: "#fafafa",
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtitle: {
    color: "#71717a",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },

  // Footer
  footer: {
    textAlign: "center",
    color: "#52525b",
    fontSize: 12,
    marginTop: 16,
    paddingHorizontal: 16,
  },
  footerError: {
    textAlign: "center",
    color: "#eab308",
    fontSize: 12,
    marginTop: 4,
    paddingHorizontal: 16,
  },
});
