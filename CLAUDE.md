# Dispatch - Personal Assistant System

**GitHub:** https://github.com/YOUR-USERNAME/dispatch

You are a personal assistant with full access to this computer. Act like a human would. Your name comes from config.local.yaml (assistant.name).

## File Organization

Put things where they belong:
- **Code** → `~/code/`
- **Documents** → `~/Documents/`
- **Skills** → `~/.claude/skills/`
- **This project** → `~/dispatch/`

## Python Environment

**ALWAYS use `uv` for Python package management, NEVER pip3.**

This project uses a venv at `~/dispatch/.venv/`

```bash
cd ~/dispatch

# Install packages - ALWAYS add to pyproject.toml, never bare uv pip install
# 1. Edit pyproject.toml to add the dependency
# 2. Run: uv sync

# Run scripts
uv run python script.py
```

**CRITICAL: Never install packages with bare `uv pip install`.** Always add dependencies to `pyproject.toml` and run `uv sync`. This ensures deps survive venv recreation and are tracked in version control.

## Communication

You communicate with humans via SMS/iMessage using the skills in `~/.claude/skills/`:
- `/contacts` - Manage contacts and tiers
- `/imessage` - Read and send messages

## Tier System

Contacts are organized by tier (via macOS Contacts groups):
- **admin** - Full access, own SDK session (e.g., the owner)
- **wife** - Special privileges, own SDK session (e.g., the partner)
- **favorite** - Own SDK session, restricted tools
- **family** - Own SDK session, read-only mutations need approval

## Architecture

The system uses the **Claude Agent SDK** (`claude_agent_sdk`) to manage sessions. Each contact gets an in-process `ClaudeSDKClient` instance — no tmux, no subprocess shells.

```
~/dispatch/
├── assistant/
│   ├── manager.py       # Main daemon: polls messages, routes to sessions
│   ├── sdk_backend.py   # SDKBackend: manages all SDK sessions
│   ├── sdk_session.py   # SDKSession: wraps ClaudeSDKClient per contact
│   ├── backends.py      # BackendConfig: messaging backend definitions (imessage/signal/test)
│   ├── cli.py           # CLI entrypoint (claude-assistant command)
│   └── common.py        # Shared constants and helpers
├── state/               # Persistent state
│   ├── last_rowid.txt   # Last processed iMessage ROWID
│   └── sessions.json  # Maps chat_id → session metadata
├── logs/
│   ├── manager.log      # Main daemon log
│   ├── session_lifecycle.log  # Session create/kill/restart events
│   └── sessions/        # Per-session logs (john-smith.log, etc.)
├── .venv/               # Python virtual environment
└── CLAUDE.md            # This file
```

### Key design: no auto-send

SDK sessions do NOT auto-send text output as SMS. Claude calls `send-sms` explicitly via Bash tool when it wants to message the user — same as the old tmux setup. The SDK just manages the Claude process lifecycle.

### Session flow

1. Message arrives in chat.db → daemon polls it
2. Contact lookup → tier determination
3. `SDKBackend.inject_message()` → creates session on-demand if needed
4. Message wrapped in SMS tags → queued into `SDKSession._message_queue`
5. `SDKSession._run_loop()` pulls from queue → `client.query()` → processes response
6. Claude calls `send-sms` via Bash when it wants to reply

### Session resume

Sessions save their `session_id` to `session_registry.json` on shutdown. On restart, `ClaudeSDKClient` resumes from that ID so conversation context is preserved.

## Running the System

```bash
claude-assistant start      # Start the daemon
claude-assistant stop       # Stop the daemon
claude-assistant restart    # Restart the daemon
claude-assistant status     # Show status and active sessions
claude-assistant logs       # Tail the log file
claude-assistant attach <session>  # Tail a session's log file

claude-assistant install    # Install LaunchAgent (auto-start on boot)
claude-assistant uninstall  # Remove LaunchAgent
```

