import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { apiRequest } from "@/src/api/client";
import { SimpleMarkdown } from "@/src/components/SimpleMarkdown";

export default function SoulScreen() {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await apiRequest<{ ok: boolean; content: string }>(
        "/api/app/soul",
        { timeout: 10000 },
      );
      if (mountedRef.current) {
        setContent(data.content);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Soul", headerBackTitle: "Settings" }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#71717a" />
        </View>
      </>
    );
  }

  if (error || !content) {
    return (
      <>
        <Stack.Screen options={{ title: "Soul", headerBackTitle: "Settings" }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error || "Not found"}</Text>
          <Pressable style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Soul", headerBackTitle: "Settings" }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
      >
        <SimpleMarkdown>{content}</SimpleMarkdown>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
    paddingHorizontal: 16,
  },
  contentContainer: {
    paddingTop: 16,
    paddingBottom: 48,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    backgroundColor: "#09090b",
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
