import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";

interface ToastProps {
  message: string;
  icon?: string; // SF Symbol name
  visible: boolean;
  onHide: () => void;
  duration?: number;
}

/**
 * A small toast that appears at the top center, auto-dismisses.
 * Styled to match iOS-style feedback indicators.
 */
export function Toast({ message, icon, visible, onHide, duration = 1500 }: ToastProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(fadeAnim, { toValue: 1, tension: 200, friction: 16, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 200, friction: 16, useNativeDriver: true }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(scaleAnim, { toValue: 0.8, duration: 200, useNativeDriver: true }),
        ]).start(({ finished }) => {
          if (finished) onHide();
        });
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible, fadeAnim, scaleAnim, duration, onHide]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
      ]}
      pointerEvents="none"
    >
      {icon && (
        <SymbolView
          name={{ ios: icon as any, android: icon as any, web: icon as any }}
          tintColor="#fafafa"
          size={16}
          weight="medium"
        />
      )}
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 60,
    alignSelf: "center",
    backgroundColor: "#2c2c2e",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 1000,
  },
  text: {
    color: "#fafafa",
    fontSize: 14,
    fontWeight: "500",
  },
});