The manager daemon:
1. Polls Messages.app chat.db every 100ms
2. Looks up sender's tier via contacts CLI
3. Routes to SDK session (created on-demand)
4. Health checks sessions every 5 minutes, auto-restarts if unhealthy
5. Kills idle sessions after 2 hours

## Watchdog (Auto-Recovery)

The watchdog monitors the daemon and automatically recovers from crashes. It runs as a separate LaunchAgent, checking daemon health every 60 seconds.

### What it does

1. **Detects daemon crashes** - Runs `claude-assistant status` every 60s
2. **Spawns healing Claude** - On crash, spawns a Claude instance with `--dangerously-skip-permissions` to diagnose and fix
3. **Notifies admin** - Sends SMS to admin at each recovery attempt
4. **Exponential backoff** - Waits progressively longer between attempts (60s, 120s, 240s, ...)
5. **Gives up gracefully** - After 5 consecutive failures, alerts admin for manual intervention

### Installation

```bash
~/dispatch/bin/watchdog-install    # Install and start watchdog
~/dispatch/bin/watchdog-uninstall  # Stop and remove watchdog
~/dispatch/bin/watchdog-status     # Check watchdog status
```

The install script copies `launchd/com.dispatch.watchdog.plist` to `~/Library/LaunchAgents/` and loads it.

### How the healer works

When the daemon is down:
1. Watchdog acquires a lock to prevent duplicate healers
2. Spawns Claude with a recovery prompt that:
   - Restarts daemon via `launchctl kickstart` (has Full Disk Access)
   - Checks logs for crash cause
   - Restarts recently-active sessions
   - Sends status SMS to admin
3. Healer has 15-minute timeout
4. If recovery succeeds, crash counter resets
5. If recovery fails, backs off and retries next cycle

### Files

- `bin/watchdog` - Main watchdog script
- `bin/watchdog-install` - Installation script
- `bin/watchdog-uninstall` - Uninstall script
- `bin/watchdog-status` - Status check
- `launchd/com.dispatch.watchdog.plist` - LaunchAgent plist
- `logs/watchdog.log` - Watchdog activity log
- `logs/watchdog-launchd.log` - launchd stdout/stderr

### Troubleshooting

```bash
# Check if watchdog is running
launchctl list com.dispatch.watchdog

# View recent watchdog activity
tail -20 ~/dispatch/logs/watchdog.log

# Force daemon restart (bypasses backoff)
rm -f /tmp/dispatch-watchdog-crashes.txt
~/dispatch/bin/watchdog
```

## Transcript Directories

Each contact has their own directory, organized by backend:

```
~/transcripts/
├── imessage/
│   ├── _15555550100/           # Phone number (+ replaced with _)
│   │   └── .claude -> ~/.claude
│   └── b3d258b9a4de447ca412eb335c82a077/  # Group UUID
│       └── .claude -> ~/.claude
├── signal/
│   └── _15555550100/
│       └── .claude -> ~/.claude
└── master/                     # Master session (unchanged)
```

Session names use the format `{backend}/{sanitized_chat_id}` (e.g., `imessage/_15555550100`).

SDK sessions run with `cwd` set to the transcript directory, so skills and CLAUDE.md are picked up automatically via the `.claude` symlink.

## Session Startup

When a session is created (first message from contact):
1. `SDKSession` creates a `ClaudeSDKClient` with tier-appropriate tools and permissions
2. If a saved `session_id` exists in registry, resumes from it
3. If fresh session, injects system prompt (read SOUL.md, check history, respond naturally)
4. Session waits for messages on its async queue

## Testing

**CRITICAL: Always run integration tests when touching daemon/manager/CLI/backend code.**

```bash
cd ~/dispatch

# Run ALL tests - DO THIS BEFORE COMMITTING
uv run --group dev pytest tests/ -v

# Run just the core integration tests (fastest feedback loop)
uv run --group dev pytest tests/test_backends.py tests/test_session_lifecycle.py tests/test_registry.py tests/test_health_checks.py tests/test_message_routing.py tests/test_performance.py -v

# Run just unit tests
uv run --group dev pytest tests/unit/ -v
```

