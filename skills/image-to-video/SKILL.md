---
name: image-to-video
description: Generate videos from images using fal.ai APIs. Supports Kling 2.6 Pro (cheap iteration) and Veo 3.1 (high quality). Trigger words - image to video, animate image, video generation, kling, veo.
---

# Image to Video Skill

Generate videos (MP4) from a single image using fal.ai cloud APIs.

## Requirements

- fal.ai API key stored in keychain as `fal-api-key`
- Also available in `~/.claude/secrets.env` as `FAL_KEY`

## Available Models

| Model | CLI ID | Best For | Speed | Cost |
|-------|--------|----------|-------|------|
| **Kling 2.6 Pro** | `kling` | Professional quality, native audio | ~60s | $0.07-0.14/sec |
| **Kling 2.1 Standard** | `kling-standard` | Good quality, faster | ~45s | ~$0.05/sec |
| **Kling 3.0 Standard** | `kling3` | Latest Kling, improved motion | ~60s | ~$0.08/sec |
| **Veo 3.1** | `veo3.1` | Google's best, frame interpolation | ~120s | ~$3.50 for 5s |
| **Veo 3.1 Fast** | `veo3.1-fast` | Faster Veo 3.1 | ~60s | ~$2.00 for 5s |
| **MiniMax Video-01** | `minimax` | Good quality Chinese model | ~60s | ~$0.10/sec |

## CLI Usage

```bash
# Generate with Kling 2.6 Pro (RECOMMENDED for most cases)
~/.claude/skills/image-to-video/scripts/generate /path/to/image.jpg "Ferrofluid spikes pulsing and flowing"

# Specify model
~/.claude/skills/image-to-video/scripts/generate -m veo3.1 /path/to/image.jpg "Metallic liquid undulating slowly"

# Custom output path
~/.claude/skills/image-to-video/scripts/generate -m kling -o /tmp/output.mp4 /path/to/image.jpg "Abstract motion"

# Kling with longer duration (5s or 10s)
~/.claude/skills/image-to-video/scripts/generate -d 10 /path/to/image.jpg "Motion prompt"

# List available models
~/.claude/skills/image-to-video/scripts/generate --list-models
```

## Model Recommendations

**Default to Kling** - it's much cheaper and quality is comparable for most use cases.

| Use Case | Recommended Model |
|----------|-------------------|
| **Default / most cases** | Kling 2.6 Pro |
| **Budget-friendly iteration** | Kling 2.1 Standard |
| **Highest quality (expensive)** | Veo 3.1 (~10x cost of Kling) |

## Tested Results (2026-03-01)

### Ferrofluid Animation Test
Source: Sharp metallic ferrofluid spikes with reflections

**Kling 2.6 Pro** (~$0.35-0.70 for 5s):
- Good motion, handles reflective surfaces well
- Fast generation (~60s)
- Recommended for iteration

**Veo 3.1** (~$3.50 for 5s):
- Much better at following motion prompts (slow pulsation, etc.)
- Frame interpolation = smoother transitions
- 10x more expensive - use for final renders

## Prompt Tips

For ferrofluid/metallic surfaces:
- "Ferrofluid spikes pulsing rhythmically with a magnetic field"
- "Metallic liquid slowly undulating, light reflecting off sharp peaks"
- "Silver spikes flowing and reshaping organically"

For abstract/artistic:
- "Slow hypnotic motion, maintaining sharp metallic reflections"
- "Breathing motion, spikes expanding and contracting"

## Output

All models output MP4 format. Videos are saved to `/tmp/` by default.

## API Costs (as of 2026-03)

- Kling Standard: ~$0.05/second
- Kling 2.6 Pro: $0.07-0.14/second
- Kling 3.0: ~$0.08/second
- Veo 3.1: ~$3.50 for 5s
- Veo 3.1 Fast: ~$2.00 for 5s

Monitor usage at: https://fal.ai/dashboard/usage-billing/credits
