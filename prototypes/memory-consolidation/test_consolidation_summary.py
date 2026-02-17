#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Test script to simulate the 2am consolidation summary injection.

Usage:
    uv run test_consolidation_summary.py [--chat-id CHAT_ID]

This sends a sample consolidation summary prompt via inject-prompt CLI.
"""

import subprocess
import sys


SAMPLE_PERSON_FACTS = """Processing 5 contacts...

[1/5] Nikhil Thorat
  Suggester: 3 candidates
  Reviewer: 3 verified, 0 refuted
  Committer: 3 facts written

[2/5] Caroline Malone
  Suggester: 2 candidates
  Reviewer: 2 verified, 0 refuted
  Committer: 2 facts written

[3/5] Sam McGrail
  Suggester: 4 candidates
  Reviewer: 3 verified, 1 refuted (hallucination)
  Committer: 3 facts written

[4/5] Ryan
  Suggester: 1 candidate
  Reviewer: 1 verified
  Committer: 1 fact written

[5/5] Priya
  Suggester: 0 candidates (no new facts)
  Skipped

Summary: 5 contacts processed, 9 facts extracted, 1 hallucination caught"""

SAMPLE_CHAT_CONTEXT = """Processing 4 chat directories...

[1/4] imessage/_16175969496 (Nikhil)
  Suggester: extracted 12 items
  Reviewer: 11 verified, 1 refuted
  Committer: wrote CONTEXT.md (4 ongoing, 2 pending, 3 topics, 2 prefs)

[2/4] imessage/2df6be1ed7534cd797e5fdb2c4bd6bd8 (sven sven sven)
  Suggester: extracted 8 items
  Reviewer: 8 verified
  Committer: wrote CONTEXT.md (3 ongoing, 3 pending, 2 topics, 3 prefs)

[3/4] imessage/b3d258b9a4de447ca412eb335c82a077 (family & claude)
  Suggester: extracted 6 items
  Reviewer: 6 verified
  Committer: wrote CONTEXT.md (2 ongoing, 2 pending, 1 topic, 2 prefs)

[4/4] signal/_16175969496 (Nikhil Signal)
  Suggester: 2 candidates
  Reviewer: 2 verified
  Committer: wrote CONTEXT.md

Summary: 4 chats processed, 28 context items extracted, 1 hallucination caught"""


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--chat-id", default="ab3876ca883949d2b0ce9c4cd5d1d633",
                        help="Chat ID to inject into (default: Nikhil's group)")
    args = parser.parse_args()

    # Build the summary prompt (same format as manager.py)
    summary_prompt = f"""<admin>
🌙 2am memory consolidation just completed. Here's what happened:

## Person-Facts Consolidation (→ Contacts.app notes)
```
{SAMPLE_PERSON_FACTS}
```

## Chat Context Consolidation (→ CONTEXT.md per chat)
```
{SAMPLE_CHAT_CONTEXT}
```

---

**Your task:**
1. Review the results above
2. Explore anything interesting (read new facts, check CONTEXT.md files)
3. If there were errors, investigate and note what went wrong
4. Send me a summary text with:
   - How many contacts/chats were processed
   - Any notable new facts learned
   - Any errors that need attention

Keep the text concise - this is a nightly check-in, not a full report.
</admin>"""

    # Use inject-prompt CLI (use full path)
    import os
    cli_path = os.path.expanduser("~/dispatch/bin/claude-assistant")
    cmd = [
        cli_path, "inject-prompt",
        args.chat_id,
        "--admin",
        summary_prompt
    ]

    print(f"Injecting consolidation summary into {args.chat_id}...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode == 0:
        print(f"Success: {result.stdout}")
    else:
        print(f"Error: {result.stderr or result.stdout}")
        sys.exit(1)


if __name__ == "__main__":
    main()
