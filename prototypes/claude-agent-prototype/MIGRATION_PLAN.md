# Migration Plan: tmux → Claude Agent SDK (SDK-Only)

**Decision: No dual backend. No tmux. SDK-only from the start.**

## Core Architecture

### `ClaudeSDKClient` — The Right API

~~`query()` is single-exchange.~~ The plan now uses `ClaudeSDKClient` for multi-turn persistent sessions:

```python
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

async with ClaudeSDKClient(options=options) as client:
    await client.query("first message")
    async for msg in client.receive_response():
        handle(msg)

    await client.query("second message")  # same session, full context
    async for msg in client.receive_response():
        handle(msg)

    # Stuck? Interrupt:
    await client.interrupt()
```

**Key differences from our prototype's `query()` approach:**
- No AsyncGenerator needed — `inject()` calls `client.query()` directly
- No `_message_generator()` — eliminated entirely
- Retry is simple: `client.query()` is idempotent per call
- Hooks supported (PreToolUse, PostToolUse) for security enforcement
- `resume=session_id` supported for session recovery
- `interrupt()` for stuck sessions

### Process Model

Each `ClaudeSDKClient` spawns a `claude` CLI subprocess (Node.js, ~150-370MB RSS). The SDK manages the subprocess lifecycle. **20-30 second cold start** per session.

The daemon is a single async Python process. SDK sessions run as asyncio tasks. Each task owns a `ClaudeSDKClient` instance managing its own subprocess. If one claude process crashes, only that session's error handler fires.

### Session Recovery via `resume`

**We SHOULD use the SDK's `resume=session_id` parameter.** It reloads the full JSONL transcript from `~/.claude/projects/` automatically. This is simpler than manually re-injecting context.

On daemon restart:
1. Read registry for known sessions
2. For each contact with a saved `session_id`:
   - Create `ClaudeSDKClient(options=ClaudeAgentOptions(resume=session_id))`
   - Full conversation history restored automatically
3. If resume fails, fall back to fresh session with system prompt injection

## `SessionBackend` Interface

```python
# assistant/backend.py

from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class SessionInfo:
    """Session metadata."""
    chat_id: str
    session_name: str
    contact_name: str
    tier: str
    source: str              # "imessage" | "signal"
    session_type: str        # "individual" | "group"
    is_alive: bool
    is_healthy: bool
    created_at: str
    last_activity: str
    turn_count: int
    total_cost: float
    session_id: str | None = None

class SessionBackend(ABC):
    """Abstract interface for session management.
    Currently only SDKBackend implements this."""

    @abstractmethod
    async def create_session(
        self, contact_name: str, chat_id: str, tier: str,
        source: str = "imessage", session_type: str = "individual",
    ) -> SessionInfo:
        """Create a new foreground session for a contact."""
        ...

    @abstractmethod
    async def create_group_session(
        self, chat_id: str, display_name: str,
        participants: list[dict], sender_tier: str,
        source: str = "imessage",
    ) -> SessionInfo:
        """Create a group session."""
        ...

    @abstractmethod
    async def create_background_session(
        self, contact_name: str, chat_id: str, tier: str,
        source: str = "imessage",
    ) -> SessionInfo:
        """Create a background session for nightly consolidation."""
        ...

    @abstractmethod
    async def inject_message(
        self, chat_id: str, text: str,
        contact_name: str, tier: str, source: str,
        wrap_type: str = "sms",  # "sms" | "admin" | "raw" | "signal"
        is_background: bool = False,
    ) -> bool:
        """Inject a message into an existing session.
        Creates session on-demand if missing (lazy creation)."""
        ...

    @abstractmethod
    async def inject_group_message(
        self, chat_id: str, display_name: str,
        sender_name: str, sender_tier: str, text: str,
        participants: list[dict], source: str = "imessage",
    ) -> bool:
        """Inject a message into a group session."""
        ...

    @abstractmethod
    async def kill_session(self, chat_id: str) -> bool:
        """Kill a session (FG + BG). Disconnects ClaudeSDKClient."""
        ...

    @abstractmethod
    async def kill_all_sessions(self) -> int:
        """Kill all sessions."""
        ...

    @abstractmethod
    async def restart_session(self, chat_id: str) -> SessionInfo | None:
        """Kill and recreate a session."""
        ...

    @abstractmethod
    async def check_session_health(self, chat_id: str) -> bool:
        """Check if a session is healthy."""
        ...

    @abstractmethod
    async def health_check_all(self) -> dict[str, bool]:
        """Check all sessions. Auto-restarts unhealthy ones."""
        ...

    @abstractmethod
    async def check_idle_sessions(self, timeout_hours: float) -> list[str]:
        """Kill idle sessions exceeding timeout. Returns chat_ids killed."""
        ...

    @abstractmethod
    async def get_session_info(self, chat_id: str) -> SessionInfo | None:
        ...

    @abstractmethod
    async def get_all_sessions(self) -> list[SessionInfo]:
        ...

    @abstractmethod
    async def get_recent_output(self, chat_id: str, lines: int = 30) -> str:
        """Get recent output from per-session log file."""
        ...

    @abstractmethod
    async def create_master_session(self) -> SessionInfo:
        """Create the always-alive master admin session."""
        ...

    @abstractmethod
    async def inject_master_prompt(self, text: str) -> bool:
        """Inject a prompt into the master session."""
        ...

    @abstractmethod
    async def shutdown(self) -> None:
        """Clean shutdown: disconnect all clients, kill child processes."""
        ...
```

