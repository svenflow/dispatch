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
import { Stack, useRouter } from "expo-router";
import { getDashboardSkills } from "@/src/api/dashboard";
import type { DashboardSkill } from "@/src/api/types";
import { timeAgoMs } from "@/src/utils/time";

const Separator = () => <View style={styles.separator} />;

type SortMode = "recent" | "popular" | "name";

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "popular", label: "Popular" },
  { key: "name", label: "A-Z" },
];

function sortSkills(skills: DashboardSkill[], mode: SortMode): DashboardSkill[] {
  const sorted = [...skills];
  switch (mode) {
    case "recent":
      return sorted.sort((a, b) => {
        if (a.last_used_ms && b.last_used_ms) return b.last_used_ms - a.last_used_ms;
        if (a.last_used_ms) return -1;
        if (b.last_used_ms) return 1;
        return a.name.localeCompare(b.name);
      });
    case "popular":
      return sorted.sort((a, b) => {
        if (b.total_invocations !== a.total_invocations)
          return b.total_invocations - a.total_invocations;
        return a.name.localeCompare(b.name);
      });
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export default function SkillsListScreen() {
  const [skills, setSkills] = useState<DashboardSkill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const mountedRef = useRef(true);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const data = await getDashboardSkills();
      if (mountedRef.current) {
        setSkills(data.skills);
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
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  useEffect(() => {
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const filteredSkills = useMemo(() => {
    const sorted = sortSkills(skills, sortMode);
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.trim().toLowerCase();
    return sorted.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, searchQuery, sortMode]);

  const renderSkill = useCallback(
    ({ item }: { item: DashboardSkill }) => (
      <Pressable
        style={({ pressed }) => [styles.skillRow, pressed && styles.skillRowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${item.name} skill, ${item.total_invocations} uses`}
        onPress={() =>
          router.push({
            pathname: "/dashboard/skill-detail",
            params: { name: item.name },
          })
        }
      >
        <View style={styles.skillHeader}>
          <View style={styles.skillNameRow}>
            <Text style={styles.skillName}>{item.name}</Text>
            {item.total_invocations > 0 && (
              <View style={styles.usageBadge}>
                <Text style={styles.usageBadgeText}>{item.total_invocations}</Text>
              </View>
            )}
          </View>
          <View style={styles.skillMeta}>
            {item.last_used_ms ? (
              <Text style={styles.lastUsed}>{timeAgoMs(item.last_used_ms)}</Text>
            ) : (
              <Text style={styles.neverUsed}>never used</Text>
            )}
            <Text style={styles.chevron}>›</Text>
          </View>
        </View>
        {item.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        {item.has_scripts && (
          <Text style={styles.scriptCount}>
            {item.script_count} script{item.script_count !== 1 ? "s" : ""}
          </Text>
        )}
      </Pressable>
    ),
    [router],
  );

  const ListHeader = useMemo(
    () => (
      <View>
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search skills..."
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
        {/* Sort picker */}
        <View style={styles.sortRow}>
          {SORT_OPTIONS.map((opt) => (
            <Pressable
              key={opt.key}
              style={[styles.sortPill, sortMode === opt.key && styles.sortPillActive]}
              onPress={() => setSortMode(opt.key)}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${opt.label}`}
              accessibilityState={{ selected: sortMode === opt.key }}
            >
              <Text
                style={[
                  styles.sortPillText,
                  sortMode === opt.key && styles.sortPillTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
          <Text style={styles.countLabel}>
            {filteredSkills.length} skill{filteredSkills.length !== 1 ? "s" : ""}
          </Text>
        </View>
      </View>
    ),
    [searchQuery, filteredSkills.length, sortMode],
  );

  return (
    <>
      <Stack.Screen options={{ title: "Skills" }} />
      <View style={styles.container}>
        {isLoading && skills.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#71717a" />
          </View>
        ) : error && skills.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            )}
            <FlatList
              data={filteredSkills}
              keyExtractor={(s) => s.name}
              renderItem={renderSkill}
              ItemSeparatorComponent={Separator}
              ListHeaderComponent={ListHeader}
              contentContainerStyle={styles.listContent}
              refreshing={refreshing}
              onRefresh={onRefresh}
              ListEmptyComponent={
                <View style={styles.emptyCenter}>
                  <Text style={styles.emptyText}>
                    {searchQuery ? "No matching skills" : "No skills found"}
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
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  sortPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#27272a",
  },
  sortPillActive: {
    backgroundColor: "#1e3a5f",
    borderColor: "#3b82f6",
  },
  sortPillText: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "600",
  },
  sortPillTextActive: {
    color: "#60a5fa",
  },
  countLabel: {
    color: "#52525b",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: "auto",
  },
  skillRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  skillRowPressed: {
    backgroundColor: "#18181b",
  },
  skillHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  skillNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  skillName: {
    color: "#fafafa",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  usageBadge: {
    backgroundColor: "#1e3a5f",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  usageBadgeText: {
    color: "#60a5fa",
    fontSize: 11,
    fontWeight: "700",
  },
  skillMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  lastUsed: {
    color: "#a1a1aa",
    fontSize: 12,
  },
  neverUsed: {
    color: "#3f3f46",
    fontSize: 12,
    fontStyle: "italic",
  },
  chevron: {
    color: "#52525b",
    fontSize: 18,
    fontWeight: "600",
  },
  description: {
    color: "#71717a",
    fontSize: 13,
    lineHeight: 18,
  },
  scriptCount: {
    color: "#52525b",
    fontSize: 12,
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
  emptyText: {
    color: "#52525b",
    fontSize: 15,
  },
});
