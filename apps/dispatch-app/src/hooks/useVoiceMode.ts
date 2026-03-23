import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, Keyboard, LayoutAnimation } from "react-native";
import { useSpeechCapture } from "./useSpeechCapture";
import { impactLight, impactMedium, notificationError } from "../utils/haptics";
import { branding } from "../config/branding";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceState = "IDLE" | "LISTENING" | "SENT";

export interface UseVoiceModeOptions {
  onSend: (text: string) => void;
  minLength?: number;
}

export interface VoiceModeReturn {
  isActive: boolean;
  voiceState: VoiceState;
  sttPartial: string;
  errorMessage: string | null;

  activate: () => Promise<void>;
  deactivate: () => void;
  startListening: () => Promise<void>;
  sendNow: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEFAULT_MIN_LENGTH = 3;
const SENT_FLASH_MS = 400;
const MAX_CONSECUTIVE_ERRORS = 3;

export function useVoiceMode(options: UseVoiceModeOptions): VoiceModeReturn {
  const { onSend, minLength = DEFAULT_MIN_LENGTH } = options;

  // Destructure so stable function refs (start/stop/reset via useCallback([]))
  // don't get invalidated when state values (isListening/transcript/partial/error) change.
  const {
    isListening: sttIsListening,
    transcript: sttTranscript,
    partial: sttPartial,
    error: sttError,
    start: sttStart,
    stop: sttStop,
    reset: sttReset,
  } = useSpeechCapture({ contextualStrings: [branding.displayName] });

  const [isActive, setIsActive] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("IDLE");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isActiveRef = useRef(false);
  const voiceStateRef = useRef<VoiceState>("IDLE");
  const consecutiveErrorRef = useRef(0);
  const sentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActivatingRef = useRef(false);
  /** Guards against double-send if auto-send effect fires twice in the same render cycle. */
  const hasSentRef = useRef(false);

  // Keep latest STT values in refs so callbacks can read without re-creating
  const sttPartialRef = useRef(sttPartial);
  sttPartialRef.current = sttPartial;
  const sttTranscriptRef = useRef(sttTranscript);
  sttTranscriptRef.current = sttTranscript;

  // Keep refs in sync
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);

  // -- Shared helpers --

  /** Reset all state to inactive. Shared by deactivate, forceDeactivate, and activate-failure. */
  const resetToInactive = useCallback(() => {
    if (sentTimerRef.current) {
      clearTimeout(sentTimerRef.current);
      sentTimerRef.current = null;
    }
    sttStop();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsActive(false);
    setVoiceState("IDLE");
    setErrorMessage(null);
    consecutiveErrorRef.current = 0;
    isActivatingRef.current = false;
    hasSentRef.current = false;
  }, [sttStop]);

  /** Process a transcript result: send if long enough, show error if too short. */
  const handleTranscriptResult = useCallback(
    (text: string) => {
      // Prevent double-send if the auto-send effect fires multiple times before re-render
      if (hasSentRef.current) return;

      const trimmed = text.trim();
      if (trimmed.length >= minLength) {
        hasSentRef.current = true;
        onSend(trimmed);
        consecutiveErrorRef.current = 0;
        impactMedium();
        AccessibilityInfo.announceForAccessibility("Message sent");
        setVoiceState("SENT");
        sentTimerRef.current = setTimeout(() => {
          sentTimerRef.current = null;
          if (isActiveRef.current) setVoiceState("IDLE");
        }, SENT_FLASH_MS);
      } else {
        setErrorMessage("Didn't catch that — tap to try again");
        setVoiceState("IDLE");
        consecutiveErrorRef.current++;
        if (consecutiveErrorRef.current >= MAX_CONSECUTIVE_ERRORS) {
          resetToInactive();
          impactLight();
          AccessibilityInfo.announceForAccessibility(
            "Voice mode unavailable — returning to text input",
          );
        }
      }
    },
    [minLength, onSend, resetToInactive],
  );

  // -- Actions --

