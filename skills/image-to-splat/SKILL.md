---
name: image-to-splat
description: Generate 3D Gaussian splats from images using Apple's ml-sharp. Trigger words - splat, gaussian, 3d from image, ply, ml-sharp.
---

# Image to Gaussian Splat

Generate 3D Gaussian splat PLY files from single images using Apple's [ml-sharp](https://github.com/apple/ml-sharp).

## Quick Start

```bash
# Generate PLY from image
~/.claude/skills/image-to-splat/scripts/image-to-splat ~/path/to/image.png

# Output goes to same directory as input: ~/path/to/image.ply
```

## CLI Options

```bash
image-to-splat <image> [output_dir]

# Examples:
image-to-splat photo.jpg                    # Output: ./photo.ply
image-to-splat photo.jpg ~/splats/          # Output: ~/splats/photo.ply
```

## Requirements

- Python 3.13+ (uses uv)
- ~2.7GB model download on first run (cached at `~/.cache/torch/hub/checkpoints/`)
- Works on CPU, MPS (Apple Silicon), or CUDA

## What it Does

1. Takes a single image (PNG, JPG, etc.)
2. Runs ml-sharp's neural network to predict 3D Gaussian parameters
3. Outputs a PLY file compatible with standard 3DGS viewers

The PLY can be viewed with:
- [SuperSplat](https://playcanvas.com/supersplat/editor) (web-based)
- [splat-viewer](https://splat-viewer-9a7.pages.dev) (our hosted viewer)
- Any 3DGS-compatible renderer

## Technical Notes

- Coordinate convention: OpenCV (x right, y down, z forward)
- Scene center is at approximately (0, 0, +z)
- Output is metric scale (absolute, not relative)
- Inference takes <1 second on GPU

## Troubleshooting

**Model download hangs**: Check network, model is ~2.7GB from Apple CDN

**Out of memory**: Try smaller images or use CPU (`--device cpu`)

**PLY not loading in viewer**: Some viewers expect different coordinate conventions - may need to rotate/scale
