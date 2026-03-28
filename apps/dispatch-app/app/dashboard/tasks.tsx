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
import { Stack } from "expo-router";
import { getDashboardTasks } from "@/src/api/dashboard";
import type { DashboardReminder } from "@/src/api/types";
import { relativeTime } from "@/src/utils/time";

const Separator = () => <View style={styles.separator} />;

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

  const filteredReminders = useMemo(() => {
    if (!searchQuery.trim()) return reminders;
    const q = searchQuery.trim().toLowerCase();
    return reminders.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.schedule.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q),
    );
  }, [reminders, searchQuery]);

  const renderReminder = useCallback(
    ({ item }: { item: DashboardReminder }) => (
      <View style={styles.reminderRow}>
        <View style={styles.reminderLeft}>
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
          <Text style={styles.schedule}>{item.schedule}</Text>
          <View style={styles.metaRow}>
            {item.next_fire && (
              <Text style={styles.metaText}>
                Next: {relativeTime(item.next_fire)}
              </Text>
            )}
            {item.last_fired && (
              <Text style={styles.metaText}>
                Last: {relativeTime(item.last_fired)}
              </Text>
            )}
            <Text style={styles.metaText}>
              Fired: {item.fired_count}×
            </Text>
          </View>
          {item.last_error && (
            <Text style={styles.errorLine} numberOfLines={2}>
              {item.last_error}
            </Text>
          )}
        </View>
      </View>
    ),
    [],
  );

  const ListHeader = useCallback(
    () => (
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
    ),
    [searchQuery],
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
              data={filteredReminders}
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
    paddingBottom: 8,
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
  reminderRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  reminderLeft: {
    gap: 4,
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
  schedule: {
    color: "#71717a",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginLeft: 16,
  },
  metaRow: {
    flexDirection: "row",
    gap: 12,
    marginLeft: 16,
    marginTop: 2,
  },
  metaText: {
    color: "#52525b",
    fontSize: 12,
  },
  errorLine: {
    color: "#ef4444",
    fontSize: 12,
    marginLeft: 16,
    marginTop: 2,
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
