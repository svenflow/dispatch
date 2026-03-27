import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { impactLight } from "../utils/haptics";

export interface BubbleMenuItem {
  label: string;
  icon: string; // SF Symbol name
  onPress: () => void;
  destructive?: boolean;
}

interface BubbleMenuProps {
  items: BubbleMenuItem[];
  /** Y position of the long-pressed bubble (pageY) */
  anchorY: number;
  onClose: () => void;
}

/**
 * Inline context menu that appears near the long-pressed bubble,
 * similar to iMessage's context menu. Dark themed, with icons.
 */
export function BubbleMenu({ items, anchorY, onClose }: BubbleMenuProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const screenHeight = Dimensions.get("window").height;

  // Position menu above or below the anchor based on screen position
  const showAbove = anchorY > screenHeight * 0.5;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(fadeAnim, {
        toValue: 1,
        tension: 300,
        friction: 20,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 300,
        friction: 20,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, scaleAnim]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 0.85, duration: 120, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) onClose();
    });
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={dismiss} />

      {/* Menu */}
      <Animated.View
        style={[
          styles.menu,
          showAbove
            ? { bottom: screenHeight - anchorY + 8 }
            : { top: anchorY + 8 },
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {items.map((item, i) => (
          <Pressable
            key={item.label}
            onPress={() => {
              impactLight();
              dismiss();
              // Small delay so dismiss animation plays
              setTimeout(item.onPress, 150);
            }}
            style={({ pressed }) => [
              styles.menuItem,
              i < items.length - 1 && styles.menuItemBorder,
              pressed && styles.menuItemPressed,
            ]}
          >
            <Text style={[styles.menuLabel, item.destructive && styles.menuLabelDestructive]}>
              {item.label}
            </Text>
            <SymbolView
              name={{ ios: item.icon as any, android: item.icon as any, web: item.icon as any }}
              tintColor={item.destructive ? "#ef4444" : "#fafafa"}
              size={16}
              weight="medium"
            />
          </Pressable>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  menu: {
    position: "absolute",
    right: 16,
    backgroundColor: "#2c2c2e",
    borderRadius: 14,
    minWidth: 200,
    overflow: "hidden",
    // iOS-style shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 20,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3a3a3c",
  },
  menuItemPressed: {
    backgroundColor: "#3a3a3c",
  },
  menuLabel: {
    color: "#fafafa",
    fontSize: 16,
    fontWeight: "400",
  },
  menuLabelDestructive: {
    color: "#ef4444",
  },
});
