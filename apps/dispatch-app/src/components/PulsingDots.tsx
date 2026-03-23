import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useReduceMotion } from "../utils/animation";

interface PulsingDotsProps {
  /** Dot color (default: #a1a1aa) */
  color?: string;
  /** Dot size in px (default: 6) */
  size?: number;
  /** Gap between dots in px (default: 4) */
  gap?: number;
}

/**
 * Three pulsing dots with staggered opacity animation.
 * Used for thinking indicators, typing indicators, and generating states.
 * Renders static dots when user prefers reduced motion.
 */
export function PulsingDots({ color = "#a1a1aa", size = 6, gap = 4 }: PulsingDotsProps) {
  const reduceMotion = useReduceMotion();
  const dot1 = useRef(new Animated.Value(reduceMotion ? 0.7 : 0.3)).current;
  const dot2 = useRef(new Animated.Value(reduceMotion ? 0.7 : 0.3)).current;
  const dot3 = useRef(new Animated.Value(reduceMotion ? 0.7 : 0.3)).current;

  useEffect(() => {
    if (reduceMotion) {
      // Static dots at medium opacity when reduce-motion is on
      dot1.setValue(0.7);
      dot2.setValue(0.7);
      dot3.setValue(0.7);
      return;
    }

    const createPulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ]),
      );

    const a1 = createPulse(dot1, 0);
    const a2 = createPulse(dot2, 200);
    const a3 = createPulse(dot3, 400);
    a1.start();
    a2.start();
    a3.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3, reduceMotion]);

  const dotStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
  };

  return (
    <View style={[styles.row, { gap }]}>
      <Animated.View style={[dotStyle, { opacity: dot1 }]} />
      <Animated.View style={[dotStyle, { opacity: dot2 }]} />
      <Animated.View style={[dotStyle, { opacity: dot3 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
});
