import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { apiRequest } from "@/src/api/client";
import { SimpleMarkdown } from "@/src/components/SimpleMarkdown";
import { colors } from "@/src/config/colors";

interface SoulVersion {
  timestamp: string;
  iso: string;
  size: number;
}

function formatRelativeTime(isoStr: string): string {
  const date = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTimestamp(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SoulHistoryScreen() {
  const [versions, setVersions] = useState<SoulVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const mountedRef = useRef(true);
  const router = useRouter();

  const loadVersions = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await apiRequest<{ ok: boolean; versions: SoulVersion[] }>(
        "/api/app/soul/history",
        { timeout: 10000 },
      );
      if (mountedRef.current) {
        setVersions(data.versions);
      }
    } catch {
      // silently fail — empty list is fine
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVersions();
    return () => {
      mountedRef.current = false;
    };
  }, [loadVersions]);

  const loadPreview = useCallback(async (timestamp: string) => {
    setSelectedVersion(timestamp);
    setIsLoadingPreview(true);
    setPreviewContent(null);
    try {
      const data = await apiRequest<{ ok: boolean; content: string }>(
        `/api/app/soul/history/${timestamp}`,
        { timeout: 10000 },
      );
      if (mountedRef.current) {
        setPreviewContent(data.content);
      }
    } catch {
      if (mountedRef.current) {
        setPreviewContent("*Failed to load this version.*");
      }
    } finally {
      if (mountedRef.current) setIsLoadingPreview(false);
    }
  }, []);

  const handleRestore = useCallback(async () => {
    if (!selectedVersion) return;

    Alert.alert(
      "Restore this version?",
      "Your current soul will be saved to history before restoring.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: async () => {
            setIsRestoring(true);
            try {
              await apiRequest("/api/app/soul/restore", {
                method: "POST",
                body: { timestamp: selectedVersion },
                timeout: 10000,
              });
              // Go back to soul page which will reload
              router.back();
            } catch {
              Alert.alert("Error", "Failed to restore version");
            } finally {
              if (mountedRef.current) setIsRestoring(false);
            }
          },
        },
      ],
    );
  }, [selectedVersion, router]);

  // Preview mode
  if (selectedVersion) {
    const version = versions.find((v) => v.timestamp === selectedVersion);
    return (
      <>
        <Stack.Screen
          options={{
            title: version ? formatTimestamp(version.iso) : "Version",
            headerBackTitle: "History",
            headerRight: () => (
              <Pressable onPress={handleRestore} disabled={isRestoring}>
                <Text style={[styles.restoreBtn, isRestoring && styles.restoreBtnDisabled]}>
                  {isRestoring ? "Restoring..." : "Restore"}
                </Text>
              </Pressable>
            ),
          }}
        />
        {isLoadingPreview ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.textMuted} />
          </View>
        ) : (
          <ScrollView
            style={styles.previewScroll}
            contentContainerStyle={styles.previewContent}
          >
            <SimpleMarkdown>{previewContent || ""}</SimpleMarkdown>
          </ScrollView>
        )}
      </>
    );
  }

  // List mode
  return (
    <>
      <Stack.Screen
        options={{
          title: "Soul History",
          headerBackTitle: "Soul",
        }}
      />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.textMuted} />
        </View>
      ) : versions.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No history yet</Text>
          <Text style={styles.emptySubtext}>
            Past versions will appear here when you edit your soul.
          </Text>
        </View>
      ) : (
        <FlatList
          data={versions}
          keyExtractor={(item) => item.timestamp}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              style={styles.versionRow}
              onPress={() => loadPreview(item.timestamp)}
            >
              <View style={styles.versionInfo}>
                <Text style={styles.versionDate}>
                  {formatTimestamp(item.iso)}
                </Text>
                <Text style={styles.versionMeta}>
                  {formatRelativeTime(item.iso)} · {(item.size / 1024).toFixed(1)}KB
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    backgroundColor: colors.background,
  },
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingTop: 8,
  },
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  versionInfo: {
    flex: 1,
  },
  versionDate: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "500",
  },
  versionMeta: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 22,
    fontWeight: "300",
    marginLeft: 8,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtext: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
  },
  previewScroll: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 16,
  },
  previewContent: {
    paddingTop: 16,
    paddingBottom: 48,
  },
  restoreBtn: {
    color: "#ef4444",
    fontSize: 16,
    fontWeight: "600",
  },
  restoreBtnDisabled: {
    opacity: 0.5,
  },
});
