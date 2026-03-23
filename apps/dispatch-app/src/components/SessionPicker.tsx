import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { getAgentSessions } from "../api/agents";
import type { AgentSession } from "../api/types";
import { pickerBaseStyles } from "../styles/pickerStyles";
import { createFuzzySearch } from "../utils/fuzzySearch";

interface SessionPickerProps {
  onSelect: (session: AgentSession) => void;
  onClose: () => void;
  /** Chat ID of the current session — excluded from the list */
  currentChatId?: string;
}

const SOURCE_ICONS: Record<string, string> = {
  imessage: "message.fill",
  signal: "lock.fill",
  discord: "bubble.left.and.bubble.right.fill",
  "dispatch-app": "app.fill",
  "sven-app": "app.fill",
};

const SOURCE_COLORS: Record<string, string> = {
  imessage: "#34C759",
  signal: "#3A76F0",
  discord: "#5865F2",
  "dispatch-app": "#a78bfa",
  "sven-app": "#a78bfa",
};

export function SessionPicker({ onSelect, onClose, currentChatId }: SessionPickerProps) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await getAgentSessions();
        if (!cancelled) {
          // Filter out current session and sort by most recent
          const filtered = all.filter((s) => s.id !== currentChatId);
          setSessions(filtered);
        }
      } catch (err) {
        console.error("[SessionPicker] Failed to load sessions:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentChatId]);

  const fuzzySearch = useMemo(
    () =>
      createFuzzySearch(sessions, {
        keys: [
          { name: "name", weight: 2 },
          { name: "source", weight: 1 },
          { name: "last_message", weight: 0.5 },
        ],
        getTimestamp: (s) => s.last_message_time,
      }),
    [sessions]
  );

  const filteredSessions = useMemo(() => fuzzySearch(query), [fuzzySearch, query]);

  const renderSession = useCallback(
    ({ item }: { item: AgentSession }) => {
      const iconName = SOURCE_ICONS[item.source] || "circle.fill";
      const iconColor = SOURCE_COLORS[item.source] || "#71717a";
      const preview = item.last_message
        ? Array.from(item.last_message).length > 60
          ? Array.from(item.last_message).slice(0, 60).join("") + "…"
          : item.last_message
        : "No messages yet";

      return (
        <Pressable
          style={({ pressed }) => [
            pickerBaseStyles.row,
            pressed && pickerBaseStyles.rowPressed,
          ]}
          onPress={() => onSelect(item)}
          accessibilityRole="button"
          accessibilityLabel={`${item.name} from ${item.source}`}
        >
          <View style={[pickerBaseStyles.iconCircle, { backgroundColor: iconColor + "22" }]}>
            <SymbolView name={iconName as any} tintColor={iconColor} size={16} />
          </View>
          <View style={pickerBaseStyles.itemInfo}>
            <View style={localStyles.nameRow}>
              <Text style={pickerBaseStyles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={localStyles.sourceBadge}>
                {item.source}
              </Text>
            </View>
            <Text style={pickerBaseStyles.preview} numberOfLines={1}>
              {item.last_message_is_from_me ? "You: " : ""}
              {preview}
            </Text>
          </View>
        </Pressable>
      );
    },
    [onSelect]
  );

  return (
    <View style={[pickerBaseStyles.container, localStyles.taller]}>
      <View style={pickerBaseStyles.header}>
        <Text style={pickerBaseStyles.title}>Choose a session</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close session picker">
          <SymbolView name="xmark" tintColor="#a1a1aa" size={16} weight="semibold" />
        </Pressable>
      </View>
      <View style={localStyles.searchContainer}>
        <SymbolView name="magnifyingglass" tintColor="#52525b" size={14} />
        <TextInput
          style={localStyles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search sessions…"
          placeholderTextColor="#52525b"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          accessibilityLabel="Search sessions"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
            <SymbolView name="xmark.circle.fill" tintColor="#52525b" size={16} />
          </Pressable>
        ) : null}
      </View>
      {loading ? (
        <View style={pickerBaseStyles.loadingContainer}>
          <Text style={pickerBaseStyles.loadingText}>Loading sessions…</Text>
        </View>
      ) : filteredSessions.length === 0 ? (
        <View style={pickerBaseStyles.loadingContainer}>
          <Text style={pickerBaseStyles.loadingText}>
            {query ? "No matching sessions" : "No other sessions found"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredSessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          style={pickerBaseStyles.list}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  taller: {
    maxHeight: 320,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#27272a",
    borderRadius: 10,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 10,
    gap: 6,
    height: 36,
  },
  searchInput: {
    flex: 1,
    color: "#fafafa",
    fontSize: 14,
    paddingVertical: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sourceBadge: {
    color: "#71717a",
    fontSize: 11,
    backgroundColor: "#27272a",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: "hidden",
  },
});