## Special Sessions Outside the Backend

### HEALME (Healing Session)
**Stays as `claude -p` (pipe mode).** One-shot diagnostic, not multi-turn. Spawned as subprocess directly.

### Admin Intercept Commands

| Command | Implementation |
|---------|---------------|
| `HEALME` | `claude -p` subprocess (not via backend) |
| `MASTER <cmd>` | `backend.inject_master_prompt(cmd)` |
| `RESTART` | `backend.restart_session(chat_id)` |
| `TMUXIMG` | **Killed entirely** |

## What Doesn't Change

- **Message polling** (chat.db SQLite queries)
- **Contact lookup + tier determination**
- **SessionRegistry** (JSON file with chat_id → metadata, now includes `session_id`)
- **SMS sending** (`~/code/sms-cli/send-sms`)
- **LaunchAgent** for daemon boot
- **HEALME** — always `claude -p`

**Things that change routing:**
- **Nightly consolidation** — calls `backend.inject_message(..., is_background=True)` directly
- **Reminders** — calls `backend.inject_message()` directly
- **Signal** — same backend interface, different `source` tag

---

## SDKSession Class

```python
class SDKSession:
    """Manages a single Claude Agent SDK session using ClaudeSDKClient."""

    def __init__(self, chat_id, contact_name, tier, cwd):
        self.chat_id = chat_id
        self.contact_name = contact_name
        self.tier = tier
        self.cwd = cwd
        self._client: ClaudeSDKClient | None = None
        self._message_queue: asyncio.Queue[str] = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self.running = False
        self.session_id: str | None = None
        self._last_activity = datetime.now()
        self._turn_count = 0
        self._total_cost = 0.0
        self._error_count = 0
        self._session_log = _get_session_logger(contact_name)

    async def start(self, resume_session_id: str | None = None):
        """Connect ClaudeSDKClient and start the message processing loop."""
        options = self._build_options(resume_session_id)
        self._client = ClaudeSDKClient(options=options)
        await self._client.connect()
        self.running = True
        self._task = asyncio.create_task(self._run_loop())
        self._session_log.info(f"SESSION_START resume={resume_session_id}")

    async def stop(self):
        """Disconnect client and cancel task."""
        self.running = False
        if self._client:
            try:
                await self._client.disconnect()
            except Exception:
                pass
            self._client = None
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._session_log.info("SESSION_STOP")

    async def inject(self, text: str):
        """Queue a message for delivery to the Claude session."""
        await self._message_queue.put(text)
        self._session_log.info(f"QUEUED: {text[:200]}")

    def is_alive(self) -> bool:
        return self.running and self._task is not None and not self._task.done()

    def is_healthy(self) -> bool:
        if not self.is_alive():
            return False
        if self._error_count >= 3:
            return False
        # Stale: messages pending but no activity for 10+ min
        if self._message_queue.qsize() > 0:
            idle = (datetime.now() - self._last_activity).total_seconds()
            if idle > 600:
                return False
        return True

    async def interrupt(self):
        """Interrupt a stuck session."""
        if self._client:
            await self._client.interrupt()
            self._session_log.info("INTERRUPTED")

    async def _run_loop(self):
        """Main loop: pull messages from queue, send via client, handle responses."""
        while self.running:
            try:
                msg = await asyncio.wait_for(
                    self._message_queue.get(), timeout=3600
                )
            except asyncio.TimeoutError:
                continue  # 1-hour idle, keep waiting

            self._last_activity = datetime.now()
            self._session_log.info(f"IN: {msg}")

            try:
                await self._client.query(msg)
                async for message in self._client.receive_response():
                    await self._handle_message(message)
                self._error_count = 0  # Reset on success
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._error_count += 1
                self._session_log.error(f"Error #{self._error_count}: {e}")
                if self._error_count >= 3:
                    self._session_log.error("Max errors reached, session dead")
                    self.running = False
                    break
                await asyncio.sleep(5 * self._error_count)

    def _build_options(self, resume_id: str | None = None) -> ClaudeAgentOptions:
        """Build options based on contact tier."""
        if self.tier in ("admin", "wife"):
            tools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep",
                     "WebSearch", "WebFetch", "Task", "NotebookEdit",
                     "Skill", "AskUserQuestion"]
            perm_mode = "bypassPermissions"
        elif self.tier == "family":
            tools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep",
                     "WebSearch", "WebFetch", "Task"]
            perm_mode = "default"
        elif self.tier == "favorite":
            tools = ["Read", "WebSearch", "WebFetch", "Grep", "Glob"]
            perm_mode = "default"
        else:
            tools = ["Read", "Grep", "Glob"]
            perm_mode = "default"

        opts = ClaudeAgentOptions(
            cwd=self.cwd,
            allowed_tools=tools,
            permission_mode=perm_mode,
            setting_sources=["project"],  # Load CLAUDE.md + skills from cwd
            model="claude-sonnet-4-5",
            max_budget_usd=5.0,            # Per-session budget cap
            # Hooks for security enforcement (better than system prompt alone)
            hooks={
                "PreToolUse": self._pre_tool_hook,
                "PostToolUse": self._post_tool_hook,
            },
        )

        if resume_id:
            opts.resume = resume_id

        return opts

    async def _pre_tool_hook(self, tool_name, tool_input):
        """Security hook: enforce tier-based tool restrictions.
        Runs before every tool call. Return False to block."""
        self._session_log.info(f"HOOK_PRE: {tool_name}")
        # Favorites: block file modifications, sensitive reads
        if self.tier == "favorite":
            if tool_name in ("Write", "Edit", "NotebookEdit"):
                return False
            if tool_name == "Bash":
                # Block everything except osascript
                cmd = tool_input.get("command", "")
                if not cmd.startswith("osascript"):
                    return False
            if tool_name == "Read":
                path = tool_input.get("file_path", "")
                if any(s in path for s in [".ssh", ".env", "credentials", "secrets"]):
                    return False
        return True

    async def _post_tool_hook(self, tool_name, tool_input, tool_output):
        """Audit hook: log every tool call for observability."""
        self._session_log.info(
            f"TOOL: {tool_name} input={json.dumps(tool_input)[:300]} "
            f"output_len={len(str(tool_output))}"
        )

    async def _handle_message(self, message):
        """Handle messages from client.receive_response()."""
        if isinstance(message, SystemMessage):
            if hasattr(message, 'data') and isinstance(message.data, dict):
                sid = message.data.get('session_id')
                if sid:
                    self.session_id = sid
            self._session_log.info(f"SYSTEM: {message.subtype}")

        elif isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    self._session_log.info(f"OUT: {block.text}")
                elif isinstance(block, ToolUseBlock):
                    self._session_log.info(f"TOOL_USE: {block.name}")

        elif isinstance(message, ResultMessage):
            self._turn_count += 1
            self._total_cost += (message.total_cost_usd or 0)
            self.session_id = getattr(message, 'session_id', self.session_id)
            self._session_log.info(
                f"TURN: #{self._turn_count} cost=${message.total_cost_usd or 0:.4f} "
                f"duration={message.duration_ms}ms error={message.is_error} "
                f"session_id={self.session_id}"
            )
```

