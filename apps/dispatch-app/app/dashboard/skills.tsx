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
import { getDashboardSkills } from "@/src/api/dashboard";
import type { DashboardSkill } from "@/src/api/types";

const Separator = () => <View style={styles.separator} />;

export default function SkillsDetailScreen() {
  const [skills, setSkills] = useState<DashboardSkill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const mountedRef = useRef(true);

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
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.trim().toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, searchQuery]);

  const renderSkill = useCallback(
    ({ item }: { item: DashboardSkill }) => (
      <View style={styles.skillRow}>
        <View style={styles.skillHeader}>
          <Text style={styles.skillName}>{item.name}</Text>
          {item.has_scripts && (
            <Text style={styles.scriptCount}>
              {item.script_count} script{item.script_count !== 1 ? "s" : ""}
            </Text>
          )}
        </View>
        {item.description ? (
          <Text style={styles.description} numberOfLines={3}>
            {item.description}
          </Text>
        ) : null}
      </View>
    ),
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
            placeholder="Search skills..."
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
        <Text style={styles.countHeader}>
          {filteredSkills.length} skill{filteredSkills.length !== 1 ? "s" : ""}
          {searchQuery ? ` matching "${searchQuery}"` : ""}
        </Text>
      </View>
    ),
    [searchQuery, filteredSkills.length],
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
                <Text style={styles.errorBannerText}>⚠️ {error}</Text>
              </View>
            )}
            <FlatList
              data={filteredSkills}
              keyExtractor={(s) => s.name}
              renderItem={renderSkill}
              ItemSeparatorComponent={Separator}
              ListHeaderComponent={ListHeader}
              contentContainerStyle={styles.listContent}
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
  countHeader: {
    color: "#52525b",
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  skillRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  skillHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  skillName: {
    color: "#fafafa",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  scriptCount: {
    color: "#52525b",
    fontSize: 12,
  },
  description: {
    color: "#71717a",
    fontSize: 13,
    lineHeight: 18,
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
