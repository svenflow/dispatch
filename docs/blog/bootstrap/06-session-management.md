# 06: Session Management

## Goal

Give each contact their own persistent Claude session with context that survives across messages and daemon restarts.

## The Problem

Without session management:
- Each message starts fresh - no memory
- Claude can't reference "what we discussed earlier"
- Conversations feel robotic

## Solution: Claude Agent SDK

The Claude Agent SDK provides:
- **Persistent sessions**: Context preserved across queries
- **Session resume**: Survive daemon restarts
- **In-process management**: No subprocess shells to manage

```python
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

# Create options
options = ClaudeAgentOptions(
    cwd="/path/to/working/dir",
    model="opus",
)

# Create client and connect
client = ClaudeSDKClient(options=options)
await client.connect()

# Send a message
await client.query("Hello!")

# Receive responses (runs until turn complete)
async for message in client.receive_messages():
    print(message)  # Handle AssistantMessage, ResultMessage, etc.
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     SDKBackend                          │
│                                                         │
│  sessions = {                                           │
│    "+15551234567": SDKSession(contact="John"),         │
│    "+15559876543": SDKSession(contact="Jane"),         │
│    "abc123...":    SDKSession(group="Family Chat"),    │
│  }                                                      │
│                                                         │
│  Each SDKSession has:                                   │
│    - ClaudeSDKClient instance                          │
│    - Message queue (async)                              │
│    - Session ID (for resume)                           │
│    - Run loop (processes queue)                        │
└─────────────────────────────────────────────────────────┘
```

## Implementation Files

The session management system consists of these files in `~/dispatch/assistant/`:
- `sdk_session.py` - The SDKSession class
- `sdk_backend.py` - The SDKBackend that manages all sessions
- `common.py` - Shared utilities (paths, normalization, message wrapping)

## Step 1: Session Registry

Track session metadata in `~/dispatch/state/sessions.json`:

```json
{
  "+15551234567": {
    "session_name": "john-doe",
    "contact_name": "John Doe",
    "tier": "favorite",
    "session_id": "abc-123-def",
    "created_at": "2026-02-01T10:00:00",
    "last_message_time": "2026-02-07T14:30:00"
  }
}
```

The `session_id` is the magic - pass it to `ClaudeSDKClient` to resume.

## Step 2: SDKSession Class

```python
import asyncio
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

class SDKSession:
    def __init__(self, contact_name: str, tier: str, chat_id: str, cwd: str):
        self.contact_name = contact_name
        self.tier = tier
        self.chat_id = chat_id
        self.cwd = cwd
        self._client = None
        self._queue = asyncio.Queue()
        self._running = False

    async def start(self, resume_session_id: str = None):
        """Start the SDK client and run loop."""
        options = ClaudeAgentOptions(
            cwd=self.cwd,
            model="opus",
        )

        # Resume is passed via options, not a separate method
        if resume_session_id:
            options.resume = resume_session_id

        self._client = ClaudeSDKClient(options=options)
        await self._client.connect()

        self._running = True
        # Start both sender and receiver loops
        asyncio.create_task(self._run_loop())
        asyncio.create_task(self._receive_loop())

    async def inject(self, text: str):
        """Queue a message for processing."""
        await self._queue.put(text)

    async def _run_loop(self):
        """Send messages from queue to Claude."""
        while self._running:
            text = await self._queue.get()
            await self._client.query(text)

    async def _receive_loop(self):
        """Handle responses from Claude."""
        async for message in self._client.receive_messages():
            # Handle AssistantMessage, ResultMessage, etc.
            pass  # Actual handling code here
```

## Step 3: Lazy Session Creation

Don't create sessions until needed:

```python
from pathlib import Path

class SDKBackend:
    def __init__(self):
        self.sessions = {}
        self.registry = SessionRegistry(Path.home() / "dispatch/state/sessions.json")

    async def inject_message(self, chat_id: str, text: str, contact_info: dict):
        """Route message to session, creating if needed."""

        if chat_id not in self.sessions:
            # Create new session
            session = await self._create_session(chat_id, contact_info)
            self.sessions[chat_id] = session

        await self.sessions[chat_id].inject_message(text)

    async def _create_session(self, chat_id: str, contact_info: dict):
        # Create transcript directory for this session
        session_name = contact_info['name'].lower().replace(" ", "-")
        transcript_dir = Path.home() / "transcripts" / session_name
        transcript_dir.mkdir(parents=True, exist_ok=True)

        session = SDKSession(
            contact_name=contact_info['name'],
            tier=contact_info['tier'],
            chat_id=chat_id,
            cwd=str(transcript_dir)
        )

        # Check for existing session to resume
        saved = self.registry.get(chat_id)
        resume_id = saved.get('session_id') if saved else None

        await session.start(resume_session_id=resume_id)
        return session
```

## Step 4: Session Resume on Daemon Restart

When daemon starts:

```python
async def startup(self):
    # Don't restore all sessions eagerly
    # Just load the registry
    self.registry.load()

    # Sessions will be recreated on first message
    # with resume_session_id from registry
```

When daemon stops:

```python
async def shutdown(self):
    for chat_id, session in self.sessions.items():
        # Save session ID for resume
        self.registry.update(chat_id, {
            'session_id': session.get_session_id()
        })
        await session.stop()

    self.registry.save()
```

## Step 5: Health Checks

Sessions can become unhealthy. Check periodically:

```python
async def health_check_all(self):
    """Run every 5 minutes."""
    for chat_id, session in list(self.sessions.items()):
        if not session.is_healthy():
            # Restart unhealthy session
            await self.restart_session(chat_id)
```

Unhealthy means:
- Client disconnected
- Too many consecutive errors
- Run loop crashed

## Step 6: Idle Session Reaping

Kill sessions that haven't been used:

```python
async def reap_idle_sessions(self, timeout_hours: float = 2.0):
    """Kill sessions idle for too long."""
    now = datetime.now()

    for chat_id, session in list(self.sessions.items()):
        idle_time = now - session.last_activity

        if idle_time.total_seconds() > timeout_hours * 3600:
            await self.kill_session(chat_id)
```

## Verification Checklist

- [ ] Sessions persist across messages (Claude remembers context)
- [ ] Session resumes after daemon restart
- [ ] Each contact has isolated session
- [ ] Registry saves/loads correctly
- [ ] Health checks run every 5 minutes
- [ ] Idle sessions are reaped after 2 hours

## What's Next

The next guides (not yet written) cover:
- `07-browser-automation.md` - Chrome control extension
- `08-smart-home.md` - Hue, Lutron, Sonos integrations
- `09-signal-integration.md` - Adding Signal as second channel

---

## Gotcha: The Steering Problem

What if a user sends a message while Claude is mid-response?

**Solution**: The SDK supports "steering" - you can call `query()` while the previous query is still running. Claude sees it as a new user message and incorporates it naturally.

```python
# This works! No need to wait for first query to finish
await client.query("What's the weather?")
await asyncio.sleep(0.5)
await client.query("Actually, make it for tomorrow")
# Claude sees both and responds appropriately
```
