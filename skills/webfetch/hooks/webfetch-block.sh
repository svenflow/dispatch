#!/bin/bash
# PreToolUse hook for WebFetch - blocks and redirects to webfetch CLI
#
# Instead of letting WebFetch run (32% failure rate), tell Claude to use
# the webfetch CLI which uses zendriver headless browser for better reliability.

set -e

# Read JSON input from stdin
INPUT=$(cat)

# Extract the URL from tool_input
URL=$(echo "$INPUT" | jq -r '.tool_input.url // empty')

# Return block decision with instructions
jq -n --arg url "$URL" '{
  "decision": "block",
  "reason": ("WebFetch is disabled. Use webfetch CLI instead:\n\n~/.claude/skills/webfetch/scripts/webfetch \"" + $url + "\"\n\nThis uses zendriver headless browser for better anti-bot handling.")
}'
