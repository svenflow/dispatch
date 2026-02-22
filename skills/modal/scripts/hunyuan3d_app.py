#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["modal"]
# ///
"""
Hunyuan3D-2.1 on Modal - WITH TEXTURE
Tencent's high-quality image-to-3D model with texture synthesis
Uses CUDA-devel base for compiling custom rasterizer extensions
"""

import modal
import io
import tempfile
from pathlib import Path

app = modal.App("hunyuan3d")

# Build image with Hunyuan3D-2.1 dependencies
# Following Modal's official Blender example approach for bpy
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.0-devel-ubuntu22.04",
        add_python="3.11",  # Use Python 3.11 like Modal's example
    )
    # Set non-interactive mode before apt installs to avoid prompts
    .env({"DEBIAN_FRONTEND": "noninteractive"})
    .apt_install(
        "git", "libgl1-mesa-glx", "libglib2.0-0", "libsm6", "libxext6", "libxrender-dev",
        "build-essential", "g++", "cmake", "ninja-build",
        # X11 deps from Modal's official bpy example
        "xorg", "libxkbcommon0",
    )
    .env({"CXX": "/usr/bin/g++", "CC": "/usr/bin/gcc"})
    # Install PyTorch with CUDA 12.4 (need torch 2.5+ for nn.RMSNorm used by Hunyuan3D shape model)
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        index_url="https://download.pytorch.org/whl/cu124"
    )
    # Install core dependencies
    .pip_install(
        "numpy==1.24.4",
        "transformers==4.46.0",
        "diffusers==0.30.0",
        "accelerate==1.1.1",
        "huggingface-hub==0.30.2",
        "safetensors==0.4.4",
        "einops==0.8.0",
        "trimesh==4.4.7",
        "pygltflib==1.16.3",
        "opencv-python==4.10.0.84",
        "imageio==2.36.0",
        "scikit-image==0.24.0",
        "omegaconf==2.3.0",
        "pyyaml==6.0.2",
        "tqdm==4.66.5",
        "ninja==1.11.1.1",
        "pybind11==2.13.4",
        "timm",
        "rembg==2.0.65",
        "xatlas==0.0.9",
        "open3d==0.18.0",
        "pytorch-lightning==1.9.5",
        "realesrgan",  # For texture upscaling in paint pipeline
        "basicsr",     # Required by realesrgan
        "facexlib",    # Required by basicsr
        "gfpgan",      # Required for face enhancement
    )
    # Patch basicsr's deprecated import (functional_tensor removed in torchvision 0.17+)
    .run_commands(
        "sed -i 's/from torchvision.transforms.functional_tensor import rgb_to_grayscale/from torchvision.transforms.functional import rgb_to_grayscale/' /usr/local/lib/python3.11/site-packages/basicsr/data/degradations.py || true"
    )
    # Clone Hunyuan3D-2.1 repo
    .run_commands("git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1.git /opt/hunyuan3d")
    # Install hy3dshape requirements
    .run_commands("cd /opt/hunyuan3d/hy3dshape && pip install -r requirements.txt || true")
    # Build custom_rasterizer CUDA extension (needs GPU for compilation)
    # Use python setup.py directly to avoid pip's isolated build environment
    .run_commands(
        "cd /opt/hunyuan3d/hy3dpaint/custom_rasterizer && python setup.py install",
        gpu="A10G",
    )
    # Build DifferentiableRenderer (pure C++, no CUDA needed)
    .run_commands(
        "cd /opt/hunyuan3d/hy3dpaint/DifferentiableRenderer && bash compile_mesh_painter.sh"
    )
    # Add paths to PYTHONPATH
    .env({
        "PYTHONPATH": "/opt/hunyuan3d/hy3dshape:/opt/hunyuan3d/hy3dpaint:/opt/hunyuan3d/hy3dpaint/DifferentiableRenderer:/opt/hunyuan3d:$PYTHONPATH"
    })
    # Patch mesh_utils.py to use trimesh instead of bpy (bpy doesn't work on Modal)
    # This must come LAST since it's add_local_file
    .add_local_file(
        Path(__file__).parent / "mesh_utils_patch.py",
        "/opt/hunyuan3d/hy3dpaint/DifferentiableRenderer/mesh_utils.py"
    )
)

