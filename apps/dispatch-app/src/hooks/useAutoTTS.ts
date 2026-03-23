import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioPlayer } from "./useAudioPlayer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoTTSReturn {
  play: (messageId: string, opts?: { allowsRecording?: boolean }) => Promise<void>;
  interrupt: () => void;
  isPlaying: boolean;
  error: string | null;
}

export interface AutoTTSOptions {
  /** Called when TTS playback finishes naturally (not interrupted). */
  onComplete?: () => void;
  /** Called when TTS playback errors. */
  onError?: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAutoTTS(options: AutoTTSOptions = {}): AutoTTSReturn {
  const audio = useAudioPlayer();
  const onCompleteRef = useRef(options.onComplete);
  const onErrorRef = useRef(options.onError);
  const playingIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep refs in sync
  onCompleteRef.current = options.onComplete;
  onErrorRef.current = options.onError;

  // Track whether audio.play() has been called and the player has acknowledged it
  const playbackStartedRef = useRef(false);

  // Detect playback completion — only after playback has actually started
  useEffect(() => {
    if (!playingIdRef.current) return;

    // Wait until the audio player acknowledges playback before watching for completion
    if (audio.isPlaying || audio.isPaused) {
      playbackStartedRef.current = true;
    }

    if (!playbackStartedRef.current) return;

    // audio.currentMessageId goes null when playback completes
    if (audio.currentMessageId === null && !audio.isPlaying && !audio.isPaused) {
      playingIdRef.current = null;
      playbackStartedRef.current = false;
      onCompleteRef.current?.();
    }
  }, [audio.currentMessageId, audio.isPlaying, audio.isPaused]);

  const play = useCallback(async (messageId: string, opts?: { allowsRecording?: boolean }) => {
    playingIdRef.current = messageId;
    playbackStartedRef.current = false;
    setError(null);
    try {
      await audio.play(messageId, `/audio/${messageId}`, opts);
    } catch (err) {
      const msg = (err as Error).message || "TTS playback failed";
      console.warn("[AutoTTS] Playback error:", msg);
      setError(msg);
      playingIdRef.current = null;
      playbackStartedRef.current = false;
      onErrorRef.current?.(msg);
    }
  }, [audio]);

  const interrupt = useCallback(() => {
    if (playingIdRef.current) {
      playingIdRef.current = null;
      audio.stop();
    }
  }, [audio]);

  return {
    play,
    interrupt,
    isPlaying: audio.isPlaying,
    error,
  };
}
