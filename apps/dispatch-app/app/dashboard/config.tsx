import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { getConfig, setConfigField } from "@/src/api/dashboard";
import type { ConfigSection, ConfigItem } from "@/src/api/types";
import { showAlert } from "@/src/utils/alert";

// ---------------------------------------------------------------------------
// Human-readable labels for config keys
// ---------------------------------------------------------------------------

const SECTION_LABELS: Record<string, string> = {
  reminders_enabled: "Automation",
  tasks_enabled: "Automation",
  backend_enabled: "Backends",
  disabled_chats: "Backends",
  owner: "Owner",
  partner: "Partner",
  assistant: "Assistant",
  signal: "Signal",
  hue: "Smart Home",
  lutron: "Smart Home",
  sonos: "Sonos",
  chrome: "Chrome",
  bloomin8: "Picture Frame",
  tailscale: "Networking",
  network: "Networking",
  metro: "Metro / Dev",
  dispatch_api: "Dispatch API",
  plex: "Plex",
  instagram: "Instagram",
  discord: "Discord",
  ruview: "RuView",
  sven_pages: "Sven Pages",
  ga4: "Analytics",
};

const KEY_LABELS: Record<string, string> = {
  reminders_enabled: "Reminders Enabled",
  tasks_enabled: "Task Execution Enabled",
  "backend_enabled.imessage": "iMessage",
  "backend_enabled.signal": "Signal",
  "backend_enabled.discord": "Discord",
  disabled_chats: "Disabled Chats",
  "owner.name": "Name",
  "owner.phone": "Phone",
  "owner.email": "Email",
  "owner.home_address": "Home Address",
  "partner.name": "Name",
  "assistant.name": "Name",
  "assistant.email": "Email",
  "assistant.phone": "Phone",
  "signal.account": "Account",
  "hue.bridges.home.ip": "Home Bridge IP",
  "hue.bridges.office.ip": "Office Bridge IP",
  "lutron.bridge_ip": "Bridge IP",
  "chrome.profiles.0.name": "Profile 0 Name",
  "chrome.profiles.0.email": "Profile 0 Email",
  "chrome.profiles.1.name": "Profile 1 Name",
  "chrome.profiles.1.email": "Profile 1 Email",
  "bloomin8.ip": "IP Address",
  "bloomin8.keepalive_enabled": "Keepalive Enabled",
  "bloomin8.keepalive_interval": "Keepalive Interval (s)",
  "bloomin8.wake_proxy_ip": "Wake Proxy IP",
  "tailscale.hostname": "Hostname",
  "tailscale.ip": "IP Address",
  "network.local_ip": "Local IP",
  "metro.port": "Port",
  "metro.host": "Host",
  "dispatch_api.port": "Port",
  "dispatch_api.host": "Host",
  "plex.tailscale_url": "Tailscale URL",
  "plex.tailscale_ip_url": "Tailscale IP URL",
  "plex.local_url": "Local URL",
  "plex.cloud_url": "Cloud URL",
  "instagram.username": "Username",
  "discord.default_tier": "Default Tier",
  "sven_pages.url": "URL",
  "ga4.measurement_id": "Measurement ID",
  "ga4.stream_id": "Stream ID",
};

const KEY_DESCRIPTIONS: Record<string, string> = {
  reminders_enabled: "Pause all cron/scheduled reminders",
  tasks_enabled: "Stop processing task.requested bus events",
  "backend_enabled.imessage": "Receive and respond to iMessages",
  "backend_enabled.signal": "Receive and respond via Signal",
  "backend_enabled.discord": "Receive and respond in Discord",
  disabled_chats: "Chat IDs to not respond to",
  "bloomin8.keepalive_enabled": "Send periodic pings to prevent sleep",
  "bloomin8.keepalive_interval": "Seconds between keepalive pings",
};

function labelForKey(key: string): string {
  return KEY_LABELS[key] ?? key.split(".").pop() ?? key;
}

