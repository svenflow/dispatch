import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
// expo-notifications is iOS/Android only — conditionally import for web compat
let Notifications: typeof import("expo-notifications") | null = null;
if (Platform.OS !== "web") {
  try {
    Notifications = require("expo-notifications") as typeof import("expo-notifications");
  } catch { /* native module not available */ }
}
import {
  getApiBaseUrl,
  setApiBaseUrl,
  getDefaultUrl,
  API_URL_STORAGE_KEY,
} from "@/src/config/constants";
import { clearMessages, restartSession } from "@/src/api/chats";
import { apiRequest } from "@/src/api/client";
import { getItem, setItem, deleteItem } from "@/src/utils/storage";
import {
  showAlert,
  showDestructiveConfirm,
  showPrompt,
} from "@/src/utils/alert";

type ConnectionStatus = "checking" | "connected" | "disconnected";

/** Single usage bar with label, percentage, and time-to-reset */
function UsageBar({
  label,
  utilization,
  resetsAt,
}: {
  label: string;
  utilization: number;
  resetsAt: string;
}) {
  // Color based on utilization level
  const barColor =
    utilization >= 80
      ? "#ef4444" // red
      : utilization >= 50
        ? "#eab308" // yellow
        : "#22c55e"; // green

  // Format reset time as relative
  const resetDate = new Date(resetsAt);
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();
  const diffHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
  const diffMins = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)));
  const resetLabel =
    diffHours > 24
      ? `${Math.floor(diffHours / 24)}d ${diffHours % 24}h`
      : diffHours > 0
        ? `${diffHours}h ${diffMins}m`
        : `${diffMins}m`;

  return (
    <View style={usageStyles.barRow}>
      <View style={usageStyles.labelRow}>
        <Text style={usageStyles.label}>{label}</Text>
        <Text style={usageStyles.percentage}>{Math.round(utilization)}%</Text>
      </View>
      <View style={usageStyles.barTrack}>
        <View
          style={[
            usageStyles.barFill,
            { width: `${Math.min(100, utilization)}%`, backgroundColor: barColor },
          ]}
        />
      </View>
      <Text style={usageStyles.resetText}>Resets in {resetLabel}</Text>
    </View>
  );
}

