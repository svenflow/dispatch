#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["modal"]
# ///
"""
PartCrafter on Modal - Structured 3D mesh generation with part decomposition.

Usage:
    # Deploy
    uv run modal deploy ~/.claude/skills/modal/scripts/partcrafter_app.py

    # Run inference
    uv run modal run ~/.claude/skills/modal/scripts/partcrafter_app.py \
        --image-path /path/to/image.jpg \
        --output-dir /tmp/partcrafter_output \
        --num-parts 3
"""

import modal
import io
import os
from pathlib import Path

app = modal.App("partcrafter")

# Volume for caching model weights
volume = modal.Volume.from_name("partcrafter-cache", create_if_missing=True)

# Build the container image
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "git", "wget", "libgl1-mesa-glx", "libglib2.0-0",
        "libegl1", "libglu1-mesa", "libxrender1", "libsm6"
    )
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "torchaudio==2.5.1",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        "huggingface_hub",
        "transformers",
        "accelerate",
        "safetensors",
        "trimesh",
        "numpy",
        "pillow",
        "einops",
        "tqdm",
        "scipy",
        "omegaconf",
        "PyMCubes",
        "xatlas",
        "plyfile",
    )
    .run_commands(
        # Clone PartCrafter repo
        "git clone https://github.com/wgsxm/PartCrafter.git /opt/partcrafter",
    )
    # Install PartCrafter dependencies from their requirements
    .pip_install(
        "torch-cluster",
        find_links="https://data.pyg.org/whl/torch-2.5.1+cu124.html",
    )
    .pip_install(
        "scikit-learn",
        "gpustat",
        "diffusers",
        "opencv-python",
        "scikit-image",
        "numpy==1.26.4",
        "peft",
        "jaxtyping",
        "typeguard",
        "matplotlib",
        "imageio-ffmpeg",
        "pyrender",
        "colormaps",
    )
    .apt_install("libegl1-mesa", "libgl1-mesa-dev")
)


@app.function(
    image=image,
    gpu="A10G",  # 24GB VRAM - PartCrafter needs ~8GB
    timeout=600,
    volumes={"/cache": volume},
)
def generate_parts(
    image_bytes: bytes,
    num_parts: int = 3,
    seed: int = 42,
    num_tokens: int = 1024,
    num_inference_steps: int = 50,
    guidance_scale: float = 7.0,
    remove_background: bool = True,
) -> dict:
    """Generate 3D parts from an image using PartCrafter."""
    import sys
    sys.path.insert(0, "/opt/partcrafter")

    import torch
    import numpy as np
    from PIL import Image
    from huggingface_hub import snapshot_download
    from accelerate.utils import set_seed
    import trimesh
    import tempfile
    import base64

    # Set seed for reproducibility
    set_seed(seed)

    # Download model weights if not cached
    weights_dir = "/cache/PartCrafter"
    rmbg_dir = "/cache/RMBG-1.4"

    if not os.path.exists(os.path.join(weights_dir, "config.json")):
        print("Downloading PartCrafter weights...")
        snapshot_download(repo_id="wgsxm/PartCrafter", local_dir=weights_dir)

    if remove_background and not os.path.exists(os.path.join(rmbg_dir, "config.json")):
        print("Downloading RMBG weights...")
        snapshot_download(repo_id="briaai/RMBG-1.4", local_dir=rmbg_dir)

    # Import PartCrafter components
    from src.pipelines.pipeline_partcrafter import PartCrafterPipeline
    from src.utils.data_utils import get_colored_mesh_composition
    from src.utils.image_utils import prepare_image
    from src.models.briarmbg import BriaRMBG

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16

    # Load image
    img_pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # Remove background if requested
    if remove_background:
        rmbg_net = BriaRMBG.from_pretrained(rmbg_dir).to(device)
        # Save to temp file for prepare_image
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            img_pil.save(f.name)
            img_pil = prepare_image(
                f.name,
                bg_color=np.array([1.0, 1.0, 1.0]),
                rmbg_net=rmbg_net
            )
            os.unlink(f.name)
        del rmbg_net
        torch.cuda.empty_cache()

    # Load PartCrafter pipeline
    print("Loading PartCrafter pipeline...")
    pipe = PartCrafterPipeline.from_pretrained(weights_dir).to(device, dtype)

    # Run inference
    print(f"Generating {num_parts} parts...")
    outputs = pipe(
        image=[img_pil] * num_parts,
        attention_kwargs={"num_parts": num_parts},
        num_tokens=num_tokens,
        generator=torch.Generator(device=device).manual_seed(seed),
        num_inference_steps=num_inference_steps,
        guidance_scale=guidance_scale,
        max_num_expanded_coords=1e9,
        use_flash_decoder=False,
    ).meshes

    # Process outputs
    results = {"parts": [], "merged": None}

    # Export individual parts as GLB
    for idx, mesh in enumerate(outputs):
        buffer = io.BytesIO()
        mesh.export(buffer, file_type="glb")
        results["parts"].append({
            "index": idx,
            "glb": base64.b64encode(buffer.getvalue()).decode("utf-8"),
        })

    # Create merged colored mesh
    merged = get_colored_mesh_composition(outputs)
    buffer = io.BytesIO()
    merged.export(buffer, file_type="glb")
    results["merged"] = base64.b64encode(buffer.getvalue()).decode("utf-8")

    print(f"Generated {len(outputs)} parts successfully!")
    return results


@app.local_entrypoint()
def main(
    image_path: str,
    output_dir: str = "/tmp/partcrafter_output",
    num_parts: int = 3,
    seed: int = 42,
):
    """Generate 3D parts from an image."""
    import base64

    # Read input image
    with open(image_path, "rb") as f:
        image_bytes = f.read()

    print(f"Processing {image_path} with {num_parts} parts...")

    # Run on Modal
    results = generate_parts.remote(
        image_bytes=image_bytes,
        num_parts=num_parts,
        seed=seed,
    )

    # Create output directory
    os.makedirs(output_dir, exist_ok=True)

    # Save individual parts
    for part in results["parts"]:
        part_path = os.path.join(output_dir, f"part_{part['index']:02d}.glb")
        with open(part_path, "wb") as f:
            f.write(base64.b64decode(part["glb"]))
        print(f"Saved: {part_path}")

    # Save merged mesh
    merged_path = os.path.join(output_dir, "merged.glb")
    with open(merged_path, "wb") as f:
        f.write(base64.b64decode(results["merged"]))
    print(f"Saved merged: {merged_path}")

    return merged_path


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        main(sys.argv[1])
