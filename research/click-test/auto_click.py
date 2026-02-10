#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow"]
# ///
"""
Click test baseline: macOS screenshot → pixel analysis → cliclick.
No Chrome JS/extension used during circle detection.
"""

import subprocess
import time
import sys
from PIL import Image

CHROME = "/Users/jsmith/code/chrome-control/chrome"
TOOLBAR_HEIGHT = 87

def get_window_bounds():
    result = subprocess.run(
        ["osascript", "-e", 'tell application "Google Chrome" to get bounds of front window'],
        capture_output=True, text=True
    )
    return tuple(int(p) for p in result.stdout.strip().split(", "))

def get_tab_id():
    result = subprocess.run([CHROME, "tabs"], capture_output=True, text=True)
    lines = result.stdout.strip().split('\n')
    for line in lines:
        stripped = line.strip()
        # Tab ID lines start with a number, URL lines start with http/file
        if stripped and stripped[0].isdigit():
            return stripped.split()[0]
    return None

def screenshot(path="/tmp/click_test_auto.png"):
    subprocess.run(["screencapture", "-x", path], check=True)
    return Image.open(path)

def find_circle_center(img, bounds, diameter):
    """Find circle center from screenshot pixels. Returns logical coords."""
    pixels = img.load()
    w, h = img.size
    wl, wt, wr, wb = bounds

    # Content area in screenshot pixels (2x retina)
    sx = wl * 2
    sy = (wt + TOOLBAR_HEIGHT) * 2
    ex = min(wr * 2, w)
    ey = min(wb * 2, h)

    # Sample dark pixels
    step = max(4, diameter // 10)  # finer sampling for smaller circles
    total_x, total_y, count = 0, 0, 0
    for y in range(sy, ey, step):
        for x in range(sx, ex, step):
            r, g, b = pixels[x, y][:3]
            if r < 40 and g < 40 and b < 40:
                total_x += x
                total_y += y
                count += 1

    if count < 3:
        return None

    cx = total_x // count
    cy = total_y // count

    # Refine: keep only pixels near the center of mass (filter text noise)
    radius = diameter * 2  # in screenshot pixels
    fx, fy, fc = 0, 0, 0
    for y in range(max(sy, cy - radius), min(ey, cy + radius), step):
        for x in range(max(sx, cx - radius), min(ex, cx + radius), step):
            r, g, b = pixels[x, y][:3]
            if r < 40 and g < 40 and b < 40:
                fx += x
                fy += y
                fc += 1

    if fc < 3:
        return cx // 2, cy // 2

    return fx // fc // 2, fy // fc // 2

def click(x, y):
    subprocess.run(["cliclick", f"c:{x},{y}"], check=True)

def read_title(tab_id):
    result = subprocess.run([CHROME, "js", tab_id, "document.title"], capture_output=True, text=True)
    return result.stdout.strip()

def navigate(tab_id, url):
    subprocess.run([CHROME, "navigate", tab_id, url], capture_output=True)

def run_test(tab_id, diameter, rounds, bounds):
    url = f"file:///Users/jsmith/code/click-test/index.html?diameter={diameter}&rounds={rounds}&bg=white&color=black"
    navigate(tab_id, url)
    time.sleep(2)

    max_attempts = rounds * 105
    attempts = 0

    while attempts < max_attempts:
        time.sleep(0.2)

        # Check if done every 10 attempts
        if attempts > 0 and attempts % 10 == 0:
            title = read_title(tab_id)
            if "RESULT" in title:
                break

        img = screenshot()
        center = find_circle_center(img, bounds, diameter)

        if center is None:
            title = read_title(tab_id)
            if "RESULT" in title:
                break
            attempts += 1
            continue

        x, y = center
        click(x, y)
        attempts += 1

    time.sleep(0.5)
    title = read_title(tab_id)
    print(f"  {title}")
    print(f"  Total attempts: {attempts}")
    return title

def main():
    sizes = [200, 150, 100, 75, 50, 30, 20, 10, 5]
    rounds = 10

    if len(sys.argv) > 1:
        sizes = [int(s) for s in sys.argv[1:]]

    tab_id = get_tab_id()
    if not tab_id:
        print("No Click Test tab found!")
        return

    bounds = get_window_bounds()
    print(f"Tab: {tab_id}, Window: {bounds}")
    print(f"Running baseline: sizes={sizes}, rounds={rounds}\n")

    results = []
    for diameter in sizes:
        print(f"--- {diameter}px ---")
        title = run_test(tab_id, diameter, rounds, bounds)
        results.append((diameter, title))
        print()

    print("\n=== SUMMARY ===")
    for diameter, title in results:
        print(f"  {diameter}px: {title}")

if __name__ == "__main__":
    main()