### What to test when

| Changed file | Tests to run |
|---|---|
| `backends.py` | `test_backends.py` (config, routing, wrapping) |
| `common.py` | `test_backends.py` + `test_message_routing.py` (normalize, is_group, wrap) |
| `sdk_session.py` | `test_session_lifecycle.py` (lifecycle, health, errors, stop hook) |
| `sdk_backend.py` | `test_session_lifecycle.py` + `test_health_checks.py` + `test_performance.py` |
| `manager.py` | `test_message_routing.py` (TestMessageWatcher normalization) |
| `cli.py` | `test_registry.py` (registry operations used by CLI) |

### Test Structure

```
tests/
├── conftest.py                  # Mock ClaudeSDKClient + shared fixtures
├── test_backends.py             # Backend config, routing, normalize, wrap (46 tests)
├── test_session_lifecycle.py    # Session start/stop/inject, health, errors, stop hook (34 tests)
├── test_registry.py             # Registry CRUD, persistence, concurrency (14 tests)
├── test_health_checks.py        # Health checks, idle reaping, exemptions (9 tests)
├── test_message_routing.py      # TestMessageWatcher normalization, file handling (16 tests)
├── test_performance.py          # Concurrency, throughput, leaks, lock fairness (19 tests)
├── unit/                        # Pure function tests (no I/O)
│   ├── test_poll_due.py         # Reminder tag parsing, timestamps
│   ├── test_add_reminder.py     # Time parsing
│   ├── test_memory.py           # Keyword matching
│   ├── test_transcript.py       # SMS extraction
│   └── test_read_transcript.py
├── integration/                 # Integration tests with test doubles
│   ├── conftest.py              # Fixtures: fake chatdb, test env
│   ├── test_sdk_backend.py      # SDK session lifecycle tests
│   └── test_example.py          # Example integration tests
├── bin/                         # Test doubles (fake CLIs)
│   ├── test-claude              # Fake Claude CLI (no API calls)
│   ├── test-sms                 # Fake SMS sender (logs only)
│   └── test-contacts            # Fake contacts CLI (in-memory)
└── fixtures/                    # Test data
```

### How the test mock works

Tests use a `FakeClaudeSDKClient` (in `conftest.py`) that replaces the real Agent SDK. This lets us test the full session lifecycle — creation, injection, queue processing, health checks, error handling — without hitting the Claude API. The mock supports configurable delays and errors for performance/reliability testing.

### Linting Hook

A PostToolUse hook automatically runs `ruff` and `ty` on Python files after edits.
Configure in `~/.claude/settings.json`.

## Type Checking with ty

This project uses **ty** (Astral's Python type checker) to catch type errors. The `assistant/` directory must pass ty with zero errors.

### Running ty manually

```bash
cd ~/dispatch
uvx ty check --python .venv/bin/python assistant/
```

### Pre-commit hook

A git pre-commit hook automatically runs ty before each commit. If type checking fails, the commit is blocked.

To skip temporarily (not recommended):
```bash
git commit --no-verify
```

### Common type patterns

```python
# Optional parameters - ALWAYS use union syntax
def foo(name: str | None = None):  # ✓ Correct
def foo(name: str = None):          # ✗ Wrong - invalid-parameter-default

# Await async functions
result = await async_func()  # ✓ Correct
result = async_func()        # ✗ Wrong - returns coroutine, not result

# None checks before subscripting
value = d.get("key")
if value is not None:
    use(value["subkey"])  # ✓ ty knows value is not None
```

### Configuration

ty is configured in `pyproject.toml`:

```toml
[tool.ty.environment]
extra-paths = [
    "skills/contacts/scripts",
    "skills/reminders/scripts",
    # ... paths for dynamically imported modules
]
```
