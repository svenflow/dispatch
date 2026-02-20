#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = [
#     "flask>=3.0",
#     "torch>=2.0",
#     "transformers>=4.40,<4.49",
#     "ultralytics>=8.0",
#     "easyocr>=1.7",
#     "paddleocr>=2.7",
#     "supervision>=0.19",
#     "opencv-python>=4.9",
#     "pillow>=10.0",
#     "openai>=1.0",
#     "timm>=0.9",
#     "einops>=0.7",
# ]
# ///
"""
OmniParser Server - Long-running server for screen parsing.

Loads models once at startup, serves parse requests via HTTP.
Auto-shuts down after idle timeout to reclaim memory.
"""

import argparse
import base64
import io
import json
import os
import signal
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request

# Add OmniParser to path
OMNIPARSER_PATH = Path.home() / "code" / "OmniParser"
sys.path.insert(0, str(OMNIPARSER_PATH))

app = Flask(__name__)

# Global state
server_state = {
    "status": "loading",
    "start_time": None,
    "last_request": None,
    "requests_served": 0,
    "model": None,
    "caption_model_processor": None,
}

# Config
IDLE_TIMEOUT = 43200  # 12 hours default
idle_timer = None
idle_lock = threading.Lock()


def reset_idle_timer():
    """Reset the idle shutdown timer."""
    global idle_timer
    with idle_lock:
        if idle_timer:
            idle_timer.cancel()
        if IDLE_TIMEOUT > 0:
            idle_timer = threading.Timer(IDLE_TIMEOUT, shutdown_server)
            idle_timer.daemon = True
            idle_timer.start()


def shutdown_server():
    """Graceful shutdown."""
    print(f"[{datetime.now().isoformat()}] Idle timeout reached, shutting down...")
    os.kill(os.getpid(), signal.SIGTERM)


def load_models():
    """Load OmniParser models."""
    global server_state

    print(f"[{datetime.now().isoformat()}] Loading models...")
    start = time.time()

    try:
        from util.utils import get_caption_model_processor, get_yolo_model
        import torch

        # Determine device
        if torch.cuda.is_available():
            device = "cuda"
        elif torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"

        print(f"[{datetime.now().isoformat()}] Using device: {device}")

        # Load YOLO model
        yolo_path = OMNIPARSER_PATH / "weights" / "icon_detect" / "model.pt"
        print(f"[{datetime.now().isoformat()}] Loading YOLO from {yolo_path}...")
        yolo_model = get_yolo_model(str(yolo_path))

        # Load Florence-2 caption model
        caption_path = OMNIPARSER_PATH / "weights" / "icon_caption_florence"
        print(f"[{datetime.now().isoformat()}] Loading Florence-2 from {caption_path}...")
        caption_model_processor = get_caption_model_processor(
            model_name="florence2",
            model_name_or_path=str(caption_path),
            device=device
        )

        server_state["model"] = yolo_model
        server_state["caption_model_processor"] = caption_model_processor
        server_state["device"] = device

        load_time = time.time() - start
        print(f"[{datetime.now().isoformat()}] Models loaded in {load_time:.2f}s")

        # Warm-up inference
        print(f"[{datetime.now().isoformat()}] Running warm-up inference...")
        warmup_start = time.time()
        # Create a small test image
        from PIL import Image
        import numpy as np
        test_img = Image.fromarray(np.zeros((100, 100, 3), dtype=np.uint8))
        # Run detection only (fast)
        yolo_model.predict(source=test_img, conf=0.01, verbose=False)
        warmup_time = time.time() - warmup_start
        print(f"[{datetime.now().isoformat()}] Warm-up complete in {warmup_time:.2f}s")

        server_state["status"] = "ready"
        server_state["start_time"] = datetime.now().isoformat()

    except Exception as e:
        print(f"[{datetime.now().isoformat()}] Error loading models: {e}")
        server_state["status"] = "error"
        server_state["error"] = str(e)
        raise


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    reset_idle_timer()
    return jsonify({
        "status": server_state["status"],
        "start_time": server_state["start_time"],
        "requests_served": server_state["requests_served"],
        "last_request": server_state["last_request"],
        "device": server_state.get("device", "unknown"),
    })


