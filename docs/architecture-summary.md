# Dispatch: Personal AI Assistant Architecture

*Generated: February 9, 2025*

---

## Overview

Dispatch is a **personal AI assistant system** that gives Claude full computer control through a Mac. It handles messaging (iMessage + Signal), browser automation, smart home control, file management, and more — all orchestrated by a persistent daemon with per-contact AI sessions.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Messages.app                             │
│                         (chat.db)                               │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Manager Daemon                              │
│               (polls every 100ms)                               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   iMessage   │  │    Signal    │  │     Test     │          │
│  │   Backend    │  │   Backend    │  │   Backend    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         └─────────────────┼─────────────────┘                   │
│                           ▼                                     │
│               ┌───────────────────────┐                         │
│               │   Contact Lookup      │                         │
│               │   (SQLite cache)      │                         │
│               └───────────┬───────────┘                         │
│                           ▼                                     │
│               ┌───────────────────────┐                         │
│               │   Tier Determination  │                         │
│               │ admin/wife/family/... │                         │
│               └───────────┬───────────┘                         │
│                           ▼                                     │
│               ┌───────────────────────┐                         │
│               │    SDK Backend        │                         │
│               │  (session manager)    │                         │
│               └───────────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SDK Sessions                               │
│                  (one per contact)                              │
│                                                                 │
│   ┌──────────────────────────────────────────────────────┐     │
│   │  +15551234567 (admin)  │  +15559876543 (wife)  │ ... │     │
│   │      SDKSession        │      SDKSession        │     │     │
│   │   ┌─────────────────┐  │   ┌─────────────────┐  │     │     │
│   │   │ Claude Agent SDK│  │   │ Claude Agent SDK│  │     │     │
│   │   │ (Opus model)    │  │   │ (Opus model)    │  │     │     │
│   │   └─────────────────┘  │   └─────────────────┘  │     │     │
│   └──────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Tools & Skills                            │
│                                                                 │
│   Browser    Smart Home    Files    Messaging    Memory         │
│  (Chrome)   (Hue/Lutron)  (Bash)  (SMS/Signal)  (Contacts)     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Manager Daemon (`manager.py` — 1,827 lines)

The central orchestrator that:

- **Polls Messages.app** every 100ms via SQLite (`chat.db`)
- **Listens to Signal** via JSON-RPC socket at `/tmp/signal-cli.sock`
- **Routes messages** to per-contact SDK sessions
- **Runs health checks** every 60s (fast) and 5min (deep)
- **Reaps idle sessions** after 2 hours
- **Handles reminders**, nightly consolidation, and IPC commands

**Key Design Decision**: Messages are polled (not pushed) because macOS doesn't expose a reliable notification API for new iMessages.

### 2. SDK Backend (`sdk_backend.py` — 1,301 lines)

Manages all Claude SDK sessions:

- **SessionRegistry**: Persistent mapping of chat_id → session metadata
- **Session Lifecycle**: Create, inject, kill, restart
- **Health Monitoring**: Two-tier system
  - **Tier 1 (60s)**: Fast regex scan for fatal errors (`context_length_exceeded`, `auth_failed`, etc.)
  - **Tier 2 (5min)**: Deep Haiku LLM analysis for semantic issues

### 3. SDK Session (`sdk_session.py` — 490 lines)

Each contact gets an `SDKSession` wrapping the Claude Agent SDK:

```python
┌─────────────────────────────────────────┐
│              SDKSession                  │
│                                          │
│  ┌────────────────┐  ┌────────────────┐ │
│  │  Message Queue │  │   Receiver     │ │
│  │  (asyncio)     │  │  (background)  │ │
│  └───────┬────────┘  └────────────────┘ │
│          │                              │
│          ▼                              │
│  ┌────────────────────────────────────┐ │
│  │        Claude SDK Client           │ │
│  │    (with session resume support)   │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**Key Features**:
- Concurrent send/receive (mid-turn steering)
- Message merging for batched inputs
- Per-session logging (10MB rotating)
- Session resume via saved session_id

### 4. Watchdog (`bin/watchdog` — 150 lines bash)

Auto-recovery system running every 60 seconds:

```
┌─────────────┐     ┌─────────────────────┐
│  launchd    │────▶│     watchdog        │
│ (60s timer) │     │                     │
└─────────────┘     │  1. Check status    │
                    │  2. If down:        │
                    │     - Lock mutex    │
                    │     - Spawn healer  │
                    │     - SMS admin     │
                    │  3. Backoff logic   │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   Healing Claude    │
                    │  (one-shot session) │
                    │                     │
                    │  - kickstart daemon │
                    │  - check logs       │
                    │  - restart sessions │
                    │  - notify admin     │
                    └─────────────────────┘
