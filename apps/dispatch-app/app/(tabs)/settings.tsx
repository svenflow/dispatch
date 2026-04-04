import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
// expo-notifications is iOS/Android only — conditionally import for web compat
let Notifications: typeof import("expo-notifications") | null = null;
if (Platform.OS !== "web") {
  try {
    Notifications = require("expo-notifications") as typeof import("expo-notifications");
  } catch { /* native module not available */ }
}
import { useRouter } from "expo-router";
import {
  getApiBaseUrl,
  setApiBaseUrl,
  getDefaultUrl,
  API_URL_STORAGE_KEY,
} from "@/src/config/constants";
import { clearMessages } from "@/src/api/chats";
import { apiRequest } from "@/src/api/client";
import { getItem, setItem, deleteItem } from "@/src/utils/storage";
import {
  showAlert,
  showDestructiveConfirm,
} from "@/src/utils/alert";

type ConnectionStatus = "checking" | "connected" | "disconnected";

/** Swipeable row for recent server URLs — swipe left to reveal delete */
function SwipeableRecentRow({
  url,
  isActive,
  onSelect,
  onDelete,
}: {
  url: string;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const swipeableRef = useRef<Swipeable>(null);

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-80, -20, 0],
      outputRange: [1, 0.8, 0],
      extrapolate: "clamp",
    });
    return (
      <Pressable
        style={swipeStyles.deleteAction}
        onPress={() => {
          swipeableRef.current?.close();
          onDelete();
        }}
      >
        <Animated.Text style={[swipeStyles.deleteText, { transform: [{ scale }] }]}>
          Delete
        </Animated.Text>
      </Pressable>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      rightThreshold={40}
      overshootRight={false}
    >
      <Pressable
        style={swipeStyles.row}
        onPress={onSelect}
      >
        <View style={swipeStyles.urlRow}>
          {isActive && (
            <View style={swipeStyles.activeDot} />
          )}
          <Text
            style={[
              swipeStyles.urlText,
              isActive && swipeStyles.urlActive,
            ]}
            numberOfLines={1}
          >
            {url}
          </Text>
        </View>
      </Pressable>
    </Swipeable>
  );
}

const swipeStyles = StyleSheet.create({
  row: {
    backgroundColor: "#18181b",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  urlRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22c55e",
    marginRight: 8,
  },
  urlText: {
    color: "#71717a",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    flexShrink: 1,
  },
  urlActive: {
    color: "#22c55e",
  },
  deleteAction: {
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    width: 80,
  },
  deleteText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});

