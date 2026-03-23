import { AccessibilityInfo, LayoutAnimation, Platform, UIManager } from "react-native";
import { useEffect, useState } from "react";

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ---------------------------------------------------------------------------
// Reduce motion support
// ---------------------------------------------------------------------------

/** Module-level cache for reduce motion preference */
let _reduceMotion = false;

// Initialize and listen for changes
AccessibilityInfo.isReduceMotionEnabled().then((v) => {
  _reduceMotion = v;
});
AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
  _reduceMotion = v;
});

/** Returns true if the user prefers reduced motion */
export function isReduceMotionEnabled(): boolean {
  return _reduceMotion;
}

/** React hook that tracks reduce-motion preference reactively */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(_reduceMotion);
  useEffect(() => {
    // Sync in case module-level value updated before mount
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/** Create a consistent LayoutAnimation config with the given duration */
export function makeLayoutAnim(duration: number) {
  return {
    duration,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    update: {
      type: LayoutAnimation.Types.easeInEaseOut,
    },
    delete: {
      type: LayoutAnimation.Types.easeOut,
      property: LayoutAnimation.Properties.opacity,
    },
  };
}

/** Safely call LayoutAnimation.configureNext — catches errors on Android
 *  where the experimental API can throw during concurrent animations.
 *  Skipped entirely when user has reduce-motion enabled. */
export function safeConfigureNext(config: ReturnType<typeof makeLayoutAnim>) {
  if (_reduceMotion) return;
  try {
    LayoutAnimation.configureNext(config);
  } catch {
    // Android experimental LayoutAnimation can throw during concurrent animations — swallow
  }
}

// ---------------------------------------------------------------------------
// Exponential backoff utility
// ---------------------------------------------------------------------------

/** Compute poll delay with exponential backoff: base × 2^failCount, capped at maxDelay */
export function backoffDelay(base: number, failCount: number, maxDelay = 30_000): number {
  if (failCount === 0) return base;
  return Math.min(base * 2 ** failCount, maxDelay);
}
