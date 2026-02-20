# Image-to-3D with Modal: Development Journey

This guide documents how we built the image-to-3D pipeline on Modal, including the challenges encountered and solutions.

## TL;DR

```bash
# Generate a 3D model from any image
uv run modal run ~/.claude/skills/modal/scripts/image_to_3d_app.py \
  --input-path ~/path/to/image.jpg \
  --output-path ~/output.glb
```

## The Journey

### Initial Approaches (Failed)

1. **Local TripoSR** - Hit Python 3.14 compatibility issues (deps need Python 3.9-3.11)
2. **fast3d.io / tripo3d.ai web** - API limitations and account requirements
3. **Hugging Face Spaces** - ZeroGPU quota limits for non-logged-in users, plus broken Gradio client API
4. **Replicate API** - Needed paid account for consistent access

### Modal Solution (Worked!)

Modal provided free GPU credits with a simple deployment model.

## Building the Modal App

### Challenge 1: torchmcubes Compilation

TripoSR depends on `torchmcubes` for marching cubes mesh extraction. This needs CUDA during compilation.

**Fix**: Use NVIDIA CUDA base image instead of `debian_slim`:

```python
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-devel-ubuntu22.04",
        add_python="3.10",
    )
    .apt_install("git", "libgl1-mesa-glx", "libglib2.0-0",
                 "build-essential", "g++", "cmake", "ninja-build")
    .env({"CXX": "/usr/bin/g++", "CC": "/usr/bin/gcc"})
    .pip_install("git+https://github.com/tatsy/torchmcubes.git")
)
```

### Challenge 2: Missing C++ Compiler

The CUDA image didn't have g++ by default.

**Fix**: Add `build-essential`, `g++`, `cmake`, `ninja-build` to apt_install.

### Challenge 3: TripoSR Not on PyPI

TripoSR doesn't have a setup.py, so can't `pip install` it.

**Fix**: Clone the repo and add to PYTHONPATH:

```python
.run_commands("git clone https://github.com/VAST-AI-Research/TripoSR.git /opt/TripoSR")
.env({"PYTHONPATH": "/opt/TripoSR:$PYTHONPATH"})
```

### Challenge 4: ONNX Runtime for rembg

Background removal via rembg needs onnxruntime. For GPU, use the GPU version:

```python
.pip_install("rembg", "onnxruntime-gpu")
```

### Challenge 5: Image Format (RGB vs RGBA)

TripoSR's `resize_foreground` expects RGBA images after background removal.

**Fix**: Proper image pipeline:

```python
from rembg import remove
img = remove(img)  # Returns RGBA
if img.mode != "RGBA":
    img = img.convert("RGBA")
img = resize_foreground(img, 0.85)

# Then convert to RGB with gray background
img_array = np.array(img).astype(np.float32) / 255.0
img_array = img_array[:, :, :3] * img_array[:, :, 3:4] + (1 - img_array[:, :, 3:4]) * 0.5
img = Image.fromarray((img_array * 255.0).astype(np.uint8))
```

### Challenge 6: extract_mesh API

TripoSR's extract_mesh returns a list, even for single inputs.

**Fix**: Index into the result:

```python
mesh = model.extract_mesh(scene_codes, has_vertex_color=True)[0]
```

### Challenge 7: OOM on T4 (16GB)

T4's 16GB VRAM wasn't enough for mesh extraction.

**Fix**: Use A10G with 24GB:

```python
@app.function(image=image, gpu="A10G", timeout=600)
```

## Final App Structure

```
~/.claude/skills/modal/
├── SKILL.md              # Main skill documentation
├── IMAGE-TO-3D-GUIDE.md  # This file
└── scripts/
    ├── image-to-3d       # CLI wrapper
    └── image_to_3d_app.py # Modal app
```

## GPU Selection Guide

| Model | Min VRAM | Recommended GPU |
|-------|----------|-----------------|
| TripoSR | 20GB | A10G (24GB) |
| Stable Diffusion XL | 12GB | T4 (16GB) |
| LLMs (7B) | 16GB | T4/A10G |
| LLMs (13B+) | 40GB+ | A100 |

## Tips for Future Modal Apps

1. **Start with T4**, upgrade if OOM
2. **Use volumes** for model weight caching - saves bandwidth and startup time
3. **Check base image requirements** - ML code often needs CUDA dev tools
4. **Test image builds separately** - Modal shows build logs in dashboard
5. **Use `modal app logs`** to debug remote execution

## References

- [Modal Docs](https://modal.com/docs)
- [TripoSR GitHub](https://github.com/VAST-AI-Research/TripoSR)
- [torchmcubes](https://github.com/tatsy/torchmcubes)