volume = modal.Volume.from_name("hunyuan3d-cache", create_if_missing=True)

@app.function(
    image=image,
    gpu="A10G",  # 24GB VRAM
    timeout=900,  # 15 min for texture generation
    volumes={"/cache": volume},
)
def generate_3d(image_bytes: bytes, with_texture: bool = True) -> bytes:
    """Generate 3D mesh from image bytes, returns GLB bytes"""
    import os
    import sys

    # Add paths - nested structure
    sys.path.insert(0, "/opt/hunyuan3d/hy3dshape")
    sys.path.insert(0, "/opt/hunyuan3d/hy3dpaint")
    sys.path.insert(0, "/opt/hunyuan3d/hy3dpaint/DifferentiableRenderer")
    sys.path.insert(0, "/opt/hunyuan3d")

    os.environ["HF_HOME"] = "/cache/huggingface"
    os.environ["HUGGINGFACE_HUB_CACHE"] = "/cache/huggingface"

    from PIL import Image as PILImage

    # Load shape generation pipeline
    print("Loading Hunyuan3D-2.1 shape pipeline...")
    from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline

    pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        'tencent/Hunyuan3D-2.1',
        cache_dir="/cache/huggingface"
    )

    # Process input image
    print("Processing image...")
    img = PILImage.open(io.BytesIO(image_bytes))
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    # Remove background
    print("Removing background...")
    from hy3dshape.rembg import BackgroundRemover
    remover = BackgroundRemover()
    img_no_bg = remover(img.convert("RGB"))

    # Save temp image for texture pipeline
    temp_image_path = "/tmp/input_image.png"
    img_no_bg.save(temp_image_path)

    # Run shape generation
    print("Running Hunyuan3D shape generation...")
    mesh = pipeline(image=img_no_bg)[0]

    # Save mesh for texture pipeline
    temp_mesh_path = "/tmp/shape_mesh.glb"
    mesh.export(temp_mesh_path)
    print(f"Shape mesh saved to {temp_mesh_path}")

    if with_texture:
        print("Running texture synthesis...")
        try:
            from textureGenPipeline import Hunyuan3DPaintPipeline, Hunyuan3DPaintConfig

            # Configure texture generation
            config = Hunyuan3DPaintConfig(max_num_view=6, resolution=512)
            paint_pipeline = Hunyuan3DPaintPipeline(config)

            # Generate texture
            output_mesh_path = paint_pipeline(
                mesh_path=temp_mesh_path,
                image_path=temp_image_path
            )

            print(f"Textured mesh saved to {output_mesh_path}")
            with open(output_mesh_path, "rb") as f:
                glb_bytes = f.read()
        except Exception as e:
            print(f"Texture generation failed: {e}")
            print("Falling back to shape-only output")
            with open(temp_mesh_path, "rb") as f:
                glb_bytes = f.read()
    else:
        with open(temp_mesh_path, "rb") as f:
            glb_bytes = f.read()

    volume.commit()
    return glb_bytes


@app.local_entrypoint()
def main(input_path: str, output_path: str = None, no_texture: bool = False):
    """CLI entrypoint for Hunyuan3D-2.1"""
    input_path = Path(input_path).expanduser()

    if output_path is None:
        output_path = input_path.with_suffix(".glb")
    else:
        output_path = Path(output_path).expanduser()

    print(f"Processing {input_path} with Hunyuan3D-2.1...")
    print(f"Texture generation: {'disabled' if no_texture else 'enabled'}")

    with open(input_path, "rb") as f:
        image_bytes = f.read()

    glb_bytes = generate_3d.remote(image_bytes, with_texture=not no_texture)

    with open(output_path, "wb") as f:
        f.write(glb_bytes)

    print(f"Saved to {output_path}")
