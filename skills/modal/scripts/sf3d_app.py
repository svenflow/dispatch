#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["modal"]
# ///
"""
SF3D (Stable Fast 3D) on Modal
Stability AI's fast image-to-3D model - generates textured mesh in ~0.5s
Requires ~6GB VRAM
"""

import modal
import io
import tempfile
from pathlib import Path

app = modal.App("sf3d")

# Build image with all SF3D dependencies
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-devel-ubuntu22.04",
        add_python="3.10",
    )
    .apt_install("git", "libgl1-mesa-glx", "libglib2.0-0", "build-essential", "g++", "cmake", "ninja-build")
    .env({"CXX": "/usr/bin/g++", "CC": "/usr/bin/gcc"})
    .pip_install("setuptools==69.5.1", "wheel")
    .pip_install(
        "torch==2.1.0",
        "torchvision==0.16.0",
        index_url="https://download.pytorch.org/whl/cu121"
    )
    .run_commands("git clone https://github.com/Stability-AI/stable-fast-3d.git /opt/sf3d")
    .pip_install(
        "huggingface_hub",
        "transformers",
        "trimesh",
        "Pillow",
        "numpy",
        "einops",
        "safetensors",
        "jaxtyping",
        "rembg",
        "onnxruntime-gpu",
    )
    # Install sf3d requirements
    .run_commands(
        "cd /opt/sf3d && pip install -r requirements.txt",
        gpu="T4",  # Need GPU for building CUDA extensions
    )
    .env({"PYTHONPATH": "/opt/sf3d:$PYTHONPATH"})
)

volume = modal.Volume.from_name("sf3d-cache", create_if_missing=True)

@app.function(
    image=image,
    gpu="T4",  # SF3D only needs ~6GB VRAM
    timeout=300,
    volumes={"/cache": volume},
    secrets=[modal.Secret.from_name("huggingface-token", required_keys=["HF_TOKEN"])]
)
def generate_3d(image_bytes: bytes, texture_resolution: int = 1024) -> bytes:
    """Generate 3D mesh from image bytes, returns GLB bytes"""
    import os
    import sys
    sys.path.insert(0, "/opt/sf3d")

    os.environ["HF_HOME"] = "/cache/huggingface"
    os.environ["HUGGINGFACE_HUB_CACHE"] = "/cache/huggingface"

    from PIL import Image
    import torch
    from sf3d.system import SF3D
    from rembg import remove
    import trimesh

    # Load model
    print("Loading SF3D model...")
    model = SF3D.from_pretrained(
        "stabilityai/stable-fast-3d",
        config_name="config.yaml",
        weight_name="model.safetensors",
    )
    model.to("cuda")
    model.eval()

    # Process input image
    print("Processing image...")
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode != "RGBA":
        img = img.convert("RGB")
        img = remove(img)  # Remove background

    # Run inference
    print("Running SF3D inference...")
    with torch.no_grad():
        mesh, _ = model.run_image(
            img,
            bake_resolution=texture_resolution,
            remesh="none",
        )

    # Export to GLB
    print("Exporting to GLB...")
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
        mesh.export(f.name)
        f.seek(0)
        with open(f.name, "rb") as glb_file:
            glb_bytes = glb_file.read()

    volume.commit()
    return glb_bytes


@app.local_entrypoint()
def main(input_path: str, output_path: str = None, texture_resolution: int = 1024):
    """CLI entrypoint for SF3D"""
    input_path = Path(input_path).expanduser()

    if output_path is None:
        output_path = input_path.with_suffix(".glb")
    else:
        output_path = Path(output_path).expanduser()

    print(f"Processing {input_path} with SF3D...")

    with open(input_path, "rb") as f:
        image_bytes = f.read()

    glb_bytes = generate_3d.remote(image_bytes, texture_resolution)

    with open(output_path, "wb") as f:
        f.write(glb_bytes)

    print(f"Saved to {output_path}")
