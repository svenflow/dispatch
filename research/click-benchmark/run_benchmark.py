#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Click Benchmark Runner
Opens the benchmark page and uses macOS-level screenshots + cliclick to find and click circles.
Measures how many attempts it takes to hit circles of varying sizes.
"""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

CHROME = os.path.expanduser("~/code/chrome-control/chrome")
BENCHMARK_HTML = Path(__file__).parent / "index.html"
SCREENSHOT_DIR = Path("/tmp/click-benchmark")
SCREENSHOT_DIR.mkdir(exist_ok=True)


def chrome(cmd):
    """Run chrome CLI command and return output."""
    result = subprocess.run(
        f"{CHROME} {cmd}",
        shell=True, capture_output=True, text=True, timeout=15
    )
    return result.stdout.strip()


def screenshot_macos(path):
    """Take a macOS-level screenshot using screencapture."""
    subprocess.run(["screencapture", "-x", str(path)], check=True, timeout=10)
    return path


def cliclick(x, y):
    """Click at macOS screen coordinates using cliclick."""
    subprocess.run(["cliclick", f"c:{x},{y}"], check=True, timeout=5)


def get_benchmark_state(tab_id):
    """Read benchmark state from the page via chrome JS."""
    raw = chrome(f'js {tab_id} "JSON.stringify(window.benchmarkState)"')
    # The output may have quotes around it
    try:
        # Strip outer quotes if present
        cleaned = raw.strip().strip('"').replace('\\"', '"')
        return json.loads(cleaned)
    except Exception as e:
        print(f"  [warn] Could not parse state: {e}")
        return None


def get_window_bounds(tab_id):
    """Get the Chrome window position and content area offset.
    Returns (window_x, window_y, content_offset_y) in screen coordinates.
    """
    # Get window bounds via osascript
    result = subprocess.run(
        ['osascript', '-e', 'tell application "Google Chrome" to get bounds of front window'],
        capture_output=True, text=True, timeout=5
    )
    bounds = [int(x.strip()) for x in result.stdout.strip().split(",")]
    win_x, win_y, win_x2, win_y2 = bounds

    # Chrome has a toolbar/tab bar area (~88px on retina = ~44 logical points)
    # This is approximate and may need calibration
    content_offset_y = 88  # pixels from top of window to content area (at 2x = 44 logical)

    return win_x, win_y, content_offset_y


def page_to_screen(page_x, page_y, win_x, win_y, content_offset_y):
    """Convert page coordinates to macOS screen coordinates.
    Retina displays: page pixels == logical points (1:1 for click coordinates).
    """
    screen_x = win_x + page_x
    screen_y = win_y + content_offset_y + page_y
    return screen_x, screen_y


def run_single_benchmark(diameter, runs, bg="#ffffff", color="#000000"):
    """Run a single benchmark configuration."""
    print(f"\n{'='*60}")
    print(f"  Benchmark: {diameter}px circle, {runs} runs")
    print(f"{'='*60}")

    # Open the benchmark page
    url = f"file://{BENCHMARK_HTML}?diameter={diameter}&runs={runs}&bg={bg.replace('#','%23')}&color={color.replace('#','%23')}&api=1"
    tab_info = chrome(f'open "{url}"')
    # Extract tab ID from output
    tab_id_match = re.search(r'tab (\d+)', tab_info)
    if not tab_id_match:
        print(f"  [error] Could not open tab: {tab_info}")
        return None
    tab_id = tab_id_match.group(1)

    time.sleep(1)  # Wait for page load

    # Focus the tab
    chrome(f"focus {tab_id}")
    time.sleep(0.5)

    # Get window bounds
    win_x, win_y, content_offset_y = get_window_bounds(tab_id)
    print(f"  Window bounds: ({win_x}, {win_y}), content offset: {content_offset_y}")

    total_attempts = 0
    max_attempts_per_circle = 20

    for run_idx in range(runs):
        state = get_benchmark_state(tab_id)
        if not state:
            print(f"  [error] Could not get state for run {run_idx+1}")
            break

        if state.get("finished"):
            break

        cx = state["circleX"]
        cy = state["circleY"]

        print(f"  Run {run_idx+1}/{runs}: circle at ({cx}, {cy}), diameter={diameter}")

        attempts = 0
        hit = False

        while not hit and attempts < max_attempts_per_circle:
            # Convert page coords to screen coords
            screen_x, screen_y = page_to_screen(cx, cy, win_x, win_y, content_offset_y)
            print(f"    Attempt {attempts+1}: clicking screen ({screen_x}, {screen_y})")

            cliclick(screen_x, screen_y)
            attempts += 1
            total_attempts += 1
            time.sleep(0.3)

            # Check if we hit
            new_state = get_benchmark_state(tab_id)
            if not new_state:
                continue

            if new_state.get("finished") or new_state.get("currentRun", 0) > run_idx:
                hit = True
                print(f"    HIT after {attempts} attempt(s)")
            elif new_state.get("hit"):
                hit = True
                print(f"    HIT after {attempts} attempt(s)")

        if not hit:
            print(f"    MISSED after {max_attempts_per_circle} attempts, skipping")

    # Get final results
    time.sleep(0.5)
    final_state = get_benchmark_state(tab_id)

    # Also get results from console
    console_output = chrome(f"console {tab_id}")

    result = {
        "diameter": diameter,
        "runs": runs,
        "state": final_state,
        "total_attempts": total_attempts,
    }

    if final_state and final_state.get("runResults"):
        per_run = final_state["runResults"]
        avg = sum(per_run) / len(per_run) if per_run else 0
        first_try = sum(1 for r in per_run if r == 1)
        result["avg_clicks"] = round(avg, 2)
        result["first_try_rate"] = f"{first_try}/{len(per_run)}"
        result["per_run"] = per_run
        print(f"\n  Results: avg={avg:.2f} clicks, first-try={first_try}/{len(per_run)}")
        print(f"  Per-run: {per_run}")

    # Close tab
    chrome(f"close {tab_id}")

    return result


def main():
    print("\n" + "="*60)
    print("  CLICK BENCHMARK - macOS Screenshot + cliclick")
    print("="*60)

    # Test sizes from large to small
    sizes = [200, 150, 100, 75, 50, 30, 20, 10, 5]
    runs_per_size = 10
    all_results = []

    for diameter in sizes:
        result = run_single_benchmark(diameter, runs_per_size)
        if result:
            all_results.append(result)

    # Summary
    print("\n" + "="*60)
    print("  FINAL SUMMARY")
    print("="*60)
    print(f"  {'Diameter':>10} | {'Avg Clicks':>10} | {'First-Try':>10}")
    print(f"  {'-'*10}-+-{'-'*10}-+-{'-'*10}")
    for r in all_results:
        avg = r.get("avg_clicks", "?")
        ft = r.get("first_try_rate", "?")
        print(f"  {r['diameter']:>8}px | {avg:>10} | {ft:>10}")

    # Save results
    results_file = Path(__file__).parent / "baseline_results.json"
    with open(results_file, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\n  Results saved to: {results_file}")


if __name__ == "__main__":
    main()
