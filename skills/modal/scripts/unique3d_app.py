#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["modal"]
# ///
"""
Unique3D on Modal
NeurIPS 2024 - High-quality textured mesh generation from single image in ~30s
Requires CUDA 12.1 and ~16GB VRAM
"""

import modal
import io
import tempfile
from pathlib import Path

app = modal.App("unique3d")

# Build image with Unique3D dependencies
# Reference: Python 3.10 + CUDA 12.2
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-devel-ubuntu22.04",
        add_python="3.10",  # Use 3.10 for better mmcv compatibility
    )
    .apt_install(
        "git", "libgl1-mesa-glx", "libglib2.0-0", "libsm6", "libxext6", "libxrender-dev",
        "build-essential", "g++", "cmake", "ninja-build", "wget"
    )
    .env({"CXX": "/usr/bin/g++", "CC": "/usr/bin/gcc", "CUDA_HOME": "/usr/local/cuda"})
    .pip_install("setuptools", "wheel", "ninja")  # Need setuptools for pkg_resources
    .pip_install(
        "torch==2.1.0",
        "torchvision==0.16.0",
        index_url="https://download.pytorch.org/whl/cu121"
    )
    .pip_install("diffusers==0.27.2")
    # Install fvcore, iopath for pytorch3d
    .pip_install("fvcore", "iopath")
    # Install pytorch3d pre-compiled wheel for py310_cu121_pyt210
    .pip_install(
        "pytorch3d",
        find_links="https://dl.fbaipublicfiles.com/pytorch3d/packaging/wheels/py310_cu121_pyt210/download.html"
    )
    # Install nvdiffrast
    .pip_install("nvdiffrast")
    # Install torch_scatter from source
    .pip_install("git+https://github.com/rusty1s/pytorch_scatter.git")
    # Install onnxruntime-gpu for CUDA 12
    .pip_install(
        "onnxruntime-gpu",
        extra_index_url="https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-12/pypi/simple/"
    )
    # Clone and install Unique3D
    .run_commands("git clone https://github.com/AiuniAI/Unique3D.git /opt/unique3d")
    .run_commands("cd /opt/unique3d && pip install -r requirements.txt || true")  # Some may fail, that's ok
    .pip_install(
        "huggingface_hub",
        "transformers",
        "trimesh",
        "Pillow",
        "numpy",
        "scipy",
        "rembg",
    )
    .env({"PYTHONPATH": "/opt/unique3d:$PYTHONPATH"})
)

volume = modal.Volume.from_name("unique3d-cache", create_if_missing=True)

@app.function(
    image=image,
    gpu="A10G",  # 24GB VRAM for safety
    timeout=600,
    volumes={"/cache": volume},
)
def generate_3d(image_bytes: bytes) -> bytes:
    """Generate 3D mesh from image bytes, returns GLB bytes"""
    import os
    import sys
    sys.path.insert(0, "/opt/unique3d")

    os.environ["HF_HOME"] = "/cache/huggingface"
    os.environ["HUGGINGFACE_HUB_CACHE"] = "/cache/huggingface"

    from PIL import Image
    import torch

    # Save input image
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode != "RGB":
        img = img.convert("RGB")

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img.save(tmp.name)
        temp_image_path = tmp.name

    # Import Unique3D modules
    print("Loading Unique3D pipeline...")
    try:
        from app.custom_models.mvimg_prediction import MVImgPredictionPipeline
        from app.custom_models.normal_prediction import NormalPredictionPipeline
        from scripts.mesh_init import build_mesh_with_texture
        from scripts.refine_mesh import refine_mesh

        # Load pipelines
        mv_pipeline = MVImgPredictionPipeline.from_pretrained(
            "Wuvin/Unique3D",
            cache_dir="/cache/huggingface",
            torch_dtype=torch.float16,
        ).to("cuda")

        normal_pipeline = NormalPredictionPipeline.from_pretrained(
            "Wuvin/Unique3D",
            cache_dir="/cache/huggingface",
            torch_dtype=torch.float16,
        ).to("cuda")

        # Run inference
        print("Generating multi-view images...")
        mv_images = mv_pipeline(img)

        print("Predicting normals...")
        normals = normal_pipeline(mv_images)

        print("Building mesh...")
        mesh = build_mesh_with_texture(mv_images, normals)

        print("Refining mesh...")
        mesh = refine_mesh(mesh)
    except Exception as e:
        print(f"Unique3D native pipeline failed: {e}")
        print("Falling back to gradio_app inference...")
        # Alternative: use the gradio inference directly
        from scripts.inference_v2 import run_inference
        mesh = run_inference(temp_image_path, "/cache")

    # Export to GLB
    print("Exporting to GLB...")
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
        mesh.export(f.name)
        with open(f.name, "rb") as glb_file:
            glb_bytes = glb_file.read()

    os.unlink(temp_image_path)
    volume.commit()
    return glb_bytes


@app.local_entrypoint()
def main(input_path: str, output_path: str = None):
    """CLI entrypoint for Unique3D"""
    input_path = Path(input_path).expanduser()

    if output_path is None:
        output_path = input_path.with_suffix(".glb")
    else:
        output_path = Path(output_path).expanduser()

    print(f"Processing {input_path} with Unique3D...")

    with open(input_path, "rb") as f:
        image_bytes = f.read()

    glb_bytes = generate_3d.remote(image_bytes)

    with open(output_path, "wb") as f:
        f.write(glb_bytes)

    print(f"Saved to {output_path}")
