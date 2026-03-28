import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import { getDashboardTasks } from "@/src/api/dashboard";
import type { DashboardReminder } from "@/src/api/types";
import { relativeTime } from "@/src/utils/time";
import { humanSchedule } from "@/src/utils/schedule";

const Separator = () => <View style={styles.separator} />;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  switch (status) {
    case "healthy":
      return "#22c55e";
    case "error":
      return "#ef4444";
    case "retrying":
      return "#eab308";
    default:
      return "#71717a";
  }
}

/** Convert a cron-style schedule string to human-readable text. */
// humanSchedule imported from shared utility

/** Format next fire time prominently */
function formatNextFire(nextFire: string | null): string {
  if (!nextFire) return "Not scheduled";
  const diff = new Date(nextFire).getTime() - Date.now();
  if (diff < 0) return "Overdue";
  if (diff < 60_000) return "In < 1 min";
  if (diff < 3600_000) return `In ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3600_000);
    const mins = Math.round((diff % 3600_000) / 60_000);
    return mins > 0 ? `In ${hours}h ${mins}m` : `In ${hours}h`;
  }
  // Show date for >24h away
  try {
    const d = new Date(nextFire);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return relativeTime(nextFire);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TasksDetailScreen() {
  const [reminders, setReminders] = useState<DashboardReminder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await getDashboardTasks();
      if (mountedRef.current) {
        setReminders(data.reminders);
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

  // Sort by next_fire (soonest first), null/missing at end
  const sortedReminders = useMemo(() => {
    const sorted = [...reminders].sort((a, b) => {
      if (!a.next_fire && !b.next_fire) return 0;
      if (!a.next_fire) return 1;
      if (!b.next_fire) return -1;
      return new Date(a.next_fire).getTime() - new Date(b.next_fire).getTime();
    });
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.trim().toLowerCase();
    return sorted.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.schedule.toLowerCase().includes(q) ||
        humanSchedule(r.schedule).toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q),
    );
  }, [reminders, searchQuery]);

  const renderReminder = useCallback(
    ({ item }: { item: DashboardReminder }) => {
      const nextFireText = formatNextFire(item.next_fire);
      const isOverdue = item.next_fire && new Date(item.next_fire).getTime() < Date.now();
      return (
        <Pressable
          style={styles.reminderRow}
          onPress={() =>
            router.push({
              pathname: "/dashboard/task-detail",
              params: {
                id: item.id,
                title: item.title,
                schedule: item.schedule,
                status: item.status,
                next_fire: item.next_fire ?? "",
                last_fired: item.last_fired ?? "",
                fired_count: String(item.fired_count),
                last_error: item.last_error ?? "",
              },
            } as never)
          }
        >
          {/* Title + status dot */}
          <View style={styles.titleRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: statusColor(item.status) },
              ]}
            />
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
          </View>

          {/* Next fire — prominent */}
          <View style={styles.nextFireRow}>
            <Text
              style={[
                styles.nextFireText,
                isOverdue && styles.nextFireOverdue,
              ]}
            >
              {nextFireText}
            </Text>
            <Text style={styles.scheduleText}>
              {humanSchedule(item.schedule)}
            </Text>
          </View>

          {/* Meta: last fired + fired count */}
          {(item.last_fired || item.fired_count > 0) && (
            <View style={styles.metaRow}>
              {item.last_fired && (
                <Text style={styles.metaText}>
                  Last: {relativeTime(item.last_fired)}
                </Text>
              )}
              {item.fired_count > 0 && (
                <Text style={styles.metaText}>
                  {item.fired_count}× fired
                </Text>
              )}
            </View>
          )}

          {/* Error line */}
          {item.last_error && (
            <Text style={styles.errorLine} numberOfLines={2}>
              {item.last_error}
            </Text>
          )}
        </Pressable>
      );
    },
    [],
  );

  const ListHeader = useCallback(
    () => (
      <View>
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search reminders..."
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
        <Text style={styles.countHeader}>
          {sortedReminders.length} reminder{sortedReminders.length !== 1 ? "s" : ""}
          {searchQuery ? ` matching "${searchQuery}"` : ""} · sorted by next fire
        </Text>
      </View>
    ),
    [searchQuery, sortedReminders.length],
  );

  return (
    <>
      <Stack.Screen options={{ title: "Tasks & Reminders" }} />
      <View style={styles.container}>
        {isLoading && reminders.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#71717a" />
          </View>
        ) : error && reminders.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.loadError}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>⚠️ {error}</Text>
              </View>
            )}
            <FlatList
              data={sortedReminders}
              keyExtractor={(r) => r.id}
              renderItem={renderReminder}
              ItemSeparatorComponent={Separator}
              ListHeaderComponent={ListHeader}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyCenter}>
                  <Text style={styles.emptyText}>
                    {searchQuery ? "No matching reminders" : "No active reminders"}
                  </Text>
                </View>
              }
            />
          </>
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyCenter: {
    paddingTop: 48,
    alignItems: "center",
  },
  listContent: {
    paddingBottom: 24,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  searchInput: {
    backgroundColor: "#27272a",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: 15,
    color: "#fafafa",
    borderWidth: 1,
    borderColor: "#3f3f46",
  },
  countHeader: {
    color: "#52525b",
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  reminderRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  title: {
    color: "#fafafa",
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
  nextFireRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginLeft: 16,
  },
  nextFireText: {
    color: "#3b82f6",
    fontSize: 14,
    fontWeight: "600",
  },
  nextFireOverdue: {
    color: "#ef4444",
  },
  scheduleText: {
    color: "#71717a",
    fontSize: 12,
  },
  metaRow: {
    flexDirection: "row",
    gap: 12,
    marginLeft: 16,
  },
  metaText: {
    color: "#52525b",
    fontSize: 12,
  },
  errorLine: {
    color: "#ef4444",
    fontSize: 12,
    marginLeft: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#27272a",
    marginLeft: 16,
  },
  errorBanner: {
    backgroundColor: "#7f1d1d",
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
  },
  errorBannerText: {
    color: "#fca5a5",
    fontSize: 13,
  },
  loadError: {
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
  emptyText: {
    color: "#52525b",
    fontSize: 15,
  },
});
