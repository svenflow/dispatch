# 11: Testing

## Goal

Build a test suite that validates the system without hitting the Claude API. This lets you refactor with confidence.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Test Infrastructure                   │
│                                                          │
│  FakeClaudeSDKClient (conftest.py)                      │
│    ├── Mocks ClaudeSDKClient                            │
│    ├── Tracks queries in FIFO order                     │
│    ├── Configurable delays/errors                       │
│    └── No API calls                                      │
│                                                          │
│  Test doubles (tests/bin/)                              │
│    ├── test-claude    # Fake Claude CLI                 │
│    ├── test-sms       # Fake SMS sender                 │
│    └── test-contacts  # Fake contacts lookup            │
└─────────────────────────────────────────────────────────┘
```

**GitHub:** [`tests/`](https://github.com/nicklaude/dispatch/tree/main/tests)

## Test Structure

```
tests/
├── conftest.py                  # FakeClaudeSDKClient + fixtures
├── test_backends.py             # Backend config, routing (46 tests)
├── test_session_lifecycle.py    # Session start/stop/inject (34 tests)
├── test_registry.py             # Registry CRUD, persistence (14 tests)
├── test_health_checks.py        # Health, idle reaping (9 tests)
├── test_message_routing.py      # Normalization, wrapping (16 tests)
├── test_performance.py          # Concurrency, throughput (19 tests)
├── unit/                        # Pure function tests
│   ├── test_poll_due.py
│   ├── test_add_reminder.py
│   └── test_memory.py
├── integration/                 # Integration tests
│   └── conftest.py              # Fake chatdb fixtures
└── bin/                         # Test doubles
    ├── test-claude
    ├── test-sms
    └── test-contacts
```

## The FakeClaudeSDKClient

The key to testing without API calls:

```python
# tests/conftest.py

class FakeClaudeSDKClient:
    """Mock SDK client that tracks queries without API calls."""

    def __init__(self):
        self.queries = []  # FIFO queue of received queries
        self.connected = False
        self.delay = 0  # Configurable delay
        self.should_error = False

    async def connect(self):
        self.connected = True

    async def query(self, text: str):
        if self.should_error:
            raise Exception("Simulated error")
        await asyncio.sleep(self.delay)
        self.queries.append(text)

    async def receive_messages(self):
        # Yield fake response
        yield FakeAssistantMessage("Got it!")
        yield FakeResultMessage()

    async def disconnect(self):
        self.connected = False
```

## Running Tests

```bash
cd ~/dispatch

# Run ALL tests
uv run --group dev pytest tests/ -v

# Run core integration tests (fastest feedback)
uv run --group dev pytest tests/test_backends.py \
    tests/test_session_lifecycle.py \
    tests/test_registry.py \
    tests/test_health_checks.py \
    tests/test_message_routing.py \
    tests/test_performance.py -v

# Run just unit tests
uv run --group dev pytest tests/unit/ -v

# Run with coverage
uv run --group dev pytest tests/ --cov=assistant --cov-report=html
```

## What to Test When

| Changed file | Tests to run |
|---|---|
| `backends.py` | `test_backends.py` |
| `common.py` | `test_backends.py` + `test_message_routing.py` |
| `sdk_session.py` | `test_session_lifecycle.py` |
| `sdk_backend.py` | `test_session_lifecycle.py` + `test_health_checks.py` |
| `manager.py` | `test_message_routing.py` |
| `cli.py` | `test_registry.py` |

## Key Test Cases

### Session Lifecycle

```python
async def test_session_starts_and_stops():
    session = SDKSession(...)
    await session.start()
    assert session.is_alive()

    await session.stop()
    assert not session.is_alive()

async def test_message_injection():
    session = SDKSession(...)
    await session.start()

    await session.inject("Hello")
    # Verify message was queued and processed
    assert "Hello" in fake_client.queries
```

### Health Checks

```python
async def test_unhealthy_session_restarts():
    backend = SDKBackend()
    await backend.inject_message("+1234", "Hi", contact_info)

    # Simulate errors
    session = backend.sessions["+1234"]
    session._error_count = 3

    await backend.health_check_all()
    # Session should have been restarted
    assert backend.sessions["+1234"]._error_count == 0
```

### Performance

```python
async def test_concurrent_sessions():
    """Verify 10 concurrent sessions don't deadlock."""
    backend = SDKBackend()

    tasks = [
        backend.inject_message(f"+{i}", "Hi", info)
        for i in range(10)
    ]
    await asyncio.gather(*tasks)

    assert len(backend.sessions) == 10
```

## Linting Hook

A PostToolUse hook automatically runs linters after edits:

```json
// ~/.claude/settings.json
{
  "hooks": {
    "PostToolUse": [
      {
        "tools": ["Edit", "Write"],
        "command": "ruff check --fix $FILE && ty $FILE"
      }
    ]
  }
}
```

## Verification Checklist

- [ ] `pytest tests/ -v` passes
- [ ] FakeClaudeSDKClient works (no API calls)
- [ ] Can test session lifecycle
- [ ] Can test health checks
- [ ] Can test concurrent sessions
- [ ] Coverage > 80% on core files

## What's Next

`12-open-source.md` covers sanitizing the codebase for public release.

---

## Gotchas

1. **Async tests**: Use `@pytest.mark.asyncio` and `pytest-asyncio` plugin.

2. **Fixture isolation**: Each test gets fresh fixtures. Don't share state.

3. **Timeouts**: Set reasonable timeouts to catch deadlocks:
   ```python
   @pytest.mark.timeout(5)
   async def test_doesnt_hang():
       ...
   ```
