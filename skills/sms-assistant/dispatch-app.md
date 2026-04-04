# Dispatch App Backend Rules

This file contains dispatch-app-specific behavioral rules. Read it immediately at session start.

## Sending Messages

```bash
# Send a text reply
~/.claude/skills/dispatch-app/scripts/reply-app "{chat_id}" "your message"

# Or pipe via stdin (for long messages or heredoc)
cat <<'EOF' | ~/.claude/skills/dispatch-app/scripts/reply-app "{chat_id}"
your message here
EOF
```

The universal `reply` CLI also works from within a transcript directory (auto-detects chat_id).

## No Tapback — Use Emoji Text Instead

The dispatch app does **not** support native tapback reactions. Use emoji in text instead:

- Instead of a 👍 tapback, send `"👍"` as a text message
- Same for ❤️, 😂, ‼️, etc.

**Acknowledgment pattern:**
```
User: "can you check if the daemon is running"
You: reply-app "{chat_id}" "on it 👍"    ← short text ack
You: [check daemon status]
You: reply-app "{chat_id}" "yeah it's running, 3 sessions active"
```

## Markdown Renders Natively

The dispatch app renders markdown — use it freely:
- **Bold**, _italic_, `code`, bullet lists, headers all render properly
- No need to use plaintext-style formatting workarounds

## Widget Support

The app supports structured widgets via `reply-widget`. Use these when a simple text reply isn't enough.

### Ask Question (multiple choice)

```bash
cat <<'EOF' | ~/.claude/skills/dispatch-app/scripts/reply-widget "{chat_id}" ask_question
{"questions":[{"question":"...","options":[{"label":"A"},{"label":"B"}]}]}
EOF
```

Options:
- 1-4 questions, 2-4 options each
- "multi_select": true → checkboxes instead of radio
- "include_other": false → hide "Other" option
- All questions shown at once with a Save button
- Response arrives as: [Widget Response <id>] with per-question answers

### Progress Tracker

```bash
cat <<'EOF' | ~/.claude/skills/dispatch-app/scripts/reply-widget "{chat_id}" progress_tracker
{"steps":[{"label":"Step 1","status":"complete"},{"label":"Step 2","status":"in_progress"},{"label":"Step 3"}]}
EOF
```

Statuses: complete, in_progress, (omit for pending)

### Map Pin

```bash
cat <<'EOF' | ~/.claude/skills/dispatch-app/scripts/reply-widget "{chat_id}" map_pin
{"pins":[{"latitude":42.36,"longitude":-71.06,"label":"Boston"}]}
EOF
```

## Reading Messages

The dispatch app doesn't use chat.db — messages come via dispatch-messages.db:

```bash
# Read recent messages for a specific chat (equivalent of read-sms)
uv run ~/.claude/skills/dispatch-app/scripts/read-dispatch-app --chat "{chat_id}" --limit 20
```

# Or use transcript reader for SDK session history

```bash
uv run ~/.claude/skills/sms-assistant/scripts/read_transcript.py --session dispatch-app/{chat_id}
```

## Images

Sending images is supported:

```bash
~/.claude/skills/dispatch-app/scripts/reply-app "{chat_id}" --image "/path/to/image.png"
```

## Group Chats

- If message came from a group (group chat_id), reply goes back to that group
- Same reply-app CLI handles both individual and group chat_ids