const usageStyles = StyleSheet.create({
  barRow: {
    paddingHorizontal: 16,
    paddingVertical: 5,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  label: {
    color: "#fafafa",
    fontSize: 14,
    fontWeight: "500",
  },
  percentage: {
    color: "#a1a1aa",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  barTrack: {
    height: 6,
    backgroundColor: "#27272a",
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
  resetText: {
    color: "#52525b",
    fontSize: 11,
    marginTop: 3,
  },
});

export default function SettingsScreen() {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("checking");
  const [currentUrl, setCurrentUrl] = useState(getApiBaseUrl());

  // Usage quota state
  interface QuotaBucket {
    utilization: number;
    resets_at: string;
  }
  interface QuotaData {
    five_hour?: QuotaBucket | null;
    seven_day?: QuotaBucket | null;
    seven_day_sonnet?: QuotaBucket | null;
    seven_day_opus?: QuotaBucket | null;
  }
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Fetch usage quota
  const fetchQuota = useCallback(async () => {
    // Subtle pulse animation on refresh
    Animated.sequence([
      Animated.timing(pulseAnim, {
        toValue: 0.5,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    try {
      setQuotaLoading(true);
      const data = await apiRequest<{
        quota?: QuotaData | null;
        _quota_error?: string | null;
        active_block?: { costUSD?: number; totalTokens?: number } | null;
      }>("/api/dashboard/ccu", { timeout: 10000 });
      if (data.quota) {
        setQuota(data.quota);
      }
      setLastFetched(new Date());
    } catch {
      // silently fail — quota is non-critical
    } finally {
      setQuotaLoading(false);
    }
  }, [pulseAnim]);

  // Fetch quota on mount and refresh every 30s
  useEffect(() => {
    fetchQuota();
    const interval = setInterval(fetchQuota, 30000);
    return () => clearInterval(interval);
  }, [fetchQuota]);

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
      return true;
    } catch {
      setConnectionStatus("disconnected");
      return false;
    }
  }, []);

  // Auto-retry connection every 5s when disconnected
  useEffect(() => {
    checkConnection();

    const interval = setInterval(async () => {
      try {
        await apiRequest("/chats", { timeout: 5000 });
        setConnectionStatus("connected");
      } catch {
        setConnectionStatus("disconnected");
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [checkConnection]);

  // Change API server URL manually
  const handleChangeUrl = useCallback(async () => {
    const newUrl = await showPrompt(
      "API Server URL",
      "Enter the full URL (e.g. http://100.70.178.37:9091)",
      currentUrl,
    );
    if (!newUrl || newUrl === currentUrl) return;

    // Normalize: remove trailing slash
    const normalized = newUrl.replace(/\/+$/, "");
    setApiBaseUrl(normalized);
    setCurrentUrl(normalized);
    await setItem(API_URL_STORAGE_KEY, normalized);

    // Test the new URL
    checkConnection();
  }, [currentUrl, checkConnection]);

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

  // Restart session
  const handleRestartSession = useCallback(async () => {
    const confirmed = await showDestructiveConfirm(
      "Restart Session",
      "Restart the Claude session? This will clear the conversation context.",
      "Restart",
    );
    if (!confirmed) return;

    try {
      await restartSession("voice");
      showAlert("Success", "Session restarted.");
    } catch {
      showAlert("Error", "Failed to restart session.");
    }
  }, []);

  const displayUrl = currentUrl || "(same-origin)";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Usage Quota Section */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>USAGE</Text>
        <Pressable onPress={fetchQuota}>
          <Animated.View style={[styles.sectionCard, { opacity: pulseAnim }]}>
            {quotaLoading && !quota ? (
              <View style={styles.row}>
                <Text style={styles.rowValue}>Loading...</Text>
              </View>
            ) : quota ? (
              <View style={styles.quotaContainer}>
                {quota.five_hour && (
                  <UsageBar
                    label="5-Hour"
                    utilization={quota.five_hour.utilization}
                    resetsAt={quota.five_hour.resets_at}
                  />
                )}
                {quota.seven_day && (
                  <>
                    <View style={styles.quotaSeparator} />
                    <UsageBar
                      label="7-Day"
                      utilization={quota.seven_day.utilization}
                      resetsAt={quota.seven_day.resets_at}
                    />
                  </>
                )}
                {quota.seven_day_sonnet && (
                  <>
                    <View style={styles.quotaSeparator} />
                    <UsageBar
                      label="Sonnet"
                      utilization={quota.seven_day_sonnet.utilization}
                      resetsAt={quota.seven_day_sonnet.resets_at}
                    />
                  </>
                )}
                {quota.seven_day_opus && (
                  <>
                    <View style={styles.quotaSeparator} />
                    <UsageBar
                      label="Opus"
                      utilization={quota.seven_day_opus.utilization}
                      resetsAt={quota.seven_day_opus.resets_at}
                    />
                  </>
                )}
              </View>
            ) : (
              <View style={styles.row}>
                <Text style={styles.rowValue}>Unavailable</Text>
              </View>
            )}
          </Animated.View>
        </Pressable>
        <View style={styles.usageFooter}>
          <Text style={styles.sectionFooter}>Tap to refresh</Text>
          {lastFetched && (
            <Text style={styles.lastFetchedText}>
              {lastFetched.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </Text>
          )}
        </View>
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
          Tap API Server to change the URL manually.
        </Text>
      </View>

      {/* Debug Section */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>DEBUG</Text>
        <View style={styles.sectionCard}>
          <Pressable style={styles.row} onPress={() => router.push("/logs")}>
            <Text style={styles.rowLabel}>Logs</Text>
            <Text style={styles.chevron}>&rsaquo;</Text>
          </Pressable>
          <View style={styles.separator} />
          <Pressable style={styles.row} onPress={handleRestartSession}>
            <Text style={styles.rowLabel}>Restart Session</Text>
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
          View live system logs, restart Claude's conversation context, or clear all notifications.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
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
  rowValueMono: {
    color: "#71717a",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
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
  quotaContainer: {
    paddingVertical: 2,
  },
  quotaSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#27272a",
    marginHorizontal: 16,
  },
  usageFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    paddingHorizontal: 4,
  },
  lastFetchedText: {
    color: "#3f3f46",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});