export default function SettingsScreen() {
  const router = useRouter();
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("checking");
  const [currentUrl, setCurrentUrl] = useState(getApiBaseUrl());
  const [recentUrls, setRecentUrls] = useState<string[]>([]);
  const [showServerModal, setShowServerModal] = useState(false);
  const [modalUrlInput, setModalUrlInput] = useState("");
  const [modalProbeStatus, setModalProbeStatus] = useState<ConnectionStatus>("checking");
  const probeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Model config state
  interface ModelConfig {
    model: string;
    source: "manual" | "default" | "quota_degraded";
    override_set_at: string | null;
    active_session_count: number;
    quota_warning: boolean;
    quota_pct: number | null;
  }
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [modelSwitching, setModelSwitching] = useState(false);
  const [modelError, setModelError] = useState(false);

  const RECENT_URLS_KEY = "recent_api_urls";
  const MAX_RECENT = 10;

  // Load recent URLs on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await getItem(RECENT_URLS_KEY);
        if (stored) setRecentUrls(JSON.parse(stored));
      } catch { /* ignore */ }
    })();
  }, []);

  // Save a URL to recent list (deduped, most recent first)
  const saveRecentUrl = useCallback(async (url: string) => {
    if (!url) return;
    setRecentUrls((prev) => {
      const filtered = prev.filter((u) => u !== url);
      const updated = [url, ...filtered].slice(0, MAX_RECENT);
      setItem(RECENT_URLS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Fetch model config
  const fetchModelConfig = useCallback(async () => {
    try {
      setModelLoading(true);
      setModelError(false);
      const data = await apiRequest<ModelConfig>("/api/app/model-config", { timeout: 10000 });
      setModelConfig(data);
    } catch {
      setModelError(true);
    } finally {
      setModelLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModelConfig();
  }, [fetchModelConfig]);

  // Auto-refresh model config when connection recovers
  const prevConnectionRef = useRef<ConnectionStatus>(connectionStatus);
  useEffect(() => {
    const prev = prevConnectionRef.current;
    prevConnectionRef.current = connectionStatus;
    if (prev !== "connected" && connectionStatus === "connected") {
      fetchModelConfig();
    }
  }, [connectionStatus, fetchModelConfig]);

  // Switch model
  const handleSwitchModel = useCallback(async (newModel: string) => {
    if (!modelConfig) return;
    // No-op if selecting the already-active model
    if (newModel === modelConfig.model) return;

    const sessionCount = modelConfig.active_session_count;
    const modelLabel = newModel.charAt(0).toUpperCase() + newModel.slice(1);
    const confirmed = await showDestructiveConfirm(
      `Switch to ${modelLabel}?`,
      `This will restart ${sessionCount} active session${sessionCount !== 1 ? "s" : ""}. Conversation context will be preserved.`,
      "Switch",
    );
    if (!confirmed) return;

    try {
      setModelSwitching(true);
      const result = await apiRequest<{
        ok: boolean;
        model: string;
        source: string;
        restarted: number;
        total: number;
      }>("/api/app/model-config", {
        method: "POST",
        body: { model: newModel },
        timeout: 60000,
      });

      if (result.ok) {
        setModelConfig((prev) =>
          prev
            ? {
                ...prev,
                model: result.model,
                source: result.source as ModelConfig["source"],
                override_set_at: result.source === "manual" ? new Date().toISOString() : null,
              }
            : prev,
        );
        const partialFail = result.total - result.restarted;
        if (partialFail > 0) {
          showAlert("Model Switched", `Switched to ${modelLabel}. ${partialFail} session${partialFail !== 1 ? "s" : ""} will update on next message.`);
        } else {
          showAlert("Model Switched", `Switched to ${modelLabel}.`);
        }
      }
    } catch {
      showAlert("Error", "Failed to switch model.");
    } finally {
      setModelSwitching(false);
      // Re-fetch to get accurate state
      fetchModelConfig();
    }
  }, [modelConfig, fetchModelConfig]);

  // Show model picker
  const showModelPicker = useCallback(() => {
    if (modelSwitching || !modelConfig) return;

    const models = [
      { key: "opus", label: "Opus — Highest quality" },
      { key: "sonnet", label: "Sonnet — Balanced speed & quality" },
      { key: "haiku", label: "Haiku — Fastest, lowest cost" },
    ];

    if (Platform.OS === "ios") {
      const options = [
        ...models.map((m) => m.label),
        "Cancel",
      ];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: options.length - 1,
          title: "Select Model",
          message: `⚡ Switching will restart all ${modelConfig.active_session_count} active sessions`,
        },
        (index) => {
          if (index < models.length) {
            handleSwitchModel(models[index].key);
          }
        },
      );
    } else {
      // Web fallback — use simple prompt
      const currentLabel = modelConfig.model;
      const choice = window.prompt(
        `Select model (opus/sonnet/haiku).\n\n⚡ This will restart all ${modelConfig.active_session_count} active sessions.\n\nCurrently: ${currentLabel}`,
        currentLabel,
      );
      if (choice && ["opus", "sonnet", "haiku"].includes(choice.toLowerCase().trim())) {
        handleSwitchModel(choice.toLowerCase().trim());
      }
    }
  }, [modelConfig, modelSwitching, handleSwitchModel]);

  // Load persisted API URL on mount
  useEffect(() => {
    (async () => {
      const saved = await getItem(API_URL_STORAGE_KEY);
      if (saved) {
        setApiBaseUrl(saved);
        setCurrentUrl(saved);
      }
    })();
  }, []);

  // Check connection to the API server
  const checkConnection = useCallback(async () => {
    setConnectionStatus("checking");
    try {
      await apiRequest("/chats", { timeout: 5000 });
      setConnectionStatus("connected");
      // Save this URL as a recently connected server
      const url = getApiBaseUrl();
      if (url) saveRecentUrl(url);
      return true;
    } catch {
      setConnectionStatus("disconnected");
      return false;
    }
  }, [saveRecentUrl]);

  // Auto-retry connection every 5s when disconnected
  useEffect(() => {
    checkConnection();

    const interval = setInterval(async () => {
      try {
        await apiRequest("/chats", { timeout: 5000 });
        setConnectionStatus((prev) => {
          if (prev !== "connected") {
            const url = getApiBaseUrl();
            if (url) saveRecentUrl(url);
          }
          return "connected";
        });
      } catch {
        setConnectionStatus("disconnected");
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [checkConnection]);

  // Switch to a recent URL
  const switchToRecentUrl = useCallback(async (url: string) => {
    setApiBaseUrl(url);
    setCurrentUrl(url);
    await setItem(API_URL_STORAGE_KEY, url);
    setShowServerModal(false);
    checkConnection();
  }, [checkConnection]);

  // Remove a URL from recent list
  const removeRecentUrl = useCallback(async (url: string) => {
    setRecentUrls((prev) => {
      const updated = prev.filter((u) => u !== url);
      setItem(RECENT_URLS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Probe a URL to check if it's reachable
  const probeUrl = useCallback(async (url: string) => {
    if (!url || !url.startsWith("http")) {
      setModalProbeStatus("disconnected");
      return;
    }
    setModalProbeStatus("checking");
    try {
      const normalized = url.replace(/\/+$/, "");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${normalized}/chats`, { signal: controller.signal });
      clearTimeout(timeout);
      setModalProbeStatus(resp.ok ? "connected" : "disconnected");
    } catch {
      setModalProbeStatus("disconnected");
    }
  }, []);

  // Debounced probe when modal input changes
  useEffect(() => {
    if (!showServerModal) return;
    if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
    probeTimerRef.current = setTimeout(() => {
      probeUrl(modalUrlInput);
    }, 500);
    return () => {
      if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
    };
  }, [modalUrlInput, showServerModal, probeUrl]);

  // Open server modal
  const handleChangeUrl = useCallback(() => {
    setModalUrlInput(currentUrl);
    setModalProbeStatus(connectionStatus); // start with current known status
    setShowServerModal(true);
  }, [currentUrl, connectionStatus]);

  // Submit URL from modal
  const handleModalSubmit = useCallback(async () => {
    const raw = modalUrlInput.trim();
    if (!raw) return;
    const normalized = raw.replace(/\/+$/, "");
    setApiBaseUrl(normalized);
    setCurrentUrl(normalized);
    await setItem(API_URL_STORAGE_KEY, normalized);
    setShowServerModal(false);
    checkConnection();
  }, [modalUrlInput, checkConnection]);

  // Reset API URL to default
  const handleResetUrl = useCallback(async () => {
    const defaultUrl = getDefaultUrl();
    setApiBaseUrl(defaultUrl);
    setCurrentUrl(defaultUrl);
    await deleteItem(API_URL_STORAGE_KEY);
    checkConnection();
  }, [checkConnection]);

  // Clear all data
  const handleClearData = useCallback(async () => {
    const confirmed = await showDestructiveConfirm(
      "Clear All Data",
      "Clear all message data? This cannot be undone.",
      "Clear",
    );
    if (!confirmed) return;

    try {
      await clearMessages("voice");
      showAlert("Success", "All data cleared.");
    } catch {
      showAlert("Error", "Failed to clear data.");
    }
  }, []);

  // Clear notifications
  const handleClearNotifications = useCallback(async () => {
    await Notifications?.dismissAllNotificationsAsync();
    await Notifications?.setBadgeCountAsync(0);
    showAlert("Done", "Notifications cleared.");
  }, []);

  // Restart daemon
  const handleRestartSession = useCallback(async () => {
    const confirmed = await showDestructiveConfirm(
      "Restart Daemon",
      "Restart the dispatch daemon? All sessions will be restarted.",
      "Restart",
    );
    if (!confirmed) return;

    try {
      await apiRequest("/api/app/restart-daemon", { method: "POST", timeout: 30000 });
      showAlert("Success", "Daemon restarting.");
    } catch {
      showAlert("Error", "Failed to restart daemon.");
    }
  }, []);

  const displayUrl = currentUrl || "(same-origin)";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Model Config Section */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>MODEL</Text>
        <View style={styles.sectionCard}>
          {modelLoading && !modelConfig ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Default Model</Text>
              <Text style={styles.rowValue}>Loading...</Text>
            </View>
          ) : modelError && !modelConfig ? (
            <Pressable style={styles.row} onPress={fetchModelConfig}>
              <Text style={styles.rowLabel}>Default Model</Text>
              <View style={styles.statusRow}>
                <Text style={styles.rowValue}>Could not load</Text>
                <Text style={styles.chevron}>↻</Text>
              </View>
            </Pressable>
          ) : modelConfig ? (
            <Pressable style={styles.row} onPress={showModelPicker} disabled={modelSwitching}>
              <Text style={styles.rowLabel}>Default Model</Text>
              <View style={styles.statusRow}>
                {modelSwitching ? (
                  <ActivityIndicator size="small" color="#71717a" />
                ) : (
                  <>
                    <Text style={styles.modelValue}>
                      {modelConfig.source === "quota_degraded"
                        ? `${modelConfig.model.charAt(0).toUpperCase() + modelConfig.model.slice(1)} (quota)`
                        : modelConfig.model.charAt(0).toUpperCase() + modelConfig.model.slice(1)}
                    </Text>
                    <Text style={styles.chevron}>&rsaquo;</Text>
                  </>
                )}
              </View>
            </Pressable>
          ) : null}
        </View>
        {modelConfig && (
          <View style={styles.modelFooter}>
            {modelConfig.source === "quota_degraded" ? (
              <Text style={styles.modelWarningText}>
                ⚠️ Auto-switched from Opus — quota at {modelConfig.quota_pct ?? "??"}%
              </Text>
            ) : modelConfig.quota_warning && modelConfig.model === "opus" ? (
              <Text style={styles.modelWarningText}>
                ⚠️ Quota at {modelConfig.quota_pct ?? "??"}%. Consider switching to Sonnet.
              </Text>
            ) : modelConfig.quota_warning ? (
              <Text style={styles.modelWarningText}>
                ⚠️ Quota at {modelConfig.quota_pct ?? "??"}%
              </Text>
            ) : (
              <Text style={styles.sectionFooter}>
                {modelConfig.active_session_count} active session{modelConfig.active_session_count !== 1 ? "s" : ""}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Soul Section */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>IDENTITY</Text>
        <View style={styles.sectionCard}>
          <Pressable style={styles.row} onPress={() => router.push("/soul")}>
            <Text style={styles.rowLabel}>Soul</Text>
            <Text style={styles.chevron}>&rsaquo;</Text>
          </Pressable>
        </View>
        <Text style={styles.sectionFooter}>
          View the personality and identity definition.
        </Text>
      </View>

      {/* Connection Section */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>CONNECTION</Text>
        <View style={styles.sectionCard}>
          <Pressable style={styles.row} onPress={handleChangeUrl}>
            <Text style={styles.rowLabel}>API Server</Text>
            <Text style={styles.rowValue} numberOfLines={1}>
              {displayUrl}
            </Text>
          </Pressable>
          <View style={styles.separator} />
          <Pressable style={styles.row} onPress={checkConnection}>
            <Text style={styles.rowLabel}>Status</Text>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  connectionStatus === "connected" && styles.statusConnected,
                  connectionStatus === "disconnected" &&
                    styles.statusDisconnected,
                  connectionStatus === "checking" && styles.statusChecking,
                ]}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.statusText,
                  connectionStatus === "connected" && styles.textConnected,
                  connectionStatus === "disconnected" &&
                    styles.textDisconnected,
                ]}
              >
                {connectionStatus === "connected"
                  ? "Connected"
                  : connectionStatus === "disconnected"
                    ? "Disconnected"
                    : "Checking..."}
              </Text>
            </View>
          </Pressable>
          <View style={styles.separator} />
          <Pressable style={styles.row} onPress={handleResetUrl}>
            <Text style={styles.resetText}>Reset to Default</Text>
            <Text style={styles.defaultUrl} numberOfLines={1}>
              {getDefaultUrl()}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.sectionFooter}>
          Tap API Server to change or select a server.
        </Text>
      </View>

      {/* Debug Section */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>DEBUG</Text>
        <View style={styles.sectionCard}>
          <Pressable style={styles.row} onPress={handleRestartSession}>
            <Text style={styles.rowLabel}>Restart Daemon</Text>
            <Text style={styles.chevron}>&rsaquo;</Text>
          </Pressable>
          <View style={styles.separator} />
          <Pressable style={styles.row} onPress={handleClearNotifications}>
            <Text style={styles.rowLabel}>Clear Notifications</Text>
            <Text style={styles.chevron}>&rsaquo;</Text>
          </Pressable>
          {__DEV__ && Platform.OS !== "web" && (
            <>
              <View style={styles.separator} />
              <Pressable
                style={styles.row}
                onPress={() => {
                  try {
                    const { NativeModules } = require("react-native");
                    if (NativeModules.DevMenu?.show) {
                      NativeModules.DevMenu.show();
                    } else if (NativeModules.DevSettings?.show) {
                      NativeModules.DevSettings.show();
                    } else {
                      showAlert("Dev Menu", "Shake your device to open the dev menu.");
                    }
                  } catch {
                    showAlert("Dev Menu", "Shake your device to open the dev menu.");
                  }
                }}
              >
                <Text style={styles.rowLabel}>Dev Tools</Text>
                <Text style={styles.chevron}>&rsaquo;</Text>
              </Pressable>
            </>
          )}
        </View>
        <Text style={styles.sectionFooter}>
          Restart the daemon or clear all notifications.
        </Text>
      </View>

      {/* App Info Section */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>APP INFO</Text>
        <View style={styles.sectionCard}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>OTA Build</Text>
            <Text style={styles.rowValue}>2026-04-03-test</Text>
          </View>
        </View>
        <Text style={styles.sectionFooter}>
          Last OTA update identifier.
        </Text>
      </View>
    </ScrollView>

    {/* Server URL Modal */}
    <Modal
      visible={showServerModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowServerModal(false)}
    >
      <KeyboardAvoidingView
        style={modalStyles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={modalStyles.header}>
          <Pressable onPress={() => setShowServerModal(false)}>
            <Text style={modalStyles.cancelButton}>Cancel</Text>
          </Pressable>
          <Text style={modalStyles.title}>API Server</Text>
          <Pressable onPress={handleModalSubmit}>
            <Text style={modalStyles.connectButton}>Connect</Text>
          </Pressable>
        </View>

        {/* URL Input */}
        <View style={modalStyles.inputSection}>
          <View style={modalStyles.inputRow}>
            <TextInput
              style={modalStyles.input}
              value={modalUrlInput}
              onChangeText={setModalUrlInput}
              placeholder="http://192.168.1.100:9091"
              placeholderTextColor="#3f3f46"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus
              returnKeyType="go"
              onSubmitEditing={handleModalSubmit}
              selectTextOnFocus
            />
            <View
              style={[
                modalStyles.probeDot,
                modalProbeStatus === "connected" && styles.statusConnected,
                modalProbeStatus === "disconnected" && styles.statusDisconnected,
                modalProbeStatus === "checking" && styles.statusChecking,
              ]}
            />
          </View>
        </View>

        {/* Recent Servers */}
        {recentUrls.length > 0 && (
          <View style={modalStyles.recentSection}>
            <Text style={modalStyles.recentLabel}>RECENT</Text>
            <View style={modalStyles.recentList}>
              {recentUrls.map((url, i) => (
                <React.Fragment key={url}>
                  {i > 0 && <View style={styles.separator} />}
                  <SwipeableRecentRow
                    url={url}
                    isActive={url === currentUrl}
                    onSelect={() => switchToRecentUrl(url)}
                    onDelete={() => removeRecentUrl(url)}
                  />
                </React.Fragment>
              ))}
            </View>
          </View>
        )}

        {/* Default server */}
        <View style={modalStyles.defaultSection}>
          <Text style={modalStyles.recentLabel}>DEFAULT</Text>
          <Pressable
            style={modalStyles.defaultRow}
            onPress={() => {
              const defaultUrl = getDefaultUrl();
              setModalUrlInput(defaultUrl);
              switchToRecentUrl(defaultUrl);
            }}
          >
            <Text style={modalStyles.defaultText} numberOfLines={1}>
              {getDefaultUrl()}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 48,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    color: "#71717a",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionCard: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    overflow: "hidden",
  },
  sectionFooter: {
    color: "#52525b",
    fontSize: 12,
    marginTop: 6,
    paddingHorizontal: 4,
    lineHeight: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  rowLabel: {
    color: "#fafafa",
    fontSize: 15,
  },
  rowValue: {
    color: "#71717a",
    fontSize: 15,
    maxWidth: "60%",
    textAlign: "right",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#27272a",
    marginLeft: 16,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  statusText: {
    color: "#71717a",
    fontSize: 15,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusConnected: {
    backgroundColor: "#22c55e",
  },
  statusDisconnected: {
    backgroundColor: "#ef4444",
  },
  statusChecking: {
    backgroundColor: "#eab308",
  },
  textConnected: {
    color: "#22c55e",
  },
  textDisconnected: {
    color: "#ef4444",
  },
  resetText: {
    color: "#71717a",
    fontSize: 14,
  },
  defaultUrl: {
    color: "#52525b",
    fontSize: 12,
    maxWidth: "50%",
    textAlign: "right",
  },
  dangerText: {
    color: "#ef4444",
    fontSize: 15,
    fontWeight: "500",
  },
  chevron: {
    color: "#52525b",
    fontSize: 22,
    fontWeight: "300",
  },
  modelValue: {
    color: "#71717a",
    fontSize: 15,
    textAlign: "right" as const,
  },
  modelFooter: {
    marginTop: 6,
    paddingHorizontal: 4,
  },
  modelWarningText: {
    color: "#eab308",
    fontSize: 12,
    lineHeight: 16,
  },
});

const modalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  cancelButton: {
    color: "#71717a",
    fontSize: 16,
  },
  title: {
    color: "#fafafa",
    fontSize: 17,
    fontWeight: "600",
  },
  connectButton: {
    color: "#3b82f6",
    fontSize: 16,
    fontWeight: "600",
  },
  inputSection: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  probeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  input: {
    flex: 1,
    backgroundColor: "#18181b",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fafafa",
    fontSize: 15,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    borderWidth: 1,
    borderColor: "#27272a",
  },
  recentSection: {
    paddingHorizontal: 16,
  },
  recentLabel: {
    color: "#71717a",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  recentList: {
    backgroundColor: "#18181b",
    borderRadius: 10,
    overflow: "hidden",
  },
  defaultSection: {
    paddingHorizontal: 16,
    marginTop: 24,
  },
  defaultRow: {
    backgroundColor: "#18181b",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  defaultText: {
    color: "#52525b",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});
