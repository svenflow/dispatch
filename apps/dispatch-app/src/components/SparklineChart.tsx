/**
 * View-based sparkline bar chart for quota utilization over time.
 * Extracted from quota.tsx for reuse on the dashboard.
 */
import React, { useState } from "react";
import { Dimensions, Platform, StyleSheet, Text, View } from "react-native";
import { quotaBarColor, formatTimestamp } from "@/src/utils/quotaHelpers";
import type { QuotaSnapshot } from "@/src/api/types";

export function SparklineChart({
  snapshots,
  field,
  label,
  height = 120,
  rangeHours,
}: {
  snapshots: QuotaSnapshot[];
  field: "five_hour" | "seven_day";
  label: string;
  height?: number;
  rangeHours?: number;
}) {
  const [containerWidth, setContainerWidth] = useState(
    Dimensions.get("window").width - 48,
  );

  if (snapshots.length < 2) {
    return (
      <View style={sparkStyles.container}>
        <Text style={sparkStyles.label}>{label}</Text>
        <View style={[sparkStyles.chartArea, { height }]}>
          <Text style={sparkStyles.emptyText}>
            Collecting data — check back in ~15 min
          </Text>
        </View>
      </View>
    );
  }

  const barWidth = Math.max(3, Math.floor(containerWidth / snapshots.length) - 1);
  const gap = 1;
  const usableHeight = height - 20;
  const lastIdx = snapshots.length - 1;

  // X-axis labels: first, middle, last
  const firstTs = formatTimestamp(snapshots[0].ts, rangeHours);
  const midTs = formatTimestamp(snapshots[Math.floor(snapshots.length / 2)].ts, rangeHours);
  const lastTs = formatTimestamp(snapshots[lastIdx].ts, rangeHours);

  // 80% threshold line position from bottom of chart area
  const thresholdBottom = 0.8 * usableHeight + 4; // +4 for paddingBottom

  return (
    <View style={sparkStyles.container}>
      <Text style={sparkStyles.label}>{label}</Text>
      <View
        style={[sparkStyles.chartArea, { height }]}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        {/* 80% threshold reference line */}
        <View style={[sparkStyles.thresholdLine, { bottom: thresholdBottom }]}>
          <Text style={sparkStyles.thresholdLabel}>80%</Text>
        </View>
        <View style={sparkStyles.barsRow}>
          {snapshots.map((snap, i) => {
            const val = snap[field] ?? 0;
            const barHeight = Math.max(1, (val / 100) * usableHeight);
            const isLast = i === lastIdx;
            const color = snap[field] === null
              ? "#3f3f46"  // NULL → gray
              : quotaBarColor(val);
            return (
              <View
                key={i}
                style={{
                  width: barWidth,
                  height: barHeight,
                  backgroundColor: color,
                  borderRadius: 1,
                  marginRight: gap,
                  alignSelf: "flex-end",
                  opacity: isLast ? 1 : 0.7,
                }}
              />
            );
          })}
        </View>
      </View>
      <View style={sparkStyles.xAxis}>
        <Text style={sparkStyles.xLabel}>{firstTs}</Text>
        <Text style={sparkStyles.xLabel}>{midTs}</Text>
        <Text style={sparkStyles.xLabelNow}>{lastTs} ●</Text>
      </View>
    </View>
  );
}

const sparkStyles = StyleSheet.create({
  container: {
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
  chartArea: {
    backgroundColor: "#18181b",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    flex: 1,
  },
  thresholdLine: {
    position: "absolute",
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: "#3f3f46",
    flexDirection: "row",
    alignItems: "center",
  },
  thresholdLabel: {
    position: "absolute",
    right: 0,
    color: "#52525b",
    fontSize: 8,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    top: -10,
  },
  emptyText: {
    color: "#52525b",
    fontSize: 13,
    textAlign: "center",
    alignSelf: "center",
  },
  xAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginTop: 4,
  },
  xLabel: {
    color: "#52525b",
    fontSize: 10,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  xLabelNow: {
    color: "#a1a1aa",
    fontSize: 10,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "600",
  },
});
