# 10: Signal Integration

## Goal

Add Signal as a second messaging channel. Some contacts prefer Signal over iMessage, and this lets Claude handle both seamlessly.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   signal-cli daemon                      │
│                                                          │
│  JSON-RPC server on Unix socket (/tmp/signal-cli.sock)  │
│                                                          │
│  - Receives messages via push (--receive-mode)          │
│  - Sends via RPC calls                                   │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   signal-listener.py   │
              │   (forwards to daemon) │
              └────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   Manager daemon       │
              │   (routes to sessions) │
              └────────────────────────┘
```

**GitHub:** [`skills/signal/`](https://github.com/nicklaude/dispatch/tree/main/skills/signal)

## Step 1: Install signal-cli

```bash
brew install signal-cli
```

## Step 2: Register a Phone Number

You need a phone number for Signal. Options:
- Dedicated SIM card
- Google Voice number
- Your existing number (if not already on Signal)

```bash
# Register (will send SMS verification)
signal-cli -u +1YOURNUMBER register

# Verify with code from SMS
signal-cli -u +1YOURNUMBER verify CODE
```

## Step 3: Start the Daemon

The signal-cli daemon listens on a Unix socket:

```bash
# Start daemon (foreground for testing)
signal-cli -u +1YOURNUMBER daemon --socket /tmp/signal-cli.sock --receive-mode on-connection
```

**Critical:** The `--receive-mode on-connection` flag is required for push notifications. Without it, you won't receive messages in real-time.

## Step 4: Create Send CLI

**File:** [`skills/signal/scripts/send-signal`](https://github.com/nicklaude/dispatch/blob/main/skills/signal/scripts/send-signal)

```bash
#!/bin/bash
# Send Signal message via JSON-RPC

RECIPIENT="$1"
MESSAGE="$2"

if [ -z "$RECIPIENT" ] || [ -z "$MESSAGE" ]; then
    echo "Usage: send-signal <phone> <message>"
    exit 1
fi

echo "{\"jsonrpc\":\"2.0\",\"method\":\"send\",\"params\":{\"recipient\":[\"$RECIPIENT\"],\"message\":\"$MESSAGE\"},\"id\":1}" | \
    nc -U /tmp/signal-cli.sock | jq -r '.result // .error'

echo "SENT|$RECIPIENT"
```

```bash
chmod +x ~/dispatch/skills/signal/scripts/send-signal
```

## Step 5: Create Group Send CLI

**File:** [`skills/signal/scripts/send-signal-group`](https://github.com/nicklaude/dispatch/blob/main/skills/signal/scripts/send-signal-group)

```bash
#!/bin/bash
# Send Signal group message

GROUP_ID="$1"  # Base64-encoded group ID
MESSAGE="$2"

echo "{\"jsonrpc\":\"2.0\",\"method\":\"send\",\"params\":{\"groupId\":\"$GROUP_ID\",\"message\":\"$MESSAGE\"},\"id\":1}" | \
    nc -U /tmp/signal-cli.sock | jq -r '.result // .error'
```

## Step 6: Signal Listener

The listener monitors the socket and forwards messages to the daemon:

**File:** [`skills/signal/scripts/signal-listener.py`](https://github.com/nicklaude/dispatch/blob/main/skills/signal/scripts/signal-listener.py)

This script:
1. Connects to the signal-cli socket
2. Listens for incoming messages
3. Forwards them to the manager daemon via `inject-prompt`

## Step 7: LaunchAgent for signal-cli

Create `~/Library/LaunchAgents/com.dispatch.signal-cli.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.dispatch.signal-cli</string>

    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/signal-cli</string>
        <string>-u</string>
        <string>+1YOURNUMBER</string>
        <string>daemon</string>
        <string>--socket</string>
        <string>/tmp/signal-cli.sock</string>
        <string>--receive-mode</string>
        <string>on-connection</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.dispatch.signal-cli.plist
```

## Step 8: Integrate with Manager

The manager daemon already supports Signal as a backend. In [`assistant/manager.py`](https://github.com/nicklaude/dispatch/blob/main/assistant/manager.py), Signal messages are routed the same way as iMessage.

## Verification Checklist

- [ ] signal-cli registered and verified
- [ ] Daemon running (`ls /tmp/signal-cli.sock`)
- [ ] `send-signal "+1234567890" "test"` works
- [ ] Can receive messages
- [ ] LaunchAgent starts on boot

## What's Next

`11-health-reliability.md` covers health checks, idle session cleanup, and error recovery.

---

## Gotchas

1. **Socket permissions**: The socket at `/tmp/signal-cli.sock` must be readable by the listener.

2. **Rate limiting**: Signal has rate limits. Don't spam messages.

3. **Group IDs**: Group IDs are base64-encoded. Get them from `signal-cli listGroups`.

4. **Linked devices**: If using on multiple devices, link them properly via signal-cli.
