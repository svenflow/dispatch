# iMessage Backend Rules

This file contains iMessage-specific behavioral rules. Read it immediately at session start.

## Sending Messages

```bash
~/.claude/skills/sms-assistant/scripts/reply "your message"
~/.claude/skills/sms-assistant/scripts/reply "message" --image /path/to/image
~/.claude/skills/sms-assistant/scripts/reply "message" --file /path/to/file
```

For group chats the same `reply` CLI works — it auto-detects chat_id from cwd.

## Tapback Reactions — USE THESE

**This is mandatory behavior, not optional.** Tapbacks are native iMessage bubble reactions — much more natural than sending emoji as text.

```bash
reply --react <emoji> --guid "<Message-GUID>"
```

**The Message-GUID appears in the injected prompt** already in `p:0/UUID` format, ready to use:

```
Message-GUID: p:0/608826CD-88B7-4814-8DBD-48D8F21D77BE
To react: reply --react <emoji> --guid "p:0/608826CD-88B7-4814-8DBD-48D8F21D77BE"
```

Just copy the guid from the "To react:" hint at the bottom of the injected message.

**Supported reactions:**

| Emoji | Tapback | When to use |
|-------|---------|-------------|
| 👍 | Thumbs up | Acknowledge request before starting work |
| ❤️ | Heart | Something wholesome or appreciative |
| 😂 | Haha | Something funny |
| ‼️ | Exclamation | Exciting, emphatic agreement |
| 👎 | Thumbs down | Disagree or "that sucks" |
| ❓ | Question | Confused, need clarification |

**Rule — When to tapback vs text reply:**
- **Tapback only**: Simple agreement, emotional reaction, quick ack where no text needed
- **Text only**: Answering a question, delivering results, asking a follow-up
- **Tapback THEN text**: User asks you to do a task → tapback 👍 immediately → do work → text reply with results

**Example:**
```
User: "can you check if the daemon is running"
You: reply --react 👍 --guid "p:0/..."    ← immediately
You: [check daemon status]
You: reply "yeah it's running, 3 sessions active"   ← results
```

## Reading Messages

```bash
~/.claude/skills/sms-assistant/scripts/read-sms --chat "+16175551234" --limit 20
~/.claude/skills/sms-assistant/scripts/read-sms --chat "hex-group-uuid" --limit 20
```

## Attachments

Use `view-attachment` for photos/files sent by users:
```bash
~/.claude/skills/sms-assistant/scripts/view-attachment "/path/to/attachment"
```

Handles HEIC → JPEG conversion, oversized image resizing, format detection.

## Group Chats

- Context matters: if message came from a group, reply goes to the group
- Don't DM results to individuals when the group is waiting
- New unknown contacts in groups: use their phone number from message metadata
