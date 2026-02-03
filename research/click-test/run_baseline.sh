#!/bin/bash
# Run baseline for all circle sizes
CHROME="/Users/nicklaude/code/chrome-control/chrome"
TAB_ID=$($CHROME tabs 2>/dev/null | grep "Click Test" | tail -1 | awk '{print $1}')

echo "=== CLICK TEST BASELINE ==="
echo "Method: macOS screenshot pixel analysis + cliclick"
echo "No Chrome JS/extension used for circle detection"
echo ""

for size in 200 150 100 75 50 30 20 10 5; do
    # Navigate to test page with this diameter
    $CHROME navigate "$TAB_ID" "file:///Users/nicklaude/code/click-test/index.html?diameter=${size}&rounds=10&bg=white&color=black" >/dev/null 2>&1
    sleep 2

    echo "--- Testing ${size}px diameter ---"
    cd /Users/nicklaude/code/click-test
    uv run auto_click.py $size 10 2>/dev/null
    echo ""
done

echo "=== BASELINE COMPLETE ==="
