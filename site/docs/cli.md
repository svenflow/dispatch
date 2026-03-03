---
layout: default
title: CLI Reference
nav_order: 5
---

# CLI Reference
{: .no_toc }

Command-line interface for managing Dispatch.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Daemon Management

### start
Start the daemon (if not running).

```bash
./bin/claude-assistant start
```

### stop
Stop the daemon.

```bash
./bin/claude-assistant stop
```

### restart
Restart the daemon via launchctl.

```bash
./bin/claude-assistant restart
```

{: .important }
Always use `restart` instead of `stop` + `start`. The restart command uses `launchctl kickstart` to ensure a clean environment.

### status
Show daemon status and active sessions.

```bash
./bin/claude-assistant status
```

Output includes:
- Daemon PID and uptime
- Active session count
- Per-session info (contact, tier, model, last activity)

### logs
Tail the daemon log file.

```bash
./bin/claude-assistant logs
```

## Session Management

### kill-session
Kill a specific session.

```bash
./bin/claude-assistant kill-session <session>
```

Session can be:
- Session name: `imessage/_16175551234`
- Chat ID: `+16175551234`
- Contact name: `"John Smith"`

### restart-session
Restart a specific session (compacts first).

```bash
./bin/claude-assistant restart-session <session>
./bin/claude-assistant restart-session <session> --no-compact  # Skip compaction
./bin/claude-assistant restart-session <session> --tier family  # Override tier
```

### restart-sessions
Restart all active sessions.

```bash
./bin/claude-assistant restart-sessions
```

### compact-session
Generate a context summary without restarting.

```bash
./bin/claude-assistant compact-session <session>
```

### inject-prompt
Inject a prompt into a session.

```bash
./bin/claude-assistant inject-prompt <session> "prompt"
./bin/claude-assistant inject-prompt <session> --sms "message"     # SMS format
./bin/claude-assistant inject-prompt <session> --admin "command"   # Admin override
./bin/claude-assistant inject-prompt <session> --bg "prompt"       # Background
```

{: .note }
Always use `inject-prompt` instead of injecting directly. It handles auto-creation, locking, and format wrapping.

## Watchdog

### watchdog-install
Install the auto-recovery watchdog.

```bash
./bin/watchdog-install
```

The watchdog:
- Checks daemon health every 60 seconds
- Auto-restarts on crash with exponential backoff
- Sends SMS alerts on recovery attempts
- Stops after 5 consecutive failures

### watchdog-uninstall
Remove the watchdog.

```bash
./bin/watchdog-uninstall
```

### watchdog-status
Check watchdog status.

```bash
./bin/watchdog-status
```

## Identity

### identity
Look up configuration values.

```bash
./bin/identity owner.name      # → "John Smith"
./bin/identity owner.phone     # → "+16175551234"
./bin/identity assistant.name  # → "Sven"
./bin/identity partner.name    # → "Jane Smith"
```

Supports dot notation for nested values.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISPATCH_CONFIG` | Path to config file (default: `config.local.yaml`) |
| `DISPATCH_LOG_LEVEL` | Log level: DEBUG, INFO, WARNING, ERROR |
| `ANTHROPIC_API_KEY` | Claude API key |
