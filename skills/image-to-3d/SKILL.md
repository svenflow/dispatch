---
name: image-to-3d
description: Generate 3D models from images using fal.ai APIs. Supports Hunyuan3D v3, Meshy-6, TripoSR, TRELLIS, Hyper3D Rodin. Trigger words - 3d model, image to 3d, generate 3d, mesh from image.
---

# Image to 3D Skill

Generate 3D models (GLB/OBJ/FBX) from a single image using fal.ai cloud APIs.

## Requirements

- fal.ai API key stored in keychain as `fal-api-key`
- Also available in `~/.claude/secrets.env` as `FAL_KEY`

## Available Models

| Model | CLI ID | Textures | Best For | Speed | Cost |
|-------|--------|----------|----------|-------|------|
| **Hunyuan3D v3** | `hunyuan` | ✅ Yes (PBR) | Faces, people, realistic | ~30s | ~$0.05 |
| **Meshy-6** | `meshy` | ✅ Yes | Cartoonish/stylized | ~60s | ~$0.10 |
| **TripoSR** | `triposr` | ❌ No | Fast previews | ~5s | ~$0.02 |
| **TRELLIS** | `trellis` | ✅ Yes | High detail objects | ~30s | ~$0.02 |
| **Hyper3D Rodin** | `rodin` | ✅ Yes | Production quality | ~90s | ~$0.40 |

## CLI Usage

```bash
# Generate with Hunyuan3D v3 (RECOMMENDED for faces/people)
~/.claude/skills/image-to-3d/scripts/generate --model hunyuan /path/to/image.jpg

# Generate with Meshy-6 (stylized with textures)
~/.claude/skills/image-to-3d/scripts/generate --model meshy /path/to/image.jpg

# Fast preview with TripoSR (no textures)
~/.claude/skills/image-to-3d/scripts/generate --model triposr /path/to/image.jpg

# Generate with Hyper3D Rodin (highest quality)
~/.claude/skills/image-to-3d/scripts/generate --model rodin /path/to/image.jpg

# Specify output path
~/.claude/skills/image-to-3d/scripts/generate -m hunyuan -o /tmp/output.glb /path/to/image.jpg

# List available models
~/.claude/skills/image-to-3d/scripts/generate --list-models
```

## Model Recommendations

| Use Case | Recommended Model |
|----------|-------------------|
| **Faces / people / portraits** | Hunyuan3D v3 |
| Quick preview / prototyping | TripoSR |
| Stylized characters / avatars | Meshy-6 |
| Objects with complex topology | TRELLIS |
| Production quality | Hyper3D Rodin |
| Budget-friendly with textures | TRELLIS / Hunyuan3D v3 |

## Output

All models output GLB format by default. Some models also provide:
- FBX, OBJ, USDZ formats
- Separate texture files (base_color PNG)
- Preview thumbnail

## Rendering Results

Use Blender to render the GLB:

```bash
# Example Blender render (use blender skill)
/Applications/Blender.app/Contents/MacOS/Blender -b -P render_script.py
```

## API Costs (as of 2026-02)

- TripoSR: ~$0.02 per generation
- TRELLIS: ~$0.02 per generation
- Hunyuan3D v3: ~$0.05 per generation
- Meshy-6: ~$0.08-0.12 per generation
- Hyper3D Rodin: ~$0.40 per generation

Monitor usage at: https://fal.ai/dashboard/usage-billing/credits

## Notes

- **Hunyuan3D v3** is the best option for realistic faces/people with full PBR textures
- For faces, avoid TripoSR (geometry only) and Rodin (tends to break on faces)
- TRELLIS handles complex topology well but textures can be inconsistent
- Meshy-6 produces stylized/cartoonish results, good for avatars
