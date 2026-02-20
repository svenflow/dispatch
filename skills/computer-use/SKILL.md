---
name: computer-use
description: Analyze and interact with screen UI via vision and accessibility APIs. Use for clicking buttons, finding elements, reading text on screen, and automating macOS, Chrome, or iOS Simulator. Trigger words - see screen, look at screen, what do you see, what's on screen, read screen, find button, click button, tap element, locate element, screen automation, computer use, vision, OCR, screenshot, control computer, interact with UI, mouse click, navigate app.
---

# Computer Use Skill

Analyze screens and interact with UI elements. Works with macOS native apps, Chrome browser, and iOS Simulator.

## Prerequisites

Requires OmniParser for vision-based parsing:

```bash
# Clone OmniParser
git clone https://github.com/microsoft/OmniParser.git ~/code/OmniParser

# Download weights (~2GB)
cd ~/code/OmniParser
uv pip install huggingface_hub
for f in icon_detect/{train_args.yaml,model.pt,model.yaml} icon_caption/{config.json,generation_config.json,model.safetensors}; do
  huggingface-cli download microsoft/OmniParser-v2.0 "$f" --local-dir weights
done
mv weights/icon_caption weights/icon_caption_florence
```

Also install Peekaboo for native macOS accessibility:
```bash
brew install steipete/tap/peekaboo
```

---

## see CLI

The unified tool for screen analysis and interaction.

### Analyze Screen

```bash
# Live screen capture (runs both Peekaboo + OmniParser in parallel)
~/.claude/skills/computer-use/scripts/see

# Analyze specific app
~/.claude/skills/computer-use/scripts/see --app Chrome

# Analyze existing image file (OmniParser only)
~/.claude/skills/computer-use/scripts/see --image /path/to/screenshot.png

# JSON output
~/.claude/skills/computer-use/scripts/see --json

# Verbose mode (shows timing)
~/.claude/skills/computer-use/scripts/see -v
```

### Click Elements

```bash
# Click Peekaboo element by ID
~/.claude/skills/computer-use/scripts/see click p_elem_42

# Click at specific coordinates
~/.claude/skills/computer-use/scripts/see click --coords 500,300
```

### Two Engines

| Engine | Prefix | Speed | Best For |
|--------|--------|-------|----------|
| **Peekaboo** | `p_*` | ~1s | Native macOS apps (uses Accessibility API) |
| **OmniParser** | `o_*` | ~4s warm, ~14s cold | Web content, custom UI, images |

When analyzing live screens, both run in parallel. When using `--image`, only OmniParser runs.

### Output Format

```json
{
  "peekaboo": {
    "elements": [
      {"id": "p_elem_42", "label": "Settings", "role": "button", "is_actionable": true}
    ],
    "element_count": 450,
    "elapsed_ms": 1200
  },
  "omniparser": {
    "elements": [
      {"id": "o_15", "content": "A gear icon", "type": "icon", "center_pixels": [558, 71], "clickable": true}
    ],
    "element_count": 196,
    "elapsed_ms": 4200
  }
}
```

---

## Platform-Specific Workflows

### macOS Native Apps

```bash
# 1. Analyze screen
~/.claude/skills/computer-use/scripts/see --json > /tmp/screen.json

# 2. Click Peekaboo element (preferred for native apps)
~/.claude/skills/computer-use/scripts/see click p_elem_42

# Or click by coordinates (Retina: divide OmniParser pixels by 2)
~/.claude/skills/computer-use/scripts/see click --coords 279,35
```

### Chrome Browser

```bash
# 1. Analyze
~/.claude/skills/computer-use/scripts/see --app Chrome --json > /tmp/chrome.json

# 2. Click using Chrome extension (NOT cliclick)
~/.claude/skills/chrome-control/scripts/chrome click 558 71
```

**Important:** Always use `chrome click` for Chrome, not `see click` or cliclick.

### iOS Simulator

```bash
# 1. Capture and analyze
xcrun simctl io booted screenshot /tmp/sim.png
~/.claude/skills/computer-use/scripts/see --image /tmp/sim.png --json > /tmp/sim.json

# 2. Tap (divide pixels by scale factor: 3x for iPhone 15, 2x for iPad)
xcrun simctl io booted tap 186 400
```

---

## Coordinate Systems

| Platform | Coordinates | Conversion |
|----------|-------------|------------|
| macOS (cliclick) | Logical pixels | OmniParser pixels / 2 (Retina) |
| Chrome | Viewport pixels | Use as-is with `chrome click` |
| iOS Simulator | Points | OmniParser pixels / scale (2x or 3x) |

---

## Server Management

OmniParser runs as a background daemon (models stay in RAM for fast inference):

```bash
# Check status
~/.claude/skills/computer-use/scripts/see --status   # via see
# or
~/.claude/skills/computer-use/scripts/parse-image --status

# Stop server (reclaim ~2GB RAM)
~/.claude/skills/computer-use/scripts/parse-image --stop

# View logs
tail -f /tmp/omniparser-server.log
```

### Server Details

- **Port:** 8765 (localhost only)
- **Auto-shutdown:** 12 hours idle
- **Memory:** ~2GB (YOLO + Florence-2 models)
- **First call:** ~10-30s (server boot + model load)
- **Subsequent calls:** ~4s (inference only)

### Troubleshooting

**Server hangs on startup:** If OmniParser hangs for 2+ minutes on startup, it may be stuck on a PaddleOCR connectivity check. The `parse-image` script sets `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True` automatically to bypass this.

---

## Tips

### Finding Elements

```bash
# Get JSON output
~/.claude/skills/computer-use/scripts/see --json > /tmp/screen.json

# Search OmniParser elements by text
jq '.omniparser.elements[] | select(.content | test("Settings"; "i"))' /tmp/screen.json

# Get clickable elements only
jq '.omniparser.elements[] | select(.clickable == true)' /tmp/screen.json

# Search Peekaboo elements
jq '.peekaboo.elements[] | select(.label | test("Settings"; "i"))' /tmp/screen.json
```

### Debugging

```bash
# Verbose mode shows timing for each engine
~/.claude/skills/computer-use/scripts/see -v

# Save annotated image
~/.claude/skills/computer-use/scripts/see --output /tmp/debug/
open /tmp/debug/omniparser_annotated.png
```
