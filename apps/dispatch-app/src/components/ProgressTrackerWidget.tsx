import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ProgressTrackerWidgetData } from "../api/types";
import { branding } from "../config/branding";

interface ProgressTrackerWidgetProps {
  data: ProgressTrackerWidgetData;
}

const STATUS_CONFIG = {
  pending: { icon: "○", color: "#71717a", barColor: "#3f3f46" },
  in_progress: { icon: "◉", color: branding.accentColor, barColor: branding.accentColor },
  complete: { icon: "✓", color: "#22c55e", barColor: "#22c55e" },
  error: { icon: "✗", color: "#ef4444", barColor: "#ef4444" },
} as const;

export function ProgressTrackerWidget({ data }: ProgressTrackerWidgetProps) {
  const steps = data.steps;

  return (
    <View style={styles.container}>
      {data.title ? <Text style={styles.title}>{data.title}</Text> : null}
      <View style={styles.stepsContainer}>
        {steps.map((step, idx) => {
          const status = step.status ?? "pending";
          const config = STATUS_CONFIG[status];
          const isLast = idx === steps.length - 1;

          return (
            <View key={idx} style={styles.stepRow}>
              {/* Left column: icon + connector line */}
              <View style={styles.iconColumn}>
                <View
                  style={[
                    styles.iconCircle,
                    status === "complete" && styles.iconCircleComplete,
                    status === "in_progress" && styles.iconCircleInProgress,
                    status === "error" && styles.iconCircleError,
                  ]}
                >
                  <Text
                    style={[
                      styles.iconText,
                      { color: status === "pending" ? "#71717a" : "#ffffff" },
                    ]}
                  >
                    {config.icon}
                  </Text>
                </View>
                {!isLast && (
                  <View
                    style={[
                      styles.connector,
                      { backgroundColor: config.barColor },
                    ]}
                  />
                )}
              </View>

              {/* Right column: label + detail */}
              <View style={[styles.labelColumn, !isLast && styles.labelColumnWithConnector]}>
                <Text
                  style={[
                    styles.stepLabel,
                    status === "complete" && styles.stepLabelComplete,
                    status === "in_progress" && styles.stepLabelActive,
                    status === "error" && styles.stepLabelError,
                  ]}
                >
                  {step.label}
                </Text>
                {step.detail ? (
                  <Text style={styles.stepDetail}>{step.detail}</Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    gap: 8,
  },
  title: {
    color: "#e4e4e7",
    fontSize: 15,
    fontWeight: "600",
  },
  stepsContainer: {
    gap: 0,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  iconColumn: {
    width: 28,
    alignItems: "center",
  },
  iconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "#52525b",
    backgroundColor: "#27272a",
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircleComplete: {
    backgroundColor: "#22c55e",
    borderColor: "#22c55e",
  },
  iconCircleInProgress: {
    backgroundColor: branding.accentColor,
    borderColor: branding.accentColor,
  },
  iconCircleError: {
    backgroundColor: "#ef4444",
    borderColor: "#ef4444",
  },
  iconText: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: -1,
  },
  connector: {
    width: 2,
    flex: 1,
    minHeight: 16,
    backgroundColor: "#3f3f46",
  },
  labelColumn: {
    flex: 1,
    marginLeft: 8,
    paddingTop: 1,
  },
  labelColumnWithConnector: {
    paddingBottom: 12,
  },
  stepLabel: {
    color: "#a1a1aa",
    fontSize: 14,
    fontWeight: "500",
  },
  stepLabelActive: {
    color: "#e4e4e7",
    fontWeight: "600",
  },
  stepLabelComplete: {
    color: "#22c55e",
  },
  stepLabelError: {
    color: "#ef4444",
  },
  stepDetail: {
    color: "#71717a",
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
});
