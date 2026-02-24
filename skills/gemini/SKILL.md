---
name: gemini
description: Chat with Google Gemini models via CLI. Use for quick AI queries, model comparisons, or when you need a second opinion. Trigger words - gemini, google ai, ask gemini.
---

# Gemini Skill

Chat with Google's Gemini models from the command line. Supports text and images.

## Quick Commands

```bash
# Simple query (uses gemini-3-pro-preview by default)
~/.claude/skills/gemini/scripts/gemini "your prompt here"

# Image analysis (auto-selects gemini-3-pro-image-preview for vision)
~/.claude/skills/gemini/scripts/gemini -i image.jpg "describe this image"
~/.claude/skills/gemini/scripts/gemini -i img1.jpg -i img2.jpg "compare these"

# Override model if needed (e.g., for cheaper queries)
~/.claude/skills/gemini/scripts/gemini -m gemini-2.5-flash "quick question"

# Show token usage
~/.claude/skills/gemini/scripts/gemini -v "prompt"

# List available models
~/.claude/skills/gemini/scripts/gemini --list-models

# Interactive session
~/.claude/skills/gemini/scripts/gemini -s

# Pipe input
echo "explain this" | ~/.claude/skills/gemini/scripts/gemini
cat file.txt | ~/.claude/skills/gemini/scripts/gemini "summarize this"
```

## All Available Models

### Gemini LLMs (Text + Vision)

| Model | Description |
|-------|-------------|
| `gemini-3-pro-preview` | Latest Pro model **(DEFAULT for text)** |
| `gemini-3-pro-image-preview` | Vision-focused Pro **(DEFAULT when images passed)** |
| `gemini-2.5-flash` | Fast, cheap, everyday use |
| `gemini-2.5-flash-lite` | Even faster/cheaper |
| `gemini-2.5-pro` | Complex reasoning, coding |
| `gemini-3-pro-preview` | Latest Pro model (preview) |
| `gemini-3-flash-preview` | Latest Flash model (preview) |
| `gemini-2.0-flash` | Previous gen, balanced |
| `gemini-2.0-flash-lite` | Previous gen, fast |

### Specialized Models

| Model | Description |
|-------|-------------|
| `gemini-3-pro-image-preview` | Vision-focused Pro model |
| `gemini-2.5-flash-image` | Image understanding |
| `gemini-2.5-computer-use-preview-10-2025` | Computer use/UI automation |
| `deep-research-pro-preview-12-2025` | Deep research mode |
| `gemini-2.5-flash-native-audio-latest` | Native audio processing |
| `gemini-2.5-flash-preview-tts` | Text-to-speech |
| `gemini-2.5-pro-preview-tts` | TTS (Pro quality) |

### Image Generation (Imagen)

| Model | Description |
|-------|-------------|
| `imagen-4.0-generate-001` | Image generation |
| `imagen-4.0-fast-generate-001` | Fast image generation |
| `imagen-4.0-ultra-generate-001` | Highest quality |
| `gemini-2.0-flash-exp-image-generation` | Gemini-based image gen |

### Video Generation (Veo)

| Model | Description |
|-------|-------------|
| `veo-3.1-generate-preview` | Latest video gen |
| `veo-3.1-fast-generate-preview` | Fast video gen |
| `veo-3.0-generate-001` | Previous gen |
| `veo-2.0-generate-001` | Older, stable |

### Open Source (Gemma)

| Model | Description |
|-------|-------------|
| `gemma-3-27b-it` | 27B params, instruction-tuned |
| `gemma-3-12b-it` | 12B params |
| `gemma-3-4b-it` | 4B params |
| `gemma-3-1b-it` | 1B params (tiny) |
| `gemma-3n-e4b-it` | Nano 4B |
| `gemma-3n-e2b-it` | Nano 2B |

### Embeddings & Other

| Model | Description |
|-------|-------------|
| `gemini-embedding-001` | Text embeddings |
| `aqa` | Attributed QA (grounded answers) |
| `gemini-robotics-er-1.5-preview` | Robotics |

## Pricing (per 1M tokens)

| Model | Input | Output |
|-------|-------|--------|
| Gemini 2.5 Flash | $0.075 | $0.30 |
| Gemini 2.5 Pro | $1.25 | $10 |
| Gemini 3 Pro (preview) | $2 | $12 |
| *For comparison:* | | |
| Claude Sonnet | $3 | $15 |
| Claude Opus | $15 | $75 |

Gemini is **5-20x cheaper** than Claude for most use cases.

## When to Use Gemini

- Quick factual queries
- Getting a second opinion on something
- Tasks where cost matters more than nuance
- Bulk processing where Claude would be expensive
- Image understanding/analysis
- Image/video generation

## IMPORTANT: Vision Understanding Tasks

**For image analysis, rating images, or understanding visual content, ALWAYS use a vision-focused model:**

```bash
# CORRECT - use gemini-3-pro-image-preview for vision understanding
~/.claude/skills/gemini/scripts/gemini -m gemini-3-pro-image-preview -i image.jpg "describe this"
~/.claude/skills/gemini/scripts/gemini -m gemini-3-pro-image-preview -i render.png "rate this render 1-10"

# WRONG - default flash model is not optimized for vision
~/.claude/skills/gemini/scripts/gemini -i image.jpg "describe this"  # Don't do this for quality vision tasks
```

The `gemini-3-pro-image-preview` model is specifically tuned for visual understanding and will give much better analysis, ratings, and feedback on images compared to the default text-focused models.

## Configuration

API key is stored in `~/.claude/secrets.env` as `GEMINI_API_KEY`.

## Examples

```bash
# Quick fact check
~/.claude/skills/gemini/scripts/gemini "What year was Python released?"

# Image analysis
~/.claude/skills/gemini/scripts/gemini -i photo.jpg "What's in this image?"

# Code help with Pro model
~/.claude/skills/gemini/scripts/gemini -m gemini-2.5-pro "Write a Python function to merge two sorted lists"

# Use latest preview model
~/.claude/skills/gemini/scripts/gemini -m gemini-3-pro-preview "Explain quantum computing"

# Verbose mode shows token usage
~/.claude/skills/gemini/scripts/gemini -v "Hello world"
```
