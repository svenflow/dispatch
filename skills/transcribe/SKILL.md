---
name: transcribe
description: Transcribe audio files (voice memos, recordings) to text using whisper.cpp. Use when asked to transcribe audio, convert voice to text, or process voice memos.
allowed-tools: Bash(whisper-cli:*), Bash(ffmpeg:*)
---

# Audio Transcription

Convert audio files to text using OpenAI's Whisper model (running locally via whisper.cpp).

## Quick Start

```bash
# Transcribe an audio file
uv run ~/.claude/skills/transcribe/scripts/transcribe.py /path/to/audio.{aac,mp3,m4a,wav}

# Output will be saved to /tmp/transcription.txt
cat /tmp/transcription.txt
```

## How It Works

1. Converts audio to 16kHz mono WAV using ffmpeg
2. Runs whisper.cpp (base.en model) for transcription
3. Returns transcribed text

## Supported Formats

- AAC (voice memos from Signal/iMessage)
- MP3
- M4A
- WAV
- Any format ffmpeg can decode

## Models

Currently using `ggml-base.en.bin` (English-only, ~141MB):
- Fast transcription (~37 seconds of audio in <5 seconds)
- Good accuracy for clear speech
- Runs on Apple Metal GPU

Model location: `~/.local/share/whisper/ggml-base.en.bin`

## Installation

Already installed! whisper.cpp is available at `/opt/homebrew/bin/whisper-cli`.

If you need to reinstall:
```bash
brew install whisper-cpp
mkdir -p ~/.local/share/whisper
curl -L -o ~/.local/share/whisper/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

## Other Models

Available models (download from https://huggingface.co/ggerganov/whisper.cpp/tree/main):

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny.en | 39MB | Fastest | Low |
| base.en | 141MB | Fast | Good (current) |
| small.en | 466MB | Medium | Better |
| medium.en | 1.5GB | Slow | Best |

## Usage in Conversations

When someone sends a voice memo via Signal/iMessage:
1. Audio attachments are saved to `~/.local/share/signal-cli/attachments/`
2. Use this skill to transcribe them
3. Send the transcription back

Example workflow:
```bash
# Find recent audio attachment
ls -t ~/.local/share/signal-cli/attachments/*.aac | head -1

# Transcribe it
uv run ~/.claude/skills/transcribe/scripts/transcribe.py $(ls -t ~/.local/share/signal-cli/attachments/*.aac | head -1)

# Read result
cat /tmp/transcription.txt
```
