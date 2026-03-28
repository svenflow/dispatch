import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { getDashboardSkillDetail } from "@/src/api/dashboard";
import type { DashboardSkillDetail } from "@/src/api/types";
import { timeAgoMs, formatDateMs, formatDuration } from "@/src/utils/time";
import { SimpleMarkdown } from "@/src/components/SimpleMarkdown";

// ── Discriminated union for section items ────────────────────────────────────

/** Reuse the invocation type from the API response */
type RecentInvocation = DashboardSkillDetail["recent_invocations"][number];

type SectionItem =
  | { type: "stats"; key: string }
  | { type: "section-header"; key: string; title: string }
  | { type: "session-row"; key: string; data: { session_name: string; count: number } }
  | { type: "recent-row"; key: string; data: RecentInvocation }
  | { type: "skill-md"; key: string; content: string };

/** Max length before a session ID gets truncated */
const SESSION_TRUNCATE_THRESHOLD = 12;
const SESSION_DISPLAY_LENGTH = 8;

/** Pretty-print a session name (strip prefixes) */
function shortSession(s: string): string {
  const parts = s.split("/");
  const last = parts[parts.length - 1];
  if (last.includes(":")) {
    const after = last.split(":")[1];
    return after.length > SESSION_TRUNCATE_THRESHOLD
      ? after.slice(0, SESSION_DISPLAY_LENGTH) + "..."
      : after;
  }
  return last;
}

