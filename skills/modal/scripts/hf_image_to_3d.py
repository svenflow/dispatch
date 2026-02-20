#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["gradio_client", "Pillow"]
# ///
"""
Use HuggingFace Spaces for image-to-3D conversion via Gradio API.
Supports: InstantMesh, Stable Fast 3D, TRELLIS
"""

import sys
from pathlib import Path
from gradio_client import Client, handle_file


def run_instantmesh(input_path: Path, output_dir: Path) -> Path:
    """Run InstantMesh via HF Space API"""
    print("Connecting to InstantMesh space...")
    client = Client("TencentARC/InstantMesh")

    print(f"Uploading {input_path}...")
    # InstantMesh API: preprocess -> generate multiview -> make 3D

    # Step 1: Check foreground
    result = client.predict(
        input_image=handle_file(str(input_path)),
        do_remove_background=True,
        api_name="/check_input_image"
    )
    print(f"Preprocessed image saved")

    # Step 2: Generate multiview images
    result = client.predict(
        api_name="/generate_mvs"
    )
    print(f"Multiview generated")

    # Step 3: Generate 3D mesh
    result = client.predict(
        api_name="/make3d"
    )
    print(f"3D mesh generated: {result}")

    # Save output
    if result:
        output_path = output_dir / "instantmesh_output.glb"
        # Result should be path to GLB file
        import shutil
        shutil.copy(result, output_path)
        return output_path
    return None


def run_stable_fast_3d(input_path: Path, output_dir: Path) -> Path:
    """Run Stable Fast 3D via HF Space API"""
    print("Connecting to Stable Fast 3D space...")
    client = Client("stabilityai/stable-fast-3d")

    print(f"Uploading {input_path}...")
    result = client.predict(
        input_image=handle_file(str(input_path)),
        foreground_ratio=0.85,
        texture_resolution=1024,
        remesh_option="None",
        api_name="/run"
    )
    print(f"Result: {result}")

    if result:
        output_path = output_dir / "sf3d_output.glb"
        import shutil
        shutil.copy(result, output_path)
        return output_path
    return None


def run_trellis(input_path: Path, output_dir: Path) -> Path:
    """Run TRELLIS via HF Space API"""
    print("Connecting to TRELLIS space...")
    client = Client("trellis-community/TRELLIS")

    print(f"Uploading {input_path}...")
    # TRELLIS API: generate_and_extract_glb
    result = client.predict(
        image=handle_file(str(input_path)),
        multiimages=[],
        seed=42,
        ss_guidance_strength=7.5,
        ss_sampling_steps=12,
        slat_guidance_strength=3.0,
        slat_sampling_steps=12,
        multiimage_algo="stochastic",
        mesh_simplify=0.95,
        texture_size=1024,
        api_name="/generate_and_extract_glb"
    )
    print(f"Result: {result}")

    # Result is tuple: (generated_3d_asset, extracted_glb, download_glb)
    if result and len(result) >= 3:
        glb_path = result[2]  # download_glb is the path
        if glb_path:
            output_path = output_dir / "trellis_output.glb"
            import shutil
            shutil.copy(glb_path, output_path)
            return output_path
    return None


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Run HuggingFace image-to-3D spaces")
    parser.add_argument("--input", "-i", required=True, help="Input image path")
    parser.add_argument("--output-dir", "-o", default=".", help="Output directory")
    parser.add_argument("--model", "-m", default="sf3d",
                       choices=["instantmesh", "sf3d", "trellis"],
                       help="Model to use")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser()
    output_dir = Path(args.output_dir).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}")
        sys.exit(1)

    print(f"Processing: {input_path}")
    print(f"Model: {args.model}")
    print(f"Output dir: {output_dir}")

    if args.model == "instantmesh":
        result = run_instantmesh(input_path, output_dir)
    elif args.model == "sf3d":
        result = run_stable_fast_3d(input_path, output_dir)
    elif args.model == "trellis":
        result = run_trellis(input_path, output_dir)
    else:
        print(f"Unknown model: {args.model}")
        sys.exit(1)

    if result:
        print(f"Success! Output saved to: {result}")
    else:
        print("Failed to generate 3D model")
        sys.exit(1)


if __name__ == "__main__":
    main()
