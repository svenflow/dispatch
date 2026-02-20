#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["modal"]
# ///
"""
CRM (Convolutional Reconstruction Model) on Modal
Single image to 3D textured mesh with UV-mapping in ~10 seconds.
MIT licensed - ECCV 2024 paper.
"""

import modal
import os
import sys

app = modal.App("crm-image-to-3d")

# Volume for caching model weights
volume = modal.Volume.from_name("crm-models", create_if_missing=True)

# Build image with CRM dependencies
image = (
    modal.Image.from_registry("nvidia/cuda:12.1.0-devel-ubuntu22.04", add_python="3.10")
    .apt_install(
        "git",
        "wget",
        "libgl1-mesa-glx",
        "libglib2.0-0",
        "libsm6",
        "libxext6",
        "libxrender-dev",
        "build-essential",
        "ninja-build",
    )
    .pip_install(
        "torch==2.1.0+cu121",
        "torchvision==0.16.0+cu121",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "huggingface-hub",
        "diffusers==0.24.0",
        "einops==0.7.0",
        "Pillow==10.1.0",
        "transformers==4.27.1",
        "open-clip-torch==2.7.0",
        "opencv-python-headless==4.9.0.80",
        "omegaconf",
        "rembg[gpu]",
        "pygltflib",
        "kiui",
        "trimesh",
        "xatlas",
        "pymeshlab",
        "numpy<2",
    )
    # Install kaolin
    .run_commands(
        "pip install kaolin -f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.1.0_cu121.html"
    )
    # Install nvdiffrast with --no-build-isolation flag
    .run_commands(
        "pip install --no-build-isolation git+https://github.com/NVlabs/nvdiffrast.git"
    )
    # Clone CRM
    .run_commands(
        "cd /root && git clone https://github.com/thu-ml/CRM.git",
    )
)


@app.function(
    image=image,
    gpu="A10G",  # Need decent GPU for the diffusion model
    volumes={"/cache": volume},
    timeout=600,
)
def generate_3d_mesh(image_bytes: bytes, filename: str = "input.png") -> dict:
    """
    Generate UV-textured 3D mesh from a single image using CRM.

    Args:
        image_bytes: Input image as bytes (should have gray/transparent background)
        filename: Filename for the input

    Returns dict with:
        - obj_data: bytes of OBJ file with UV coords
        - mtl_data: bytes of MTL material file
        - texture_data: bytes of texture image
        - glb_data: bytes of GLB file (if generated)
        - success: bool
        - message: str
    """
    import subprocess
    from pathlib import Path
    import shutil

    # Setup paths
    crm_dir = Path("/root/CRM")
    input_dir = crm_dir / "examples"
    output_dir = Path("/tmp/crm_output")

    input_dir.mkdir(exist_ok=True)
    output_dir.mkdir(exist_ok=True)

    # Set up HF cache
    hf_cache = Path("/cache/huggingface")
    hf_cache.mkdir(exist_ok=True)
    os.environ["HF_HOME"] = str(hf_cache)
    os.environ["TRANSFORMERS_CACHE"] = str(hf_cache)

    # Save input image
    input_path = input_dir / filename
    input_path.write_bytes(image_bytes)
    print(f"Saved input image to {input_path} ({len(image_bytes)} bytes)")

    # Run CRM
    cmd = [
        "python", "run.py",
        "--inputdir", str(input_path),
    ]

    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(
        cmd,
        cwd=str(crm_dir),
        capture_output=True,
        text=True,
        env={**os.environ, "CUDA_VISIBLE_DEVICES": "0"},
    )

    print("STDOUT:", result.stdout[-5000:] if len(result.stdout) > 5000 else result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr[-2000:] if len(result.stderr) > 2000 else result.stderr)

    # Collect outputs
    outputs = {"success": False, "message": ""}

    # CRM outputs to a directory based on input name
    stem = Path(filename).stem
    result_dir = crm_dir / "results" / stem

    if result_dir.exists():
        for f in result_dir.rglob("*"):
            if f.is_file():
                print(f"Found output: {f}")
                if f.suffix == ".obj":
                    outputs["obj_data"] = f.read_bytes()
                elif f.suffix == ".mtl":
                    outputs["mtl_data"] = f.read_bytes()
                elif f.suffix == ".png" and "texture" in f.name.lower():
                    outputs["texture_data"] = f.read_bytes()
                elif f.suffix == ".glb":
                    outputs["glb_data"] = f.read_bytes()

        if "obj_data" in outputs:
            outputs["success"] = True
            outputs["message"] = f"Generated 3D mesh with UV textures"
    else:
        outputs["message"] = f"Output directory not found: {result_dir}"
        if result.returncode != 0:
            outputs["message"] += f"\nReturn code: {result.returncode}"

    # Commit volume
    volume.commit()

    return outputs


@app.local_entrypoint()
def main(
    input_path: str = None,
    output_dir: str = None,
):
    """
    Generate 3D mesh from an image using CRM.

    Example:
        uv run modal run crm_3d_app.py --input-path ~/face.jpg --output-dir ~/output/
    """
    from pathlib import Path

    if not input_path:
        print("Usage: uv run modal run crm_3d_app.py --input-path IMAGE --output-dir OUTPUT_DIR")
        sys.exit(1)

    input_path = Path(input_path).expanduser()
    if not input_path.exists():
        print(f"Input file not found: {input_path}")
        sys.exit(1)

    output_dir = Path(output_dir or ".").expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Processing: {input_path}")
    print(f"Output to: {output_dir}")

    # Read input image
    image_bytes = input_path.read_bytes()

    # Run generation
    results = generate_3d_mesh.remote(image_bytes, input_path.name)

    if results["success"]:
        stem = input_path.stem
        for key in ["obj_data", "mtl_data", "texture_data", "glb_data"]:
            if key in results and results[key]:
                ext = key.split("_")[0]
                if ext == "texture":
                    ext = "png"
                out_path = output_dir / f"crm_{stem}.{ext}"
                out_path.write_bytes(results[key])
                print(f"Saved: {out_path} ({len(results[key])} bytes)")
        print("Done!")
    else:
        print(f"Failed: {results['message']}")
        sys.exit(1)
