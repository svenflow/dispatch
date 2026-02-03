# Messaging System Refactor: Adding a Test Backend

**Date:** 2026-02-01
**Status:** Proposal

---

## Current State

| Source | Reader | Sender | History | Tag |
|--------|--------|--------|---------|-----|
| iMessage | `MessagesReader` (SQLite) | `send-sms` | `read-sms` | `"imessage"` |
| Signal | `SignalListener` (JSON-RPC) | `send-signal` / `send-signal-group` | None | `"signal"` |
| Test | `TestMessageWatcher` (JSON dir) | None | None | `"test"` |

~15 `if source == "signal"` branches across 5 files: `common.py`, `sdk_backend.py`, `sdk_session.py`, `cli.py`, `manager.py`. All just selecting strings (CLI commands, labels, suffixes).

---

## The Fix: One Config Dict

All source-specific behavior is string selection. So: one frozen dataclass, one lookup dict.

```python
# assistant/backends.py
from dataclasses import dataclass

@dataclass(frozen=True)
class BackendConfig:
    name: str              # "imessage", "signal", "test"
    label: str             # "SMS", "SIGNAL", "TEST"
    session_suffix: str    # "", "-signal", "-test"
    registry_prefix: str   # "", "signal:", "test:"
    send_cmd: str          # CLI template with {chat_id}
    send_group_cmd: str    # CLI template for groups
    history_cmd: str       # CLI template or "" if unavailable

BACKENDS = {
    "imessage": BackendConfig(
        name="imessage", label="SMS", session_suffix="", registry_prefix="",
        send_cmd='~/code/sms-cli/send-sms "{chat_id}"',
        send_group_cmd='~/code/sms-cli/send-sms "{chat_id}"',
        history_cmd='~/code/sms-cli/read-sms --chat "{chat_id}" --limit {limit}',
    ),
    "signal": BackendConfig(
        name="signal", label="SIGNAL", session_suffix="-signal", registry_prefix="signal:",
        send_cmd='~/code/signal/send-signal "{chat_id}"',
        send_group_cmd='~/code/signal/send-signal-group "{chat_id}"',
        history_cmd="",
    ),
    "test": BackendConfig(
        name="test", label="TEST", session_suffix="-test", registry_prefix="test:",
        send_cmd='~/code/claude-assistant/tools/test-send "{chat_id}"',
        send_group_cmd='~/code/claude-assistant/tools/test-send "{chat_id}"',
        history_cmd='~/code/claude-assistant/tools/test-read --chat "{chat_id}" --limit {limit}',
    ),
}

def get_backend(source: str) -> BackendConfig:
    return BACKENDS.get(source, BACKENDS["imessage"])
```

Changes vs previous revision:
- Dropped `send_tool_marker` — derive from `send_cmd` at the one call site that needs it (stop hook can just check if any backend's `send_cmd` basename appears in tool history)
- `history_cmd` is `""` instead of `Optional[None]` — simpler truthiness check, no `Optional` import
- Removed the `"message"` placeholder from send_cmd templates — sessions already know to append the message arg

---

## What Changes Where

Every change is the same pattern: replace `if source == "signal"` with `backend = get_backend(source)`.

| File | Function | What changes |
|------|----------|-------------|
| `common.py` | `get_session_name()` | `f"{name}{backend.session_suffix}"` |
| `common.py` | `wrap_sms()` | `backend.label`, `backend.send_cmd` |
| `common.py` | `wrap_group_message()` | `backend.label`, `backend.send_group_cmd` |
| `sdk_backend.py` | `inject_message()` | `f"{backend.registry_prefix}{chat_id}"` |
| `sdk_backend.py` | `_build_individual_system_prompt()` | send_cmd, history_cmd, label |
| `sdk_backend.py` | `_build_group_system_prompt()` | send_cmd, history_cmd |
| `sdk_backend.py` | `_create_session_unlocked()` | Signal CLAUDE.md — **leave as-is**, generalize later if needed |
| `sdk_session.py` | `_stop_hook()` | Check `backend.send_cmd` basename instead of hardcoded strings |
| `cli.py` | `cmd_inject_prompt()` | Loop `BACKENDS` for prefix match instead of `if startswith("signal:")` |

**Not touched:** `manager.py` — readers are fundamentally different I/O (SQLite vs socket vs filesystem), not worth unifying. `_send_sms()`/`_send_signal()` only used by HEALME/RESTART admin notifications, fine as-is.

---

## New: Test Messaging CLIs

**`tools/test-send`** — Write JSON to `~/.claude/test-messages/outbox/{timestamp}.json`
```bash
tools/test-send "+1234567890" "hello"
```

**`tools/test-read`** — Read from inbox + outbox, filter by chat_id, format like read-sms
```bash
tools/test-read --chat "+1234567890" --limit 20
```

Directory layout (inbox already exists for TestMessageWatcher):
```
~/.claude/test-messages/
  inbox/    # Drop JSON to simulate incoming
  outbox/   # test-send writes here
```

---

## Gotchas

1. **Test contacts**: Test messages with fake phone numbers hit the "unknown sender" path. Use real contact phone numbers or add test contacts to Contacts.app.
2. **Group ID asymmetry**: `inject_message()` adds registry prefix for individuals. `inject_group_message()` does not (group IDs are already unique). This is correct — just document it.
3. **Registry prefix stripping**: `cli.py` must strip prefix early, pass `source` separately through IPC.

---

## Implementation Order

**Phase 1 — Pure refactor (zero behavior change):**
1. Create `assistant/backends.py`
2. Replace branching in `common.py`
3. Replace branching in `sdk_backend.py`
4. Replace branching in `sdk_session.py` and `cli.py`

**Phase 2 — New functionality:**
5. Build `tools/test-send` and `tools/test-read`
6. End-to-end test: inbox JSON → daemon → session with test commands → test-send → outbox → test-read

---

## Files Changed

| File | Change |
|------|--------|
| `assistant/backends.py` | **New** — ~40 lines |
| `assistant/common.py` | Replace 3 if/else blocks |
| `assistant/sdk_backend.py` | Replace 4 if/else blocks |
| `assistant/sdk_session.py` | Replace 1 hardcoded check |
| `assistant/cli.py` | Replace 1 prefix check |
| `tools/test-send` | **New** |
| `tools/test-read` | **New** |

## Done When

- No `if source ==` branches remain
- Adding a 4th backend = adding one entry to `BACKENDS`
- Test flow: inbox JSON → daemon → session → test-send → outbox → test-read
