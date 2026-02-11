---
name: signal
description: Send and receive Signal messages via signal-cli daemon. Use when sending Signal messages, checking Signal groups, or working with the Signal socket.
---

# Signal Messaging

Send and receive Signal messages using signal-cli with JSON-RPC socket.

## Prerequisites

- signal-cli installed and linked to a phone number
- signal-cli daemon running with JSON-RPC socket

## Daemon Setup

The daemon is managed by launchd. It listens on `/tmp/signal-cli.sock`.

```bash
# Start daemon
launchctl load ~/Library/LaunchAgents/com.dispatch.signal-cli.plist

# Check status
launchctl list | grep signal

# View logs
tail -f /tmp/signal-cli.log
```

## Send Individual Message

```bash
~/.claude/skills/signal/scripts/send-signal "+16175551234" "Hello via Signal!"
```

## Send Group Message

```bash
# Text only
~/.claude/skills/signal/scripts/send-signal-group "base64-group-id" "Hello group!"

# With file attachment
~/.claude/skills/signal/scripts/send-signal-group "base64-group-id" "Check this out" --file /path/to/file.pdf

# File only (no message)
~/.claude/skills/signal/scripts/send-signal-group "base64-group-id" --file /path/to/image.png
```

Group IDs are base64-encoded. Get them from signal-cli or the daemon logs.

## Receive Messages

Messages are received by the signal-listener.py script, which forwards them to the daemon for processing.

## Socket Protocol

Direct JSON-RPC via Unix socket at `/tmp/signal-cli.sock`:

```bash
# Send via raw socket
echo '{"jsonrpc":"2.0","method":"send","id":1,"params":{"recipient":["+16175551234"],"message":"Hello"}}' | nc -U /tmp/signal-cli.sock
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Socket not found | Daemon not running. Check `launchctl list | grep signal` |
| Permission denied | Check socket permissions, may need `chmod 666 /tmp/signal-cli.sock` |
| Message not delivered | Check `/tmp/signal-cli.log` for errors |
| Rate limited | Signal has rate limits. Wait and retry. |