## SDKBackend Class

```python
class SDKBackend(SessionBackend):
    """Agent SDK-based session management using ClaudeSDKClient."""

    def __init__(self, registry, contacts):
        self.registry = registry
        self.contacts = contacts  # For group participant tier lookups
        self.sessions: dict[str, SDKSession] = {}  # chat_id -> SDKSession
        self._lock = asyncio.Lock()

    async def create_session(self, contact_name, chat_id, tier, source="imessage",
                             session_type="individual"):
        async with self._lock:
            if chat_id in self.sessions and self.sessions[chat_id].is_alive():
                return self._session_info(chat_id)

            transcript_dir = Path.home() / "transcripts" / _session_name(contact_name)
            transcript_dir.mkdir(parents=True, exist_ok=True)
            _ensure_claude_symlink(transcript_dir)

            # Try to resume from saved session_id
            reg_entry = self.registry.get(chat_id)
            resume_id = reg_entry.get("session_id") if reg_entry else None

            session = SDKSession(
                chat_id=chat_id,
                contact_name=contact_name,
                tier=tier,
                cwd=str(transcript_dir),
            )
            await session.start(resume_session_id=resume_id)
            self.sessions[chat_id] = session

            # If no resume (fresh session), inject system prompt
            if not resume_id:
                system_prompt = _build_system_prompt(contact_name, tier, chat_id, source)
                await session.inject(system_prompt)

            # Persist session_id to registry for future resume
            self.registry.register(
                chat_id=chat_id,
                session_name=_session_name(contact_name),
                contact_name=contact_name,
                tier=tier,
                source=source,
                session_type=session_type,
            )

            return self._session_info(chat_id)

    async def inject_message(self, chat_id, text, contact_name, tier, source,
                             wrap_type="sms", is_background=False):
        # Hold lock for create-then-inject to prevent race with kill_session
        async with self._lock:
            if chat_id not in self.sessions or not self.sessions[chat_id].is_alive():
                await self._create_session_unlocked(contact_name, chat_id, tier, source)
            session = self.sessions.get(chat_id)
            if not session:
                return False

        # Inject outside lock — queue.put is safe
        wrapped = _wrap(text, contact_name, tier, chat_id, source, wrap_type)
        await session.inject(wrapped)
        return True

    async def check_session_health(self, chat_id):
        session = self.sessions.get(chat_id)
        if not session:
            return False
        if not session.is_healthy():
            # Auto-restart unhealthy sessions
            await self.restart_session(chat_id)
            return False
        return True

    async def restart_session(self, chat_id):
        async with self._lock:
            session = self.sessions.pop(chat_id, None)
            if session:
                await session.stop()

        # Recreate from registry
        reg = self.registry.get(chat_id)
        if reg:
            return await self.create_session(
                reg["contact_name"], chat_id, reg["tier"], reg.get("source", "imessage")
            )
        return None

    async def kill_session(self, chat_id):
        async with self._lock:
            session = self.sessions.pop(chat_id, None)
            # Also kill BG session
            bg_id = f"{chat_id}-bg"
            bg_session = self.sessions.pop(bg_id, None)
        if session:
            await session.stop()
        if bg_session:
            await bg_session.stop()
        return session is not None

    async def kill_all_sessions(self):
        async with self._lock:
            sessions = list(self.sessions.values())
            self.sessions.clear()
        for s in sessions:
            await s.stop()
        return len(sessions)

    async def check_idle_sessions(self, timeout_hours):
        now = datetime.now()
        killed = []
        for chat_id, session in list(self.sessions.items()):
            idle = (now - session._last_activity).total_seconds()
            if idle > timeout_hours * 3600:
                await self.kill_session(chat_id)
                killed.append(chat_id)
        return killed

    async def get_recent_output(self, chat_id, lines=30):
        session = self.sessions.get(chat_id)
        if not session:
            return ""
        log_path = SESSION_LOG_DIR / f"{_session_name_from_chat_id(chat_id)}.log"
        if log_path.exists():
            all_lines = log_path.read_text().splitlines()
            return "\n".join(all_lines[-lines:])
        return ""

    async def shutdown(self):
        """Clean shutdown of all sessions."""
        async with self._lock:
            sessions = list(self.sessions.values())
            self.sessions.clear()
        # Save session_ids to registry before killing
        for s in sessions:
            if s.session_id:
                self.registry.update_session_id(s.chat_id, s.session_id)
        # Disconnect all clients
        await asyncio.gather(*(s.stop() for s in sessions), return_exceptions=True)
```