  const startListening = useCallback(async () => {
    setErrorMessage(null);
    setVoiceState("LISTENING");
    hasSentRef.current = false;
    impactLight();
    try {
      await sttStart();
    } catch (err) {
      console.warn("[VoiceMode] Failed to start STT on retry:", err);
      setErrorMessage("Microphone unavailable — tap to try again");
      setVoiceState("IDLE");
      notificationError();
      AccessibilityInfo.announceForAccessibility("Microphone unavailable — tap to try again");
      consecutiveErrorRef.current++;
      if (consecutiveErrorRef.current >= MAX_CONSECUTIVE_ERRORS) {
        resetToInactive();
        impactLight();
        AccessibilityInfo.announceForAccessibility(
          "Voice mode unavailable — returning to text input",
        );
      }
    }
  }, [sttStart, resetToInactive]);

  const deactivate = useCallback(() => {
    resetToInactive();
    impactLight();
    AccessibilityInfo.announceForAccessibility("Voice mode off");
  }, [resetToInactive]);

  const activate = useCallback(async () => {
    // Guard against double-activation from rapid long-presses
    if (isActivatingRef.current || isActiveRef.current) return;
    isActivatingRef.current = true;

    impactMedium();
    Keyboard.dismiss();

    // Wait for keyboard to dismiss before showing voice strip
    await new Promise<void>((resolve) => {
      const sub = Keyboard.addListener("keyboardDidHide", () => {
        sub.remove();
        resolve();
      });
      // Fallback if keyboard wasn't open (250ms allows keyboard animation to complete)
      setTimeout(() => { sub.remove(); resolve(); }, 250);
    });

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsActive(true);
    setErrorMessage(null);
    consecutiveErrorRef.current = 0;
    AccessibilityInfo.announceForAccessibility("Voice mode activated, listening");

    // Start listening immediately (skip IDLE on first activation)
    setVoiceState("LISTENING");
    hasSentRef.current = false;
    try {
      await sttStart();
    } catch (err) {
      // STT failed to start — revert to text input cleanly
      console.warn("[VoiceMode] Failed to start STT:", err);
      resetToInactive();
      notificationError();
      AccessibilityInfo.announceForAccessibility("Voice mode unavailable");
      return;
    }
    isActivatingRef.current = false;
  }, [sttStart, resetToInactive]);

  const sendNow = useCallback(() => {
    if (voiceStateRef.current !== "LISTENING") return;
    const text = sttPartialRef.current || sttTranscriptRef.current;
    sttStop();
    handleTranscriptResult(text || "");
  }, [sttStop, handleTranscriptResult]);

  // -- Effects --

  // STT error → voice error
  useEffect(() => {
    if (!sttError || !isActiveRef.current) return;
    setErrorMessage(sttError);
    setVoiceState("IDLE");
    notificationError();
    consecutiveErrorRef.current++;
    if (consecutiveErrorRef.current >= MAX_CONSECUTIVE_ERRORS) {
      resetToInactive();
      impactLight();
      AccessibilityInfo.announceForAccessibility(
        "Voice mode unavailable — returning to text input",
      );
    }
  }, [sttError, resetToInactive]);

  // STT completed → auto-send
  useEffect(() => {
    if (voiceStateRef.current !== "LISTENING") return;
    if (!sttIsListening && sttTranscript && isActiveRef.current) {
      const text = sttTranscript;
      sttReset();
      handleTranscriptResult(text);
    }
  }, [sttIsListening, sttTranscript, sttReset, handleTranscriptResult]);

  // AppState: stop STT on background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" && isActiveRef.current && voiceStateRef.current === "LISTENING") {
        sttStop();
        setVoiceState("IDLE");
      }
    });
    return () => sub.remove();
  }, [sttStop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
      sttStop();
    };
  }, [sttStop]);

  return {
    isActive,
    voiceState,
    sttPartial,
    errorMessage,
    activate,
    deactivate,
    startListening,
    sendNow,
  };
}
