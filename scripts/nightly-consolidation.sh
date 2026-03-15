#!/bin/bash
# Nightly memory consolidation wrapper
# Runs person-facts and chat-context consolidation scripts sequentially.
# Used by the ephemeral task system as a script-mode task.
#
# Exit codes:
#   0 = both passed
#   1 = person-facts failed
#   2 = chat-context failed
#   3 = both failed

set -o pipefail
# Note: set -e is intentionally omitted. This script captures exit codes
# manually to report partial failures (exit 1/2/3). set -e would conflict
# with the || exit_code=$? pattern inside command substitutions.

PERSON_FACTS="$HOME/dispatch/prototypes/memory-consolidation/consolidate_3pass.py"
CHAT_CONTEXT="$HOME/dispatch/prototypes/memory-consolidation/consolidate_chat.py"

echo "=== Person-Facts Consolidation (→ Contacts.app notes) ==="
pf_output=$(uv run "$PERSON_FACTS" --all 2>&1) && pf_exit=0 || pf_exit=$?
echo "$pf_output"

echo ""
echo "=== Chat Context Consolidation (→ CONTEXT.md per chat) ==="
cc_output=$(uv run "$CHAT_CONTEXT" --all 2>&1) && cc_exit=0 || cc_exit=$?
echo "$cc_output"

echo ""
echo "=== Summary ==="
if [ $pf_exit -eq 0 ] && [ $cc_exit -eq 0 ]; then
    echo "✅ Both consolidation passes completed successfully"
    exit 0
elif [ $pf_exit -ne 0 ] && [ $cc_exit -ne 0 ]; then
    echo "❌ Both consolidation passes failed (person-facts=$pf_exit, chat-context=$cc_exit)"
    exit 3
elif [ $pf_exit -ne 0 ]; then
    echo "⚠️ Person-facts failed (exit=$pf_exit), chat-context succeeded"
    exit 1
else
    echo "⚠️ Chat-context failed (exit=$cc_exit), person-facts succeeded"
    exit 2
fi