---

## Migration Phases

### Phase 0: Convert Daemon Main Loop to Async

**Goal:** The SDK requires async. Convert `Manager.run()` from sync to async.

```python
# OLD:
def run(self):
    while True:
        messages = self._poll_messages()
        for msg in messages:
            self.process_message(msg)
        self._check_timers()
        time.sleep(0.1)

# NEW:
async def run(self):
    # Start Unix socket command server
    await self._start_command_server()

    while not self._shutdown_flag:
        # Run blocking SQLite poll in executor (contains time.sleep(0.05))
        messages = await asyncio.get_event_loop().run_in_executor(
            None, self._poll_messages
        )
        for msg in messages:
            await self.process_message(msg)
        await self._check_timers()
        await asyncio.sleep(0.1)

if __name__ == "__main__":
    manager = Manager()
    asyncio.run(manager.run())
```

**Key conversions:**
- `Manager.run()` → `async def run()`
- `process_message()` → `async def process_message()`
- `time.sleep()` → `await asyncio.sleep()`
- `_poll_messages()` in `run_in_executor` (has blocking `time.sleep(0.05)`)
- `SignalListener` thread → bridge via `loop.call_soon_threadsafe`
- Subprocess calls (HEALME) → `asyncio.create_subprocess_exec`
- Signal group IDs: pass `session_type` through backend interface

