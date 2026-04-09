import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { getDashboardFacts, createFact, updateFact, deleteFact } from "@/src/api/dashboard";
import type { Fact } from "@/src/api/types";
import { relativeTime } from "@/src/utils/time";

const Separator = () => <View style={styles.separator} />;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "#22c55e"; // green
  if (confidence >= 0.5) return "#eab308"; // yellow
  return "#ef4444"; // red
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.5) return "Medium";
  return "Low";
}

function isStale(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return true;
  const ts = new Date(updatedAt).getTime();
  if (Number.isNaN(ts)) return true;
  const age = Date.now() - ts;
  return age > 30 * 24 * 60 * 60 * 1000; // 30 days
}

function factTypeEmoji(factType: string): string {
  switch (factType.toLowerCase()) {
    case "travel": return "✈️";
    case "preference": return "⭐";
    case "event": return "📅";
    case "relationship": return "👥";
    case "location": return "📍";
    case "work": return "💼";
    case "health": return "🏥";
    case "food": return "🍽️";
    case "hobby": return "🎮";
    default: return "📝";
  }
}

function formatAge(isoStr: string | null | undefined): string {
  if (!isoStr) return "";
  const ts = new Date(isoStr).getTime();
  if (Number.isNaN(ts)) return "";
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "just now";
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ---------------------------------------------------------------------------
// Fact Row
// ---------------------------------------------------------------------------

function FactRow({
  fact,
  onEdit,
  onDelete,
}: {
  fact: Fact;
  onEdit: (fact: Fact) => void;
  onDelete: (fact: Fact) => void;
}) {
  const stale = isStale(fact.updated_at);

  const handleLongPress = () => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Edit", "Delete", "Cancel"],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) onEdit(fact);
          if (idx === 1) onDelete(fact);
        },
      );
    } else {
      Alert.alert("Fact", fact.summary, [
        { text: "Edit", onPress: () => onEdit(fact) },
        { text: "Delete", style: "destructive", onPress: () => onDelete(fact) },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.factRow, pressed && styles.factRowPressed]}
      onLongPress={handleLongPress}
    >
      <View style={styles.factHeader}>
        <Text style={styles.factType}>
          {factTypeEmoji(fact.fact_type)} {fact.fact_type}
        </Text>
        <View style={styles.factMeta}>
          {stale && <Text style={styles.staleBadge}>STALE</Text>}
          <View style={[styles.confidenceDot, { backgroundColor: confidenceColor(fact.confidence) }]} />
          <Text style={[styles.confidenceText, { color: confidenceColor(fact.confidence) }]}>
            {confidenceLabel(fact.confidence)}
          </Text>
        </View>
      </View>
      <Text style={styles.factSummary}>{fact.summary}</Text>
      {fact.details ? (
        <Text style={styles.factDetails} numberOfLines={2}>
          {fact.details}
        </Text>
      ) : null}
      <View style={styles.factFooter}>
        <Text style={styles.factAge}>{formatAge(fact.updated_at)}</Text>
        {fact.source === "manual" && (
          <Text style={styles.manualBadge}>manual</Text>
        )}
        {fact.starts_at && (
          <Text style={styles.factDate}>
            {new Date(fact.starts_at).toLocaleDateString()}
            {fact.ends_at ? ` → ${new Date(fact.ends_at).toLocaleDateString()}` : ""}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Add/Edit Modal (inline prompt-based for simplicity)
// ---------------------------------------------------------------------------

function showAddFactPrompt(
  contacts: string[],
  onSubmit: (data: { contact: string; fact_type: string; summary: string; details?: string }) => void,
) {
  Alert.prompt(
    "New Fact",
    "Enter fact as: contact | type | summary\nExample: John | travel | Going to Paris in June",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Add",
        onPress: (value: string | undefined) => {
          if (!value) return;
          const parts = value.split("|").map((s: string) => s.trim());
          if (parts.length < 3) {
            Alert.alert("Invalid format", "Use: contact | type | summary");
            return;
          }
          onSubmit({
            contact: parts[0],
            fact_type: parts[1],
            summary: parts[2],
            details: parts[3] || undefined,
          });
        },
      },
    ],
    "plain-text",
  );
}

function showEditFactPrompt(fact: Fact, onSubmit: (summary: string) => void) {
  Alert.prompt(
    "Edit Fact",
    `Editing: ${fact.summary}`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: (value: string | undefined) => {
          if (value && value !== fact.summary) {
            onSubmit(value);
          }
        },
      },
    ],
    "plain-text",
    fact.summary,
  );
}

