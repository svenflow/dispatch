---
layout: default
title: Architecture
nav_order: 6
---

# Architecture
{: .no_toc }

How Dispatch works under the hood.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## System Overview

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
                    │   (event loop)        │
                    └──────────┬────────────┘
                               ▼
                    ┌───────────────────────┐
                    │   Contact Lookup      │
                    │   + Tier Check        │
                    └──────────┬────────────┘
                               ▼
                    ┌───────────────────────┐
                    │   SDK Backend         │
                    │   (session factory)   │
                    └──────────┬────────────┘
                               ▼
              ┌────────────────────────────────┐
              │   Per-Contact SDK Sessions     │
              │   (Claude Opus, async queues,  │
              │    mid-turn message injection) │
              └────────────────────────────────┘
                               ▼
              ┌────────────────────────────────┐
              │   Tools & Skills               │
              │   Browser, Smart Home, Memory, │
              │   Messaging, Files, etc.       │
              └────────────────────────────────┘
```

## Components

### Manager Daemon

The main daemon (`assistant/manager.py`) that:
- Polls Messages.app (chat.db) every 100ms
- Listens to Signal JSON-RPC socket
- Routes messages to appropriate sessions
- Handles session lifecycle

### SDK Backend

Session factory (`assistant/sdk_backend.py`) that:
- Creates and manages per-contact sessions
- Configures tool access based on tier
- Handles session resumption
- Manages idle reaping

### SDK Session

Per-contact wrapper (`assistant/sdk_session.py`) that:
- Wraps Claude Agent SDK
- Manages async message queue
- Handles mid-turn steering
- Tracks health and activity

### Contact Lookup

Tier determination via:
- macOS Contacts.app groups
- SQLite cache for O(1) lookups
- AppleScript fallback for writes

## Message Flow

### Inbound Message

1. Message arrives in Messages.app or Signal
2. Manager detects new message (poll or socket)
3. Contact lookup → get tier, name, phone
4. If unknown tier → ignore
5. If known tier:
   - Get or create SDKSession
   - Inject message into session queue
   - Claude processes and responds

### Outbound Message

Claude explicitly calls send CLIs:
```bash
~/.claude/skills/sms-assistant/scripts/send-sms "+phone" "message"
~/.claude/skills/signal/scripts/send-signal "+phone" "message"
```

{: .note }
No auto-send — Claude has full control over when and how to respond.

## Mid-Turn Steering

New messages can reach Claude between tool calls:

```
User sends message
    ↓
Message added to session queue
    ↓
Claude is mid-turn (running tools)
    ↓
Between tool calls, Claude checks queue
    ↓
If new messages, they're included in context
    ↓
Claude can respond or adjust behavior
```

This enables responsive behavior without waiting for long operations to complete.

## Health Monitoring

Two-tier health check system:

### Tier 1: Fast Regex (60s)
- Checks for stuck patterns in session output
- Low CPU, runs every minute
- Catches obvious failures

### Tier 2: Deep LLM Analysis (5min)
- Haiku analyzes session state
- Catches subtle issues
- Higher fidelity, runs less often

## Session Lifecycle

```
New message → Check registry
                ↓
        Session exists? ──No──→ Create session
                ↓                    ↓
               Yes              Set up cwd
                ↓               Inject skills
                ↓               Start SDK agent
                ↓                    ↓
        Inject message ←─────────────┘
                ↓
        Process & respond
                ↓
        Update last_activity
                ↓
        Idle > 2h? ──Yes──→ Reap session
                ↓
               No
                ↓
        Continue...
```

## Key Design Decisions

1. **No auto-send**: Claude explicitly calls send CLIs
2. **In-process sessions**: No tmux/subprocess shells
3. **Mid-turn steering**: Async queues for message injection
4. **Two-tier health**: Speed vs accuracy tradeoff
5. **Skills as modules**: Shared, version-controlled, injected via symlink
6. **Opus only**: All sessions use Claude Opus (never Sonnet/Haiku for contacts)