**SIGTERM handler:**
```python
async def run(self):
    loop = asyncio.get_event_loop()
    loop.add_signal_handler(signal.SIGTERM, lambda: asyncio.create_task(self._shutdown()))
    loop.add_signal_handler(signal.SIGINT, lambda: asyncio.create_task(self._shutdown()))
    ...

async def _shutdown(self):
    log.info("DAEMON | SHUTDOWN | START")
    await self.sessions.shutdown()  # Save session_ids, disconnect all clients
    self._stop_signal()             # Stop Signal daemon
    self._stop_search()             # Stop search daemon
    Path("/tmp/claude-assistant.sock").unlink(missing_ok=True)
    log.info("DAEMON | SHUTDOWN | COMPLETE")
    self._shutdown_flag = True      # Main loop exits cleanly
```

---

### Phase 1: Extract Shared Utilities + Kill Fast Path

**Goal:** Pull backend-agnostic code out of manager.py and cli.py. Kill the fast path that bypasses the session manager.

**CRITICAL:** manager.py imports 11 functions directly from cli.py and uses them to go straight to tmux, bypassing SessionManager. These must be split:

| Category | Functions | Goes to |
|----------|-----------|---------|
| **Backend-agnostic** | `_normalize_chat_id`, `_wrap_sms`, `_wrap_admin`, `_wrap_signal`, `_get_reply_chain`, `_get_session_name` | `assistant/common.py` |
| **Old tmux-specific** | `_session_exists`, `_inject_text`, `_check_session_health`, `_create_fg_session`, `_kill_session` | **DELETED** (replaced by backend methods) |
| **Registry** | `_load_registry`, `_save_registry` | **DELETED** (unified into `SessionRegistry`) |

**Kill the fast path:** manager.py's `inject_message()` and `inject_group_message()` currently call tmux functions directly. Both must route through `await self.sessions.inject_message()` only.

**Unify registry:** `_load_registry`/`_save_registry` from cli.py and `SessionRegistry` from manager.py are two views of the same JSON file. Unify into `SessionRegistry` only, add `session_id` field.

**New file:** `assistant/common.py`

---

### Phase 2: Implement SDKBackend + SDKSession

**Goal:** Build the SDK backend using `ClaudeSDKClient`.

**New files:**
- `assistant/sdk_backend.py` — `SDKBackend(SessionBackend)` (shown above)
- `assistant/sdk_session.py` — `SDKSession` using `ClaudeSDKClient` (shown above)

**Wire into daemon:**
```python
# manager.py:
from assistant.sdk_backend import SDKBackend

self.sessions = SDKBackend(registry=self.registry, contacts=self.contacts)
```

**Warmup:** Stagger 30 seconds between session spawns (20-30s cold start per session).

**Testing before integration:**
- [ ] Basic message exchange via `ClaudeSDKClient`
- [ ] Multi-turn: 50+ turns in one session
- [ ] Resume: save session_id, disconnect, reconnect with resume
- [ ] Error recovery: kill claude subprocess, verify error handler fires
- [ ] Long idle: leave session idle 1+ hour, send message
- [ ] Large prompts: consolidation-sized prompts with special chars
- [ ] Hooks: verify PreToolUse blocks for favorite tier
- [ ] Concurrent: 5 sessions running simultaneously
- [ ] interrupt(): stuck session recovery

---

### Phase 3: CLI via Unix Socket

**Goal:** CLI sends all commands to daemon via Unix socket.

**Daemon side:** Unix socket server at `/tmp/claude-assistant.sock` (chmod 600).

**Socket framing:** Length-prefixed (4-byte header + JSON body):
```python
# Write:
data = json.dumps(cmd).encode()
writer.write(len(data).to_bytes(4, 'big') + data)

# Read:
header = await reader.readexactly(4)
length = int.from_bytes(header, 'big')
data = await reader.readexactly(length)
```

**CLI commands:**

| Command | Socket message |
|---------|---------------|
| `inject-prompt` | `{"type": "inject", "args": {...}}` |
| `kill-session` | `{"type": "kill", "args": {"chat_id": "..."}}` |
| `kill-sessions` | `{"type": "kill_all"}` |
| `restart-session` | `{"type": "restart", "args": {"chat_id": "..."}}` |
| `restart-sessions` | `{"type": "restart_all"}` |
| `status` | `{"type": "status"}` |
| `attach` | `tail -f` session log file (no socket needed) |
| `monitor` | `multitail` on all session logs (no socket needed) |

