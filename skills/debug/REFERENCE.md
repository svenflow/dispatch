# Dispatch System Reference

## Timestamp Rosetta Stone

| Source | Format | Storage | Conversion to Unix Epoch |
|--------|--------|---------|--------------------------|
| chat.db (message.date) | Core Data nanoseconds | INTEGER | `ts / 1e9 + 978307200` |
| bus.db records.timestamp | Unix milliseconds | INTEGER | `ts / 1000` |
| bus.db sdk_events.timestamp | Unix milliseconds | INTEGER | `ts / 1000` |
| sessions.json timestamps | ISO 8601 | TEXT | `datetime.fromisoformat(ts)` |
| Log files | `YYYY-MM-DD HH:MM:SS` | TEXT | grep-based |
| Perf JSONL (ts field) | ISO 8601 | TEXT | `datetime.fromisoformat(ts)` |
| Perf tool_execution (value) | milliseconds duration | FLOAT | N/A (duration, not timestamp) |

### Core Data Epoch
macOS uses an epoch of 2001-01-01 00:00:00 UTC = Unix timestamp 978307200.
- chat.db stores nanoseconds since Core Data epoch
- To Unix seconds: `chat_db_date / 1_000_000_000 + 978307200`
- To Unix ms: `chat_db_date / 1_000_000 + 978307200 * 1000`

## Log Files

| Path | Purpose | Format |
|------|---------|--------|
| `~/dispatch/logs/manager.log` | Main daemon log | `YYYY-MM-DD HH:MM:SS \| level \| message` |
| `~/dispatch/logs/session_lifecycle.log` | Session create/restart/kill events | `YYYY-MM-DD HH:MM:SS \| message` |
| `~/dispatch/logs/sessions/{name}.log` | Per-session log (IN/OUT/TOOL_USE/TURN) | `YYYY-MM-DD HH:MM:SS \| message` |
| `~/dispatch/logs/compactions.log` | PreCompact hook events | `YYYY-MM-DD HH:MM:SS \| HOOK \| message` |
| `~/dispatch/logs/watchdog.log` | Watchdog health checks | Text |
| `~/dispatch/logs/watchdog-launchd.log` | Watchdog LaunchAgent stdout/stderr | Text |
| `~/dispatch/logs/launchd.log` | Daemon LaunchAgent stdout/stderr | Text |
| `~/dispatch/logs/signal-daemon.log` | Signal CLI daemon log | Text |
| `~/dispatch/logs/perf-YYYY-MM-DD.jsonl` | Performance metrics | JSONL |
| `~/dispatch/logs/memory-consolidation.log` | Memory consolidation runs | Text |
| `~/dispatch/logs/chat-context-consolidation.log` | Chat context consolidation | Text |

Session log names: session_name with `/` replaced by `-` (e.g., `imessage/_16175969496` -> `imessage-_16175969496.log`).

## Bus Topics & Event Types

### messages (keyed by chat_id)
- `message.received` — Inbound message detected from chat.db/signal
- `message.sent` — Outbound message sent via send-sms/send-signal
- `message.failed` — Send failed
- `message.produce_failed` — Bus produce failed
- `message.processing_failed` — Processing pipeline error
- `message.ignored` — Message ignored (unknown tier, etc.)
- `reaction.received` — Tapback/reaction detected
- `reaction.ignored` — Reaction ignored

### sessions (keyed by chat_id)
- `session.created` — New SDK session started
- `session.restarted` — Session restarted (compaction, health, etc.)
- `session.killed` — Session explicitly killed
- `session.crashed` — Session died unexpectedly
- `session.compacted` — Context compaction completed
- `session.injected` — Message injected into session
- `session.idle_killed` — Killed due to inactivity
- `session.prewarmed` — Pre-warmed session created
- `session.tier_mismatch` — Tier changed, session reconfigured
- `session.prompt_built` — System prompt assembled
- `session.receive_error` — SDK receive loop error
- `session.stop_failed` — Failed to stop cleanly
- `session.model_changed` — Model upgraded/downgraded
- `permission.denied` — Tool blocked by tier policy
- `command.restart` — Restart command received

### system (keyed by component/session_name)
- `daemon.started/stopped/crashed/recovered`
- `health.check_completed/failed/fast_check_completed/deep_check_completed`
- `health.service_restarted/service_spawned`
- `sdk.turn_complete` — Claude finished processing (has duration_ms, num_turns, is_error)
- `session.heartbeat` — Session liveness proof (every 2 min, has queue_depth, pending_queries)
- `compaction.triggered` — PreCompact hook fired
- `signal.connection_state`

### tasks (keyed by requested_by chat_id)
- `task.requested/started/completed/failed/timeout/skipped`

### reminders (keyed by chat_id)
- `reminder.due`

### Source Column Semantics
- **messages**: transport — `imessage`, `signal`, `test`
- **sessions**: origin — `daemon`, `health`, `ipc`, `inject`, `sdk`
- **system**: component — `daemon`, `watchdog`, `health`, `sdk`, `signal`, `compaction`

