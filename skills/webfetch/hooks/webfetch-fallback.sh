#!/bin/bash
# PostToolUseFailure hook for WebFetch - falls back to webfetch CLI on failure
#
# Triggers when WebFetch fails (403, 503, antibot, etc)
# Retries with webfetch CLI which has:
# - Chrome cookies injection
# - Playwright headless fallback
# - Better antibot handling

set -e

# Read JSON input from stdin
INPUT=$(cat)

# Extract the URL from tool_input
URL=$(echo "$INPUT" | jq -r '.tool_input.url // empty')
PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // empty')
ERROR=$(echo "$INPUT" | jq -r '.error // empty')

# Only retry if we have a URL
if [ -z "$URL" ]; then
  exit 0
fi

# Log to stderr (visible in verbose mode)
echo "[webfetch-fallback] WebFetch failed for $URL, trying webfetch CLI..." >&2
echo "[webfetch-fallback] Original error: $ERROR" >&2

# Run webfetch CLI
CONTENT=$(~/.claude/skills/webfetch/scripts/webfetch "$URL" 2>&1) || {
  echo "[webfetch-fallback] webfetch CLI also failed" >&2
  exit 0  # Don't block, just let the original error through
}

# Check if we got meaningful content
if [ ${#CONTENT} -lt 100 ]; then
  echo "[webfetch-fallback] webfetch CLI returned too little content" >&2
  exit 0
fi

# Return the content as additionalContext for Claude
echo "[webfetch-fallback] Success! Got ${#CONTENT} chars" >&2

# Return JSON with the fetched content
jq -n --arg content "$CONTENT" --arg url "$URL" --arg prompt "$PROMPT" '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUseFailure",
    "additionalContext": ("WebFetch failed but fallback succeeded. Here is the content from " + $url + ":\n\n" + $content + "\n\nOriginal prompt was: " + $prompt)
  }
}'
