---
name: image-to-video
description: Generate videos from images or text using fal.ai APIs. Supports LTX-2 with synchronized audio, Kling (cheap), and Veo (high quality). Trigger words - image to video, text to video, animate image, video generation, kling, veo, ltx, audio.
---

# Image/Text to Video Skill

Generate videos (MP4) from images or text prompts using fal.ai cloud APIs.

**NEW: LTX-2 generates video WITH synchronized audio!** Waves sound like waves, footsteps match motion, etc.

## Requirements

- fal.ai API key stored in keychain as `fal-api-key`
- Also available in `~/.claude/secrets.env` as `FAL_KEY`

## Available Models

### LTX-2 (Video + Audio)

| Model | CLI ID | Best For | Speed | Cost |
|-------|--------|----------|-------|------|
| **LTX-2 19B** | `ltx2` | Text-to-video WITH audio | ~60s | ~$0.04/sec |
| **LTX-2 19B I2V** | `ltx2-i2v` | Image-to-video WITH audio | ~60s | ~$0.04/sec |

**LTX-2 is the only model that generates synchronized audio.** Use for:
- Scenes with sound (waves, fire, rain, crowds)
- Videos where audio adds value
- Text-to-video (no image needed)

### Kling (Image-to-Video, Cheap)

| Model | CLI ID | Best For | Speed | Cost |
|-------|--------|----------|-------|------|
| **Kling 2.6 Pro** | `kling` | Professional quality | ~60s | $0.07-0.14/sec |
| **Kling 2.1 Standard** | `kling-standard` | Good quality, faster | ~45s | ~$0.05/sec |
| **Kling 3.0 Standard** | `kling3` | Latest Kling, improved motion | ~60s | ~$0.08/sec |

### Veo (Image-to-Video, High Quality)

| Model | CLI ID | Best For | Speed | Cost |
|-------|--------|----------|-------|------|
| **Veo 3.1** | `veo3.1` | Google's best, frame interpolation | ~120s | ~$3.50 for 5s |
| **Veo 3.1 Fast** | `veo3.1-fast` | Faster Veo 3.1 | ~60s | ~$2.00 for 5s |

### Other

| Model | CLI ID | Best For | Speed | Cost |
|-------|--------|----------|-------|------|
| **MiniMax Video-01** | `minimax` | Good quality Chinese model | ~60s | ~$0.10/sec |

## CLI Usage

```bash
# TEXT-TO-VIDEO with audio (LTX-2) - no image needed!
~/.claude/skills/image-to-video/scripts/generate -m ltx2 "Waves crashing on rocky shore, seagulls calling"

# IMAGE-TO-VIDEO with audio (LTX-2)
~/.claude/skills/image-to-video/scripts/generate -m ltx2-i2v /path/to/image.jpg "Ocean waves with sound"

# IMAGE-TO-VIDEO with Kling (default, no audio)
~/.claude/skills/image-to-video/scripts/generate /path/to/image.jpg "Ferrofluid spikes pulsing"

# IMAGE-TO-VIDEO with Veo (highest quality, no audio)
~/.claude/skills/image-to-video/scripts/generate -m veo3.1 /path/to/image.jpg "Metallic liquid undulating"

# LTX-2 options
~/.claude/skills/image-to-video/scripts/generate -m ltx2 --no-audio "Silent timelapse"      # Disable audio
~/.claude/skills/image-to-video/scripts/generate -m ltx2 --frames 241 "Longer video"       # ~10s video
~/.claude/skills/image-to-video/scripts/generate -m ltx2 --video-size portrait_9_16 "Vertical video"

# Custom output path
~/.claude/skills/image-to-video/scripts/generate -m kling -o /tmp/output.mp4 /path/to/image.jpg "Motion"

# List all models
~/.claude/skills/image-to-video/scripts/generate --list-models
```

## Model Recommendations

| Use Case | Recommended Model |
|----------|-------------------|
| **Video with sound effects** | `ltx2` (text-to-video) or `ltx2-i2v` (image-to-video) |
| **Quick iteration, no audio** | `kling` |
| **Highest visual quality** | `veo3.1` |
| **Budget-friendly** | `kling-standard` or `ltx2` |

## LTX-2 Audio Tips

LTX-2 auto-enhances prompts to be more cinematic. For best audio:

- **Be specific about sounds**: "waves crashing", "footsteps on gravel", "birds chirping"
- **Mention ambient audio**: "quiet forest with wind rustling leaves"
- **For speech**: "person speaking to camera" (generates realistic lip-sync + voice)

Examples:
- "Fireplace crackling with flames dancing, warm ambient glow"
- "Thunderstorm with rain on windows, lightning flashes"
- "Busy cafe with conversations, clinking dishes, espresso machine"

## Output

All models output MP4 format with:
- Video: H.264 codec
- Audio (LTX-2 only): AAC stereo

Videos are saved to `/tmp/` by default.

## API Costs (as of 2026-03)

- LTX-2: ~$0.04/second (~$0.20 for 5s)
- Kling Standard: ~$0.05/second
- Kling 2.6 Pro: $0.07-0.14/second
- Kling 3.0: ~$0.08/second
- Veo 3.1: ~$3.50 for 5s
- Veo 3.1 Fast: ~$2.00 for 5s

Monitor usage at: https://fal.ai/dashboard/usage-billing/credits
