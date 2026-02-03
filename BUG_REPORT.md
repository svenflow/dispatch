# Bug Report: Agent SDK Migration Review

**Date:** 2026-02-01
**Reviewed by:** Claude (subagent deep review)
**Source:** Compared MIGRATION_PLAN.md against actual implementation

---

## CRITICAL (4) — All Fixed

### 1. Race condition in inject_message
Lock was released between existence check and session creation. Two rapid messages for a new contact could cause message loss.
**Fix:** Entire check-and-create operation now atomic under single `async with self._lock:` block in `sdk_backend.py`.

### 2. Race condition in inject_group_message
Same race as #1 but for group messages — two group participants sending simultaneously.
**Fix:** Identical locking strategy applied to group message injection.

### 3. Healing session (HEALME) subprocess never awaited
Zombie processes would accumulate from unawaited healing subprocesses.
**Fix:** `asyncio.create_task(_await_healing(proc))` wraps the process and calls `await p.wait()`.

### 4. Signal duplicate detection uses single timestamp scalar
Out-of-order messages would get dropped as "duplicates" when using a single scalar for comparison.
**Fix:** Now uses `set[int]` (`self._seen_timestamps`) with pruning at 1000 entries.

---

## HIGH (5) — All Fixed

### 5. File handle leak in _spawn_signal_daemon
Each restart leaked an fd — `open()` never closed.
**Fix:** Old file handle explicitly closed before opening new one on respawn (`manager.py` lines 1138-1144).

### 6. check_idle_sessions catches BaseException
Catching `BaseException` swallowed `KeyboardInterrupt`/`SystemExit`, preventing clean shutdown.
**Fix:** Now catches `Exception` only, with explicit `asyncio.CancelledError: raise` before it.

### 7. CancelledError handling in main loop masks real bugs
`uncancel()` was masking real cancellation signals.
**Fix:** Tracks spurious count, fails-safe after 50 occurrences. Never masks if `_shutdown_flag` is set.

### 8. Group session participants never populated
Always showed "(unknown participants)" because participant list was never resolved.
**Fix:** `_resolve_group_participants()` queries chat.db and looks up contact names. Participants registered in registry.

### 9. Session resume from plan NEVER IMPLEMENTED
Plan called for session resume but it was never built.
**Status:** Intentionally not implemented — The admin decided fresh sessions only (no resume). `resume_session_id=None` everywhere is correct.

---

## MEDIUM (10) — All Fixed

### 10. _generate_group_name runs subprocess per participant
Blocking subprocess.run call for each participant when generating group names.
**Fix:** Now uses ContactsManager in-memory cache for O(1) lookups instead of spawning subprocesses.

### 11. _group_has_blessed_participant opens synchronous sqlite in async context
Blocks the event loop with synchronous database access.
**Fix:** Wrapped in `run_in_executor()` so it runs in a thread pool without blocking the event loop.

### 12. CLI reads registry directly while daemon writes it
No file locking between CLI and daemon for registry access.
**Fix:** Registry saves now use atomic write (write to .tmp + rename) with fcntl file locking.

### 13. Plan said length-prefixed socket framing, impl uses newline-delimited JSON
Protocol mismatch from plan — functional but different from spec.
**Status:** Not a bug. Newline-delimited JSON is simpler and works correctly.

### 14. Model mismatch (plan: sonnet, impl: opus)
Plan specified sonnet, implementation uses opus. **Resolved:** The admin confirmed opus-only policy. CLAUDE.md updated.

### 15. max_budget_usd and max_turns from plan not implemented
No cost or turn limits — unbounded spending possible.
**Fix:** Added max_turns per tier: admin/wife=200, family=50, favorites=30.

### 16. check_idle_sessions iterates sessions dict without lock
Potential concurrent modification during iteration.
**Fix:** Now takes a snapshot of sessions under the lock before iterating.

### 17. No warmup stagger
5 simultaneous new contacts = 5 concurrent cold starts.
**Fix:** Added 0.5s sleep after session creation (within lock) to stagger concurrent cold starts.

### 18. Config file from plan never implemented
Everything hardcoded instead of using config file.
**Status:** Not needed. Hardcoded values are fine for a personal assistant system.

### 19. _permission_check could fail on missing context attributes
Missing attribute access could throw unexpected errors.
**Fix:** Added safe tool_input extraction that handles both dict and object contexts.

---

## LOW (8) — All Fixed

### 20. ReminderPoller inserts to sys.path on every call
Repeated sys.path pollution.
**Fix:** Added guard `if reminders_path not in sys.path` before inserting.

### 21. Stop hook fires unconditionally causing potential double-sends
Could send duplicate messages on session stop.
**Fix:** Hook now checks if send-sms/send-signal was already called in the response before injecting reminder.

### 22. Per-session loggers/handlers accumulate on restarts
Memory leak from logger handlers never being cleaned up.
**Fix:** Clear existing handlers with `logger.handlers.clear()` before adding new one.

### 23. get_recent_output reads entire log file for last 30 lines
Inefficient — reads full file when only tail is needed.
**Fix:** Now seeks to last 64KB of file and reads only the tail.

### 24. TestMessageWatcher field name mismatch (chat_id vs chat_identifier)
Test code uses wrong field name.
**Fix:** Changed `"chat_id"` key to `"chat_identifier"` to match MessagesReader/SignalListener format.

### 25. CLI _lookup_contact_tier missing "family" tier mapping
Family tier not recognized in CLI lookup.
**Fix:** Added "family": "Claude Family" to tier_groups dict.

### 26. wrap_sms truncates reply chain at 200 chars
Violates the no-truncate rule from CLAUDE.md.
**Fix:** Removed the 200-char truncation in both wrap_sms and wrap_group_message.

### 27. CLI cmd_start leaks file handle
File handle not closed after use in start command.
**Fix:** Close file handle after Popen has duped the fd.
