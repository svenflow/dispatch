import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAudioPlayer as useExpoPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
} from "expo-audio";
import { downloadAudio } from "../api/audio";

export interface AudioPlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  currentMessageId: string | null;
  play: (messageId: string, audioUrl: string, opts?: { allowsRecording?: boolean }) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

export function useAudioPlayer(): AudioPlayerState {
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);
  const audioConfiguredRef = useRef(false);

  const player = useExpoPlayer(null);
  const status = useAudioPlayerStatus(player);

  // Derive playing/paused from the expo-audio status
  const isPlaying = currentMessageId !== null && status.playing;
  const isPaused =
    currentMessageId !== null && !status.playing && status.currentTime > 0;

  // Detect playback completion: was playing, now not playing, and we've
  // reached the end of the track
  useEffect(() => {
    if (currentMessageIdRef.current === null) return;
    if (
      !status.playing &&
      status.duration > 0 &&
      status.currentTime >= status.duration - 0.15
    ) {
      // Playback completed
      setCurrentMessageId(null);
      currentMessageIdRef.current = null;
    }
  }, [status.playing, status.currentTime, status.duration]);

  const configureAudioSession = useCallback(async (opts?: { allowsRecording?: boolean }) => {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        // When allowsRecording is true, iOS uses .playAndRecord category,
        // which allows STT (microphone) to run simultaneously with audio playback.
        // This enables voice-interrupt during TTS.
        allowsRecording: opts?.allowsRecording ?? false,
      });
      audioConfiguredRef.current = true;
    } catch {
      // Ignore audio session config errors
    }
  }, []);

  const resetState = useCallback(() => {
    setCurrentMessageId(null);
    currentMessageIdRef.current = null;
  }, []);

  const stop = useCallback(() => {
    try {
      player.pause();
      player.replace(null);
    } catch {
      // Ignore errors when stopping
    }
    resetState();
  }, [player, resetState]);

  const play = useCallback(
    async (messageId: string, audioUrl: string, opts?: { allowsRecording?: boolean }) => {
      // Stop any currently playing audio
      if (currentMessageIdRef.current) {
        try {
          player.pause();
        } catch {
          // Ignore
        }
      }

      await configureAudioSession(opts);

      try {
        const localUri = await downloadAudio(audioUrl);

        currentMessageIdRef.current = messageId;
        setCurrentMessageId(messageId);

        player.replace({ uri: localUri });
        player.play();
      } catch (err) {
        resetState();
        throw err; // Re-throw so callers (useAutoTTS) can detect failure
      }
    },
    [player, configureAudioSession, resetState],
  );

  const pause = useCallback(() => {
    try {
      player.pause();
    } catch {
      // Ignore
    }
  }, [player]);

  const resume = useCallback(() => {
    try {
      player.play();
    } catch {
      // Ignore
    }
  }, [player]);

  return {
    isPlaying,
    isPaused,
    currentMessageId,
    play,
    pause,
    resume,
    stop,
  };
}
