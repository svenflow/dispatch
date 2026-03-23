import { useCallback, useRef, useState } from "react";
import { getApiBaseUrl } from "../config/constants";
import { getDeviceToken } from "../api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SSEThinking { type: "thinking" }
interface SSEAgentText { type: "agent_text"; text: string; message_id: string }
interface SSEAudioReady { type: "audio_ready"; audio_url: string }
interface SSEError { type: "error"; message: string }
interface SSETimeout { type: "timeout"; message: string }
type SSEEvent = SSEThinking | SSEAgentText | SSEAudioReady | SSEError | SSETimeout;

export interface SSEVoiceReturn {
  send: (chatId: string, text: string) => void;
  abort: () => void;
  streamingText: string;
  audioUrl: string | null;
  messageId: string | null;
  isStreaming: boolean;
  isComplete: boolean;
  error: string | null;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a single SSE line into an event object, or null if unparseable. */
function parseSSELine(line: string): SSEEvent | null {
  if (!line.startsWith("data: ")) return null;
  const jsonStr = line.slice(6).trim();
  if (!jsonStr || jsonStr === "[DONE]") return null;
  try {
    return JSON.parse(jsonStr) as SSEEvent;
  } catch (err) {
    console.warn("[SSEVoice] Malformed SSE JSON:", jsonStr, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const SSE_TIMEOUT_MS = 60_000;

export function useSSEVoice(): SSEVoiceReturn {
  const [streamingText, setStreamingText] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setStreamingText("");
    setAudioUrl(null);
    setMessageId(null);
    setIsStreaming(false);
    setIsComplete(false);
    setError(null);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const send = useCallback((chatId: string, text: string) => {
    const token = getDeviceToken();
    if (!token) {
      setError("No device token. Check settings.");
      return;
    }

    // Reset state for new request
    setStreamingText("");
    setAudioUrl(null);
    setMessageId(null);
    setIsStreaming(true);
    setIsComplete(false);
    setError(null);

    // Abort any previous request
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    // Timeout
    timeoutRef.current = setTimeout(() => abortController.abort(), SSE_TIMEOUT_MS);

    (async () => {
      try {
        const url = `${getApiBaseUrl()}/voice/respond`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, transcript: text, token }),
          signal: abortController.signal,
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const event = parseSSELine(line);
            if (!event) continue;

            switch (event.type) {
              case "thinking":
                break;
              case "agent_text":
                setStreamingText(event.text);
                setMessageId(event.message_id);
                break;
              case "audio_ready":
                setAudioUrl(event.audio_url);
                setIsComplete(true);
                setIsStreaming(false);
                break;
              case "error":
              case "timeout":
                setError(event.message);
                setIsStreaming(false);
                return;
            }
          }
        }

        // Stream ended — mark complete even if no audio_ready
        if (!abortController.signal.aborted) {
          setIsComplete(true);
          setIsStreaming(false);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setError("Request timed out. Try again.");
        } else {
          setError((err as Error).message || "Connection failed.");
        }
        setIsStreaming(false);
      } finally {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      }
    })();
  }, []);

  return { send, abort, streamingText, audioUrl, messageId, isStreaming, isComplete, error, reset };
}