// ---------------------------------------------------------------------------
// Filter Pills
// ---------------------------------------------------------------------------

function FilterPills({
  options,
  selected,
  onSelect,
}: {
  options: string[];
  selected: string;
  onSelect: (val: string) => void;
}) {
  return (
    <View style={styles.pills}>
      {options.map((opt) => (
        <Pressable
          key={opt}
          style={[styles.pill, selected === opt && styles.pillActive]}
          onPress={() => onSelect(opt)}
        >
          <Text style={[styles.pillText, selected === opt && styles.pillTextActive]}>
            {opt}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function FactsScreen() {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [contactFilter, setContactFilter] = useState("All");
  const [refreshing, setRefreshing] = useState(false);

  const fetchFacts = useCallback(async () => {
    try {
      const data = await getDashboardFacts();
      setFacts(data.facts);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load facts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchFacts();
  }, [fetchFacts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchFacts();
  }, [fetchFacts]);

  // Unique contacts for filter
  const contacts = useMemo(() => {
    const names = [...new Set(facts.map((f) => f.contact))].sort();
    return ["All", ...names];
  }, [facts]);

  // Filter + search
  const filtered = useMemo(() => {
    let result = facts.filter((f) => f.active);
    if (contactFilter !== "All") {
      result = result.filter((f) => f.contact === contactFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (f) =>
          f.summary.toLowerCase().includes(q) ||
          f.details?.toLowerCase().includes(q) ||
          f.fact_type.toLowerCase().includes(q) ||
          f.contact.toLowerCase().includes(q),
      );
    }
    return result;
  }, [facts, contactFilter, search]);

  // Group by contact
  const sections = useMemo(() => {
    const grouped: Record<string, Fact[]> = {};
    for (const fact of filtered) {
      if (!grouped[fact.contact]) grouped[fact.contact] = [];
      grouped[fact.contact].push(fact);
    }
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([contact, data]) => ({
        title: contact,
        data: data.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
      }));
  }, [filtered]);

  const handleAdd = useCallback(() => {
    const contactNames = [...new Set(facts.map((f) => f.contact))];
    showAddFactPrompt(contactNames, async (data) => {
      try {
        const newFact = await createFact({
          ...data,
          confidence: 1.0, // manual facts are high confidence
        });
        setFacts((prev) => [newFact, ...prev]);
      } catch (e: unknown) {
        Alert.alert("Error", e instanceof Error ? e.message : "Failed to create fact");
      }
    });
  }, [facts]);

  const handleEdit = useCallback((fact: Fact) => {
    showEditFactPrompt(fact, async (summary) => {
      try {
        const updated = await updateFact(fact.id, { summary });
        setFacts((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      } catch (e: unknown) {
        Alert.alert("Error", e instanceof Error ? e.message : "Failed to update fact");
      }
    });
  }, []);

  const handleDelete = useCallback((fact: Fact) => {
    Alert.alert("Delete Fact", `Delete "${fact.summary}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteFact(fact.id);
            setFacts((prev) => prev.filter((f) => f.id !== fact.id));
          } catch (e: unknown) {
            Alert.alert("Error", e instanceof Error ? e.message : "Failed to delete fact");
          }
        },
      },
    ]);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Knowledge Base" }} />
        <ActivityIndicator color="#a1a1aa" size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Knowledge Base" }} />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryBtn} onPress={fetchFacts}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Knowledge Base", headerBackTitle: "Dashboard" }} />

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search facts..."
          placeholderTextColor="#71717a"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Contact filter pills */}
      {contacts.length > 2 && (
        <View style={styles.filterContainer}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={contacts}
            keyExtractor={(item) => item}
            contentContainerStyle={styles.pillsContent}
            renderItem={({ item }) => (
              <Pressable
                style={[styles.pill, contactFilter === item && styles.pillActive]}
                onPress={() => setContactFilter(item)}
              >
                <Text style={[styles.pillText, contactFilter === item && styles.pillTextActive]}>
                  {item}
                </Text>
              </Pressable>
            )}
          />
        </View>
      )}

      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          {filtered.length} fact{filtered.length !== 1 ? "s" : ""}
          {contactFilter !== "All" ? ` for ${contactFilter}` : ` across ${contacts.length - 1} contacts`}
        </Text>
      </View>

      {/* Facts list grouped by contact */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
            <Text style={styles.sectionCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <FactRow fact={item} onEdit={handleEdit} onDelete={handleDelete} />
        )}
        SectionSeparatorComponent={() => <View style={{ height: 8 }} />}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No facts found</Text>
            <Text style={styles.emptySubtitle}>
              {search ? "Try a different search" : "Facts are extracted from conversations automatically"}
            </Text>
          </View>
        }
      />

      {/* FAB to add fact */}
      <Pressable style={styles.fab} onPress={handleAdd}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
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

  // Search
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchInput: {
    backgroundColor: "#18181b",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    color: "#fafafa",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#27272a",
  },

  // Filters
  filterContainer: {
    paddingBottom: 8,
  },
  pillsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  pills: {
    flexDirection: "row",
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#27272a",
  },
  pillActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  pillText: {
    color: "#a1a1aa",
    fontSize: 13,
    fontWeight: "500",
  },
  pillTextActive: {
    color: "#fafafa",
  },

  // Summary
  summaryBar: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  summaryText: {
    color: "#71717a",
    fontSize: 13,
  },

  // Section headers
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionHeaderText: {
    color: "#a1a1aa",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionCount: {
    color: "#52525b",
    fontSize: 12,
    fontWeight: "500",
  },

  // Fact rows
  factRow: {
    backgroundColor: "#18181b",
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  factRowPressed: {
    opacity: 0.7,
  },
  factHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  factType: {
    color: "#a1a1aa",
    fontSize: 12,
    fontWeight: "500",
    textTransform: "capitalize",
  },
  factMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  staleBadge: {
    color: "#eab308",
    fontSize: 10,
    fontWeight: "700",
    backgroundColor: "#422006",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: "hidden",
    marginRight: 6,
  },
  confidenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  confidenceText: {
    fontSize: 11,
    fontWeight: "500",
  },
  factSummary: {
    color: "#fafafa",
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 20,
  },
  factDetails: {
    color: "#a1a1aa",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  factFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  factAge: {
    color: "#52525b",
    fontSize: 12,
  },
  manualBadge: {
    color: "#3b82f6",
    fontSize: 10,
    fontWeight: "600",
    backgroundColor: "#172554",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: "hidden",
  },
  factDate: {
    color: "#52525b",
    fontSize: 12,
  },

  // List
  listContent: {
    paddingBottom: 100,
  },
  separator: {
    height: 6,
  },

  // Empty state
  emptyState: {
    alignItems: "center",
    paddingTop: 80,
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

  // FAB
  fab: {
    position: "absolute",
    right: 20,
    bottom: 32,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#3b82f6",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  fabText: {
    color: "#fafafa",
    fontSize: 28,
    fontWeight: "400",
    lineHeight: 30,
  },
});
