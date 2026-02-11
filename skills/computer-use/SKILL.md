---
name: computer-use
description: Parse screenshots and interact with UI elements. Use for screen automation on macOS, Chrome, or iOS Simulator. Trigger words - parse screen, click element, annotate image, computer use.
---

# Computer Use Skill

Parse screenshots into structured UI elements and interact with them. Works with macOS native apps, Chrome browser, and iOS Simulator.

## Prerequisites

This skill requires OmniParser to be installed locally:

### 1. Clone OmniParser

```bash
git clone https://github.com/microsoft/OmniParser.git ~/code/OmniParser
```

### 2. Download Model Weights (~2GB)

```bash
# Install huggingface CLI if needed
uv pip install huggingface_hub

# Download weights
cd ~/code/OmniParser
for f in icon_detect/{train_args.yaml,model.pt,model.yaml} icon_caption/{config.json,generation_config.json,model.safetensors}; do
  huggingface-cli download microsoft/OmniParser-v2.0 "$f" --local-dir weights
done
mv weights/icon_caption weights/icon_caption_florence
```

### 3. Verify Setup

```bash
ls ~/code/OmniParser/weights/
# Should show: icon_caption_florence  icon_detect
```

**Note:** The server uses ~2GB RAM when running. It auto-shuts down after 10 minutes idle.

---

## parse-image CLI

The core tool for screen parsing. Uses OmniParser (YOLOv8 + Florence-2) to detect text and icons.

### Basic Usage

```bash
# Parse a screenshot (text output)
~/.claude/skills/computer-use/scripts/parse-image screenshot.png

# JSON output with full element data
~/.claude/skills/computer-use/scripts/parse-image screenshot.png --json

# Save annotated image with numbered boxes
~/.claude/skills/computer-use/scripts/parse-image screenshot.png --output annotated.png

# Both JSON and annotated image
~/.claude/skills/computer-use/scripts/parse-image screenshot.png --json --output annotated.png
```

### Performance

- **First call:** ~12s (server boot + model load + inference)
- **Subsequent calls:** ~3-4s (inference only, models warm)
- **Server auto-shutdown:** 10 minutes idle

### CLI Options

```
parse-image <image> [options]

Arguments:
  image              Path to screenshot (PNG, JPG)

Options:
  --json             Output structured JSON
  --output, -o PATH  Save annotated image
  --no-caption       Skip icon captioning (faster, ~1s)
  --verbose, -v      Show detailed progress
  --status           Check if server is running
  --stop             Stop the background server
```

### Output Formats

**Text (default):**
```
Text Box 0: Settings
  bbox: [0.120, 0.050, 0.080, 0.020]
  center_pixels: [192, 65]
Icon Box 15: A gear icon
  bbox: [0.450, 0.050, 0.030, 0.030]
  center_pixels: [540, 108]

Total elements: 47
Inference time: 3420ms
```

**JSON (--json):**
```json
{
  "elements": [
    {
      "id": 0,
      "type": "text",
      "content": "Settings",
      "bbox": [0.12, 0.05, 0.08, 0.02],
      "bbox_pixels": [144, 54, 96, 22],
      "center": [0.16, 0.06],
      "center_pixels": [192, 65],
      "clickable": false
    },
    {
      "id": 15,
      "type": "icon",
      "content": "A gear icon",
      "bbox": [0.45, 0.05, 0.03, 0.03],
      "bbox_pixels": [540, 54, 36, 32],
      "center": [0.465, 0.066],
      "center_pixels": [558, 71],
      "clickable": true
    }
  ],
  "annotated_image": "base64...",
  "source_image": {"width": 1200, "height": 800},
  "model": "omniparse",
  "inference_time_ms": 3420,
  "element_count": 47
}
```

### Coordinate System

- **Origin:** Top-left corner (0, 0)
- **bbox:** `[x, y, width, height]` as ratios (0.0-1.0)
- **bbox_pixels:** Same in absolute pixels
- **center_pixels:** Ready to use with click tools

---

## macOS Native Apps

For automating Finder, System Settings, or any native macOS app.

### Workflow

```bash
# 1. Take screenshot
screencapture -x /tmp/screen.png

# 2. Parse and save annotated image
~/.claude/skills/computer-use/scripts/parse-image /tmp/screen.png --json --output /tmp/annotated.png > /tmp/elements.json

# 3. Find target element (example: find "Settings")
jq '.elements[] | select(.content | test("Settings"; "i"))' /tmp/elements.json

# 4. Click using center_pixels (Retina: divide by 2)
# If screen is Retina (3840x2160 logical = 1920x1080 physical):
# center_pixels [558, 71] → cliclick coords [279, 35]
cliclick c:279,35

# 5. Verify by taking another screenshot
screencapture -x /tmp/screen2.png
```

### Retina Display Handling

macOS Retina displays have 2x scaling. Screenshots are full resolution but cliclick uses logical coordinates.

