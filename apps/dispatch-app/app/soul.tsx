import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Animated as RNAnimated,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest } from "@/src/api/client";
import { SimpleMarkdown } from "@/src/components/SimpleMarkdown";
import { colors } from "@/src/config/colors";

export default function SoulScreen() {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [inputHeight, setInputHeight] = useState(40);
  const mountedRef = useRef(true);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Fade animation for content updates
  const fadeAnim = useRef(new RNAnimated.Value(1)).current;

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

  const handleSend = useCallback(async () => {
    const instruction = inputText.trim();
    if (!instruction || isSending) return;

    setInputText("");
    setIsSending(true);

    try {
      const data = await apiRequest<{ ok: boolean; content: string }>(
        "/api/app/soul/edit",
        {
          method: "POST",
          body: { instruction },
          timeout: 90000, // AI edit can take a while
        },
      );
      if (mountedRef.current && data.content) {
        // Animate the content swap
        RNAnimated.sequence([
          RNAnimated.timing(fadeAnim, {
            toValue: 0.3,
            duration: 150,
            useNativeDriver: true,
          }),
          RNAnimated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
        setContent(data.content);
        // Scroll to top to see changes
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Edit failed");
        // Restore input text so user can retry
        setInputText(instruction);
      }
    } finally {
      if (mountedRef.current) {
        setIsSending(false);
      }
    }
  }, [inputText, isSending, fadeAnim]);

  const canSend = inputText.trim().length > 0 && !isSending;

  if (isLoading) {
    return (
      <>
        <Stack.Screen
          options={{
            title: "Soul",
            headerBackTitle: "Settings",
            headerRight: () => (
              <Pressable onPress={() => router.push("/soul-history")}>
                <Text style={styles.headerBtn}>History</Text>
              </Pressable>
            ),
          }}
        />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.textMuted} />
        </View>
      </>
    );
  }

  if (error && !content) {
    return (
      <>
        <Stack.Screen
          options={{
            title: "Soul",
            headerBackTitle: "Settings",
          }}
        />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Soul",
          headerBackTitle: "Settings",
          headerRight: () => (
            <Pressable onPress={() => router.push("/soul-history")}>
              <Text style={styles.headerBtn}>History</Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {/* Scrollable rendered markdown */}
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          <RNAnimated.View style={{ opacity: fadeAnim }}>
            <SimpleMarkdown>{content || ""}</SimpleMarkdown>
          </RNAnimated.View>

          {/* Inline error banner */}
          {error && (
            <Pressable style={styles.errorBanner} onPress={() => setError(null)}>
              <Text style={styles.errorBannerText}>{error}</Text>
              <Text style={styles.errorDismiss}>✕</Text>
            </Pressable>
          )}
        </ScrollView>

        {/* Sending indicator */}
        {isSending && (
          <View style={styles.sendingBar}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={styles.sendingText}>Rewriting soul...</Text>
          </View>
        )}

        {/* Chat-style input bar */}
        <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.inputRow}>
            <View style={styles.inputWrapper}>
              <TextInput
                ref={inputRef}
                style={[styles.input, { height: Math.max(40, Math.min(inputHeight, 120)) }]}
                value={inputText}
                onChangeText={setInputText}
                onContentSizeChange={(e) => {
                  setInputHeight(e.nativeEvent.contentSize.height + 16);
                }}
                placeholder="Describe a change to your soul..."
                placeholderTextColor={colors.textPlaceholder}
                multiline
                maxLength={2000}
                editable={!isSending}
                blurOnSubmit={false}
                returnKeyType="default"
              />
              {canSend && (
                <Pressable style={styles.sendBtn} onPress={handleSend}>
                  <Text style={styles.sendBtnText}>↑</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 24,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    backgroundColor: colors.background,
  },
  errorText: {
    color: colors.error,
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
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  headerBtn: {
    color: "#2563eb",
    fontSize: 16,
    fontWeight: "500",
  },
  inputContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  inputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 20,
    paddingLeft: 16,
    paddingRight: 6,
    minHeight: 40,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 120,
  },
  sendBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#2563eb",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 5,
    marginLeft: 4,
  },
  sendBtnText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginTop: -1,
  },
  sendingBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    gap: 8,
  },
  sendingText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.errorBg,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
  },
  errorBannerText: {
    color: colors.errorLight,
    fontSize: 13,
    flex: 1,
  },
  errorDismiss: {
    color: colors.errorLight,
    fontSize: 14,
    marginLeft: 8,
  },
});