---

### Phase 4: Per-Session Logging

**Goal:** Replace tmux attach with comprehensive session logs.

```
~/.claude-assistant/logs/sessions/{session_name}.log
```

Each `SDKSession` logs via `_session_log` (RotatingFileHandler, 10MB max, 5 backups):
- `IN:` every injected message (full text)
- `OUT:` every assistant text response (full text)
- `TOOL_USE:` every tool call name
- `HOOK_PRE:` every PreToolUse hook invocation
- `TOOL:` every PostToolUse with input summary + output length
- `TURN:` turn number, cost, duration, error status, session_id
- `SYSTEM:` init messages
- `QUEUED:` messages waiting in queue
- `SESSION_START` / `SESSION_STOP`
- `INTERRUPTED`
- `Error #N:` with full traceback

**Lifecycle log** (centralized, same format as current):
```
~/.claude-assistant/logs/session_lifecycle.log
```
Events: `CREATE`, `RESTART`, `HEALTH_CHECK`, `HEALED`, `IDLE_TIMEOUT`, `SHUTDOWN`

**CLI attach:**
```bash
claude-assistant attach jane-doe
# → tail -f ~/.claude-assistant/logs/sessions/jane-doe.log
```

---

### Phase 5: Response Handling

**Decision: Option A — Claude keeps sending SMS itself.**

Claude calls `send-sms` via Bash tool inside the SDK session. The PostToolUse hook logs it. Zero behavioral change for users.

---

### Phase 6: Background Sessions + Consolidation + Warmup

**BG sessions:** Separate `SDKSession` with `-bg` suffix and BG-specific system prompt ("Wait for consolidation trigger...").

**Consolidation orchestration:** Lives on `Manager` (not backend). Iterates registry, builds prompts, calls `await self.sessions.inject_message(..., is_background=True)` for each contact with sleep between.

**Reminders:** Call `await self.sessions.inject_message()` directly (no more CLI subprocess).

**Warmup:** Stagger 30 seconds between `create_session()` calls on boot.

---

### Phase 7: Group Sessions + Master Session

**Groups:** Same `SDKSession`, keyed by group chat_id. Daemon resolves participant tiers before calling backend. No BG session for groups.

**Master session:** `create_master_session()` creates a permanent session with master-specific system prompt. `inject_master_prompt()` sends to it.

---

## Testing & Cutover

### Verification Checklist
- [ ] Send SMS → session created, response received
- [ ] Send follow-up → message injected into existing session
- [ ] Wait 5 min → health check passes
- [ ] `claude-assistant status` → shows sessions via socket
- [ ] `claude-assistant inject-prompt +number "test"` → works via socket
- [ ] Kill daemon → restart → sessions resume via saved session_ids
- [ ] Send 3 messages rapidly → all processed in order
- [ ] Wait 2+ hours → idle timeout kills session
- [ ] Send message after timeout → new session created (lazy)
- [ ] `claude-assistant attach name` → shows live log tail
- [ ] `MASTER status` → master session responds
- [ ] `HEALME` → spawns claude -p diagnostic (not via backend)
- [ ] `RESTART` → kills and recreates session via backend
- [ ] Signal message → routed correctly
- [ ] Nightly consolidation → injects via backend directly
- [ ] Reminder fires → injects via backend directly
- [ ] Daemon SIGTERM → all sessions stopped, session_ids saved, no orphans
- [ ] Family tier → correct tools + system prompt restrictions
- [ ] Favorite tier → PreToolUse hook blocks dangerous tools
- [ ] Session budget cap → stops at $5
- [ ] Compaction → monitor for hangs, proactively recycle if needed
- [ ] 50+ turns in single session → no degradation

---

## Risk Assessment

### HIGH RISK

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Async conversion of daemon main loop** | Breaks everything if wrong | Test thoroughly. Most dangerous phase. |
| **20-30s cold start per session** | Slow session creation | Stagger warmup 30s. Accept cold start. Resume avoids re-creation. |
| **Compaction hangs on large sessions** | Session unresponsive | Monitor turn count, proactively recycle sessions. Use `interrupt()`. |
| **Behavioral drift after compaction** | Tier rules lost from system prompt | Use PreToolUse hooks for enforcement (not just prompt). |
| SDK subprocess crashes silently | Lost messages | Error callback + auto-restart + log alerts |
| CLI can't reach daemon socket | Can't inject prompts | CLI shows clear error if socket missing |
| AsyncGenerator deadlocks | N/A — eliminated. Using `ClaudeSDKClient` discrete calls. |

