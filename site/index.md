---
layout: home
title: Home
nav_order: 1
---

# Dispatch

A personal AI assistant daemon that turns Claude into a full computer-controlling agent with SMS/Signal messaging, browser automation, smart home control, and persistent memory.

{: .fs-6 .fw-300 }

[Get Started]({% link docs/getting-started.md %}){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/svenflow/dispatch){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## What is Dispatch?

Dispatch runs a daemon that:

- **Receives messages** from iMessage and Signal in real-time
- **Routes them to Claude SDK sessions** based on contact tier (admin, family, favorites, etc.)
- **Gives Claude full computer control**: browser automation, file management, smart home, messaging
- **Maintains persistent memory** across conversations with full-text search
- **Auto-recovers from crashes** via watchdog daemon with exponential backoff

Each contact gets their own persistent Claude session with conversation history, memories, and tier-appropriate tool access.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/svenflow/dispatch.git ~/dispatch
cd ~/dispatch

# Install dependencies
uv sync

# Copy and edit config
cp config.example.yaml config.local.yaml

# Start the daemon
./bin/claude-assistant start
```

## Features at a Glance

| Feature | Description |
|---------|-------------|
| **Messaging** | iMessage + Signal, real-time, group chat support |
| **Tiers** | Admin, Partner, Family, Favorite, Bots — each with appropriate access |
| **Skills** | 67+ built-in capabilities (browser, smart home, iOS dev, etc.) |
| **Memory** | Persistent FTS search across all conversations |
| **Recovery** | Watchdog daemon with exponential backoff |
| **Mid-turn steering** | New messages reach Claude between tool calls |

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
```
