#!/usr/bin/env python
"""
Modal app for Image-to-3D using TripoSR.
Deploy: uv run modal deploy ~/.claude/skills/modal/scripts/image_to_3d_app.py
Run: uv run modal run ~/.claude/skills/modal/scripts/image_to_3d_app.py --input-path /path/to/image.jpg
"""

import modal
import io
import sys
import os

app = modal.App("image-to-3d")

# Volume for caching model weights
model_volume = modal.Volume.from_name("triposr-models", create_if_missing=True)

# Use CUDA base image for proper torchmcubes compilation
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-devel-ubuntu22.04",
        add_python="3.10",
    )
    .apt_install("git", "libgl1-mesa-glx", "libglib2.0-0", "build-essential", "g++", "cmake", "ninja-build")
    .env({"CXX": "/usr/bin/g++", "CC": "/usr/bin/gcc"})
    .pip_install(
        "torch",
        "torchvision",
        "transformers>=4.35.0",
        "safetensors",
        "trimesh>=4.0.0",
        "pillow>=10.0.0",
        "numpy",
        "huggingface_hub",
        "einops",
        "omegaconf",
        "rembg",
        "onnxruntime-gpu",
        "xatlas",
    )
    # Install torchmcubes from source (needs CUDA)
    .pip_install("git+https://github.com/tatsy/torchmcubes.git")
    # Clone TripoSR repo
    .run_commands(
        "git clone https://github.com/VAST-AI-Research/TripoSR.git /opt/TripoSR",
    )
    .env({"PYTHONPATH": "/opt/TripoSR:$PYTHONPATH"})
)


@app.function(
    image=image,
    gpu="A10G",  # T4 runs OOM, need 24GB
    timeout=600,
    volumes={"/models": model_volume},
)
def generate_3d_triposr(image_bytes: bytes, remove_bg: bool = True) -> bytes:
    """
    Generate a 3D GLB model from an image using TripoSR.
    """
    import torch
    from PIL import Image
    from huggingface_hub import snapshot_download
    import numpy as np

    # Add TripoSR to path
    sys.path.insert(0, "/opt/TripoSR")

    from tsr.system import TSR
    from tsr.utils import remove_background, resize_foreground

    # Load image
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # Remove background and process image
    if remove_bg:
        from rembg import remove
        img = remove(img)  # Returns RGBA
        if img.mode != "RGBA":
            img = img.convert("RGBA")

        # resize_foreground expects RGBA
        img = resize_foreground(img, 0.85)

        # Convert to RGB with gray background (as per TripoSR's run.py)
        import numpy as np
        img_array = np.array(img).astype(np.float32) / 255.0
        # Alpha composite with gray (0.5) background
        img_array = img_array[:, :, :3] * img_array[:, :, 3:4] + (1 - img_array[:, :, 3:4]) * 0.5
        img = Image.fromarray((img_array * 255.0).astype(np.uint8))
    else:
        # No background removal - just convert to RGB
        img = img.convert("RGB")

    # Download/cache model weights
    model_cache = "/models/triposr-weights"
    if not os.path.exists(f"{model_cache}/model.ckpt"):
        print("Downloading TripoSR model weights...")
        snapshot_download(
            "stabilityai/TripoSR",
            local_dir=model_cache,
            local_dir_use_symlinks=False,
        )
        model_volume.commit()
    else:
        print("Using cached model weights")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading model on {device}...")

    model = TSR.from_pretrained(
        model_cache,
        config_name="config.yaml",
        weight_name="model.ckpt",
    )
    model.to(device)

    # Generate 3D mesh
    print("Generating 3D mesh...")
    with torch.no_grad():
        scene_codes = model([img], device)
        mesh = model.extract_mesh(scene_codes, has_vertex_color=True)[0]

    # Export as GLB
    print("Exporting GLB...")
    output = io.BytesIO()
    mesh.export(output, file_type="glb")

    return output.getvalue()


@app.local_entrypoint()
def main(input_path: str, output_path: str = None, remove_bg: bool = True):
    """Local entrypoint."""
    if output_path is None:
        base = os.path.splitext(input_path)[0]
        output_path = f"{base}_3d.glb"

    with open(input_path, "rb") as f:
        image_bytes = f.read()

    print(f"Processing: {input_path}")
    print(f"Output will be: {output_path}")

    result = generate_3d_triposr.remote(image_bytes, remove_bg)

    with open(output_path, "wb") as f:
        f.write(result)

    print(f"Success! 3D model saved to: {output_path}")


if __name__ == "__main__":
    main()