### MEDIUM RISK

| Risk | Impact | Mitigation |
|------|--------|------------|
| Resume fails (corrupted JSONL) | Lost context | Fall back to fresh session + system prompt |
| Race condition on session creation | Duplicate sessions | `asyncio.Lock` in create/inject |
| SDK version breaking changes | Won't start | Pin `>=0.1.23,<0.2.0` |
| `setting_sources` doesn't load skills | Claude can't use skills | Explicit `["project"]` + test |
| SignalListener thread bridge | Signal messages lost | `loop.call_soon_threadsafe` + test |
| Context overflow / compaction triggers late | Quality degradation | `max_turns` safety cap, monitor `ResultMessage.usage` |
| Messages queue silently while busy | No user feedback | Consider tapback on queue |

### LOW RISK

| Risk | Impact | Mitigation |
|------|--------|------------|
| Log files fill disk | Disk full | `RotatingFileHandler(maxBytes=10MB, backupCount=5)` |
| Orphaned claude processes on crash | Memory leak | SIGTERM handler + `shutdown()` + explicit `disconnect()` |
| Registry concurrent writes | Corruption | Daemon is sole writer via SessionRegistry |

---

## Memory & Performance

**Per session:** ~150-370MB RSS (claude CLI subprocess). Similar to tmux.

**Advantage:** Clean `stop()` + `resume` means aggressive idle timeout (30 min instead of 2 hours). On next message, session resumes from JSONL with full context. Steady-state memory drops.

**Cold start:** 20-30 seconds per session. Use resume to avoid unnecessary re-creation.

**Budget:** `max_budget_usd=5.0` per session. `max_turns` for safety.

---

## Files Summary

| File | Type | Purpose |
|------|------|---------|
| `assistant/backend.py` | **NEW** | `SessionBackend` ABC + `SessionInfo` + unified `SessionRegistry` |
| `assistant/common.py` | **NEW** | `_wrap_sms`, `_normalize_chat_id`, `_get_session_name`, `_get_reply_chain` |
| `assistant/sdk_backend.py` | **NEW** | `SDKBackend(SessionBackend)` using `ClaudeSDKClient` |
| `assistant/sdk_session.py` | **NEW** | `SDKSession` class with hooks, logging, error handling |
| `assistant/manager.py` | **MODIFY** | Async main loop, use `self.sessions: SessionBackend`, kill fast paths |
| `assistant/cli.py` | **MODIFY** | Socket-only CLI, remove all tmux code |
| `pyproject.toml` | **MODIFY** | Add `claude-agent-sdk>=0.1.23,<0.2.0` |

**Deleted code:**
- All tmux calls (`new-session`, `send-keys`, `capture-pane`, `kill-session`, etc.)
- `_inject_text`, `_session_exists`, `_check_session_health` from cli.py
- `_load_registry`, `_save_registry` from cli.py (unified into SessionRegistry)
- `_create_fg_session`, `_kill_session` from cli.py
- `TMUXIMG` command handler
- `cmd_monitor` tmux dashboard (replaced by multitail)
- All `time.sleep()` calls in session management

**Files that DON'T change:**
- `assistant/transcript.py`, `assistant/contacts.py`
- `~/.claude/skills/*`, `~/code/sms-cli/*`
- LaunchAgent plist

---

## Implementation Order

```
Phase 0: Async daemon main loop + SIGTERM handler
Phase 1: common.py + kill fast path + unify registry
Phase 2: sdk_backend.py + sdk_session.py (ClaudeSDKClient)
Phase 3: CLI via Unix socket only
Phase 4: Per-session logging + lifecycle logging
Phase 5: Response handling (Claude sends SMS)
Phase 6: BG sessions + consolidation + reminders + warmup
Phase 7: Group sessions + master session + intercepts
```

**Phase 0 is the riskiest.** Phases 1-2 are the core SDK work.

---

## SDK Configuration Reference

```python
ClaudeAgentOptions(
    cwd="/path/to/transcript/dir",
    allowed_tools=["Read", "Write", "Bash", ...],
    permission_mode="bypassPermissions",
    setting_sources=["project"],        # Load CLAUDE.md + skills
    model="claude-sonnet-4-5",
    max_budget_usd=5.0,                 # Per-session budget
    max_turns=200,                      # Safety cap
    resume="session-uuid-here",         # Resume from JSONL
    hooks={...},                        # PreToolUse, PostToolUse
)
```

**Pin version:** `claude-agent-sdk>=0.1.26,<0.2.0`

---

## Configuration File

`~/.claude-assistant/config.json` — runtime configuration, editable without code changes.

