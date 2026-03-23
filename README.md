# Dispatch

Turn a Mac into an always-on AI assistant with its own identity — its own iCloud, Gmail, and phone number. Not acting as you. A separate entity in your household.

**[Documentation](https://svenflow.github.io/dispatch/)** · **[Architecture](#architecture)** · **[Quick Start](#installation)**

## Overview

Dispatch runs a daemon that:
- **Receives messages** from iMessage and Signal in real-time
- **Routes them to Claude SDK sessions** based on contact tier (admin, partner, family, favorites, bots)
- **Gives Claude full computer control**: browser automation, file management, smart home, messaging
- **Maintains persistent memory** across conversations with full-text search
- **Auto-recovers from crashes** via multi-tier health monitoring and watchdog daemon
- **Records all events** to a Kafka-on-SQLite bus with 9 topics, 8+ consumer groups, FTS5 search, and tiered retention

Each contact gets their own persistent Claude session with conversation history, memories, and tier-appropriate tool access.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Messages.app (iMessage)      Signal (via signal-cli)       │
│  Polled every 100ms           JSON-RPC socket               │
└────────────────┬──────────────────────────┬─────────────────┘
                 │                          │
                 └──────────────┬───────────┘
                                ▼
                    ┌───────────────────────┐
                    │    Manager Daemon     │
                    │   (async event loop)  │
                    └──────────┬────────────┘
                               │
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
     ┌──────────────┐  ┌─────────────────────────────────┐
     │  SDK Backend  │  │  Event Bus (Kafka-on-SQLite)    │
     │  (sessions)   │  │  bus.db · WAL mode · FTS5       │
     └──────┬───────┘  │                                  │
            ▼          │  produce() ──→ write queue ──→   │
 ┌────────────────┐    │  background thread batches to    │
 │ Per-Contact    │    │  partitioned topic logs          │
 │ SDK Sessions   │    │                                  │
 │ (Opus)         │───→│  9 topics · 8+ consumer groups   │
 │ async queues,  │    │  7-day hot → infinite archive    │
 │ mid-turn       │    └──────────────┬──────────────────┘
 │ injection      │                   │
 └──────┬─────────┘          ┌────────┼─────────┐
        ▼                    ▼        ▼         ▼
 ┌────────────────┐    ┌────────┐ ┌──────┐ ┌────────┐
 │ Tools & Skills │    │message-│ │audit-│ │task-   │
 │ Browser, Home, │    │router  │ │*     │ │runner  │
 │ Memory, Msg    │    └────────┘ └──────┘ └────────┘
 └────────────────┘
```

## Features

### Messaging
- **iMessage**: Polls `chat.db` for new messages, supports individual + group chats
- **Signal**: Connects via `signal-cli` daemon with JSON-RPC socket
- **Image handling**: Gemini Vision analyzes images with conversation context
- **Mid-turn steering**: New messages reach Claude between tool calls

### Contact Tiers
| Tier | Access |
|------|--------|
| **Admin** | Full computer control, browser automation, all tools |
| **Partner** | Full access with personalized warm tone |
| **Family** | Read-only, mutations need admin approval |
| **Favorite** | Own session, restricted tools |
| **Bots** | Read-only with loop detection |
| **Unknown** | Ignored (no session created) |

Tiers are managed via macOS Contacts.app groups.

### Session Management
- Per-contact SDK sessions with automatic resumption
- Transcript storage at `~/transcripts/{backend}/{chat_id}/`
- Two-tier health monitoring: fast regex (60s) + deep LLM analysis (5min)
- Idle session reaping after 2 hours
- Session registry persists across daemon restarts

### Skills System
Skills are modular capabilities in `~/.claude/skills/`. Each has:
- `SKILL.md` with YAML frontmatter (name, description, triggers)
- Optional `scripts/` directory with CLI executables
- Template placeholders: `{{CONTACT_NAME}}`, `{{TIER}}`, `{{CHAT_ID}}`

**67+ built-in skills** including:
- `sms-assistant` - Messaging guidelines and tier rules
- `chrome-control` - Browser automation (clicks, typing, screenshots)
- `memory` - Persistent memory with FTS search
- `hue`, `lutron`, `sonos` - Smart home control
- `ios-app` - iOS development and TestFlight
- `gemini` - Vision API for image analysis
- `reminders` - Natural language reminder parsing
- And many more...

### Event Bus (Kafka-on-SQLite)

Every message, session event, health check, and tool call flows through a SQLite-based event bus modeled after Kafka's log architecture.

**Core design:**
- **Fire-and-forget writes**: In-memory write queue (~microsecond enqueue), background thread batches up to 100 records per transaction
- **WAL mode**: Concurrent reads during writes, no event loop blocking
- **Partitioned topics**: 9 topics (`messages`, `system`, `sessions`, `tasks`, `messages.dlq`, `facts`, `reminders`, `imessage.ui`, plus `sdk_events`) with configurable partition counts
- **Consumer groups**: 8+ active groups (message-router, audit-\*, task-runner, compaction-handler, etc.) with committed offsets, generation tracking, and at-least-once delivery
- **Two storage tiers**: Hot tables with 7-day retention auto-prune to archive tables with infinite retention
- **FTS5 full-text search**: BM25-ranked search across all events with smart text extraction per event type
- **SDK event tracking**: Every tool call from every Claude session traced with duration, error status, and session context

**Schema:**
- `records` — Business events with composite PK `(topic, partition, offset)`, WITHOUT ROWID
- `sdk_events` — Tool execution traces with structured columns
- `records_archive` / `sdk_events_archive` — Pruned records retained indefinitely
- `records_fts` / `sdk_events_fts` — FTS5 virtual tables with auto-sync triggers

**Bus CLI:**
```bash
uv run python -m bus.cli stats          # Event counts, throughput, consumer lag
uv run python -m bus.cli tail           # Live tail of events
uv run python -m bus.cli search "query" # Full-text search across all records
uv run python -m bus.cli groups         # Consumer group status and lag
uv run python -m bus.cli export         # Export events as JSONL
```

### Resource Lifecycle
- **ResourceRegistry**: Centralized tracking of all persistent FDs, connections, and subprocesses via `AsyncExitStack`
- **ManagedSQLiteReader/Writer**: Single-connection-per-database pattern on dedicated executor threads — eliminates contention
- **FD leak detection**: Monitors `/dev/fd/` delta vs tracked resources every 5 minutes
- **Safe cleanup**: Handles non-idempotent `close()` calls (SQLite, subprocesses) via wrapped callbacks

### Reliability
- **Watchdog daemon**: Auto-recovers from crashes
- **Exponential backoff**: 60s → 120s → 240s → 480s → 900s
- **Health checks**: Regex patterns + Haiku LLM analysis
- **SMS alerts**: Admin notified of recovery attempts
- **Max 5 failures** before manual intervention required

## Requirements

- macOS (uses Messages.app, Contacts.app)
- Python 3.12+ with [`uv`](https://github.com/astral-sh/uv) package manager
- Claude API access (Anthropic)
- Optional: `signal-cli` daemon for Signal messaging
- Optional: Chrome with [Chrome Control extension](~/.claude/skills/chrome-control/) for browser automation

## Installation

```bash
# Clone the repo
git clone https://github.com/svenflow/dispatch.git ~/dispatch
cd ~/dispatch

# Install dependencies
uv sync

# Copy and edit config
cp config.example.yaml config.local.yaml
# Edit config.local.yaml with your settings

# Start the daemon
./bin/claude-assistant start

# Install watchdog for auto-recovery (recommended)
./bin/watchdog-install
```

## Configuration

See `config.example.yaml` for all options. Key settings:

```yaml
assistant:
  name: "Sven"                    # Assistant's name

contacts:
  owner_phone: "+1234567890"      # Your phone (gets admin tier)

messaging:
  enabled_backends:
    - imessage
    - signal

hue:
  bridges:
    home: "192.168.1.x"
    office: "192.168.1.y"
```

## CLI Usage

```bash
# Daemon management
./bin/claude-assistant start           # Start daemon
./bin/claude-assistant stop            # Stop daemon
./bin/claude-assistant restart         # Restart (via launchctl)
./bin/claude-assistant status          # Show status and sessions
./bin/claude-assistant logs            # Tail daemon logs

# Session management
./bin/claude-assistant kill-session <name>      # Kill specific session
./bin/claude-assistant restart-session <name>   # Restart specific session
./bin/claude-assistant restart-sessions         # Restart all sessions

# Watchdog
./bin/watchdog-install     # Install auto-recovery
./bin/watchdog-uninstall   # Remove watchdog
./bin/watchdog-status      # Check watchdog status
```

## Directory Structure

```
~/dispatch/
├── assistant/           # Core daemon code
│   ├── manager.py       # Main daemon (polling, routing)
│   ├── sdk_backend.py   # Session factory and management
│   ├── sdk_session.py   # Per-contact session wrapper
│   ├── bus_helpers.py   # Bus event production helpers (taxonomy v6)
│   ├── resources.py     # ResourceRegistry, ManagedSQLiteReader/Writer
│   ├── health.py        # Health check logic (fast regex + deep LLM)
│   ├── reminders.py     # Reminder system
│   ├── readers.py       # Message readers (iMessage, Signal)
│   ├── perf.py          # Performance metric recording
│   ├── cli.py           # Command-line interface
│   └── config.py        # Configuration loader
├── bus/                 # Kafka-on-SQLite message bus
│   ├── bus.py           # Core: Producer (write queue), Consumer groups, FTS5
│   ├── cli.py           # Bus CLI (stats, tail, search, groups, export)
│   ├── consumers.py     # Consumer framework with declarative configs
│   └── search.py        # FTS5 full-text search (BM25, smart text extraction)
├── bin/                 # Executable scripts
│   ├── claude-assistant # Main CLI
│   ├── watchdog         # Auto-recovery daemon
│   └── watchdog-*       # Watchdog management
├── services/            # Supporting services
│   └── dispatch-api/        # iOS app backend
├── tests/               # Test suite (920+ tests)
├── state/               # Runtime state
│   ├── sessions.json    # Session registry
│   ├── bus.db           # Bus database (records + sdk_events)
│   └── daemon.pid       # Current PID
├── logs/                # Log files
│   ├── manager.log      # Daemon log
│   ├── perf-*.jsonl     # Performance metrics (daily)
│   └── sessions/        # Per-session logs
├── plans/               # Architecture plans
└── config.local.yaml    # Local configuration
```

## Development

```bash
# Run all tests
uv run pytest tests/ -v

# Run core tests only
uv run pytest tests/test_backends.py tests/test_session_lifecycle.py \
    tests/test_registry.py tests/test_health_checks.py -v

# Type checking (uses ty, not mypy)
uv run ty check assistant/

# Linting (uses ruff)
uv run ruff check assistant/
```

### Test Structure
- `tests/test_backends.py` - Backend config, routing, normalization
- `tests/test_session_lifecycle.py` - Session create/stop/inject, health
- `tests/test_registry.py` - Registry CRUD, persistence
- `tests/test_health_checks.py` - Health monitoring, idle reaping
- `tests/test_message_routing.py` - Message normalization, file handling
- `tests/test_performance.py` - Concurrency, throughput, leaks
- `tests/test_bus.py` - Bus core: producer, consumer, write queue, retention, FTS5, archive
- `tests/test_bus_helpers.py` - Event production, sanitize/reconstruct, taxonomy
- `tests/test_consumers.py` - Consumer groups, offsets, commit, fanout, batching
- `tests/unit/` - Pure function tests
- `tests/integration/` - Integration tests with fake chatdb

## Key Design Decisions

1. **No auto-send**: Claude explicitly calls `send-sms` or `send-signal` CLIs (full control over messaging)
2. **In-process sessions**: No tmux/subprocess shells, all sessions in async event loop
3. **Mid-turn steering**: New messages injected between tool calls via async queue
4. **Two-tier health**: Fast regex + slow LLM analysis balances speed vs accuracy
5. **Skills as modules**: Shared, version-controlled, injected via symlink
6. **Kafka-on-SQLite event bus**: Fire-and-forget audit trail with write queue (no event loop blocking), 8+ consumer groups for routing, auditing, and task execution
7. **Tiered event storage**: Business events in `records` table (7-day hot → infinite archive), SDK traces in `sdk_events` table (7-day hot → infinite archive), both with FTS5 full-text search
8. **Centralized resource lifecycle**: All FDs, connections, and subprocesses tracked via `ResourceRegistry` (AsyncExitStack wrapper) for structural cleanup and FD leak detection

## Metrics & Limits

| Setting | Value |
|---------|-------|
| Polling interval | 100ms |
| Health check (Tier 1) | 60 seconds |
| Health check (Tier 2) | 5 minutes |
| Session idle reap | 2 hours |
| Watchdog cycle | 60 seconds |
| Max consecutive failures | 5 |
| Session log size | 10MB (5 backups) |
| Bus write batch size | 100 records |
| Bus hot retention | 7 days (auto-prune to archive) |
| Bus archive retention | Infinite |
| Bus prune interval | Every 1000 produces |

## Documentation

Full documentation is available at **[svenflow.github.io/dispatch](https://svenflow.github.io/dispatch/)**, covering:

- **Getting Started** — Philosophy, setup guide
- **Core Systems** — Architecture, messaging, tiers & permissions, skills, CLI reference
- **Operations** — Message bus, memory, health & healing, analytics, postmortems, configuration

## License

MIT
