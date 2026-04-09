import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { getDashboardQuotaHistory } from "@/src/api/dashboard";
import type { QuotaHistoryResponse, QuotaSnapshot, QuotaHeavySession } from "@/src/api/types";
import { Dimensions } from "react-native";
import { quotaBarColor, formatResetTime, formatResetTimeInfo, formatTimestamp, computeQuotaPrediction, predictionIcon, predictionColor } from "@/src/utils/quotaHelpers";

/** Force a re-render every `ms` so time-relative text stays fresh */
function useTick(ms = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function formatAge(isoStr: string): string {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  if (diffMs < 0) return "just now";
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}

// SparklineChart — imported from shared component
import { SparklineChart } from "@/src/components/SparklineChart";

// ---------------------------------------------------------------------------
// Expanded quota bar (larger version for detail screen)
// ---------------------------------------------------------------------------

function ExpandedBar({
  label,
  utilization,
  resetsAt,
  subtitle,
}: {
  label: string;
  utilization: number;
  resetsAt?: string;
  subtitle?: string;
}) {
  const prediction = resetsAt ? computeQuotaPrediction(label, utilization, resetsAt) : null;
  const showAlert = prediction != null && prediction.status === "danger";
  return (
    <View style={barStyles.barRow}>
      <View style={barStyles.labelRow}>
        <View style={barStyles.labelWithAlert}>
          <Text style={barStyles.label}>{label}</Text>
          {showAlert && (
            <Text style={[barStyles.alertText, { color: predictionColor(prediction.status) }]}>
              {predictionIcon(prediction.status)} {prediction.message}
            </Text>
          )}
        </View>
        <Text style={barStyles.percentage}>
          {Math.round(utilization)}%
        </Text>
      </View>
      <View style={barStyles.barTrack}>
        <View
          style={[
            barStyles.barFill,
            {
              width: `${Math.min(100, utilization)}%`,
              backgroundColor: quotaBarColor(utilization),
            },
          ]}
        />
      </View>
      {subtitle ? (
        <Text style={barStyles.resetText}>{subtitle}</Text>
      ) : resetsAt ? (() => {
        const info = formatResetTimeInfo(resetsAt);
        return (
          <Text style={[barStyles.resetText, !info.isFresh && { color: "#f59e0b" }]}>
            {info.isFresh ? `Resets in ${info.text}` : info.text}
          </Text>
        );
      })() : null}
    </View>
  );
}

const barStyles = StyleSheet.create({
  barRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  labelWithAlert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  label: {
    color: "#fafafa",
    fontSize: 15,
    fontWeight: "600",
  },
  alertText: {
    fontSize: 12,
  },
  percentage: {
    color: "#a1a1aa",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  barTrack: {
    height: 12,
    backgroundColor: "#27272a",
    borderRadius: 6,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 6,
  },
  resetText: {
    color: "#71717a",
    fontSize: 12,
    marginTop: 4,
  },
});

// ---------------------------------------------------------------------------
// Burn rate chart — computed from 5h quota deltas between snapshots
// ---------------------------------------------------------------------------

// Fixed absolute scale for burn rate (values above MAX_BURN are clipped)
const MAX_BURN = 20; // %/hr

function BurnRateChart({ snapshots }: { snapshots: QuotaSnapshot[] }) {
  const [containerWidth, setContainerWidth] = useState(
    Dimensions.get("window").width - 64,
  );

  if (snapshots.length < 3) return null;

  // Compute deltas: positive = burning quota, negative = recovering
  const deltas: Array<{ ts: string; delta: number }> = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1].five_hour;
    const curr = snapshots[i].five_hour;
    if (prev != null && curr != null) {
      const timeDiffMin = (new Date(snapshots[i].ts).getTime() - new Date(snapshots[i - 1].ts).getTime()) / 60_000;
      if (timeDiffMin > 0) {
        const deltaPerHour = ((curr - prev) / timeDiffMin) * 60;
        deltas.push({ ts: snapshots[i].ts, delta: deltaPerHour });
      }
    }
  }

  if (deltas.length < 2) return null;

  const barWidth = Math.max(2, Math.floor(containerWidth / deltas.length) - 1);
  const gap = 1;
  const chartHeight = 80;
  const halfHeight = chartHeight / 2;

  const firstTs = formatTimestamp(deltas[0].ts);
  const lastTs = formatTimestamp(deltas[deltas.length - 1].ts);

  return (
    <View style={burnStyles.wrapper}>
      <Text style={burnStyles.label}>QUOTA BURN RATE</Text>
      <Text style={burnStyles.subtitle}>5-hour quota block consumption rate (%/hr)</Text>
      <View style={burnStyles.chartRow}>
        {/* Y-axis labels */}
        <View style={burnStyles.yAxis}>
          <Text style={burnStyles.yLabel}>+{MAX_BURN}</Text>
          <Text style={burnStyles.yLabelZero}>0</Text>
          <Text style={burnStyles.yLabel}>-{MAX_BURN}</Text>
        </View>
        <View
          style={[burnStyles.container, { height: chartHeight, flex: 1 }]}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
          {/* Zero line */}
          <View style={[burnStyles.zeroLine, { top: halfHeight }]} />
          <View style={burnStyles.barsRow}>
            {deltas.map((d, i) => {
              const isLast = i === deltas.length - 1;
              // Fixed scale: clip to MAX_BURN
              const clipped = Math.min(Math.abs(d.delta), MAX_BURN);
              const barHeight = Math.max(1, (clipped / MAX_BURN) * (halfHeight - 2));
              const isPositive = d.delta >= 0;
              const color = isPositive
                ? (Math.abs(d.delta) > 5 ? "#ef4444" : Math.abs(d.delta) > 2 ? "#eab308" : "#a1a1aa")
                : "#22c55e";
              return (
                <View
                  key={i}
                  style={{
                    width: barWidth,
                    height: barHeight,
                    backgroundColor: color,
                    borderRadius: 1,
                    marginRight: gap,
                    opacity: isLast ? 1 : 0.65,
                    position: "absolute",
                    left: i * (barWidth + gap),
                    ...(isPositive
                      ? { bottom: halfHeight }
                      : { top: halfHeight }),
                  }}
                />
              );
            })}
          </View>
        </View>
      </View>
      <View style={burnStyles.legendRow}>
        <Text style={burnStyles.timeLabel}>{firstTs}</Text>
        <View style={burnStyles.legendCenter}>
          <View style={[burnStyles.legendDot, { backgroundColor: "#ef4444" }]} />
          <Text style={burnStyles.legendText}>using</Text>
          <View style={[burnStyles.legendDot, { backgroundColor: "#22c55e" }]} />
          <Text style={burnStyles.legendText}>freed</Text>
        </View>
        <Text style={burnStyles.timeLabel}>{lastTs}</Text>
      </View>
    </View>
  );
}

