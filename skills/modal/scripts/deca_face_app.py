#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["modal"]
# ///
"""
DECA Face Reconstruction on Modal
Extracts 3D face mesh with UV-mapped texture from a single image.
Uses DECA (SIGGRAPH 2021) for detailed face reconstruction.
"""

import modal
import os
import sys

app = modal.App("deca-face-reconstruction")

# Volume for caching DECA model weights
volume = modal.Volume.from_name("deca-models", create_if_missing=True)

# Build image with DECA dependencies
image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install(
        "git",
        "wget",
        "unzip",
        "libgl1-mesa-glx",
        "libglib2.0-0",
        "libsm6",
        "libxext6",
        "libxrender-dev",
        "libgomp1",
        "build-essential",
    )
    .pip_install(
        "torch==2.1.0",
        "torchvision==0.16.0",
        "numpy<2",
        "scipy",
        "cython",
        "scikit-image",
        "opencv-python-headless",
        "PyYAML",
        "face-alignment",
        "yacs",
        "kornia",
        "ninja",
        "fvcore",
        "iopath",
    )
    # Install pytorch3d from source (compiled for the specific torch version)
    .run_commands(
        "pip install 'git+https://github.com/facebookresearch/pytorch3d.git@stable'"
    )
    # Clone DECA
    .run_commands(
        "cd /root && git clone https://github.com/yfeng95/DECA.git",
        "cd /root/DECA && pip install -r requirements.txt || true",  # Some deps may already be installed
    )
)


@app.function(
    image=image,
    gpu="A10G",  # Need GPU for face reconstruction
    volumes={"/cache": volume},
    timeout=600,
)
def reconstruct_face(image_bytes: bytes, filename: str = "input.jpg") -> dict:
    """
    Reconstruct 3D face from image and return textured mesh.

    Returns dict with:
    - obj_data: bytes of OBJ file
    - mtl_data: bytes of MTL file (material)
    - texture_data: bytes of texture image
    - detail_obj: bytes of detailed OBJ (if available)
    """
    import subprocess
    import shutil
    from pathlib import Path

    # Setup paths
    deca_dir = Path("/root/DECA")
    input_dir = Path("/tmp/deca_input")
    output_dir = Path("/tmp/deca_output")
    model_dir = Path("/cache/deca_models")

    input_dir.mkdir(exist_ok=True)
    output_dir.mkdir(exist_ok=True)
    model_dir.mkdir(exist_ok=True)

    # Save input image
    input_path = input_dir / filename
    input_path.write_bytes(image_bytes)
    print(f"Saved input image to {input_path}")

    # Check if models are downloaded
    deca_model_path = deca_dir / "data" / "deca_model.tar"
    if not deca_model_path.exists():
        print("Downloading DECA models...")
        # Models need to be downloaded from official source
        # They require agreeing to license terms
        # For now, we'll try to use the auto-download feature
        pass

    # Link cache to DECA data directory if models exist in cache
    cache_model = model_dir / "deca_model.tar"
    if cache_model.exists() and not deca_model_path.exists():
        deca_model_path.parent.mkdir(exist_ok=True)
        shutil.copy(cache_model, deca_model_path)
        print("Copied cached models")

    # Run DECA reconstruction
    cmd = [
        "python", "demos/demo_reconstruct.py",
        "-i", str(input_dir),
        "-s", str(output_dir),
        "--saveObj", "True",
        "--useTex", "True",
        "--saveDepth", "True",
    ]

    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(
        cmd,
        cwd=str(deca_dir),
        capture_output=True,
        text=True,
    )

    print("STDOUT:", result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr)

    if result.returncode != 0:
        raise RuntimeError(f"DECA failed: {result.stderr}")

    # Collect outputs
    outputs = {}

    # Find output files
    input_stem = Path(filename).stem
    for f in output_dir.rglob("*"):
        if f.is_file():
            print(f"Found output: {f}")
            rel_name = f.name
            if rel_name.endswith(".obj"):
                if "detail" in rel_name:
                    outputs["detail_obj"] = f.read_bytes()
                else:
                    outputs["obj_data"] = f.read_bytes()
            elif rel_name.endswith(".mtl"):
                outputs["mtl_data"] = f.read_bytes()
            elif rel_name.endswith(".png") and "tex" in rel_name.lower():
                outputs["texture_data"] = f.read_bytes()
            elif rel_name.endswith(".png"):
                outputs[f"image_{rel_name}"] = f.read_bytes()

    # Cache models for next time
    if deca_model_path.exists() and not cache_model.exists():
        shutil.copy(deca_model_path, cache_model)
        volume.commit()
        print("Cached DECA models")

    return outputs


@app.local_entrypoint()
def main(
    input_path: str = None,
    output_dir: str = None,
):
    """
    Run DECA face reconstruction on an image.

    Example:
        uv run modal run deca_face_app.py --input-path ~/face.jpg --output-dir ~/output/
    """
    from pathlib import Path

    if not input_path:
        print("Usage: uv run modal run deca_face_app.py --input-path IMAGE --output-dir OUTPUT_DIR")
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

    # Run reconstruction
    results = reconstruct_face.remote(image_bytes, input_path.name)

    # Save outputs
    for key, data in results.items():
        if isinstance(data, bytes):
            ext = "obj" if "obj" in key else "mtl" if "mtl" in key else "png"
            out_path = output_dir / f"deca_{key}.{ext}"
            out_path.write_bytes(data)
            print(f"Saved: {out_path} ({len(data)} bytes)")

    print("Done!")
