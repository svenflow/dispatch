# 04: Messaging Core Daemon

## Goal

Build a daemon that:
1. Polls `~/Library/Messages/chat.db` every 100ms for new messages
2. Injects them into a Claude session
3. Runs continuously in the background

This is the heart of the system. Everything else builds on this.

## Understanding chat.db

iMessage stores everything in a SQLite database:

```bash
sqlite3 ~/Library/Messages/chat.db
```

Key tables:
- `message` - All messages (text, sender, timestamp, ROWID)
- `handle` - Phone numbers/emails
- `chat` - Conversations (including group chats)

**The polling query:**
```sql
SELECT
    m.ROWID,
    m.text,
    m.is_from_me,
    m.date,
    h.id as sender
FROM message m
JOIN handle h ON m.handle_id = h.ROWID
WHERE m.ROWID > ?  -- Last processed ROWID
ORDER BY m.ROWID ASC
LIMIT 100;
```

## Architecture

```
┌─────────────────────────────────────────────┐
│                   Daemon                     │
│                                             │
│  ┌─────────┐    ┌──────────┐    ┌────────┐ │
│  │ Poller  │───▶│ Router   │───▶│ Claude │ │
│  │ (100ms) │    │          │    │ Session│ │
│  └─────────┘    └──────────┘    └────────┘ │
│       │                              │      │
│       ▼                              ▼      │
│  chat.db                        send-sms    │
└─────────────────────────────────────────────┘
```

## Step 1: Basic Poller

Create `~/dispatch/assistant/poller.py`:

**Note:** We use `~/dispatch/` as the project root throughout this guide. The actual production system uses this same structure.

```python
#!/usr/bin/env python3
"""Poll chat.db for new messages."""

import sqlite3
import time
from pathlib import Path

MESSAGES_DB = Path.home() / "Library/Messages/chat.db"
STATE_FILE = Path.home() / "dispatch/state/last_rowid.txt"
POLL_INTERVAL = 0.1  # 100ms

def get_last_rowid() -> int:
    """Get last processed ROWID from state file."""
    if STATE_FILE.exists():
        return int(STATE_FILE.read_text().strip())
    # Start from current max to avoid processing history
    conn = sqlite3.connect(str(MESSAGES_DB))
    cursor = conn.execute("SELECT MAX(ROWID) FROM message")
    max_rowid = cursor.fetchone()[0] or 0
    conn.close()
    return max_rowid

def save_last_rowid(rowid: int):
    """Save last processed ROWID."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(str(rowid))

def poll_messages(last_rowid: int) -> list:
    """Fetch messages newer than last_rowid."""
    conn = sqlite3.connect(str(MESSAGES_DB))
    cursor = conn.execute("""
        SELECT
            m.ROWID,
            m.text,
            m.is_from_me,
            h.id as sender
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.ROWID > ?
        ORDER BY m.ROWID ASC
        LIMIT 100
    """, (last_rowid,))

    messages = []
    for row in cursor.fetchall():
        rowid, text, is_from_me, sender = row
        if not is_from_me and text:  # Only incoming messages with text
            messages.append({
                'rowid': rowid,
                'text': text,
                'sender': sender
            })
    conn.close()
    return messages

def main():
    """Main polling loop."""
    print("Starting message poller...")
    last_rowid = get_last_rowid()
    print(f"Starting from ROWID: {last_rowid}")

    while True:
        messages = poll_messages(last_rowid)

        for msg in messages:
            print(f"[{msg['sender']}]: {msg['text']}")
            last_rowid = msg['rowid']
            save_last_rowid(last_rowid)

            # TODO: Route to Claude session

        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
```

**Test it:**
```bash
mkdir -p ~/dispatch/state
uv run ~/dispatch/assistant/poller.py
```

Send yourself an iMessage - you should see it print.

## Step 2: Claude Session Integration

Now pipe messages into Claude. Create `~/dispatch/assistant/session.py`:

```python
#!/usr/bin/env python3
"""Manage Claude session for message handling."""

import subprocess
import json

def inject_message(sender: str, text: str):
    """Inject a message into Claude and get response."""

    prompt = f"""
---SMS FROM {sender}---
{text}
---END SMS---

Respond naturally. To reply, use: send-sms "{sender}" "your message"
"""

    # Simple approach: use claude CLI directly
    result = subprocess.run(
        ["claude", "--print", prompt],
        capture_output=True,
        text=True,
        timeout=60
    )

    return result.stdout

# For now, we'll use subprocess
# Later: migrate to Claude Agent SDK for persistent sessions
```

