#!/bin/bash
# Click test runner - uses only macOS screenshots and cliclick
# Usage: ./run_test.sh <diameter> <rounds> [bg_color] [circle_color]

DIAMETER=${1:-100}
ROUNDS=${2:-10}
BG=${3:-white}
COLOR=${4:-black}

CHROME="/Users/jsmith/code/chrome-control/chrome"

# Open the test page
URL="file:///Users/jsmith/code/click-test/index.html?diameter=${DIAMETER}&rounds=${ROUNDS}&bg=${BG}&color=${COLOR}"
$CHROME open "$URL"

echo "Test page opened. Diameter: ${DIAMETER}px, Rounds: ${ROUNDS}"
echo "Use macOS screenshots + cliclick to click the circles."
echo "The page title will show results when done."