const burnStyles = StyleSheet.create({
  wrapper: {
    marginBottom: 16,
  },
  label: {
    color: "#a1a1aa",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  subtitle: {
    color: "#52525b",
    fontSize: 10,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  yAxis: {
    width: 28,
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingRight: 4,
    paddingVertical: 2,
  },
  yLabel: {
    color: "#52525b",
    fontSize: 8,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  yLabelZero: {
    color: "#71717a",
    fontSize: 8,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  container: {
    backgroundColor: "#1c1c1f",
    borderRadius: 8,
    paddingHorizontal: 8,
    overflow: "hidden",
    position: "relative",
  },
  barsRow: {
    position: "absolute",
    left: 8,
    right: 8,
    top: 0,
    bottom: 0,
  },
  zeroLine: {
    position: "absolute",
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: "#52525b",
  },
  legendRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
    paddingHorizontal: 2,
  },
  legendCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendText: {
    color: "#52525b",
    fontSize: 9,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginRight: 6,
  },
  timeLabel: {
    color: "#52525b",
    fontSize: 9,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});

// ---------------------------------------------------------------------------
// Time range picker
// ---------------------------------------------------------------------------

const TIME_RANGES = [
  { label: "24h", hours: 24 },
  { label: "3d", hours: 72 },
  { label: "7d", hours: 168 },
] as const;

function TimeRangePicker({
  activeHours,
  onSelect,
  disabled,
}: {
  activeHours: number;
  onSelect: (hours: number) => void;
  disabled: boolean;
}) {
  return (
    <View style={pickerStyles.row}>
      {TIME_RANGES.map((r) => (
        <Pressable
          key={r.hours}
          style={[
            pickerStyles.btn,
            activeHours === r.hours && pickerStyles.btnActive,
          ]}
          onPress={() => onSelect(r.hours)}
          disabled={disabled}
        >
          <Text
            style={[
              pickerStyles.btnText,
              activeHours === r.hours && pickerStyles.btnTextActive,
            ]}
          >
            {r.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#27272a",
  },
  btnActive: {
    backgroundColor: "#3b82f6",
  },
  btnText: {
    color: "#a1a1aa",
    fontSize: 13,
    fontWeight: "600",
  },
  btnTextActive: {
    color: "#ffffff",
  },
});

// ---------------------------------------------------------------------------
// Heavy hitters — sessions that consumed the most between snapshots
// ---------------------------------------------------------------------------

/** Group heavy sessions by window, show delta + top sessions */
function HeavyHitters({ sessions, rangeHours }: { sessions: QuotaHeavySession[]; rangeHours?: number }) {
  if (sessions.length === 0) return null;

  // Group by window
  const windows: Map<string, { start: string; end: string; fhDelta: number; sdDelta: number; sessions: QuotaHeavySession[] }> = new Map();
  for (const s of sessions) {
    const key = `${s.window_start}|${s.window_end}`;
    if (!windows.has(key)) {
      windows.set(key, {
        start: s.window_start,
        end: s.window_end,
        fhDelta: s.five_hour_delta,
        sdDelta: s.seven_day_delta,
        sessions: [],
      });
    }
    windows.get(key)!.sessions.push(s);
  }

  // Sort windows by time descending (most recent first)
  const sortedWindows = Array.from(windows.values()).sort(
    (a, b) => new Date(b.end).getTime() - new Date(a.end).getTime(),
  );

  return (
    <View style={hhStyles.container}>
      <Text style={hhStyles.sectionLabel}>HEAVY HITTERS</Text>
      {sortedWindows.map((w, wi) => {
        const startTime = formatTimestamp(w.start, rangeHours);
        const endTime = formatTimestamp(w.end, rangeHours);
        const hasDelta = w.fhDelta > 0 || w.sdDelta > 0;
        return (
          <View key={wi} style={hhStyles.window}>
            <View style={hhStyles.windowHeader}>
              <Text style={hhStyles.windowTime}>{startTime} → {endTime}</Text>
              {hasDelta && (
                <Text style={[
                  hhStyles.windowDelta,
                  w.fhDelta > 10 ? { color: "#ef4444" } : w.fhDelta > 5 ? { color: "#eab308" } : {},
                ]}>
                  5h block: +{w.fhDelta}%  rolling 7d: +{w.sdDelta}%
                </Text>
              )}
            </View>
            {w.sessions.map((s, si) => {
              const displayName = s.display_name || s.session_name.replace(/^(imessage|signal|dispatch-app)\//, "");
              return (
                <View key={si} style={hhStyles.sessionRow}>
                  <View style={hhStyles.sessionInfo}>
                    <Text style={hhStyles.sessionName} numberOfLines={1} ellipsizeMode="tail">
                      {displayName}
                    </Text>
                    <Text style={hhStyles.sessionMeta}>
                      {s.event_count} events · {s.duration_sec.toFixed(0)}s
                    </Text>
                  </View>
                  {s.tools.length > 0 && (
                    <Text style={hhStyles.toolsText} numberOfLines={1}>
                      {s.tools.slice(0, 4).join(", ")}
                      {s.tools.length > 4 ? ` +${s.tools.length - 4}` : ""}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const hhStyles = StyleSheet.create({
  container: {
    marginTop: 8,
    marginBottom: 16,
  },
  sectionLabel: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  window: {
    backgroundColor: "#18181b",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  windowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  windowTime: {
    color: "#a1a1aa",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  windowDelta: {
    color: "#71717a",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  sessionRow: {
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#27272a",
  },
  sessionInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sessionName: {
    color: "#fafafa",
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  sessionMeta: {
    color: "#71717a",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginLeft: 8,
  },
  toolsText: {
    color: "#52525b",
    fontSize: 11,
    marginTop: 2,
  },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function QuotaDetailScreen() {
  useTick(30_000); // keep reset countdowns live
  const [data, setData] = useState<QuotaHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const mountedRef = useRef(true);
  const lastFetchRef = useRef(Date.now());

  const load = useCallback(
    async (h: number, refresh = false) => {
      if (refresh) setIsRefreshing(true);
      try {
        const result = await getDashboardQuotaHistory(h);
        if (mountedRef.current) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    load(hours);
    return () => {
      mountedRef.current = false;
    };
  }, [load, hours]);

  const handleTimeRange = useCallback(
    (h: number) => {
      if (h === hours || isLoading) return;
      setHours(h);
      setIsLoading(true);
      lastFetchRef.current = Date.now();
      load(h);
    },
    [hours, isLoading, load],
  );

  const handleRefresh = useCallback(() => {
    lastFetchRef.current = Date.now();
    load(hours, true);
  }, [hours, load]);

  // Build quota bars from current_quota
  const quota = data?.current_quota;
  const bars: Array<{ label: string; utilization: number; resetsAt: string }> = [];
  if (quota?.five_hour) {
    bars.push({ label: "5-Hour", utilization: quota.five_hour.utilization, resetsAt: quota.five_hour.resets_at });
  }
  if (quota?.seven_day) {
    bars.push({ label: "7-Day", utilization: quota.seven_day.utilization, resetsAt: quota.seven_day.resets_at });
  }
  if (quota?.seven_day_opus) {
    bars.push({ label: "7-Day Opus", utilization: quota.seven_day_opus.utilization, resetsAt: quota.seven_day_opus.resets_at });
  }
  if (quota?.seven_day_sonnet) {
    bars.push({ label: "7-Day Sonnet", utilization: quota.seven_day_sonnet.utilization, resetsAt: quota.seven_day_sonnet.resets_at });
  }

  // Extra usage (overage spend)
  const extraUsage = quota?.extra_usage;

  // Backoff / staleness status
  const backoff = data?.current_backoff;
  const failures = backoff?.consecutive_failures ?? 0;
  const quotaUpdated = data?._quota_updated_at;
  const snapshots = data?.snapshots ?? [];
  const lastSnapshotTs = snapshots.length > 0 ? snapshots[snapshots.length - 1].ts : null;
  const isStale = lastSnapshotTs
    ? Date.now() - new Date(lastSnapshotTs).getTime() > 20 * 60 * 1000
    : false;

  // Auto-refresh every 90s since last fetch (resets on manual interactions)
  useEffect(() => {
    const id = setInterval(() => {
      if (!isLoading && !isRefreshing && Date.now() - lastFetchRef.current >= 90_000) {
        lastFetchRef.current = Date.now();
        load(hours);
      }
    }, 15_000); // check every 15s but only fetch if 90s elapsed since last
    return () => clearInterval(id);
  }, [hours, isLoading, isRefreshing, load]);

  return (
    <>
      <Stack.Screen options={{ title: "Quota" }} />
      <View style={styles.container}>
        {isLoading && !data ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#71717a" />
          </View>
        ) : error && !data ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => load(hours)}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Sticky time range picker */}
            <View style={styles.stickyPicker}>
              <TimeRangePicker
                activeHours={hours}
                onSelect={handleTimeRange}
                disabled={isLoading}
              />
            </View>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={handleRefresh}
                  tintColor="#71717a"
                />
              }
            >
              {error && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>⚠️ {error}</Text>
                </View>
              )}

              {/* Expanded quota bars */}
              <View style={styles.card}>
                <Text style={styles.sectionHeader}>CURRENT QUOTA</Text>
                {bars.length > 0 ? (
                  bars.map((bar, i) => (
                    <React.Fragment key={bar.label}>
                      {i > 0 && <View style={styles.separator} />}
                      <ExpandedBar
                        label={bar.label}
                        utilization={bar.utilization}
                        resetsAt={bar.resetsAt}
                      />
                    </React.Fragment>
                  ))
                ) : (
                  <Text style={styles.mutedText}>
                    {isLoading ? "Loading quota…" : "No quota data"}
                  </Text>
                )}
              </View>

              {/* Extra usage card */}
              {extraUsage?.is_enabled && extraUsage.utilization != null && (
                <View style={styles.card}>
                  <Text style={styles.sectionHeader}>EXTRA USAGE</Text>
                  <ExpandedBar
                    label="Extra Usage"
                    utilization={extraUsage.utilization}
                    subtitle={`$${((extraUsage.used_credits ?? 0) / 100).toFixed(2)} of $${((extraUsage.monthly_limit ?? 0) / 100).toFixed(2)} · Resets monthly`}
                  />
                </View>
              )}

              {/* Sparkline charts */}
              <SparklineChart
                snapshots={snapshots}
                field="five_hour"
                label="5-HOUR QUOTA"
                height={120}
                rangeHours={hours}
                resetsAt={quota?.five_hour?.resets_at}
              />
              <SparklineChart
                snapshots={snapshots}
                field="seven_day"
                label="7-DAY QUOTA"
                height={120}
                rangeHours={hours}
                resetsAt={quota?.seven_day?.resets_at}
              />

              {/* Burn rate chart */}
              <BurnRateChart snapshots={snapshots} />

              {/* Heavy hitters */}
              <HeavyHitters sessions={data?.heavy_sessions ?? []} rangeHours={hours} />

              {/* Status footer */}
              <View style={styles.statusSection}>
                {failures > 0 ? (
                  <Text style={styles.statusWarning}>
                    ⚠️ API unreachable — retrying in{" "}
                    {Math.round((backoff?.backoff_seconds ?? 900) / 60)}m ({failures}{" "}
                    {failures === 1 ? "failure" : "failures"})
                  </Text>
                ) : quotaUpdated ? (
                  <Text style={styles.statusOk}>
                    ✓ Quota healthy — fetched {formatAge(quotaUpdated)}
                  </Text>
                ) : null}
                {isStale && (
                  <Text style={styles.statusStale}>
                    ⚠ Latest snapshot is over 20 min old — fetcher may be down
                  </Text>
                )}
                <Text style={styles.snapshotCount}>
                  {snapshots.length} snapshots in range
                </Text>
              </View>
            </ScrollView>
          </>
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
  stickyPicker: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: "#09090b",
  },
  scrollContent: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 48,
  },
  card: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  sectionHeader: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#27272a",
    marginHorizontal: 16,
  },
  mutedText: {
    color: "#52525b",
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 16,
  },
  statusSection: {
    marginTop: 8,
    paddingHorizontal: 4,
  },
  statusOk: {
    color: "#22c55e",
    fontSize: 12,
    marginBottom: 4,
  },
  statusWarning: {
    color: "#eab308",
    fontSize: 12,
    marginBottom: 4,
  },
  statusStale: {
    color: "#f59e0b",
    fontSize: 12,
    marginBottom: 4,
  },
  snapshotCount: {
    color: "#52525b",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 4,
  },
  errorText: {
    color: "#fafafa",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 12,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: "#3b82f6",
    borderRadius: 8,
  },
  retryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  errorBanner: {
    backgroundColor: "#7f1d1d",
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorBannerText: {
    color: "#fca5a5",
    fontSize: 13,
  },
});
