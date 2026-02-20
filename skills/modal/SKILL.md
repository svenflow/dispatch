---
name: modal
description: Deploy and run serverless GPU functions on Modal. Use for ML inference, image processing, 3D generation. Trigger words - modal, serverless GPU, deploy, ML inference.
---

# Modal Skill

Deploy and run serverless GPU functions on [Modal](https://modal.com). Perfect for ML inference, image processing, 3D generation, and any GPU-heavy workloads.

## Authentication

Modal credentials are stored in keychain:
- `modal-token-id` - API token ID
- `modal-token-secret` - API token secret

The token is also saved to `~/.modal.toml` after running `modal token set`.

## CLI Usage

```bash
# Check Modal is working
uv run modal --version

# List deployed apps
uv run modal app list

# Deploy an app
uv run modal deploy path/to/app.py

# Run a function remotely
uv run modal run path/to/app.py

# View logs
uv run modal app logs <app-name>
```

## Writing Modal Apps

Basic structure:

```python
import modal

app = modal.App("my-app")

# Define a container image with dependencies
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch",
    "transformers",
)

@app.function(image=image, gpu="T4")  # or "A10G", "A100"
def my_function(input_data: bytes) -> bytes:
    # Run on GPU
    return result

@app.local_entrypoint()
def main():
    # Local code that calls remote functions
    result = my_function.remote(data)
```

## Available GPU Types

| GPU | VRAM | Cost | Best For |
|-----|------|------|----------|
| T4 | 16GB | $ | Light inference, testing |
| A10G | 24GB | $$ | Medium models, Stable Diffusion |
| A100-40GB | 40GB | $$$ | Large models, LLMs |
| A100-80GB | 80GB | $$$$ | Very large models |

## Pre-built Functions

### Image to 3D
```bash
uv run modal run ~/.claude/skills/modal/scripts/image_to_3d_app.py \
  --input-path ~/photo.jpg \
  --output-path ~/model.glb
```

Uses TripoSR on A10G GPU to generate textured 3D GLB models from images.

**Development guide**: See [IMAGE-TO-3D-GUIDE.md](./IMAGE-TO-3D-GUIDE.md) for details on how this was built, including solutions for torchmcubes compilation, OOM issues, and image format handling.

## Tips

1. **Use volumes for caching models** - Avoid re-downloading large models:
   ```python
   volume = modal.Volume.from_name("model-cache", create_if_missing=True)
   @app.function(volumes={"/cache": volume})
   ```

2. **Secrets for API keys** - Store in Modal dashboard, access in functions:
   ```python
   @app.function(secrets=[modal.Secret.from_name("my-secret")])
   ```

3. **Timeouts** - Default is 60s, increase for long-running tasks:
   ```python
   @app.function(timeout=600)  # 10 minutes
   ```

4. **Concurrency** - Allow multiple concurrent calls:
   ```python
   @app.function(allow_concurrent_inputs=10)
   ```
