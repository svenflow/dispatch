---
name: tts
description: Convert text to audio using local TTS models. Two options - Kokoro (fast, preset voices) or Qwen3-TTS (slower, custom voice design via natural language prompts). Use when asked to read content aloud, create audiobooks, or convert text to speech. Trigger words - tts, text to speech, speak, voice, audio, narrate.
---

# Text-to-Speech (Local)

Two TTS engines available, both run locally on Mac:

| Engine | Speed | Voice Control | RAM | Best For |
|--------|-------|---------------|-----|----------|
| **Kokoro** | ~0.25x RT | 54 preset voices | ~500MB | Fast generation, audiobooks |
| **Qwen3-TTS** | ~1.2x RT | Natural language prompts | ~7GB | Custom voices, expressive speech |

---

## Qwen3-TTS Voice Design (NEW!)

Generate speech with custom voice styles described in natural language. The model understands descriptions like "an excited child" or "a tired professor".

```bash
# Basic usage with voice style
~/.claude/skills/tts/scripts/speak-qwen "Hello world" --style "An excited tech enthusiast"

# Save to file
~/.claude/skills/tts/scripts/speak-qwen "Breaking news" --style "A serious news anchor" -o /tmp/news.wav

# Play immediately
~/.claude/skills/tts/scripts/speak-qwen "Good morning" --style "A warm, friendly barista" --play
```

**Example styles:**
- "An excited child who just ate too much candy"
- "A deep, calm narrator reading a bedtime story"
- "A tired professor explaining quantum physics"
- "A sports commentator during an exciting play"
- "Someone who drank too much coffee"

**Model info:**
- 1.7B params, 4.2GB on disk, ~7GB peak RAM
- ~21 tokens/sec on M4 Pro
- Location: `~/code/qwen3-tts-apple-silicon/`

---

## Kokoro (Fast, Preset Voices)

Convert text to high-quality audio using the Kokoro ONNX model. Faster than Qwen3 but uses preset voices.

## Quick Start

```bash
# Convert text to audio (default voice: bm_lewis - British male)
~/.claude/skills/tts/scripts/speak "Hello, this is a test"

# Use a specific voice
~/.claude/skills/tts/scripts/speak "Hello" -v af_nova

# Save to specific file
~/.claude/skills/tts/scripts/speak "Hello" -o /tmp/output.wav

# Generate and play immediately
~/.claude/skills/tts/scripts/speak "Hello" --play

# List all available voices
~/.claude/skills/tts/scripts/speak --voices
```

## Voices

54 voices available across multiple languages. Default is `bm_lewis` (British male).

**Voice naming convention:**
- First letter: language (a=American, b=British, e=Spanish, f=French, h=Hindi, i=Italian, j=Japanese, p=Portuguese, z=Chinese)
- Second letter: gender (f=female, m=male)

**Popular English voices:**
- `bm_lewis` - British Male (default)
- `bm_george` - British Male
- `bf_emma` - British Female
- `am_adam` - American Male
- `af_nova` - American Female

Run `~/.claude/skills/tts/scripts/speak --voices` to see all available voices.

## Options

```
-v, --voice VOICE   Voice to use (default: bm_lewis)
-o, --output FILE   Output file path (default: temp file)
-s, --speed SPEED   Speech speed multiplier (default: 1.0)
--play              Play audio after generating
--voices            List all available voices
```

## Long-Form Audio

For articles/PDFs, read the text and pass it to speak:

```bash
# From a text file
~/.claude/skills/tts/scripts/speak "$(cat article.txt)" -o /tmp/article.wav

# Extract text from PDF first
uv run --with pypdf python -c "
from pypdf import PdfReader
reader = PdfReader('/path/to/doc.pdf')
print('\n'.join(page.extract_text() for page in reader.pages))
" | xargs -0 ~/.claude/skills/tts/scripts/speak -o /tmp/audiobook.wav
```

## Send to Phone

After generating audio, send via iMessage:
```bash
~/.claude/skills/sms-assistant/scripts/send-sms "+phone" --image /tmp/output.wav
```

**Kokoro Model Info:**
- **Model**: Kokoro v1.0 (310MB ONNX)
- **Voices**: 27MB voice pack
- **Speed**: ~0.25x realtime on M3
- **Location**: `~/.claude/skills/tts/models/`

---

## When to Use Which

- **Need speed?** → Kokoro (4x faster)
- **Need custom voice style?** → Qwen3-TTS
- **Long audiobook?** → Kokoro (less RAM, faster)
- **Expressive/emotional?** → Qwen3-TTS (can describe emotion in style)