```

**Exponential Backoff**: 60s → 120s → 240s → 480s → 900s (max)

---

## Contact Tier System

Tiers are managed via macOS Contacts.app groups:

| Tier | Access Level | Session | Description |
|------|--------------|---------|-------------|
| **admin** | Full | ✅ | Owner — browser, shell, smart home, everything |
| **wife** | Full | ✅ | Same as admin but with warmer tone |
| **family** | Read-only | ✅ | Can ask questions; mutations need admin approval |
| **favorite** | Restricted | ✅ | Trusted friends; limited tools |
| **bots** | Read-only | ✅ | Other AIs; loop detection enabled |
| **unknown** | None | ❌ | Ignored — no response, no session |

Each tier has a rules file injected into the session:
- `~/.claude/skills/sms-assistant/admin-rules.md`
- `~/.claude/skills/sms-assistant/wife-rules.md`
- etc.

---

## Message Flow

### Inbound Message

```
1. Message arrives in Messages.app (or Signal)
2. Manager detects new rowid in chat.db (or Signal socket event)
3. Contact lookup → get tier, name, phone
4. If unknown tier → ignore
5. If known tier:
   a. Get or create SDKSession for this chat_id
   b. Wrap message with context (tier, reply chain, etc.)
   c. Inject into session's message queue
   d. Claude processes message
   e. Claude calls send-sms/send-signal via Bash tool
```

### Outbound Message

Claude doesn't auto-send. It explicitly calls:

```bash
~/.claude/skills/sms-assistant/scripts/send-sms "+15551234567" "Hello!"
# or
~/.claude/skills/signal/scripts/send-signal "+15551234567" "Hello!"
```

This is intentional — it ensures Claude consciously decides to send each message.

---

## Session Naming & Directories

### Transcript Structure

```
~/transcripts/
├── master/                              # Admin-only background session
├── imessage/
│   ├── _15551234567/                   # Individual (phone sanitized)
│   │   ├── .claude -> ~/.claude        # Symlink to skills
│   │   └── transcript.jsonl            # Conversation history
│   └── b3d258b9a4de447ca412eb335c82a077/  # Group (UUID)
│       └── .claude -> ~/.claude
└── signal/
    └── _15551234567/
        └── .claude -> ~/.claude
```

### Session Naming Convention

```
{backend}/{sanitized_chat_id}

Examples:
  imessage/_15551234567     # Individual iMessage
  signal/_15551234567       # Individual Signal
  imessage/b3d258b9...      # Group iMessage
```

---

## Skills System

Skills are reusable capability modules in `~/.claude/skills/`:

```
~/.claude/skills/
├── chrome-control/        # Browser automation
│   ├── SKILL.md
│   └── scripts/
│       └── chrome         # CLI for Chrome control
├── sms-assistant/         # Messaging
│   ├── SKILL.md
│   └── scripts/
│       ├── send-sms
│       ├── read-sms
│       └── reply
├── hue/                   # Philips Hue lights
├── lutron/                # Lutron Caseta
├── sonos/                 # Sonos speakers
├── reminders/             # macOS Reminders
├── contacts/              # Contact lookup
├── memory/                # Persistent memory (FTS)
└── ...
```

Each skill has:
- **SKILL.md**: Documentation with YAML frontmatter
- **scripts/**: Executable CLIs (Python with `uv` shebang)

---

## State & Configuration

### Runtime State (`~/dispatch/state/`)

```
state/
├── daemon.pid           # Current process ID
├── last_rowid.txt       # Last processed iMessage rowid
├── sessions.json        # Session registry
└── sessions.json.bak    # Backup
```

### Logs (`~/dispatch/logs/`)

```
logs/
├── manager.log              # Main daemon
├── session_lifecycle.log    # Create/kill/restart events
├── watchdog.log             # Watchdog activity
└── sessions/
    └── imessage-_15551234567.log  # Per-session logs