function labelForSection(section: string): string {
  return SECTION_LABELS[section] ?? section.charAt(0).toUpperCase() + section.slice(1).replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Editable field components
// ---------------------------------------------------------------------------

function BoolField({
  item,
  onToggle,
}: {
  item: ConfigItem;
  onToggle: (key: string, value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.labelGroup}>
        <Text style={styles.rowLabel}>{labelForKey(item.key)}</Text>
        {KEY_DESCRIPTIONS[item.key] && (
          <Text style={styles.rowDescription}>{KEY_DESCRIPTIONS[item.key]}</Text>
        )}
      </View>
      <Switch
        value={item.value as boolean}
        onValueChange={(v) => onToggle(item.key, v)}
        trackColor={{ false: "#3f3f46", true: "#166534" }}
        thumbColor={(item.value as boolean) ? "#22c55e" : "#71717a"}
      />
    </View>
  );
}

function ReadOnlyField({ item }: { item: ConfigItem }) {
  const val = item.value;
  let displayValue: string;

  if (Array.isArray(val)) {
    displayValue = val.length === 0 ? "(empty)" : val.join(", ");
  } else if (typeof val === "boolean") {
    displayValue = val ? "Yes" : "No";
  } else {
    displayValue = String(val ?? "—");
  }

  // Mask sensitive-looking values (IPs are fine, but passwords aren't shown in config anyway)
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{labelForKey(item.key)}</Text>
      <Text style={styles.rowValue} numberOfLines={2} selectable>
        {displayValue}
      </Text>
    </View>
  );
}

