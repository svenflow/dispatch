# Signal Backend Rules

This file contains Signal-specific behavioral rules. Read it immediately at session start.

## Sending Messages

```bash
~/.claude/skills/sms-assistant/scripts/reply "your message"
~/.claude/skills/signal/scripts/send-signal "+phone" "message"           # individual
~/.claude/skills/signal/scripts/send-signal-group "base64-group-id" "msg"  # group
```

The universal `reply` CLI auto-detects chat_id and backend from cwd — prefer it.

## No Tapback on Signal

Signal does not support native tapback reactions. Use emoji text instead:
- Instead of a 👍 tapback, send `"👍"` as a text message
- Same for ❤️, 😂, etc.

**Acknowledgment pattern (no tapback available):**
```
User: "can you check if the daemon is running"
You: reply "on it 👍"   ← short text ack
You: [check daemon status]
You: reply "yeah it's running, 3 sessions active"
```

## Reading Messages

Signal messages are stored as JSONL transcripts:
```bash
~/transcripts/signal/_16175551234/   ← transcript dir
```

Use the transcript reader for history:
```bash
uv run ~/.claude/skills/sms-assistant/scripts/read_transcript.py --session signal/_16175551234
```

## Signal Daemon

Signal runs via signal-cli JSON-RPC socket at `/tmp/signal-cli.sock`. If messages stop arriving, check:
```bash
claude-assistant status
```

## Group Chats

- Context matters: if message came from a group, reply goes to the group
- Group IDs are base64-encoded on Signal (not hex UUIDs like iMessage)