```

### Configuration (`~/dispatch/config.local.yaml`)

```yaml
owner:
  name: "Your Name"
  phone: "+1XXXXXXXXXX"

wife:
  name: "Partner Name"

signal:
  account: "+1XXXXXXXXXX"

hue:
  bridges:
    home:
      ip: "10.10.10.X"
```

---

## CLI Commands

```bash
# Daemon management
claude-assistant start              # Start daemon
claude-assistant stop               # Stop daemon
claude-assistant restart            # Restart daemon
claude-assistant status             # Show active sessions

# Session management
claude-assistant kill-session <id>      # Stop session
claude-assistant restart-session <id>   # Restart session
claude-assistant inject-prompt <id> "msg"  # Inject message

# Logs
claude-assistant logs               # Tail manager.log
claude-assistant attach <session>   # Tail session log

# Installation
claude-assistant install            # Install LaunchAgent
claude-assistant uninstall          # Remove LaunchAgent
```

---

## Recent Changes (Last 2 Weeks)

### Major Milestones

| Date | Commit | Change |
|------|--------|--------|
| Feb 9 | `f87e4b9` | iOS app infrastructure, memory search, chrome improvements |
| Feb 8 | `646ca5d` | **Watchdog auto-recovery system** |
| Feb 7 | `7603b86` | Session auto-resume, reply CLI, transcript migration |
| Feb 6 | `edd1a6b` | axctl (macOS accessibility automation) |
| Feb 6 | `243fceb` | Bootstrap guides for recreating system from scratch |
| Feb 6 | `d923194` | **Refactor: ~/code/claude-assistant → ~/dispatch** |
| Feb 2 | `27dd966` | Initial commit: PII-safe codebase for version control |

### Key Improvements

1. **Watchdog System** (Feb 8)
   - Auto-detects daemon crashes
   - Exponential backoff prevents thrashing
   - Spawns healing Claude session
   - SMS notifications to admin

2. **Session Resume** (Feb 7)
   - Sessions persist across daemon restarts
   - Conversation context preserved
   - SDK session_id saved to registry

3. **Two-Tier Health Checks** (Feb 7)
   - Fast regex scan every 60s
   - Deep Haiku analysis every 5min
   - Auto-restart on detected issues

4. **Reply CLI** (Feb 7)
   - Universal `reply` command
   - Auto-detects backend from cwd
   - Works in any transcript directory

5. **Bootstrap Documentation** (Feb 6)
   - 15 step-by-step guides
   - Recreate entire system from scratch
   - Detailed permissions setup

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **Polling (not push)** | macOS has no reliable iMessage notification API |
| **One session per contact** | Maintains conversation context and memory |
| **Opus model only** | Quality matters more than cost for personal assistant |
| **Explicit send commands** | Claude consciously decides each outgoing message |
| **Lazy session creation** | Reduces memory footprint; create on first message |
| **File locking for registry** | Prevents CLI/daemon race conditions |
| **Watchdog as separate process** | Can recover from daemon crashes |
| **Skills as symlinked directories** | All sessions share same skill definitions |

---

## Code Statistics

| Component | Lines | Purpose |
|-----------|-------|---------|
| `manager.py` | 1,827 | Main daemon, polling, lifecycle |
| `sdk_backend.py` | 1,301 | Session management, health |
| `cli.py` | 866 | CLI commands, IPC server |
| `sdk_session.py` | 490 | Per-session queue, send/receive |
| `common.py` | 413 | Utilities, normalization |
| `health.py` | 275 | Health check logic |
| `backends.py` | 68 | Backend definitions |
| **Total Core** | **~5,500** | Python (excluding tests) |

---

## Quick Start for New Developers

1. **Read the bootstrap guides** in `~/dispatch/docs/bootstrap/`
2. **Check daemon status**: `claude-assistant status`
3. **Tail the logs**: `claude-assistant logs`
4. **Understand tiers**: Look at Contacts.app groups
5. **Explore skills**: `ls ~/.claude/skills/`

For questions, the admin can be reached via the admin session.

---

*This document was auto-generated by Sven, the AI assistant.*
