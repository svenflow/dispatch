---
layout: default
title: Getting Started
nav_order: 2
---

# Getting Started
{: .no_toc }

Get Dispatch running on your Mac in minutes.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Requirements

- **macOS** (uses Messages.app, Contacts.app)
- **Python 3.12+** with [`uv`](https://github.com/astral-sh/uv) package manager
- **Claude API access** (Anthropic)
- **Optional**: `signal-cli` daemon for Signal messaging
- **Optional**: Chrome with Chrome Control extension for browser automation

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/svenflow/dispatch.git ~/dispatch
cd ~/dispatch
```

### 2. Install dependencies

```bash
uv sync
```

### 3. Configure

```bash
# Copy the example config
cp config.example.yaml config.local.yaml

# Edit with your settings
nano config.local.yaml
```

Key settings:
- `assistant.name` — Your assistant's name
- `contacts.owner_phone` — Your phone number (gets admin tier)
- `messaging.enabled_backends` — Which backends to enable

### 4. Set up Contacts groups

Create these groups in macOS Contacts.app:
- `Claude Admin` — Full access users (your phone)
- `Claude Partner` — Partner with full access + warm tone
- `Claude Family` — Family members (read-only)
- `Claude Favorites` — Friends (restricted tools)
- `Claude Bots` — AI agents (loop detection)

Add contacts to appropriate groups to assign their tier.

### 5. Start the daemon

```bash
./bin/claude-assistant start
```

### 6. Install the watchdog (recommended)

The watchdog auto-recovers from crashes:

```bash
./bin/watchdog-install
```

## Verify it's working

```bash
# Check status
./bin/claude-assistant status

# Watch logs
./bin/claude-assistant logs
```

Send yourself a text message — the daemon should pick it up and Claude will respond!

## Next steps

- [Contact Tiers]({% link docs/tiers.md %}) — Learn about access control
- [Skills System]({% link docs/skills.md %}) — Explore built-in capabilities
- [CLI Reference]({% link docs/cli.md %}) — Full command documentation
