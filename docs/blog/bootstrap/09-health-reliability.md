# 09: Health Checks and Reliability

## Goal

Keep the system running reliably 24/7:
- Detect and restart unhealthy sessions
- Clean up idle sessions to save resources
- Recover gracefully from errors

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Manager Daemon                        │
│                                                          │
│  Every 5 minutes:                                        │
│    health_check_all()                                    │
│      ├── Check each session is_alive()                  │
│      ├── Restart if error_count >= 3                    │
│      └── check_idle_sessions(threshold=2h)              │
│            └── Kill sessions idle > 2 hours             │
│                (except master/-bg sessions)              │
└─────────────────────────────────────────────────────────┘
```

**GitHub:**
- [`assistant/sdk_backend.py`](https://github.com/jsmith/dispatch/blob/main/assistant/sdk_backend.py) - Health check implementation
- [`assistant/sdk_session.py`](https://github.com/jsmith/dispatch/blob/main/assistant/sdk_session.py) - Session health state

## Health Check Logic

### Session Health (`sdk_session.py`)

Each session tracks:
- `_error_count`: Incremented on errors, reset on success
- `last_activity`: Updated on every message
- `running`: Whether the run loop is active

```python
def is_alive(self) -> bool:
    """Session is healthy if connected and not errored out."""
    return (
        self.running and
        self._client is not None and
        self._error_count < 3
    )
```

### Backend Health Checks (`sdk_backend.py`)

```python
async def health_check_all(self):
    """Run every 5 minutes via scheduled task."""
    for chat_id, session in list(self.sessions.items()):
        if not session.is_alive():
            logger.warning(f"Session {chat_id} unhealthy, restarting")
            await self.restart_session(chat_id)
```

## Idle Session Cleanup

Sessions that haven't received a message in 2 hours are killed to free resources:

```python
async def check_idle_sessions(self, threshold_hours: float = 2.0):
    """Kill sessions idle for too long."""
    now = datetime.now()

    for chat_id, session in list(self.sessions.items()):
        # Skip special sessions
        if self._is_exempt_from_idle(chat_id):
            continue

        idle_time = now - session.last_activity
        if idle_time.total_seconds() > threshold_hours * 3600:
            await self.kill_session(chat_id)
```

### Exempt Sessions

Some sessions are never killed:
- **Master session**: The main admin session
- **Background sessions**: Sessions with `-bg` suffix
- Sessions with explicit `exempt_from_idle` flag

## Error Recovery

### Automatic Restart

When a session hits 3 consecutive errors:
1. Health check detects `is_alive() == False`
2. Session is killed
3. Fresh session is created on next message

### Graceful Degradation

If Claude API is down:
- Sessions queue messages instead of failing
- When API recovers, queued messages are processed
- No messages are lost

## Configuration

Key constants in the codebase:

| Constant | Value | Location |
|----------|-------|----------|
| `HEALTH_CHECK_INTERVAL` | 300s (5 min) | `manager.py` |
| `IDLE_SESSION_TIMEOUT` | 2.0 hours | `sdk_backend.py` |
| `MAX_ERROR_COUNT` | 3 | `sdk_session.py` |
| `POLL_INTERVAL` | 0.1s (100ms) | `manager.py` |

## Monitoring

### Logs

```bash
# Main daemon log
tail -f ~/dispatch/logs/manager.log

# Session lifecycle events
tail -f ~/dispatch/logs/session_lifecycle.log

# Individual session logs
tail -f ~/dispatch/logs/sessions/<session-name>.log
```

### CLI Status

```bash
claude-assistant status
# Shows: running sessions, health status, idle times
```

## Verification Checklist

- [ ] Health checks run every 5 minutes (check logs)
- [ ] Unhealthy sessions auto-restart
- [ ] Idle sessions are killed after 2 hours
- [ ] Master/-bg sessions are exempt from idle kill
- [ ] Errors don't crash the daemon

## What's Next

`10-testing.md` covers the test suite and how to test without hitting the Claude API.

---

## Gotchas

1. **Don't kill too aggressively**: The 2-hour idle timeout is conservative. Active conversations should never be killed.

2. **Error count reset**: The error count resets on successful message processing, so transient errors don't cause unnecessary restarts.

3. **Session resume**: When a session is restarted, it resumes from its saved `session_id`, preserving conversation context.