## sdk_events Schema

```sql
CREATE TABLE sdk_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,        -- Unix milliseconds
    session_name TEXT NOT NULL,         -- e.g. "imessage/+16175969496"
    chat_id TEXT,
    event_type TEXT NOT NULL,           -- "tool_use", "tool_result", "result", "error"
    tool_name TEXT,                     -- e.g. "Bash", "Read", "Edit"
    tool_use_id TEXT,
    duration_ms REAL,
    is_error INTEGER DEFAULT 0,
    payload TEXT,                       -- Error message for errors
    num_turns INTEGER
);
-- Indexes: idx_sdk_session (session_name, timestamp), idx_sdk_type
```

## chat.db Key Tables & Queries

```sql
-- Recent messages for a phone number
SELECT m.ROWID, m.date, COALESCE(h.id, 'me') as phone,
       m.is_from_me, m.text, m.attributedBody
FROM message m
JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
JOIN chat c ON cmj.chat_id = c.ROWID
LEFT JOIN handle h ON m.handle_id = h.ROWID
WHERE c.chat_identifier = ?
ORDER BY m.date DESC LIMIT ?;

-- Core Data timestamp conversion
-- To datetime: datetime(date/1000000000 + 978307200, 'unixepoch', 'localtime')
-- To unix ms: date / 1000000 + 978307200000
```

## Health Check Architecture

Two-tier system (see `~/dispatch/assistant/health.py`):
1. **Tier 1 (every 60s)**: Regex scan of recent transcript for fatal patterns
   - `invalid_request_400`, `image_too_large`, `context_too_long`, `auth_error`, etc.
2. **Tier 2 (every 5 min)**: Haiku LLM classification of recent assistant messages
   - Determines FATAL vs HEALTHY

Session health (`sdk_session.py`): `is_healthy()` checks:
- `is_alive()` — task running and not done
- `_error_count < 3` — not too many errors
- `_consecutive_error_turns < 3` — not stuck in error loop
- Queue not stale (pending messages for >10 min)
- Not stuck (injected but no ResultMessage for >10 min)

## State Files

| Path | Format | Contents |
|------|--------|----------|
| `~/dispatch/state/sessions.json` | JSON | Session registry: chat_id -> {session_name, contact_name, tier, ...} |
| `~/dispatch/state/bus.db` | SQLite | Message bus (records, consumer_offsets, consumer_members, sdk_events) |
| `~/dispatch/state/daemon.pid` | Text | Daemon process ID |
| `~/Library/Messages/chat.db` | SQLite | macOS Messages database (read-only) |

## IPC Protocol

Sessions are managed via the Agent SDK (ClaudeSDKClient). The daemon:
1. Polls chat.db every 100ms for new messages
2. Listens to Signal JSON-RPC socket at `/tmp/signal-cli.sock`
3. Routes messages to SDKSession instances via `inject(text)`
4. Sessions use `query()` to send to Claude and `receive_messages()` to get responses
5. Claude calls send-sms/send-signal via Bash tool to reply

## Watchdog System

LaunchAgent at `~/Library/LaunchAgents/com.sven.dispatch-watchdog.plist`:
- Runs `~/dispatch/bin/watchdog` every 60s
- Checks if daemon PID is alive
- On failure: spawns healing Claude session, sends admin SMS
- Logs to `~/dispatch/logs/watchdog.log`

## Common Debugging Queries

```bash
# Recent bus events for a chat_id
sqlite3 ~/dispatch/state/bus.db \
  "SELECT datetime(timestamp/1000,'unixepoch','localtime'), type, source, payload
   FROM records WHERE key='+16175969496' ORDER BY timestamp DESC LIMIT 10"

# Recent SDK tool calls for a session
sqlite3 ~/dispatch/state/bus.db \
  "SELECT datetime(timestamp/1000,'unixepoch','localtime'), event_type, tool_name, duration_ms, is_error
   FROM sdk_events WHERE session_name='imessage/+16175969496' ORDER BY timestamp DESC LIMIT 20"

# Failed messages in last hour
sqlite3 ~/dispatch/state/bus.db \
  "SELECT datetime(timestamp/1000,'unixepoch','localtime'), key, payload
   FROM records WHERE type='message.failed' AND timestamp > (strftime('%s','now')-3600)*1000"

# Session heartbeat gaps
sqlite3 ~/dispatch/state/bus.db \
  "SELECT datetime(timestamp/1000,'unixepoch','localtime'), key, json_extract(payload,'$.queue_depth')
   FROM records WHERE type='session.heartbeat' ORDER BY timestamp DESC LIMIT 20"

# Bus size and record counts
sqlite3 ~/dispatch/state/bus.db \
  "SELECT topic, COUNT(*), MIN(datetime(timestamp/1000,'unixepoch','localtime')),
          MAX(datetime(timestamp/1000,'unixepoch','localtime'))
   FROM records GROUP BY topic"
```
