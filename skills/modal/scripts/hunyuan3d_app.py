#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["modal"]
# ///
"""
Hunyuan3D-2 on Modal
Tencent's high-quality image-to-3D model with texture synthesis
Requires ~6GB for shape only, ~16GB for shape+texture
Using the mini variant for lower VRAM
"""

import modal
import io
import tempfile
from pathlib import Path

app = modal.App("hunyuan3d")

# Build image with Hunyuan3D-2 dependencies
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-devel-ubuntu22.04",
        add_python="3.10",
    )
    .apt_install(
        "git", "libgl1-mesa-glx", "libglib2.0-0", "libsm6", "libxext6", "libxrender-dev",
        "build-essential", "g++", "cmake", "ninja-build"
    )
    .env({"CXX": "/usr/bin/g++", "CC": "/usr/bin/gcc"})
    # Pin numpy<2 to avoid compatibility issues
    .pip_install("numpy<2.0")
    .pip_install(
        "torch==2.1.0",
        "torchvision==0.16.0",
        index_url="https://download.pytorch.org/whl/cu121"
    )
    # Pin diffusers version compatible with torch 2.1
    .pip_install("diffusers==0.27.2", "transformers<4.50", "accelerate<1.0")
    .run_commands("git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git /opt/hunyuan3d")
    # Install requirements but skip diffusers (already installed with correct version)
    .run_commands("cd /opt/hunyuan3d && pip install -r requirements.txt --ignore-installed diffusers || true")
    .run_commands("cd /opt/hunyuan3d && pip install -e . --no-deps || pip install -e .")
    # Build custom rasterizer and differentiable renderer for texture
    .run_commands(
        "cd /opt/hunyuan3d/hy3dgen/texgen/custom_rasterizer && python setup.py install",
        gpu="A10G",
    )
    .run_commands(
        "cd /opt/hunyuan3d/hy3dgen/texgen/differentiable_renderer && python setup.py install",
        gpu="A10G",
    )
    .env({"PYTHONPATH": "/opt/hunyuan3d:$PYTHONPATH"})
)

volume = modal.Volume.from_name("hunyuan3d-cache", create_if_missing=True)

@app.function(
    image=image,
    gpu="A10G",  # 24GB VRAM, enough for shape+texture
    timeout=600,
    volumes={"/cache": volume},
)
def generate_3d(image_bytes: bytes, with_texture: bool = True) -> bytes:
    """Generate 3D mesh from image bytes, returns GLB bytes"""
    import os
    import sys
    sys.path.insert(0, "/opt/hunyuan3d")

    os.environ["HF_HOME"] = "/cache/huggingface"
    os.environ["HUGGINGFACE_HUB_CACHE"] = "/cache/huggingface"

    from PIL import Image
    import torch
    import trimesh

    # Load pipeline
    print("Loading Hunyuan3D-2 pipeline...")
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

    pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        'tencent/Hunyuan3D-2',
        cache_dir="/cache/huggingface"
    )
    pipeline = pipeline.to("cuda")

    # Process input image
    print("Processing image...")
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode != "RGB":
        img = img.convert("RGB")

    # Save temp file for pipeline
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img.save(tmp.name)
        temp_image_path = tmp.name

    # Run shape generation
    print("Running Hunyuan3D shape generation...")
    mesh = pipeline(image=temp_image_path)[0]

    if with_texture:
        print("Running texture synthesis...")
        from hy3dgen.texgen import Hunyuan3DPaintPipeline

        tex_pipeline = Hunyuan3DPaintPipeline.from_pretrained(
            'tencent/Hunyuan3D-2',
            cache_dir="/cache/huggingface"
        )
        tex_pipeline = tex_pipeline.to("cuda")
        mesh = tex_pipeline(mesh, image=temp_image_path)

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
def main(input_path: str, output_path: str = None, no_texture: bool = False):
    """CLI entrypoint for Hunyuan3D-2"""
    input_path = Path(input_path).expanduser()

    if output_path is None:
        output_path = input_path.with_suffix(".glb")
    else:
        output_path = Path(output_path).expanduser()

    print(f"Processing {input_path} with Hunyuan3D-2...")

    with open(input_path, "rb") as f:
        image_bytes = f.read()

    glb_bytes = generate_3d.remote(image_bytes, with_texture=not no_texture)

    with open(output_path, "wb") as f:
        f.write(glb_bytes)

    print(f"Saved to {output_path}")
