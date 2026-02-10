---
name: tts
description: Convert text to audio using local Kokoro TTS model. Use when asked to read content aloud, create audiobooks, or convert text to speech. Runs locally on Mac with Metal acceleration.
---

# Text-to-Speech (Local)

Convert text to high-quality audio using the Kokoro ONNX model. Runs entirely locally on Mac - no API keys needed.

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

## Model Info

- **Model**: Kokoro v1.0 (310MB ONNX)
- **Voices**: 27MB voice pack
- **Speed**: ~0.25x realtime on M3
- **Location**: `~/.claude/skills/tts/models/`
