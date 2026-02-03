---
name: tts
description: Convert text, articles, or PDFs to audio using Google Cloud Text-to-Speech. Use when asked to read content aloud, create audiobooks, or convert text to speech.
---

# Text-to-Speech

Convert text content to high-quality audio files using Google Cloud TTS.

## Quick Start

```bash
# Convert text to audio
uv run ~/.claude/skills/tts/scripts/tts.py "Hello, this is a test" -o /tmp/output.mp3

# Convert a text file
uv run ~/.claude/skills/tts/scripts/tts.py --file /path/to/article.txt -o /tmp/article.mp3

# Convert with different voice
uv run ~/.claude/skills/tts/scripts/tts.py "Hello" -o /tmp/output.mp3 --voice en-US-Neural2-D
```

## Voices

Popular voices (all Neural2 high-quality):
- `en-US-Neural2-D` - Male, US English (default)
- `en-US-Neural2-F` - Female, US English
- `en-US-Neural2-J` - Male, US English (deeper)
- `en-GB-Neural2-B` - Male, British
- `en-GB-Neural2-C` - Female, British

## Long-Form Audio

For articles/PDFs (handles chunking automatically):
```bash
# Extract text from PDF using pypdf
uv run --with pypdf python -c "
from pypdf import PdfReader
reader = PdfReader('/path/to/doc.pdf')
text = '\n'.join(page.extract_text() for page in reader.pages)
print(text)
" > /tmp/extracted.txt

# Then convert to audio
uv run ~/.claude/skills/tts/scripts/tts.py --file /tmp/extracted.txt -o /tmp/audiobook.mp3
```

## Send to Phone

After generating audio, send via iMessage:
```bash
~/code/sms-cli/send-sms "+phone" --image /tmp/output.mp3
```

## API Key

Uses Google Cloud TTS API with key stored in `~/.claude/skills/tts/.env`
