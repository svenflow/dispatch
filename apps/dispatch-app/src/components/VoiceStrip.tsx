import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { branding } from "../config/branding";
import type { ConversationVoiceState } from "../hooks/useVoiceConversation";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VoiceStripProps {
  voiceState: ConversationVoiceState;
  sttPartial: string;
  errorMessage: string | null;
  onSpeak: () => void;
  onSend: () => void;
  onStop: () => void;
  onInterrupt: () => void;
  onRetry: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const NUM_BARS = 5;

export function VoiceStrip({
  voiceState,
  sttPartial,
  errorMessage,
  onSpeak,
  onSend,
  onStop,
  onInterrupt,
  onRetry,
}: VoiceStripProps) {
  // Respect reduced motion
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  // Waveform bar animations — active during LISTENING
  const barAnims = useRef(
    Array.from({ length: NUM_BARS }, () => new Animated.Value(0.3)),
  ).current;

  useEffect(() => {
    if (reduceMotion || voiceState !== "LISTENING") {
      barAnims.forEach((b) => b.setValue(0.3));
      return;
    }
    const loops: Animated.CompositeAnimation[] = [];
    barAnims.forEach((anim, i) => {
      const duration = 400 + i * 120;
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 0.6 + Math.random() * 0.4,
            duration,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.15 + Math.random() * 0.2,
            duration,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      loops.push(loop);
    });
    return () => loops.forEach((l) => l.stop());
  }, [voiceState, barAnims, reduceMotion]);

  // -- Render --

  return (
    <View style={styles.container} accessibilityRole="toolbar" accessibilityLabel="Voice mode">
      {/* Exit button — always visible */}
      <Pressable
        onPress={onStop}
        style={({ pressed }) => [styles.exitButton, pressed && styles.pressed]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Exit voice mode"
        accessibilityHint="Returns to text input"
      >
        <SymbolView name={"xmark" as any} tintColor="#a1a1aa" size={14} weight="bold" />
      </Pressable>

      {/* IDLE — tap to speak */}
      {voiceState === "IDLE" && (
        <Pressable
          onPress={onSpeak}
          style={({ pressed }) => [styles.centerArea, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Tap to speak"
          accessibilityHint="Starts listening for speech"
        >
          <SymbolView name={"mic.fill" as any} tintColor="#71717a" size={18} />
          <Text style={styles.idleText}>Tap to speak</Text>
        </Pressable>
      )}

      {/* ERROR — tap to retry */}
      {voiceState === "ERROR" && (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.centerArea, pressed && styles.pressed]}
          accessibilityRole="alert"
          accessibilityLabel={errorMessage || "Error occurred"}
          accessibilityHint="Tap to retry"
        >
          <SymbolView name={"exclamationmark.triangle" as any} tintColor="#fbbf24" size={16} />
          <Text style={styles.errorText} numberOfLines={1}>{errorMessage}</Text>
        </Pressable>
      )}

      {/* LISTENING — waveform + partial text + send button */}
      {voiceState === "LISTENING" && (
        <View style={styles.listeningRow}>
          <View style={styles.waveformAndText}>
            <View style={styles.waveform} accessibilityElementsHidden>
              {barAnims.map((anim, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.waveformBar,
                    { transform: [{ scaleY: anim }] },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.listeningHint} accessibilityRole="text">
              {sttPartial ? "Listening..." : "Listening..."}
            </Text>
          </View>
          <Pressable
            onPress={onSend}
            style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Send now"
            accessibilityHint="Sends your speech immediately"
          >
            <SymbolView name={"arrow.up" as any} tintColor="#ffffff" size={16} weight="bold" />
          </Pressable>
        </View>
      )}

      {/* SPEAKING — speaker icon + tap to interrupt */}
      {voiceState === "SPEAKING" && (
        <Pressable
          onPress={onInterrupt}
          style={({ pressed }) => [styles.speakingRow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Playing response"
          accessibilityHint="Tap to interrupt and speak"
        >
          <View style={styles.speakerIconContainer}>
            <SymbolView name={"speaker.wave.2.fill" as any} tintColor={branding.accentColor} size={18} />
          </View>
          <Text style={styles.speakingText}>Playing response...</Text>
          <Text style={styles.interruptHint}>Speak or tap to interrupt</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#27272a",
    borderRadius: 20,
    minHeight: 40,
    paddingHorizontal: 4,
  },
  exitButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#3f3f46",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  centerArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  idleText: {
    color: "#71717a",
    fontSize: 15,
    fontWeight: "500",
  },
  errorText: {
    color: "#fbbf24",
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  listeningRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  waveformAndText: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  waveform: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 20,
  },
  waveformBar: {
    width: 3,
    height: 20,
    borderRadius: 1.5,
    backgroundColor: "#22c55e",
  },
  partialText: {
    color: "#a1a1aa",
    fontSize: 15,
    flex: 1,
    fontStyle: "italic",
  },
  listeningHint: {
    color: "#52525b",
    fontSize: 15,
    fontStyle: "italic",
  },
  sendButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: branding.accentColor,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
    marginRight: 2,
  },
  speakingRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 8,
  },
  speakerIconContainer: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  speakingText: {
    color: branding.accentColor,
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
  interruptHint: {
    color: "#52525b",
    fontSize: 12,
    fontWeight: "500",
  },
  pressed: {
    opacity: 0.7,
  },
});