@app.route("/parse", methods=["POST"])
def parse():
    """Parse an image and return elements."""
    if server_state["status"] != "ready":
        return jsonify({"error": f"Server not ready: {server_state['status']}"}), 503

    reset_idle_timer()
    start_time = time.time()

    try:
        # Get image from request
        if "image" not in request.files:
            # Try base64 in JSON body
            data = request.get_json()
            if data and "image_base64" in data:
                image_data = base64.b64decode(data["image_base64"])
            else:
                return jsonify({"error": "No image provided"}), 400
        else:
            image_data = request.files["image"].read()

        # Parse options
        options = {}
        if request.content_type == "application/json":
            options = request.get_json() or {}
        else:
            options = {
                "no_caption": request.form.get("no_caption", "false").lower() == "true",
                "confidence": float(request.form.get("confidence", 0.0)),
            }

        no_caption = options.get("no_caption", False)
        min_confidence = options.get("confidence", 0.0)

        # Load image
        from PIL import Image
        image = Image.open(io.BytesIO(image_data)).convert("RGB")
        width, height = image.size

        # Import parsing utilities
        from util.utils import check_ocr_box, get_som_labeled_img

        # Run OCR
        ocr_start = time.time()
        (text, ocr_bbox), _ = check_ocr_box(
            image,
            display_img=False,
            output_bb_format='xyxy',
            easyocr_args={'text_threshold': 0.8},
            use_paddleocr=False
        )
        ocr_time = time.time() - ocr_start

        # Configure drawing
        box_overlay_ratio = max(image.size) / 3200
        draw_bbox_config = {
            'text_scale': 0.8 * box_overlay_ratio,
            'text_thickness': max(int(2 * box_overlay_ratio), 1),
            'text_padding': max(int(3 * box_overlay_ratio), 1),
            'thickness': max(int(3 * box_overlay_ratio), 1),
        }

        # Run detection + captioning
        inference_start = time.time()
        encoded_image, label_coordinates, parsed_content_list = get_som_labeled_img(
            image,
            server_state["model"],
            BOX_TRESHOLD=0.01,
            output_coord_in_ratio=True,
            ocr_bbox=ocr_bbox,
            draw_bbox_config=draw_bbox_config,
            caption_model_processor=None if no_caption else server_state["caption_model_processor"],
            ocr_text=text,
            use_local_semantics=not no_caption,
            iou_threshold=0.7,
            scale_img=False,
            batch_size=128
        )
        inference_time = time.time() - inference_start

        # Build structured output
        elements = []
        for i, elem in enumerate(parsed_content_list):
            bbox = elem["bbox"]  # [x1, y1, x2, y2] as ratios
            # Convert to [x, y, w, h] format
            x, y = bbox[0], bbox[1]
            w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]

            # Calculate center
            center_x = x + w / 2
            center_y = y + h / 2

            # Pixel versions
            bbox_pixels = [
                int(x * width),
                int(y * height),
                int(w * width),
                int(h * height)
            ]
            center_pixels = [
                int(center_x * width),
                int(center_y * height)
            ]

            elements.append({
                "id": i,
                "type": elem["type"],
                "content": elem["content"],
                "bbox": [round(x, 4), round(y, 4), round(w, 4), round(h, 4)],
                "bbox_pixels": bbox_pixels,
                "center": [round(center_x, 4), round(center_y, 4)],
                "center_pixels": center_pixels,
                "clickable": elem.get("interactivity", elem["type"] == "icon"),
            })

        # Filter by confidence if requested (not yet implemented in OmniParser output)
        # elements = [e for e in elements if e.get("confidence", 1.0) >= min_confidence]

        total_time = time.time() - start_time

        # Update state
        server_state["requests_served"] += 1
        server_state["last_request"] = datetime.now().isoformat()

        return jsonify({
            "elements": elements,
            "annotated_image": encoded_image,
            "source_image": {
                "width": width,
                "height": height,
            },
            "model": "omniparse",
            "inference_time_ms": int(inference_time * 1000),
            "ocr_time_ms": int(ocr_time * 1000),
            "total_time_ms": int(total_time * 1000),
            "element_count": len(elements),
            "timestamp": datetime.now().isoformat(),
        })

    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc(),
        }), 500


@app.route("/shutdown", methods=["POST"])
def shutdown():
    """Graceful shutdown endpoint."""
    print(f"[{datetime.now().isoformat()}] Shutdown requested via API")
    # Schedule shutdown after response
    threading.Timer(0.5, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()
    return jsonify({"status": "shutting_down"})


def main():
    parser = argparse.ArgumentParser(description="OmniParser Server")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--idle-timeout", type=int, default=600, help="Idle timeout in seconds (0 to disable)")
    parser.add_argument("--pid-file", default="/tmp/omniparser-server.pid", help="PID file path")
    args = parser.parse_args()

    global IDLE_TIMEOUT
    IDLE_TIMEOUT = args.idle_timeout

    # Write PID file
    with open(args.pid_file, "w") as f:
        f.write(str(os.getpid()))

    # Clean up PID file on exit
    def cleanup(signum, frame):
        print(f"[{datetime.now().isoformat()}] Received signal {signum}, cleaning up...")
        try:
            os.remove(args.pid_file)
        except:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    # Load models
    load_models()

    # Start idle timer
    reset_idle_timer()

    print(f"[{datetime.now().isoformat()}] Server starting on {args.host}:{args.port}")
    print(f"[{datetime.now().isoformat()}] Idle timeout: {IDLE_TIMEOUT}s")

    # Run server
    app.run(host=args.host, port=args.port, threaded=False)


if __name__ == "__main__":
    main()