```json
{
  "model": "claude-sonnet-4-5",
  "budget": {
    "admin": null,
    "wife": null,
    "family": 2.0,
    "favorite": 1.0,
    "default": 0.5
  },
  "max_turns": {
    "admin": null,
    "wife": null,
    "family": 100,
    "favorite": 50,
    "default": 50
  },
  "idle_timeout_hours": {
    "admin": 2.0,
    "wife": 2.0,
    "family": 1.0,
    "favorite": 0.5,
    "default": 0.5
  },
  "warmup_stagger_seconds": 5,
  "health_check_interval_seconds": 300,
  "consolidation_hour": 4,
  "socket_path": "/tmp/claude-assistant.sock"
}
```

**Defaults:** No budget limits for admin/wife (`null`). Config file is optional — missing keys use hardcoded defaults. Daemon watches file mtime and hot-reloads on change.

---

## All Addressed Gaps (51 total across 3 reviews + research)

| # | Gap | Resolution |
|---|-----|------------|
| 1 | Master session | Added to interface |
| 2 | Healing session | Stays `claude -p` |
| 3 | Admin security check | Socket file permissions (chmod 600) |
| 4 | Daemon is synchronous | Phase 0: async conversion |
| 5 | File locking | Daemon sole owner, `asyncio.Lock` |
| 6 | Intercept commands | Mapped (HEALME stays, TMUXIMG killed, MASTER/RESTART via backend) |
| 7 | Signal daemon spawning | `loop.call_soon_threadsafe` bridge |
| 8 | Warmup overwhelms | 30s stagger (increased from 5s due to cold start research) |
| 9 | Reminders shell out | Direct backend call |
| 10 | Consolidation shells out | Direct backend call |
| 11 | Health check patterns | `is_healthy()` + stale detection + hooks for monitoring |
| 12 | Lose tmux attach | Comprehensive per-session logging |
| 13 | BG sessions need own prompt | Separate creation with BG-specific prompt |
| 14 | Queued messages no ack | Noted in risks |
| 15 | Generator timeout | N/A — `ClaudeSDKClient` eliminates generator |
| 16 | Status zero after restart | Resume from saved session_ids |
| 17 | Group participant lookup | `contacts` passed to backend |
| 18 | query() multi-turn | **CRITICAL FIX: switched to ClaudeSDKClient** |
| 19 | Context/compaction | Monitor usage, `max_turns`, proactive recycling |
| 20 | Tier system prompts | First message + PreToolUse hooks |
| 21 | Socket buffer 64KB | Length-prefixed framing |
| 22 | `get_clean_env()` | Removed (no tmux) |
| 23 | Signal group naming | `session_type` passed through interface |
| 24 | Lifecycle logging | Mirrors current format |
| 25 | Monitor dashboard | multitail on session logs |
| 26 | Shutdown cleanup | `shutdown()` in interface + SIGTERM handler |
| 27 | HaikuHandler | Confirm dead, remove |
| 28 | Registry writes | Daemon sole writer |
| 29 | `check_idle_sessions()` | Added to interface |
| 30 | 11 imports from cli.py | Split into common.py, delete tmux-specific |
| 31 | Dual registry | Unified into SessionRegistry |
| 32 | Consolidation orchestration | Lives on Manager |
| 33 | contacts not in backend | Passed to constructor |
| 34 | Fast path bypass | Killed |
| 35 | time.sleep blocks async | `run_in_executor` for poll, `asyncio.sleep` elsewhere |
| 36 | Retry never tested | `ClaudeSDKClient` makes retry simpler (discrete calls) |
| 37 | Warmup not scoped | Phase 6, staggered 30s |
| 38 | `__init__` can't be async | Popen stays sync (fine) |
| 39 | Large prompt format | Test before integration |
| 40 | SIGTERM handler | Added with clean teardown |
| 41 | `_send_sms` stays on Manager | Documented |
| 42 | Log rotation backupCount | 5 backups |
| 43 | Model explicit | `claude-sonnet-4-5` |
| 44 | Generator message loss on retry | N/A — `ClaudeSDKClient` eliminates generator |
| 45 | inject + kill race | Lock held for create-then-inject |
| 46 | MessagesReader blocking sleep | `run_in_executor` |
| 47 | Master session prompt | Define and inject on creation |
| 48 | CLI restart bypasses backend | All CLI commands via socket |
| 49 | Signal group ID regex | `session_type` passed through |
| 50 | sys.exit in SIGTERM | Shutdown flag, clean exit |
| 51 | signal: prefix ambiguity | Documented: canonical chat_id, wrap strips prefix |