function EditableNumberField({
  item,
  onSave,
}: {
  item: ConfigItem;
  onSave: (key: string, value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(item.value));

  useEffect(() => {
    setText(String(item.value));
  }, [item.value]);

  const handleSave = () => {
    const num = Number(text);
    if (!isNaN(num)) {
      onSave(item.key, num);
    }
    setEditing(false);
  };

  return (
    <Pressable style={styles.row} onPress={() => setEditing(true)}>
      <View style={styles.labelGroup}>
        <Text style={styles.rowLabel}>{labelForKey(item.key)}</Text>
        {KEY_DESCRIPTIONS[item.key] && (
          <Text style={styles.rowDescription}>{KEY_DESCRIPTIONS[item.key]}</Text>
        )}
      </View>
      {editing ? (
        <TextInput
          style={styles.editInput}
          value={text}
          onChangeText={setText}
          onBlur={handleSave}
          onSubmitEditing={handleSave}
          keyboardType="numeric"
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
        />
      ) : (
        <Text style={styles.rowValueEditable}>{String(item.value)}</Text>
      )}
    </Pressable>
  );
}

function EditableStringField({
  item,
  onSave,
}: {
  item: ConfigItem;
  onSave: (key: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(item.value ?? ""));

  useEffect(() => {
    setText(String(item.value ?? ""));
  }, [item.value]);

  const handleSave = () => {
    onSave(item.key, text);
    setEditing(false);
  };

  return (
    <Pressable style={styles.row} onPress={() => setEditing(true)}>
      <View style={styles.labelGroup}>
        <Text style={styles.rowLabel}>{labelForKey(item.key)}</Text>
        {KEY_DESCRIPTIONS[item.key] && (
          <Text style={styles.rowDescription}>{KEY_DESCRIPTIONS[item.key]}</Text>
        )}
      </View>
      {editing ? (
        <TextInput
          style={styles.editInput}
          value={text}
          onChangeText={setText}
          onBlur={handleSave}
          onSubmitEditing={handleSave}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : (
        <Text style={styles.rowValueEditable} numberOfLines={1}>
          {String(item.value ?? "—")}
        </Text>
      )}
    </Pressable>
  );
}

function EditableStringListField({
  item,
  onSave,
}: {
  item: ConfigItem;
  onSave: (key: string, value: string[]) => void;
}) {
  const list = (item.value as string[]) ?? [];
  return (
    <View style={styles.listFieldContainer}>
      <View style={styles.labelGroup}>
        <Text style={styles.rowLabel}>{labelForKey(item.key)}</Text>
        {KEY_DESCRIPTIONS[item.key] && (
          <Text style={styles.rowDescription}>{KEY_DESCRIPTIONS[item.key]}</Text>
        )}
      </View>
      {list.length === 0 ? (
        <Text style={styles.emptyList}>(none)</Text>
      ) : (
        list.map((v, i) => (
          <View key={`${v}-${i}`} style={styles.listItem}>
            <Text style={styles.listItemText}>{v}</Text>
            <Pressable
              onPress={() => {
                const updated = list.filter((_, idx) => idx !== i);
                onSave(item.key, updated);
              }}
              hitSlop={8}
            >
              <Text style={styles.listItemRemove}>-</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Field renderer
// ---------------------------------------------------------------------------

function ConfigField({
  item,
  onUpdate,
}: {
  item: ConfigItem;
  onUpdate: (key: string, value: unknown) => void;
}) {
  if (!item.editable) {
    return <ReadOnlyField item={item} />;
  }

  switch (item.type) {
    case "bool":
      return <BoolField item={item} onToggle={onUpdate} />;
    case "number":
      return (
        <EditableNumberField item={item} onSave={onUpdate} />
      );
    case "string":
      return (
        <EditableStringField item={item} onSave={onUpdate} />
      );
    case "string_list":
      return (
        <EditableStringListField item={item} onSave={onUpdate} />
      );
    default:
      return <ReadOnlyField item={item} />;
  }
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ConfigScreen() {
  const [sections, setSections] = useState<ConfigSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await getConfig();
      if (mountedRef.current) {
        setSections(data.sections);
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
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const handleUpdate = useCallback(
    async (key: string, value: unknown) => {
      // Optimistic update
      setSections((prev) =>
        prev.map((s) => ({
          ...s,
          items: s.items.map((it) =>
            it.key === key ? { ...it, value } : it,
          ),
        })),
      );

      try {
        await setConfigField(key, value);
      } catch (err) {
        showAlert("Error", `Failed to update ${key}`);
        // Revert — reload
        load();
      }
    },
    [load],
  );

  // Group sections with the same label together
  const groupedSections = React.useMemo(() => {
    const grouped: { label: string; items: ConfigItem[] }[] = [];
    const labelMap = new Map<string, ConfigItem[]>();

    for (const section of sections) {
      const label = labelForSection(section.section);
      const existing = labelMap.get(label);
      if (existing) {
        existing.push(...section.items);
      } else {
        const items = [...section.items];
        labelMap.set(label, items);
        grouped.push({ label, items });
      }
    }

    // Filter out sections with hidden items (like discord channel arrays, etc)
    // Keep all for now — complex objects were already flattened by the API
    return grouped;
  }, [sections]);

  return (
    <>
      <Stack.Screen options={{ title: "Config" }} />
      <View style={styles.container}>
        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#71717a" />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.contentContainer}
          >
            {groupedSections.map((group) => (
              <View key={group.label} style={styles.section}>
                <Text style={styles.sectionHeader}>
                  {group.label.toUpperCase()}
                </Text>
                <View style={styles.sectionCard}>
                  {group.items.map((item, i) => (
                    <React.Fragment key={item.key}>
                      {i > 0 && <View style={styles.separator} />}
                      <ConfigField item={item} onUpdate={handleUpdate} />
                    </React.Fragment>
                  ))}
                </View>
              </View>
            ))}
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                config.local.yaml · Editable fields update live (hot-reloaded)
              </Text>
            </View>
          </ScrollView>
        )}
      </View>
    </>
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
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
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
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#27272a",
    marginLeft: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  labelGroup: {
    flex: 1,
    marginRight: 12,
  },
  rowLabel: {
    color: "#fafafa",
    fontSize: 15,
  },
  rowDescription: {
    color: "#52525b",
    fontSize: 12,
    marginTop: 2,
  },
  rowValue: {
    color: "#71717a",
    fontSize: 14,
    maxWidth: "55%",
    textAlign: "right",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  rowValueEditable: {
    color: "#3b82f6",
    fontSize: 14,
    maxWidth: "55%",
    textAlign: "right",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  editInput: {
    backgroundColor: "#27272a",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: "#fafafa",
    fontSize: 14,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    minWidth: 100,
    textAlign: "right",
    borderWidth: 1,
    borderColor: "#3b82f6",
  },
  listFieldContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyList: {
    color: "#52525b",
    fontSize: 13,
    marginTop: 6,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    backgroundColor: "#27272a",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  listItemText: {
    color: "#a1a1aa",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  listItemRemove: {
    color: "#ef4444",
    fontSize: 18,
    fontWeight: "700",
    paddingHorizontal: 6,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
  },
  footerText: {
    color: "#3f3f46",
    fontSize: 12,
    textAlign: "center",
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
