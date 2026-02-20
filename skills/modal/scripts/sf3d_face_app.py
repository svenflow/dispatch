#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["modal"]
# ///
"""
Stable Fast 3D (SF3D) on Modal
Generates UV-unwrapped textured 3D mesh from a single image in ~1 second.
Uses Stability AI's SF3D model.
"""

import modal
import os
import sys

app = modal.App("sf3d-image-to-3d")

# Volume for caching model weights
volume = modal.Volume.from_name("sf3d-models", create_if_missing=True)

# Build image with SF3D dependencies
image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install(
        "git",
        "wget",
        "libgl1-mesa-glx",
        "libglib2.0-0",
        "libsm6",
        "libxext6",
        "libxrender-dev",
        "build-essential",
    )
    .pip_install(
        "setuptools==69.5.1",
        "wheel",
    )
    .pip_install(
        "torch==2.1.0",
        "torchvision==0.16.0",
        "huggingface_hub",
    )
    # Clone SF3D and install
    .run_commands(
        "cd /root && git clone https://github.com/Stability-AI/stable-fast-3d.git",
    )
    .run_commands(
        "cd /root/stable-fast-3d && pip install -r requirements.txt",
    )
)


@app.function(
    image=image,
    gpu="T4",  # Only needs ~6GB VRAM
    volumes={"/cache": volume},
    timeout=300,
    secrets=[modal.Secret.from_name("huggingface-token", required=False)],
)
def generate_3d_mesh(image_bytes: bytes, filename: str = "input.png", texture_resolution: int = 1024) -> dict:
    """
    Generate UV-unwrapped textured 3D mesh from an image.

    Args:
        image_bytes: Input image as bytes
        filename: Filename for the input
        texture_resolution: Resolution of output texture (default 1024)

    Returns dict with:
        - glb_data: bytes of GLB file with UV-mapped textures
        - success: bool
        - message: str
    """
    import subprocess
    from pathlib import Path

    # Setup paths
    sf3d_dir = Path("/root/stable-fast-3d")
    input_dir = Path("/tmp/sf3d_input")
    output_dir = Path("/tmp/sf3d_output")

    input_dir.mkdir(exist_ok=True)
    output_dir.mkdir(exist_ok=True)

    # Save input image
    input_path = input_dir / filename
    input_path.write_bytes(image_bytes)
    print(f"Saved input image to {input_path} ({len(image_bytes)} bytes)")

    # Set up HF cache
    hf_cache = Path("/cache/huggingface")
    hf_cache.mkdir(exist_ok=True)
    os.environ["HF_HOME"] = str(hf_cache)
    os.environ["TRANSFORMERS_CACHE"] = str(hf_cache)

    # Check if HF token is available
    hf_token = os.environ.get("HF_TOKEN")
    if hf_token:
        os.environ["HUGGING_FACE_HUB_TOKEN"] = hf_token
        print("HF token found")
    else:
        print("Warning: No HF token found - model may not download if gated")

    # Run SF3D
    cmd = [
        "python", "run.py",
        str(input_path),
        "--output-dir", str(output_dir),
        "--texture-resolution", str(texture_resolution),
    ]

    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(
        cmd,
        cwd=str(sf3d_dir),
        capture_output=True,
        text=True,
        env={**os.environ},
    )

    print("STDOUT:", result.stdout[-5000:] if len(result.stdout) > 5000 else result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr[-2000:] if len(result.stderr) > 2000 else result.stderr)

    # Find output GLB
    outputs = {"success": False, "message": ""}

    glb_files = list(output_dir.glob("*.glb"))
    if glb_files:
        glb_path = glb_files[0]
        outputs["glb_data"] = glb_path.read_bytes()
        outputs["success"] = True
        outputs["message"] = f"Generated {glb_path.name} ({len(outputs['glb_data'])} bytes)"
        print(outputs["message"])
    else:
        outputs["message"] = f"No GLB output found. Return code: {result.returncode}"
        if result.stderr:
            outputs["message"] += f"\nError: {result.stderr[-500:]}"
        print(outputs["message"])

    # Commit volume if we downloaded new models
    volume.commit()

    return outputs


@app.local_entrypoint()
def main(
    input_path: str = None,
    output_path: str = None,
    texture_resolution: int = 1024,
):
    """
    Generate 3D mesh from an image using SF3D.

    Example:
        uv run modal run sf3d_face_app.py --input-path ~/face.jpg --output-path ~/face_3d.glb
    """
    from pathlib import Path

    if not input_path:
        print("Usage: uv run modal run sf3d_face_app.py --input-path IMAGE --output-path OUTPUT.glb")
        sys.exit(1)

    input_path = Path(input_path).expanduser()
    if not input_path.exists():
        print(f"Input file not found: {input_path}")
        sys.exit(1)

    output_path = Path(output_path or f"{input_path.stem}_sf3d.glb").expanduser()

    print(f"Processing: {input_path}")
    print(f"Output to: {output_path}")

    # Read input image
    image_bytes = input_path.read_bytes()

    # Run generation
    results = generate_3d_mesh.remote(image_bytes, input_path.name, texture_resolution)

    if results["success"]:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(results["glb_data"])
        print(f"Saved: {output_path}")
    else:
        print(f"Failed: {results['message']}")
        sys.exit(1)

    print("Done!")
