import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import type { CookingTimelineWidgetData, CookingStep, CookingDish } from "../api/types";

import { useWidgetState } from "../hooks/useWidgetState";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISH_COLORS = ["#EF4444", "#22C55E", "#F59E0B", "#3B82F6", "#A855F7", "#EC4899"];
const TIMER_TICK_MS = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CookingTimelineWidgetProps {
  data: CookingTimelineWidgetData;
  messageId?: string;
}

interface TimerState {
  startedAt: number;
  durationMs: number;
  notificationId?: string;
  pausedAt?: number; // timestamp when paused (remaining = durationMs - (pausedAt - startedAt))
}

type CookingPhase = "not_started" | "active" | "completed";
type NotifPermission = "granted" | "denied" | "undetermined";

interface PersistedState {
  phase: CookingPhase;
  startTime: number;
  completedSteps: Record<string, number>;
  activeTimers: Record<string, { startedAt: number; durationMs: number; pausedAt?: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return "0:00";
  const totalSec = Math.ceil(remainingMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getAbsoluteTime(st: number, offsetMin: number): string {
  return formatTime(new Date(st + offsetMin * 60_000));
}

// ---------------------------------------------------------------------------
// StepCard sub-component
// ---------------------------------------------------------------------------

interface StepCardProps {
  step: CookingStep;
  isCurrent: boolean;
  isCompleted: boolean;
  completedAt?: number;
  dish: CookingDish | undefined;
  color: string;
  timer: TimerState | undefined;
  isExpanded: boolean;
  startTime: number;
  pulseAnim: Animated.Value;
  onComplete: (id: string) => void;
  onUndo: (id: string) => void;
  onStartTimer: (id: string, min: number) => void;
  onPauseTimer: (id: string) => void;
  onResumeTimer: (id: string) => void;
  onExtendTimer: (id: string) => void;
  onCancelTimer: (id: string) => void;
  onToggleExpand: (id: string) => void;
}

function StepCard({
  step, isCurrent, isCompleted, completedAt, dish, color, timer, isExpanded, startTime: st,
  pulseAnim: pulse, onComplete, onUndo, onStartTimer, onPauseTimer, onResumeTimer, onExtendTimer, onCancelTimer, onToggleExpand,
}: StepCardProps) {
  const isPaused = !!timer?.pausedAt;
  const remaining = timer
    ? isPaused
      ? timer.durationMs - (timer.pausedAt! - timer.startedAt)
      : timer.durationMs - (Date.now() - timer.startedAt)
    : null;
  const isExpired = remaining !== null && remaining <= 0 && !isPaused;
  const hasTimer = step.timer && step.duration_min;

  // --- Completed step: compact inline with undo ---
  if (isCompleted) {
    return (
      <Pressable onPress={() => onUndo(step.id)}>
        <View style={styles.stepCardCompleted}>
          <View style={[styles.timelineDot, styles.timelineDotDone]} />
          <View style={styles.stepContentCompleted}>
            <Text style={styles.completedStepText}>
              {dish?.emoji} {step.action}
            </Text>
            <Text style={styles.completedMeta}>
              {completedAt ? formatTime(new Date(completedAt)) : "done"} · tap to undo
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }

  // --- Active step ---
  return (
    <Animated.View
      style={[
        styles.stepCard,
        isCurrent && [styles.stepCardCurrent, { borderColor: color }],
        !isCurrent && styles.stepCardPending,
        isExpired && { opacity: pulse },
      ]}
    >
      {/* Step header */}
      <View style={styles.stepHeader}>
        <View style={styles.stepTitleRow}>
          <Text style={styles.stepEmoji}>{dish?.emoji}</Text>
          <Text style={[styles.stepAction, isCurrent && styles.stepActionCurrent]} numberOfLines={2}>
            {step.action}
          </Text>
        </View>
        <View style={styles.stepMeta}>
          <Text style={styles.stepMetaLabel}>
            {step.type === "passive" ? "PASSIVE" : "ACTIVE"}
            {step.duration_min ? ` · ${step.duration_min} min` : ""}
          </Text>
          {st > 0 && (
            <Text style={styles.stepTimeLabel}>
              {getAbsoluteTime(st, step.offset_min)}
            </Text>
          )}
        </View>
      </View>

      {/* Detail (expandable) */}
      {step.detail && (
        <Pressable onPress={() => onToggleExpand(step.id)} style={styles.detailPressable}>
          <Text style={styles.detailToggle}>
            {isExpanded ? "▾ Details" : "▸ Details"}
          </Text>
          {isExpanded && <Text style={styles.detailText}>{step.detail}</Text>}
        </Pressable>
      )}

      {/* Checkpoint */}
      {step.checkpoint && (
        <View style={styles.checkpoint}>
          <Text style={styles.checkpointText}>📍 {step.checkpoint}</Text>
        </View>
      )}

      {/* Timer controls */}
      {hasTimer && !timer && (
        <Pressable
          style={[styles.timerButton, { backgroundColor: color + "18" }]}
          onPress={() => onStartTimer(step.id, step.duration_min!)}
        >
          <Text style={[styles.timerButtonText, { color }]}>
            ▶  Start Timer · {step.duration_min} min
          </Text>
        </Pressable>
      )}

      {timer && (
        <View style={[styles.timerDisplay, isExpired && styles.timerDisplayExpired, isPaused && styles.timerDisplayPaused]}>
          <View style={styles.timerCountdownRow}>
            {isExpired ? (
              <Text style={styles.timerExpiredText}>
                Done {formatCountdown(Math.abs(remaining!))} ago
              </Text>
            ) : (
              <Text style={[styles.timerCountdown, isPaused && { opacity: 0.5 }, { color: isExpired ? "#EF4444" : color }]}>
                {formatCountdown(remaining!)}
              </Text>
            )}
          </View>
          <View style={styles.timerActions}>
            {!isExpired && (
              <Pressable
                style={styles.iconButton}
                onPress={() => isPaused ? onResumeTimer(step.id) : onPauseTimer(step.id)}
              >
                <Text style={[styles.iconButtonText, { color: isPaused ? "#22C55E" : "#9CA3AF" }]}>
                  {isPaused ? "▶" : "⏸"}
                </Text>
              </Pressable>
            )}
            <Pressable
              style={styles.iconButton}
              onPress={() => onCancelTimer(step.id)}
            >
              <Text style={[styles.iconButtonText, { color: "#4B5563" }]}>✕</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Complete button */}
      <Pressable
        style={styles.completeButton}
        onPress={() => onComplete(step.id)}
      >
        <Text style={styles.completeButtonText}>Mark done</Text>
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function CookingTimelineWidget({ data, messageId }: CookingTimelineWidgetProps) {
  const { dishes, steps, title, total_duration_min, target_time } = data;
  const widgetId = messageId ?? data.title; // fallback key for persistence

  // --- Persisted state via generic hook ---
  const defaultPersisted: PersistedState = {
    phase: "not_started",
    startTime: 0,
    completedSteps: {},
    activeTimers: {},
  };
  const [persisted, setPersisted, loaded] = useWidgetState<PersistedState>(
    widgetId,
    "cooking_timeline",
    defaultPersisted,
  );

  // Destructure persisted state for convenience
  const { phase, startTime, completedSteps } = persisted;

  // Active timers need notificationId (not persisted) — overlay in-memory
  const [liveTimers, setLiveTimers] = useState<Record<string, TimerState>>({});

  // Merge persisted timer data with live notification IDs
  const activeTimers = useMemo(() => {
    const merged: Record<string, TimerState> = {};
    for (const [id, t] of Object.entries(persisted.activeTimers)) {
      merged[id] = liveTimers[id] ?? { startedAt: t.startedAt, durationMs: t.durationMs, pausedAt: t.pausedAt };
    }
    return merged;
  }, [persisted.activeTimers, liveTimers]);

  // Convenience setters that update persisted state
  const setPhase = useCallback(
    (p: CookingPhase) => setPersisted((prev) => ({ ...prev, phase: p })),
    [setPersisted],
  );
  const setStartTime = useCallback(
    (t: number) => setPersisted((prev) => ({ ...prev, startTime: t })),
    [setPersisted],
  );
  const setCompletedSteps = useCallback(
    (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) =>
      setPersisted((prev) => ({
        ...prev,
        completedSteps: typeof updater === "function" ? updater(prev.completedSteps) : updater,
      })),
    [setPersisted],
  );
  const setActiveTimers = useCallback(
    (updater: Record<string, TimerState> | ((prev: Record<string, TimerState>) => Record<string, TimerState>)) => {
      // Update both persisted (without notificationId) and live (with notificationId)
      const resolve = (prev: Record<string, TimerState>) =>
        typeof updater === "function" ? updater(prev) : updater;

      setLiveTimers((prevLive) => {
        const merged: Record<string, TimerState> = {};
        for (const [id, t] of Object.entries(persisted.activeTimers)) {
          merged[id] = prevLive[id] ?? { startedAt: t.startedAt, durationMs: t.durationMs, pausedAt: t.pausedAt };
        }
        const next = resolve(merged);
        // Update persisted (strip notificationId, keep pausedAt)
        const persistedTimers: Record<string, { startedAt: number; durationMs: number; pausedAt?: number }> = {};
        for (const [id, t] of Object.entries(next)) {
          persistedTimers[id] = { startedAt: t.startedAt, durationMs: t.durationMs, ...(t.pausedAt ? { pausedAt: t.pausedAt } : {}) };
        }
        setPersisted((prev) => ({ ...prev, activeTimers: persistedTimers }));
        return next;
      });
    },
    [setPersisted, persisted.activeTimers],
  );

  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [dishFilter, setDishFilter] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [notifPermission, setNotifPermission] = useState<NotifPermission>("undetermined");

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Dish color map
  const dishColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    dishes.forEach((d, i) => {
      map[d.id] = DISH_COLORS[i % DISH_COLORS.length];
    });
    return map;
  }, [dishes]);

  // --- Timer tick (only when there are running, non-paused timers) ---
  useEffect(() => {
    if (phase !== "active") return;
    const hasRunning = Object.values(activeTimers).some((t) => !t.pausedAt);
    if (!hasRunning) return;
    const interval = setInterval(() => setTick((t) => t + 1), TIMER_TICK_MS);
    return () => clearInterval(interval);
  }, [phase, activeTimers]);

  // --- Pulse animation for expired timers ---
  useEffect(() => {
    const hasExpired = Object.values(activeTimers).some(
      (t) => t.durationMs - (Date.now() - t.startedAt) <= 0,
    );
    if (hasExpired) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [activeTimers, pulseAnim]);

  // --- Check completion (haptic only, no phase change — timeline stays visible) ---
  const allDone = useMemo(() => steps.every((s) => completedSteps[s.id]), [steps, completedSteps]);
  const prevAllDone = useRef(false);
  useEffect(() => {
    if (phase === "active" && allDone && !prevAllDone.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    prevAllDone.current = allDone;
  }, [allDone, phase]);

  // --- Derived data ---
  const currentStepId = useMemo(
    () => steps.find((s) => !completedSteps[s.id])?.id ?? null,
    [steps, completedSteps],
  );

  const filteredSteps = useMemo(
    () => (dishFilter ? steps.filter((s) => s.dish_id === dishFilter) : steps),
    [steps, dishFilter],
  );


  // "While waiting" — cross-dish always, regardless of filter
  const whileWaitingSteps = useMemo(() => {
    if (!currentStepId) return [];
    const current = steps.find((s) => s.id === currentStepId);
    if (!current || current.type !== "passive" || !current.duration_min) return [];
    if (!activeTimers[currentStepId]) return [];
    const windowEnd = current.offset_min + current.duration_min;
    return steps.filter(
      (s) =>
        s.id !== currentStepId &&
        !completedSteps[s.id] &&
        s.type === "active" &&
        s.offset_min >= current.offset_min &&
        s.offset_min < windowEnd,
    );
  }, [currentStepId, steps, completedSteps, activeTimers]);

  // --- Actions ---
  const handleStartCooking = useCallback(() => {
    setStartTime(Date.now());
    setPhase("active");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const handleCompleteStep = useCallback((stepId: string) => {
    setCompletedSteps((prev) => ({ ...prev, [stepId]: Date.now() }));
    // Auto-clear timer if running
    setActiveTimers((prev) => {
      if (!prev[stepId]) return prev;
      const next = { ...prev };
      if (next[stepId]?.notificationId) {
        Notifications.cancelScheduledNotificationAsync(next[stepId].notificationId!).catch(() => {});
      }
      delete next[stepId];
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleUndoStep = useCallback((stepId: string) => {
    setCompletedSteps((prev) => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    setPhase("active");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const scheduleNotification = useCallback(
    async (title: string, body: string, seconds: number): Promise<string | undefined> => {
      try {
        let { status } = await Notifications.getPermissionsAsync();
        // Request permissions on first attempt (undetermined → prompt user)
        if (status === "undetermined") {
          const result = await Notifications.requestPermissionsAsync();
          status = result.status;
        }
        if (status !== "granted") {
          setNotifPermission("denied");
          return undefined;
        }
        setNotifPermission("granted");
        const id = await Notifications.scheduleNotificationAsync({
          content: { title, body, sound: true },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(1, Math.ceil(seconds)) },
        });
        return id;
      } catch (e) {
        console.error("[CookingTimeline] Failed to schedule notification:", e);
        setNotifPermission("denied");
        return undefined;
      }
    },
    [],
  );

  const handleStartTimer = useCallback(
    async (stepId: string, durationMin: number) => {
      const durationMs = durationMin * 60_000;
      const step = steps.find((s) => s.id === stepId);
      const dish = step ? dishes.find((d) => d.id === step.dish_id) : null;

      const notificationId = await scheduleNotification(
        `${dish?.emoji ?? "🍽"} Timer done!`,
        step?.action ?? "Time's up!",
        durationMs / 1000,
      );

      setActiveTimers((prev) => ({
        ...prev,
        [stepId]: { startedAt: Date.now(), durationMs, notificationId },
      }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [steps, dishes, scheduleNotification],
  );

  const handleExtendTimer = useCallback(
    async (stepId: string) => {
      // Read current timer state via ref to avoid stale closure on rapid double-tap
      let existing: TimerState | undefined;
      setActiveTimers((prev) => {
        existing = prev[stepId];
        return prev; // no-op update to read current value
      });
      if (!existing) return;

      // Cancel old notification
      if (existing.notificationId) {
        try {
          await Notifications.cancelScheduledNotificationAsync(existing.notificationId);
        } catch {}
      }

      // Reset timer: startedAt = now, duration = remaining + 5 min (or 5 min if expired)
      const elapsed = existing.pausedAt
        ? existing.pausedAt - existing.startedAt
        : Date.now() - existing.startedAt;
      const remaining = existing.durationMs - elapsed;
      const newDurationMs = Math.max(remaining, 0) + 5 * 60_000;

      const notificationId = await scheduleNotification(
        "⏱ Timer extended +5 min",
        steps.find((s) => s.id === stepId)?.action ?? "Timer extended",
        newDurationMs / 1000,
      );

      setActiveTimers((prev) => ({
        ...prev,
        [stepId]: { startedAt: Date.now(), durationMs: newDurationMs, notificationId },
      }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [steps, scheduleNotification],
  );

  const handleCancelTimer = useCallback(
    (stepId: string) => {
      const existing = activeTimers[stepId];
      if (!existing) return;
      Alert.alert("Cancel timer?", undefined, [
        { text: "Keep", style: "cancel" },
        {
          text: "Cancel Timer",
          style: "destructive",
          onPress: async () => {
            if (existing.notificationId) {
              try {
                await Notifications.cancelScheduledNotificationAsync(existing.notificationId);
              } catch {}
            }
            setActiveTimers((prev) => {
              const next = { ...prev };
              delete next[stepId];
              return next;
            });
          },
        },
      ]);
    },
    [activeTimers],
  );

  const handlePauseTimer = useCallback(
    async (stepId: string) => {
      const existing = activeTimers[stepId];
      if (!existing || existing.pausedAt) return;
      // Cancel notification while paused
      if (existing.notificationId) {
        try {
          await Notifications.cancelScheduledNotificationAsync(existing.notificationId);
        } catch {}
      }
      setActiveTimers((prev) => ({
        ...prev,
        [stepId]: { ...prev[stepId], pausedAt: Date.now(), notificationId: undefined },
      }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [activeTimers],
  );

  const handleResumeTimer = useCallback(
    async (stepId: string) => {
      const existing = activeTimers[stepId];
      if (!existing || !existing.pausedAt) return;
      // Calculate remaining time and create a fresh timer
      const elapsed = existing.pausedAt - existing.startedAt;
      const remainingMs = existing.durationMs - elapsed;
      if (remainingMs <= 0) {
        // Timer was already expired when paused — just unpause
        setActiveTimers((prev) => {
          const t = { ...prev[stepId] };
          delete t.pausedAt;
          return { ...prev, [stepId]: t };
        });
        return;
      }
      const step = steps.find((s) => s.id === stepId);
      const dish = step ? dishes.find((d) => d.id === step.dish_id) : null;
      const notificationId = await scheduleNotification(
        `${dish?.emoji ?? "🍽"} Timer done!`,
        step?.action ?? "Time's up!",
        remainingMs / 1000,
      );
      // Reset startedAt to now with remaining duration
      setActiveTimers((prev) => ({
        ...prev,
        [stepId]: { startedAt: Date.now(), durationMs: remainingMs, notificationId },
      }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [activeTimers, steps, dishes, scheduleNotification],
  );

  const toggleExpand = useCallback((stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  // Don't render until persisted state is loaded
  if (!loaded) return null;

  // ---------------------------------------------------------------------------
  // Render: Not Started
  // ---------------------------------------------------------------------------
  if (phase === "not_started") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.dishPreview}>
          {dishes.map((d, i) => (
            <View key={d.id} style={styles.dishPreviewItem}>
              <Text style={styles.dishPreviewEmoji}>{d.emoji}</Text>
              <Text style={styles.dishPreviewName}>{d.name}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.durationLabel}>~{total_duration_min} min</Text>
        {target_time && (
          <Text style={styles.durationLabel}>Target: {target_time}</Text>
        )}
        <Pressable style={styles.startButton} onPress={handleStartCooking}>
          <Text style={styles.startButtonText}>Start Cooking</Text>
        </Pressable>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Active Cooking (stays visible even when all steps are done)
  // ---------------------------------------------------------------------------
  return (
    <View style={styles.container}>
      {/* Header */}
      {allDone ? (
        <View style={styles.completedBanner}>
          <Text style={styles.completedBannerText}>🎉 Dinner is served!</Text>
          <Text style={styles.completedBannerSub}>{title} · {steps.length} steps</Text>
        </View>
      ) : (
        <Text style={styles.title}>{title}</Text>
      )}

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round((Object.keys(completedSteps).length / steps.length) * 100)}%` },
          ]}
        />
      </View>
      <Text style={styles.progressLabel}>
        {Object.keys(completedSteps).length} of {steps.length} steps
      </Text>

      {/* Dish filter chips */}
      <View style={styles.dishChips}>
        {dishes.map((d) => {
          const isActive = dishFilter === d.id;
          const chipColor = dishColorMap[d.id];
          return (
            <Pressable
              key={d.id}
              style={[
                styles.dishChip,
                isActive && { backgroundColor: chipColor + "20", borderColor: chipColor },
              ]}
              onPress={() => setDishFilter(isActive ? null : d.id)}
            >
              <Text style={[styles.dishChipText, isActive && { color: chipColor }]}>
                {d.emoji} {d.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Active dishes status strip */}
      <View style={styles.statusStrip}>
        {dishes.map((d) => {
          const timerSteps = steps
            .filter((s) => s.dish_id === d.id && activeTimers[s.id] && !completedSteps[s.id])
            .map((s) => ({
              step: s,
              timer: activeTimers[s.id],
              remaining: activeTimers[s.id].pausedAt
                ? activeTimers[s.id].durationMs - (activeTimers[s.id].pausedAt! - activeTimers[s.id].startedAt)
                : activeTimers[s.id].durationMs - (Date.now() - activeTimers[s.id].startedAt),
            }))
            .sort((a, b) => a.remaining - b.remaining);
          const best = timerSteps[0];

          return (
            <View key={d.id} style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: dishColorMap[d.id] }]} />
              <Text style={styles.statusDishName}>{d.name}</Text>
              {best ? (
                <Text
                  style={[
                    styles.statusTimer,
                    best.remaining <= 0 && styles.statusTimerExpired,
                  ]}
                >
                  {best.remaining > 0 ? formatCountdown(best.remaining) : "done!"}
                </Text>
              ) : (
                <Text style={styles.statusDash}>—</Text>
              )}
            </View>
          );
        })}
      </View>

      {/* Notification permission warning */}
      {notifPermission === "denied" && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            ⚠️ Enable notifications for timer alerts
          </Text>
        </View>
      )}

      {/* Timeline */}
      <View style={styles.timeline}>
        {filteredSteps.map((step, idx) => {
          const isCompleted = !!completedSteps[step.id];
          const isFirst = step.id === currentStepId;
          const isLastStep = step.id === steps[steps.length - 1]?.id;
          const isLast = idx === filteredSteps.length - 1;

          return (
            <View key={step.id} style={styles.timelineItem}>
              {/* Connector line */}
              {!isLast && (
                <View style={[styles.timelineConnector, isCompleted && styles.timelineConnectorDone]} />
              )}
              {/* Plating separator before last step */}
              {isLastStep && !isCompleted && (
                <View style={styles.platingSeparator}>
                  <View style={styles.platingSeparatorLine} />
                  <Text style={styles.platingSeparatorText}>PLATING</Text>
                  <View style={styles.platingSeparatorLine} />
                </View>
              )}
            <StepCard
              step={step}
              isCurrent={isFirst}
              isCompleted={isCompleted}
              completedAt={completedSteps[step.id]}
              dish={dishes.find((d) => d.id === step.dish_id)}
              color={dishColorMap[step.dish_id] ?? "#71717a"}
              timer={activeTimers[step.id]}
              isExpanded={expandedSteps.has(step.id)}
              startTime={startTime}
              pulseAnim={pulseAnim}
              onComplete={handleCompleteStep}
              onUndo={handleUndoStep}
              onStartTimer={handleStartTimer}
              onPauseTimer={handlePauseTimer}
              onResumeTimer={handleResumeTimer}
              onExtendTimer={handleExtendTimer}
              onCancelTimer={handleCancelTimer}
              onToggleExpand={toggleExpand}
            />
              {/* While waiting cue after current passive step with running timer */}
              {isFirst && !isCompleted && activeTimers[step.id] && step.type === "passive" && (
                <View style={styles.whileWaiting}>
                  {whileWaitingSteps.length > 0 ? (
                    <>
                      <Text style={styles.whileWaitingLabel}>WHILE WAITING</Text>
                      {whileWaitingSteps.map((ws) => (
                        <Text key={ws.id} style={styles.whileWaitingStep}>
                          {dishes.find((d) => d.id === ws.dish_id)?.emoji} {ws.action}
                        </Text>
                      ))}
                    </>
                  ) : (
                    <Text style={styles.whileWaitingLabel}>
                      Nothing to do — relax ☕
                    </Text>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // --- Layout ---
  container: {
    marginTop: 8,
    gap: 16,
  },

  // --- Typography & Header ---
  title: {
    color: "#F5F5F5",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  durationLabel: {
    color: "#9CA3AF",
    fontSize: 13,
    fontWeight: "500",
  },

  // --- Not-started: dish preview ---
  dishPreview: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 4,
  },
  dishPreviewItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dishPreviewEmoji: {
    fontSize: 20,
  },
  dishPreviewName: {
    color: "#9CA3AF",
    fontSize: 14,
    fontWeight: "500",
  },

  // --- Start button ---
  startButton: {
    backgroundColor: "#F59E0B",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  startButtonText: {
    color: "#0F0F0F",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },

  // --- Completed banner ---
  completedBanner: {
    backgroundColor: "#0A2E1A",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 4,
  },
  completedBannerText: {
    color: "#22C55E",
    fontSize: 18,
    fontWeight: "700",
  },
  completedBannerSub: {
    color: "#9CA3AF",
    fontSize: 13,
  },

  // --- Progress bar ---
  progressBar: {
    height: 4,
    backgroundColor: "#1F1F1F",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#F59E0B",
    borderRadius: 2,
  },
  progressLabel: {
    color: "#4B5563",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: -8,
  },

  // --- Dish filter chips (pill style) ---
  dishChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dishChip: {
    borderWidth: 1,
    borderColor: "#2E2E2E",
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: "#1A1A1A",
  },
  dishChipText: {
    color: "#9CA3AF",
    fontSize: 13,
    fontWeight: "600",
  },

  // --- Status strip ---
  statusStrip: {
    backgroundColor: "#141414",
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  statusItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDishName: {
    color: "#9CA3AF",
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
  statusTimer: {
    color: "#F5F5F5",
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  statusTimerExpired: {
    color: "#EF4444",
  },
  statusDash: {
    color: "#4B5563",
    fontSize: 12,
  },

  // --- Warning banner ---
  warningBanner: {
    backgroundColor: "#422006",
    borderRadius: 10,
    padding: 10,
  },
  warningText: {
    color: "#FBBF24",
    fontSize: 12,
    fontWeight: "500",
  },

  // --- Timeline layout ---
  timeline: {
    gap: 0,
  },
  timelineItem: {
    position: "relative",
    paddingLeft: 0,
    marginBottom: 8,
  },
  timelineConnector: {
    position: "absolute",
    left: 8,
    top: 0,
    bottom: -8,
    width: 2,
    backgroundColor: "#1F1F1F",
    zIndex: -1,
  },
  timelineConnectorDone: {
    backgroundColor: "#22C55E40",
  },
  timelineDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#4B5563",
    backgroundColor: "#0F0F0F",
    position: "absolute",
    left: 0,
    top: 8,
    zIndex: 1,
  },
  timelineDotDone: {
    backgroundColor: "#22C55E",
    borderColor: "#22C55E",
  },

  // --- Step card ---
  stepCard: {
    backgroundColor: "#1A1A1A",
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: "#2E2E2E",
  },
  stepCardCurrent: {
    backgroundColor: "#242424",
    borderLeftWidth: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  stepCardPending: {
    opacity: 0.6,
  },
  stepCardCompleted: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    paddingLeft: 28,
    gap: 8,
  },
  stepContentCompleted: {
    flex: 1,
  },

  // --- Step content ---
  stepHeader: {
    gap: 4,
  },
  stepTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  stepEmoji: {
    fontSize: 20,
    marginTop: 0,
  },
  stepAction: {
    color: "#9CA3AF",
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 22,
    flex: 1,
    letterSpacing: 0.2,
  },
  stepActionCurrent: {
    color: "#F5F5F5",
    fontWeight: "600",
  },
  stepMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
    paddingLeft: 28,
  },
  stepMetaLabel: {
    color: "#4B5563",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  stepTimeLabel: {
    color: "#4B5563",
    fontSize: 11,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },

  // --- Completed step text ---
  completedStepText: {
    color: "#4B5563",
    fontSize: 14,
    textDecorationLine: "line-through",
  },
  completedMeta: {
    color: "#374151",
    fontSize: 11,
    marginTop: 2,
  },

  // --- Detail ---
  detailPressable: {
    paddingLeft: 28,
  },
  detailToggle: {
    color: "#F59E0B",
    fontSize: 12,
    fontWeight: "600",
  },
  detailText: {
    color: "#9CA3AF",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },

  // --- Checkpoint ---
  checkpoint: {
    backgroundColor: "#1A1200",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#F59E0B30",
    padding: 10,
    marginLeft: 28,
  },
  checkpointText: {
    color: "#FBBF24",
    fontSize: 12,
    fontWeight: "600",
  },

  // --- Timer ---
  timerButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  timerButtonText: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  timerDisplay: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#141414",
    borderRadius: 12,
    padding: 12,
  },
  timerDisplayExpired: {
    backgroundColor: "#1A0A0A",
    borderWidth: 1,
    borderColor: "#EF444440",
  },
  timerDisplayPaused: {
    backgroundColor: "#141418",
    borderWidth: 1,
    borderColor: "#4B5563",
  },
  timerCountdownRow: {
    flex: 1,
  },
  timerCountdown: {
    fontSize: 32,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  timerExpiredText: {
    color: "#EF4444",
    fontSize: 14,
    fontWeight: "600",
  },
  timerActions: {
    flexDirection: "row",
    gap: 8,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A1A",
  },
  iconButtonText: {
    fontSize: 18,
    fontWeight: "700",
  },

  // --- Complete button ---
  completeButton: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#1A1A1A",
  },
  completeButtonText: {
    color: "#4B5563",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },

  // --- While waiting ---
  whileWaiting: {
    backgroundColor: "#0F1A2E",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E3A5F40",
    padding: 12,
    gap: 6,
  },
  whileWaitingLabel: {
    color: "#4B5563",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    textAlign: "center",
  },
  whileWaitingStep: {
    color: "#9CA3AF",
    fontSize: 13,
    paddingLeft: 8,
  },

  // --- Plating separator ---
  platingSeparator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  platingSeparatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#2E2E2E",
  },
  platingSeparatorText: {
    color: "#4B5563",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
});
