---
name: vision
description: Computer vision tools - segmentation, depth estimation, edge detection. Trigger words - segment, depth, vision, cutout, mask, layer separation.
---

# Vision Skill

Computer vision tools for image segmentation, depth estimation, and creative effects. All tools run locally on Mac with Metal acceleration.

## Available Tools

### 1. Apple Vision Person Segmentation (Recommended for people)
```bash
~/.claude/skills/vision/scripts/segment-person input.jpg output_prefix
```
- Uses Apple's VNGeneratePersonSegmentationRequest
- Runs on Neural Engine, very fast
- Best quality for person segmentation
- Outputs: `_mask.png`, `_overlay.png`, `_cutout.png`

### 2. YOLO Segmentation (Object-aware)
```bash
~/.claude/skills/vision/scripts/segment-yolo input.jpg output_prefix
```
- Uses YOLOv8-seg model
- Detects and segments objects with labels (person, cup, car, etc.)
- Good for understanding scene contents
- Outputs: `_mask.png`, `_overlay.png`

### 3. FastSAM (Segment Everything)
```bash
~/.claude/skills/vision/scripts/segment-fastsam input.jpg output_prefix
```
- Segment Anything Model (fast version)
- Segments ALL objects/regions in image
- No semantic labels, just boundaries
- Good for creative effects
- Outputs: `_mask.png`, `_overlay.png`

### 4. Depth Estimation
```bash
~/.claude/skills/vision/scripts/estimate-depth input.jpg output_prefix
```
- Uses DPT (MiDaS-based) model
- Monocular depth estimation
- Brighter = closer
- Outputs: `_depth_gray.png`, `_depth_color.png`

## Comparison

| Tool | Speed | Use Case |
|------|-------|----------|
| Apple Vision | Fastest | People only, production quality |
| YOLO-seg | Fast | Object detection + segmentation |
| FastSAM | Medium | Everything, creative effects |
| DPT Depth | Medium | 3D effects, parallax, blur |

## Creative Applications

### Depth-aware blur (fake bokeh)
1. Run depth estimation
2. Use depth map as blur radius
3. Background gets more blur than foreground

### Layer separation for compositing
1. Run Apple Vision for person cutout
2. Composite person onto new background
3. Add shadows/effects between layers

### Per-object color grading
1. Run YOLO segmentation
2. Get masks for specific objects
3. Apply different color grades to each

### Parallax/3D effect
1. Run depth estimation
2. Separate into depth layers
3. Move layers at different speeds

### Depth-based style blend (NEW)
Blend between original and stylized versions using depth:
```bash
~/.claude/skills/vision/scripts/depth-blend original.jpg stylized.png depth.png output.mp4
~/.claude/skills/vision/scripts/depth-blend a.jpg b.jpg depth.png out.mp4 --style dissolve
```
- Near objects (bright in depth map) transition first
- Background transitions last
- Styles: `wipe` (smooth) or `dissolve` (sparkly/organic)
- Options: `--duration 6` `--fps 30`

## Implementation Notes

### Apple Vision (Swift)
- Requires macOS, uses Vision.framework
- VNGeneratePersonSegmentationRequest with `.accurate` quality
- Outputs 8-bit grayscale mask
- Scales to match input image size

### YOLO/FastSAM (Python + Ultralytics)
- Uses `ultralytics` package
- Models auto-download on first use
- MPS (Metal) acceleration when available
- YOLOv8n-seg (~7MB), FastSAM-s (~23MB)

### Depth (Python + Transformers)
- Uses Intel DPT-Large model via HuggingFace
- Downloads ~1.3GB model on first use
- MPS acceleration supported

## File Requirements

Input images should be:
- JPEG, PNG, or HEIC format
- Reasonable size (800-2000px recommended)
- For HEIC, convert first: `sips -s format jpeg input.heic --out input.jpg`