## Step 3: Send SMS CLI

Create `~/.claude/skills/sms-assistant/scripts/send-sms`:

**Note:** We place this in the skills directory so Claude sessions can discover it via the SKILL.md system (covered in 04-skills-system.md).

```bash
#!/bin/bash
# Send iMessage via AppleScript

RECIPIENT="$1"
MESSAGE="$2"

if [ -z "$RECIPIENT" ] || [ -z "$MESSAGE" ]; then
    echo "Usage: send-sms <phone> <message>"
    exit 1
fi

osascript <<EOF
tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set targetBuddy to participant "$RECIPIENT" of targetService
    send "$MESSAGE" to targetBuddy
end tell
EOF

echo "SENT|$RECIPIENT"
```

Make it executable and test:
```bash
mkdir -p ~/.claude/skills/sms-assistant/scripts
chmod +x ~/.claude/skills/sms-assistant/scripts/send-sms
~/.claude/skills/sms-assistant/scripts/send-sms "+15551234567" "Hello from the assistant!"
```

## Step 4: Wire It Together

Update `poller.py` to call Claude:

```python
from assistant.session import inject_message

def main():
    print("Starting message poller...")
    last_rowid = get_last_rowid()

    while True:
        messages = poll_messages(last_rowid)

        for msg in messages:
            print(f"[{msg['sender']}]: {msg['text']}")

            # Inject into Claude
            response = inject_message(msg['sender'], msg['text'])
            print(f"Claude response: {response}")

            last_rowid = msg['rowid']
            save_last_rowid(last_rowid)

        time.sleep(POLL_INTERVAL)
```

## Step 5: Run as Daemon

For now, use a simple approach:

```bash
# Create logs directory
mkdir -p ~/dispatch/logs

# Run in background
nohup uv run ~/dispatch/assistant/poller.py > ~/dispatch/logs/daemon.log 2>&1 &
echo $! > ~/dispatch/state/daemon.pid

# Check if running
ps aux | grep poller.py

# Stop
kill $(cat ~/dispatch/state/daemon.pid)
```

## Step 6: Auto-Start on Boot (LaunchAgent)

Create a LaunchAgent so the daemon starts automatically:

Create `~/Library/LaunchAgents/com.dispatch.assistant.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.dispatch.assistant</string>

    <key>ProgramArguments</key>
    <array>
        <string>/Users/YOUR_USERNAME/dispatch/bin/claude-assistant</string>
        <string>start</string>
    </array>

    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/dispatch</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <false/>

    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/dispatch/logs/launchd.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/dispatch/logs/launchd.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>/Users/YOUR_USERNAME</string>
    </dict>
</dict>
</plist>
```

**Important:** Replace `YOUR_USERNAME` with your actual username.

Load the LaunchAgent:

```bash
# Load it (starts immediately and on boot)
launchctl load ~/Library/LaunchAgents/com.dispatch.assistant.plist

# Check status
launchctl list | grep dispatch

# Unload if needed
launchctl unload ~/Library/LaunchAgents/com.dispatch.assistant.plist
```

**GitHub reference:** See [`launchd/com.nicklaude.claude-assistant.plist`](https://github.com/nicklaude/dispatch/blob/main/launchd/com.nicklaude.claude-assistant.plist) for a working example.

## Verification Checklist

- [ ] Poller runs and prints incoming messages
- [ ] send-sms successfully sends iMessages
- [ ] Claude receives messages and can call send-sms
- [ ] State persists across restarts (last_rowid.txt)
- [ ] Messages aren't processed twice
- [ ] LaunchAgent is loaded (`launchctl list | grep dispatch`)
- [ ] Daemon survives reboot

## What's Next

This basic daemon works but has no access control. In `05-contacts-tiers.md`, we add contact lookup and permission tiers so only approved people can interact.

---

## Gotchas

1. **chat.db race condition**: Sometimes `text` is NULL briefly after message arrives. Add a small retry.

2. **AppleScript escaping**: Messages with quotes need escaping. Handle this in send-sms.

3. **Rate limiting**: Don't spam Claude. Add debouncing if someone sends 10 messages rapidly.

4. **Permissions**: If sqlite3 fails, check Full Disk Access again.
