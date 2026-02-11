---
name: sven-app
description: Backend for Sven iOS voice assistant app. Handles message storage and TTS generation for in-app responses.
---

# Sven App Backend

This skill provides the backend infrastructure for the Sven iOS voice assistant app.

## Architecture

```
iOS App → POST /prompt → sven-api → inject-prompt → SDK Session
                                                        ↓
                                              Claude generates response
                                                        ↓
                                              calls reply-sven CLI
                                                        ↓
                                    reply-sven stores message + generates TTS
                                                        ↓
iOS App ← GET /messages ← sven-api ← reads from SQLite message bus
iOS App ← GET /audio/{id} ← serves TTS audio files
```

## Components

### Message Bus (SQLite)
Location: `~/dispatch/state/sven-messages.db`

```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,  -- 'user' or 'assistant'
    content TEXT NOT NULL,
    audio_path TEXT,     -- path to TTS audio file (assistant only)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### reply-sven CLI
Location: `~/.claude/skills/sven-app/scripts/reply-sven`

Called by Claude to send responses. Stores message in SQLite and generates TTS audio.

```bash
~/.claude/skills/sven-app/scripts/reply-sven "voice" "Your response text here"
```

### Session
- Transcript directory: `~/transcripts/sven-app/voice/`
- Session name: `sven-app/voice`
- Tier: admin (full access)

## API Endpoints (sven-api)

- `POST /prompt` - Receive transcript, inject into session
- `GET /messages?since=<timestamp>` - Poll for new messages
- `GET /audio/<id>` - Download TTS audio file
