#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["modal"]
# ///
"""
TRELLIS on Modal
Microsoft's state-of-the-art 3D generation model with PBR materials
Requires 16GB+ VRAM, tested on A100/A6000
"""

import modal
import io
import tempfile
from pathlib import Path

app = modal.App("trellis")

# Build image with TRELLIS dependencies
# Using the pip commands extracted from setup.sh
image = (
    modal.Image.from_registry(
        "nvidia/cuda:11.8.0-devel-ubuntu22.04",
        add_python="3.10",
    )
    .apt_install(
        "git", "libgl1-mesa-glx", "libglib2.0-0", "libsm6", "libxext6", "libxrender-dev",
        "build-essential", "g++", "cmake", "ninja-build", "wget", "unzip"
    )
    .env({"CXX": "/usr/bin/g++", "CC": "/usr/bin/gcc", "CUDA_HOME": "/usr/local/cuda"})
    .pip_install("setuptools", "wheel")
    .pip_install(
        "torch==2.4.0",
        "torchvision==0.19.0",
        index_url="https://download.pytorch.org/whl/cu118"
    )
    # Basic dependencies from setup.sh
    .pip_install(
        "pillow", "imageio", "imageio-ffmpeg", "tqdm", "easydict",
        "opencv-python-headless", "scipy", "ninja", "rembg", "onnxruntime",
        "trimesh", "open3d", "xatlas", "pyvista", "pymeshfix", "igraph", "transformers"
    )
    # Utils3d
    .pip_install("git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8")
    # xformers for attention (cu118 compatible)
    .pip_install("xformers==0.0.27.post2", index_url="https://download.pytorch.org/whl/cu118")
    # spconv for sparse convolutions
    .pip_install("spconv-cu118")
    # kaolin for 3D ops
    .run_commands(
        "pip install kaolin -f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.4.0_cu118.html",
        gpu="A10G",
    )
    # Clone TRELLIS with submodules
    .run_commands("git clone --recurse-submodules https://github.com/microsoft/TRELLIS.git /opt/trellis")
    # Install nvdiffrast from extensions
    .run_commands(
        "cd /opt/trellis && pip install extensions/nvdiffrast",
        gpu="A10G",
    )
    # Install diffoctreerast from extensions
    .run_commands(
        "cd /opt/trellis && pip install extensions/diffoctreerast",
        gpu="A10G",
    )
    # Install vox2seq
    .run_commands(
        "cd /opt/trellis && pip install extensions/vox2seq",
        gpu="A10G",
    )
    .env({"PYTHONPATH": "/opt/trellis:$PYTHONPATH"})
)

volume = modal.Volume.from_name("trellis-cache", create_if_missing=True)

@app.function(
    image=image,
    gpu="A10G",  # 24GB should work
    timeout=900,  # 15 minutes for large model
    volumes={"/cache": volume},
)
def generate_3d(image_bytes: bytes, seed: int = 42) -> bytes:
    """Generate 3D mesh from image bytes, returns GLB bytes"""
    import os
    import sys
    sys.path.insert(0, "/opt/trellis")

    os.environ["HF_HOME"] = "/cache/huggingface"
    os.environ["HUGGINGFACE_HUB_CACHE"] = "/cache/huggingface"
    os.environ["ATTN_BACKEND"] = "xformers"  # Use xformers for A10G

    from PIL import Image
    import torch

    # Save input image
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode != "RGB":
        img = img.convert("RGB")

    # Load TRELLIS pipeline
    print("Loading TRELLIS pipeline...")
    from trellis.pipelines import TrellisImageTo3DPipeline

    pipeline = TrellisImageTo3DPipeline.from_pretrained(
        "microsoft/TRELLIS-image-large",
        cache_dir="/cache/huggingface"
    )
    pipeline.cuda()

    # Run inference
    print("Running TRELLIS inference...")
    outputs = pipeline.run(img, seed=seed)

    # TRELLIS outputs include gaussians, radiance_field, and mesh
    # Export the mesh to GLB
    print("Exporting to GLB...")
    glb_bytes = outputs['glb']  # TRELLIS returns GLB bytes directly

    volume.commit()
    return glb_bytes


@app.local_entrypoint()
def main(input_path: str, output_path: str = None, seed: int = 42):
    """CLI entrypoint for TRELLIS"""
    input_path = Path(input_path).expanduser()

    if output_path is None:
        output_path = input_path.with_suffix(".glb")
    else:
        output_path = Path(output_path).expanduser()

    print(f"Processing {input_path} with TRELLIS...")

    with open(input_path, "rb") as f:
        image_bytes = f.read()

    glb_bytes = generate_3d.remote(image_bytes, seed)

    with open(output_path, "wb") as f:
        f.write(glb_bytes)

    print(f"Saved to {output_path}")
