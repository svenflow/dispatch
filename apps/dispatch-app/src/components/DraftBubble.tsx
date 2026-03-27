import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { branding } from "../config/branding";

interface DraftBubbleProps {
  text: string;
}

export function DraftBubble({ text }: DraftBubbleProps) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.bubble, { opacity: pulseAnim }]}>
        <Text style={styles.text}>{text || "Listening…"}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 3,
  },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    borderWidth: 2,
    borderColor: branding.accentColor,
    borderStyle: "dashed",
    backgroundColor: "transparent",
  },
  text: {
    color: "#ffffff",
    fontSize: 16,
    lineHeight: 21,
  },
});
