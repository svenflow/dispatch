#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["gradio_client", "httpx", "pillow"]
# ///
"""
Image to 3D via HuggingFace Spaces
Uses Gradio Client to call existing demos instead of running models ourselves.
Avoids all the dependency hell.
"""

import argparse
import base64
import sys
import tempfile
from pathlib import Path

def try_sf3d(image_path: str, output_path: str) -> bool:
    """Try SF3D via HuggingFace Spaces"""
    print("Trying SF3D via HuggingFace...")
    try:
        from gradio_client import Client, handle_file

        client = Client("stabilityai/stable-fast-3d")
        result = client.predict(
            image=handle_file(image_path),
            foreground_ratio=0.85,
            texture_resolution=1024,
            api_name="/run"
        )

        # Result should be a file path
        if result and Path(result).exists():
            import shutil
            shutil.copy(result, output_path)
            print(f"SF3D success! Saved to {output_path}")
            return True
    except Exception as e:
        print(f"SF3D failed: {e}")
    return False


def try_hunyuan3d(image_path: str, output_path: str) -> bool:
    """Try Hunyuan3D-2 via HuggingFace Spaces"""
    print("Trying Hunyuan3D-2 via HuggingFace...")
    try:
        from gradio_client import Client, handle_file

        client = Client("tencent/Hunyuan3D-2")
        # Use /generation_all for shape + texture
        result = client.predict(
            caption=None,  # use image only
            image=handle_file(image_path),
            mv_image_front=None,
            mv_image_back=None,
            mv_image_left=None,
            mv_image_right=None,
            steps=30,
            guidance_scale=5.0,
            seed=1234,
            octree_resolution=256,
            check_box_rembg=True,
            num_chunks=8000,
            randomize_seed=True,
            api_name="/generation_all"
        )

        # Result is (file, file, html, mesh_stats, seed) - first file is the mesh
        if result and len(result) >= 1:
            mesh_file = result[0]
            if mesh_file and Path(mesh_file).exists():
                import shutil
                shutil.copy(mesh_file, output_path)
                print(f"Hunyuan3D success! Saved to {output_path}")
                return True
    except Exception as e:
        print(f"Hunyuan3D failed: {e}")
    return False


def try_unique3d(image_path: str, output_path: str) -> bool:
    """Try Unique3D via HuggingFace Spaces"""
    print("Trying Unique3D via HuggingFace...")
    try:
        from gradio_client import Client, handle_file

        client = Client("Wuvin/Unique3D")
        result = client.predict(
            image=handle_file(image_path),
            api_name="/predict"
        )

        # Result should be a file path
        if result and Path(result).exists():
            import shutil
            shutil.copy(result, output_path)
            print(f"Unique3D success! Saved to {output_path}")
            return True
    except Exception as e:
        print(f"Unique3D failed: {e}")
    return False


def try_trellis(image_path: str, output_path: str) -> bool:
    """Try TRELLIS via HuggingFace Spaces"""
    print("Trying TRELLIS via HuggingFace...")
    try:
        from gradio_client import Client, handle_file

        client = Client("microsoft/TRELLIS")

        # Step 1: Generate 3D asset from image
        print("  Generating 3D asset...")
        result = client.predict(
            image=handle_file(image_path),
            multiimages=[],  # single image mode
            seed=42,
            ss_guidance_strength=7.5,
            ss_sampling_steps=12,
            slat_guidance_strength=3.0,
            slat_sampling_steps=12,
            multiimage_algo="stochastic",
            api_name="/image_to_3d"
        )
        print(f"  Generation result: {result}")

        # Step 2: Extract GLB
        print("  Extracting GLB...")
        glb_result = client.predict(
            mesh_simplify=0.95,
            texture_size=1024,
            api_name="/extract_glb"
        )

        # Result is (model_path, download_path)
        if glb_result and len(glb_result) >= 2:
            glb_file = glb_result[1]  # download button path
            if glb_file and Path(glb_file).exists():
                import shutil
                shutil.copy(glb_file, output_path)
                print(f"TRELLIS success! Saved to {output_path}")
                return True
    except Exception as e:
        print(f"TRELLIS failed: {e}")
        import traceback
        traceback.print_exc()
    return False


def main():
    parser = argparse.ArgumentParser(description="Image to 3D via HuggingFace Spaces")
    parser.add_argument("--input", "-i", required=True, help="Input image path")
    parser.add_argument("--output", "-o", help="Output GLB path (default: input.glb)")
    parser.add_argument("--model", "-m", choices=["sf3d", "hunyuan3d", "unique3d", "trellis", "all"],
                        default="all", help="Which model to use")

    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}")
        sys.exit(1)

    output_base = args.output or str(input_path.with_suffix(""))

    if args.model == "all":
        models = ["sf3d", "hunyuan3d", "unique3d", "trellis"]
    else:
        models = [args.model]

    results = {}

    for model in models:
        output_path = f"{output_base}_{model}.glb"

        if model == "sf3d":
            results[model] = try_sf3d(str(input_path), output_path)
        elif model == "hunyuan3d":
            results[model] = try_hunyuan3d(str(input_path), output_path)
        elif model == "unique3d":
            results[model] = try_unique3d(str(input_path), output_path)
        elif model == "trellis":
            results[model] = try_trellis(str(input_path), output_path)

    print("\n=== Results ===")
    for model, success in results.items():
        status = "✅ Success" if success else "❌ Failed"
        print(f"{model}: {status}")


if __name__ == "__main__":
    main()
