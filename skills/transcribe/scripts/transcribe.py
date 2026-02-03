#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""
Transcribe audio files to text using whisper.cpp
"""

import subprocess
import sys
import os
from pathlib import Path

WHISPER_CLI = "/opt/homebrew/bin/whisper-cli"
WHISPER_MODEL = Path.home() / ".local/share/whisper/ggml-base.en.bin"
OUTPUT_FILE = "/tmp/transcription.txt"


def transcribe_audio(audio_path: str) -> str:
    """Transcribe audio file to text."""
    audio_path = Path(audio_path).expanduser()

    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    if not WHISPER_MODEL.exists():
        raise FileNotFoundError(
            f"Whisper model not found at {WHISPER_MODEL}\n"
            "Download with:\n"
            "  mkdir -p ~/.local/share/whisper\n"
            "  curl -L -o ~/.local/share/whisper/ggml-base.en.bin \\\n"
            "    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
        )

    # Convert to WAV if not already
    wav_path = "/tmp/audio_for_whisper.wav"

    print(f"Converting {audio_path.name} to WAV...", file=sys.stderr)
    ffmpeg_result = subprocess.run(
        [
            "ffmpeg",
            "-i", str(audio_path),
            "-ar", "16000",  # 16kHz sample rate
            "-ac", "1",      # Mono
            "-c:a", "pcm_s16le",  # 16-bit PCM
            "-y",  # Overwrite output
            wav_path
        ],
        capture_output=True,
        text=True
    )

    if ffmpeg_result.returncode != 0:
        raise RuntimeError(f"ffmpeg conversion failed:\n{ffmpeg_result.stderr}")

    # Run whisper transcription
    print(f"Transcribing with whisper.cpp...", file=sys.stderr)
    whisper_result = subprocess.run(
        [
            WHISPER_CLI,
            "-m", str(WHISPER_MODEL),
            "-f", wav_path,
            "-otxt",  # Output format: text
            "-of", "/tmp/transcription",  # Output file prefix
            "--no-prints"  # Suppress verbose output
        ],
        capture_output=True,
        text=True
    )

    if whisper_result.returncode != 0:
        raise RuntimeError(f"Whisper transcription failed:\n{whisper_result.stderr}")

    # Read transcription result
    if not Path(OUTPUT_FILE).exists():
        raise RuntimeError("Transcription output file not created")

    with open(OUTPUT_FILE, 'r') as f:
        transcription = f.read().strip()

    # Cleanup temp WAV
    Path(wav_path).unlink(missing_ok=True)

    return transcription


def main():
    if len(sys.argv) < 2:
        print("Usage: transcribe.py <audio_file>", file=sys.stderr)
        print("\nSupported formats: AAC, MP3, M4A, WAV, etc.", file=sys.stderr)
        sys.exit(1)

    audio_file = sys.argv[1]

    try:
        transcription = transcribe_audio(audio_file)
        print(transcription)
        print(f"\n[Transcription saved to {OUTPUT_FILE}]", file=sys.stderr)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