```bash
# Get screen info
system_profiler SPDisplaysDataType | grep Resolution

# For Retina: divide center_pixels by 2
# center_pixels: [558, 71] → cliclick: c:279,35
```

### Screenshot Options

```bash
# Full screen (no sound)
screencapture -x /tmp/screen.png

# Specific region (x,y,w,h in logical pixels)
screencapture -x -R0,0,800,600 /tmp/region.png

# Specific window (by window ID)
screencapture -x -l$(osascript -e 'tell app "Finder" to id of window 1') /tmp/finder.png

# Interactive window selection
screencapture -x -w /tmp/window.png
```

---

## Chrome Browser

For automating web pages in Chrome.

### Workflow

```bash
# 1. Take Chrome screenshot
~/.claude/skills/chrome-control/scripts/chrome screenshot /tmp/chrome.png

# 2. Parse
~/.claude/skills/computer-use/scripts/parse-image /tmp/chrome.png --json > /tmp/elements.json

# 3. Find element
jq '.elements[] | select(.content | test("Submit"; "i"))' /tmp/elements.json

# 4. Click using Chrome extension (not cliclick!)
# Chrome click uses viewport coordinates (no Retina adjustment needed)
~/.claude/skills/chrome-control/scripts/chrome click 558 71
```

### Important: Use Chrome Extension for Clicks

**Never use cliclick for Chrome.** The Chrome extension handles:
- Correct coordinate mapping
- Shadow DOM elements
- iframes
- Viewport scrolling

```bash
# CORRECT - use chrome CLI
~/.claude/skills/chrome-control/scripts/chrome click 558 71

# WRONG - don't use cliclick for Chrome
cliclick c:279,35  # Will click wrong location
```

---

## iOS Simulator

For automating iOS apps in Simulator.

### Workflow

```bash
# 1. Take Simulator screenshot
xcrun simctl io booted screenshot /tmp/sim.png

# 2. Parse
~/.claude/skills/computer-use/scripts/parse-image /tmp/sim.png --json > /tmp/elements.json

# 3. Find element
jq '.elements[] | select(.content | test("Continue"; "i"))' /tmp/elements.json

# 4. Tap using simctl
# Simulator uses points, not pixels. Divide by device scale factor.
# iPhone 15 Pro: 3x scale, so pixels / 3
# center_pixels: [558, 1200] → tap: [186, 400]
xcrun simctl io booted tap 186 400
```

### Device Scale Factors

| Device | Scale | Conversion |
|--------|-------|------------|
| iPhone SE | 2x | pixels / 2 |
| iPhone 15 | 3x | pixels / 3 |
| iPhone 15 Pro Max | 3x | pixels / 3 |
| iPad | 2x | pixels / 2 |

### Simulator Commands

```bash
# List booted simulators
xcrun simctl list devices booted

# Screenshot specific device
xcrun simctl io "iPhone 15 Pro" screenshot /tmp/sim.png

# Tap at coordinates (in points)
xcrun simctl io booted tap 186 400

# Type text
xcrun simctl io booted input text "Hello"

# Press button
xcrun simctl io booted press home
```

---

## Server Management

The parse-image CLI manages a background server automatically. Manual control:

```bash
# Check server status
~/.claude/skills/computer-use/scripts/parse-image --status

# Stop server (reclaim ~2GB RAM)
~/.claude/skills/computer-use/scripts/parse-image --stop

# View server logs
tail -f /tmp/omniparser-server.log
```

### Server Details

- **Port:** 8765 (localhost only)
- **Auto-shutdown:** 10 minutes idle
- **PID file:** /tmp/omniparser-server.pid
- **Log file:** /tmp/omniparser-server.log
- **Memory:** ~2GB (YOLO + Florence-2 models)

---

## Tips

### Finding Elements

```bash
# Search by exact text
jq '.elements[] | select(.content == "Settings")' /tmp/elements.json

# Search by partial text (case-insensitive)
jq '.elements[] | select(.content | test("sett"; "i"))' /tmp/elements.json

# Get only clickable elements
jq '.elements[] | select(.clickable == true)' /tmp/elements.json

# Get elements near a region (center_x between 0.4-0.6)
jq '.elements[] | select(.center[0] > 0.4 and .center[0] < 0.6)' /tmp/elements.json
```

### Debugging

```bash
# Verbose mode shows timing
~/.claude/skills/computer-use/scripts/parse-image /tmp/screen.png -v

# Save annotated image to see what was detected
~/.claude/skills/computer-use/scripts/parse-image /tmp/screen.png --output /tmp/debug.png
open /tmp/debug.png
```

### Performance Optimization

```bash
# Skip captioning for faster results (~1s vs ~4s)
# Icons will be labeled "icon_0", "icon_1", etc.
~/.claude/skills/computer-use/scripts/parse-image /tmp/screen.png --no-caption
```
