---
name: screen-clicking
description: Guide for clicking on screen elements using cliclick on macOS with Retina displays.
---

# Screen Clicking Skill

How to accurately click on screen elements using cliclick on a Retina display Mac.

## Key Insight: Coordinate Systems

On a Retina display (like the 4.5K display at 4480x2520), there are TWO coordinate systems:

1. **Image/Pixel coordinates**: What you see in screenshots (e.g., 4480x2520)
2. **Logical/Point coordinates**: What cliclick uses (approximately half: 2240x1260)

### Converting Coordinates

```
logical_x = image_x / 2
logical_y = image_y / 2
```

## Debugging Workflow

### Step 1: Take a screenshot and add a grid
```python
from PIL import Image, ImageDraw

img = Image.open('/tmp/screenshot.png')
draw = ImageDraw.Draw(img)

# Draw grid lines every 500 pixels
for x in range(0, img.width, 500):
    draw.line([(x, 0), (x, img.height)], fill='yellow', width=2)
    draw.text((x+5, 10), str(x), fill='yellow')

for y in range(0, img.height, 500):
    draw.line([(0, y), (img.width, y)], fill='yellow', width=2)
    draw.text((10, y+5), str(y), fill='yellow')

img.save('/tmp/screenshot_grid.png')
```

### Step 2: Mark where you want to click
```python
# Mark target position
x, y = 2350, 740  # Image coordinates
radius = 30
draw.ellipse([x-radius, y-radius, x+radius, y+radius], outline='lime', width=10)
draw.text((x+40, y), f"Target ({x//2},{y//2})", fill='lime')
img.save('/tmp/screenshot_marked.png')
```

### Step 3: View marked screenshot and verify position

### Step 4: Click using logical coordinates
```bash
# Convert image coords to logical: divide by 2
cliclick c:1175,370  # For image coords (2350, 740)
```

## Window Position Matters

Get Chrome window position:
```bash
osascript -e 'tell application "Google Chrome" to get bounds of front window'
# Returns: left, top, right, bottom (in logical coordinates)
# Example: 737, 50, 1937, 1146
```

The window's top-left corner is at (737, 50) in logical coords, not (0, 0).

## Common Issues

1. **Click lands on wrong window**: Make sure target app is active before clicking
   ```bash
   osascript -e 'tell application "Google Chrome" to activate' && sleep 0.3
   ```

2. **Click lands on wrong element**: Double-check coordinate conversion (divide by 2)

3. **Multiple windows overlapping**: Close other windows first
   ```applescript
   tell application "Google Chrome"
       repeat while (count of windows) > 1
           close window 2
       end repeat
   end tell
   ```

## Quick Reference

| Display | Screenshot Size | Logical Size | Conversion |
|---------|----------------|--------------|------------|
| 4.5K Retina | 4480x2520 | 2240x1260 | / 2 |
| Standard Retina | 2880x1800 | 1440x900 | / 2 |

## Example: Click button at image coords (2350, 740)

```bash
# 1. Activate window
osascript -e 'tell application "Google Chrome" to activate'
sleep 0.3

# 2. Click at logical coords (2350/2, 740/2) = (1175, 370)
cliclick c:1175,370
```