export default function SkillDetailScreen() {
  const params = useLocalSearchParams<{ name: string }>();
  const name = Array.isArray(params.name) ? params.name[0] : params.name;
  const [detail, setDetail] = useState<DashboardSkillDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMd, setShowMd] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!name) return;
    try {
      const data = await getDashboardSkillDetail(name);
      if (mountedRef.current) {
        setDetail(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setRefreshing(false);
      }
    }
  }, [name]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  useEffect(() => {
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: name || "Skill" }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#71717a" />
        </View>
      </>
    );
  }

  if (error || !detail) {
    return (
      <>
        <Stack.Screen options={{ title: name || "Skill" }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error || "Not found"}</Text>
          <Pressable style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </>
    );
  }

  const errorRate = useMemo(
    () =>
      detail.total_invocations > 0
        ? ((detail.error_count / detail.total_invocations) * 100).toFixed(1)
        : "0",
    [detail.total_invocations, detail.error_count],
  );

  const sections = useMemo<SectionItem[]>(() => [
    { type: "stats", key: "stats" },
    // SKILL.md toggle (if available)
    ...(detail.skill_md
      ? [{ type: "section-header" as const, key: "md-header", title: showMd ? "SKILL.md ▾" : "SKILL.md ▸" }]
      : []),
    ...(detail.skill_md && showMd
      ? [{ type: "skill-md" as const, key: "skill-md", content: detail.skill_md }]
      : []),
    // Session breakdown
    ...(detail.invocations_by_session.length > 0
      ? [{ type: "section-header" as const, key: "session-header", title: "Usage by Session" }]
      : []),
    ...detail.invocations_by_session.map((s) => ({
      type: "session-row" as const,
      key: `session-${s.session_name}`,
      data: s,
    })),
    // Recent invocations
    ...(detail.recent_invocations.length > 0
      ? [{ type: "section-header" as const, key: "recent-header", title: "Recent Invocations" }]
      : []),
    ...detail.recent_invocations.map((inv, i) => ({
      type: "recent-row" as const,
      key: `recent-${i}`,
      data: inv,
    })),
  ], [detail, showMd]);

  const renderItem = useCallback(({ item }: { item: SectionItem }) => {
    switch (item.type) {
      case "stats":
        return (
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{detail.total_invocations}</Text>
              <Text style={styles.statLabel}>Total Uses</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>
                {detail.last_used_ms ? timeAgoMs(detail.last_used_ms) : "never"}
              </Text>
              <Text style={styles.statLabel}>Last Used</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>
                {formatDuration(detail.avg_duration_ms)}
              </Text>
              <Text style={styles.statLabel}>Avg Duration</Text>
            </View>
            <View style={styles.statCard}>
              <Text
                style={[
                  styles.statValue,
                  detail.error_count > 0 && styles.statValueError,
                ]}
              >
                {errorRate}%
              </Text>
              <Text style={styles.statLabel}>Error Rate</Text>
            </View>
          </View>
        );

      case "section-header":
        // Make SKILL.md header tappable
        if (item.key === "md-header") {
          return (
            <Pressable
              onPress={() => setShowMd((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={showMd ? "Collapse SKILL.md" : "Expand SKILL.md"}
            >
              <Text style={[styles.sectionHeader, styles.sectionHeaderTappable]}>
                {item.title}
              </Text>
            </Pressable>
          );
        }
        return <Text style={styles.sectionHeader}>{item.title}</Text>;

      case "skill-md":
        return (
          <View style={styles.mdContainer}>
            <ScrollView
              nestedScrollEnabled
              style={styles.mdScroll}
              showsVerticalScrollIndicator
            >
              <SimpleMarkdown>{item.content}</SimpleMarkdown>
            </ScrollView>
          </View>
        );

      case "session-row": {
        const s = item.data;
        const pct =
          detail.total_invocations > 0
            ? Math.round((s.count / detail.total_invocations) * 100)
            : 0;
        return (
          <View style={styles.sessionRow}>
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionName} numberOfLines={1}>
                {shortSession(s.session_name)}
              </Text>
              <Text style={styles.sessionFull} numberOfLines={1}>
                {s.session_name}
              </Text>
            </View>
            <View style={styles.sessionRight}>
              <Text style={styles.sessionCount}>{s.count}</Text>
              <View style={styles.barContainer}>
                <View style={[styles.barFill, { width: `${Math.max(pct, 4)}%` }]} />
              </View>
            </View>
          </View>
        );
      }

      case "recent-row": {
        const inv = item.data;
        return (
          <View style={styles.recentRow}>
            <View style={styles.recentLeft}>
              <View style={styles.recentDotRow}>
                <View
                  style={[
                    styles.recentDot,
                    inv.is_error ? styles.dotError : styles.dotSuccess,
                  ]}
                />
                <Text style={styles.recentTime}>
                  {formatDateMs(inv.timestamp_ms)}
                </Text>
              </View>
              <Text style={styles.recentSession} numberOfLines={1}>
                {inv.session_name}
              </Text>
            </View>
            <Text style={styles.recentDuration}>
              {formatDuration(inv.duration_ms)}
            </Text>
          </View>
        );
      }

      default:
        return null;
    }
  }, [detail, showMd]);

  return (
    <>
      <Stack.Screen options={{ title: name || "Skill", headerBackTitle: "Skills" }} />
      <View style={styles.container}>
        <FlatList
          data={sections}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.listContent}
          renderItem={renderItem}
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListEmptyComponent={
            <View style={styles.emptyCenter}>
              <Text style={styles.emptyText}>No usage data yet</Text>
            </View>
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    backgroundColor: "#09090b",
  },
  listContent: {
    paddingBottom: 32,
  },
  // Stats grid
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    gap: 10,
  },
  statCard: {
    flex: 1,
    minWidth: "44%",
    backgroundColor: "#18181b",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "#27272a",
  },
  statValue: {
    color: "#fafafa",
    fontSize: 20,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  statValueError: {
    color: "#ef4444",
  },
  statLabel: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "500",
  },
  // Section headers
  sectionHeader: {
    color: "#52525b",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
  },
  sectionHeaderTappable: {
    color: "#60a5fa",
  },
  // SKILL.md preview
  mdContainer: {
    backgroundColor: "#18181b",
    marginHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#27272a",
    maxHeight: 400,
  },
  mdScroll: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  // Session rows
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  sessionInfo: {
    flex: 1,
    gap: 2,
  },
  sessionName: {
    color: "#fafafa",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  sessionFull: {
    color: "#3f3f46",
    fontSize: 11,
  },
  sessionRight: {
    alignItems: "flex-end",
    gap: 4,
    width: 80,
  },
  sessionCount: {
    color: "#a1a1aa",
    fontSize: 13,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  barContainer: {
    width: "100%",
    height: 4,
    backgroundColor: "#27272a",
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    backgroundColor: "#3b82f6",
    borderRadius: 2,
  },
  // Recent invocations
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1c1c1e",
  },
  recentLeft: {
    flex: 1,
    gap: 2,
  },
  recentDotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  recentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotSuccess: {
    backgroundColor: "#22c55e",
  },
  dotError: {
    backgroundColor: "#ef4444",
  },
  recentTime: {
    color: "#a1a1aa",
    fontSize: 13,
  },
  recentSession: {
    color: "#52525b",
    fontSize: 12,
    marginLeft: 12,
  },
  recentDuration: {
    color: "#71717a",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  // Empty / Error
  emptyCenter: {
    paddingTop: 48,
    alignItems: "center",
  },
  emptyText: {
    color: "#52525b",
    fontSize: 15,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: "#fafafa",
    fontSize: 15,
    fontWeight: "600",
  },
});
