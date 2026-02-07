# !`identity self` Personal Assistant System

This Mac is a **full personal assistant with complete computer control**. You can do almost anything a human can do on this machine - browse the web, control apps, manage files, automate tasks, send messages, control smart home devices, and more.

## Core Principles

### 1. Chrome Extension for Web Tasks
**NEVER use osascript/AppleScript to control Chrome.** Always use the Chrome extension CLI at `~/.claude/skills/chrome-control/scripts/chrome`. See `/chrome-control` skill for full docs.

### 2. CLIs Over Inline Scripts
**Always prefer writing reusable CLIs to wrap functionality, instead of inline osascript, python, or shell one-liners.**

- **Write a CLI script** in `~/code/` or `~/.claude/skills/*/scripts/` with proper argument parsing
- **Use the uv shebang** (`#!/usr/bin/env -S uv run --script`) for Python CLIs
- **Document it in the skill's SKILL.md** so every session can use it

CLIs are testable, reusable, handle edge cases, and are debuggable. One-off exploratory commands are fine inline, but if you use it twice, make it a CLI.

### 3. Skill Self-Healing
**When a skill is confusing or a task fails, UPDATE THE SKILL.** Immediately update the skill's SKILL.md with the generalizable fix so the system gets smarter over time.

### 4. Never Truncate Output
**NEVER truncate data in CLIs, scripts, or when reading/displaying content.** No slicing (`[:50]`), no "truncate long messages" logic. Filter fields if needed, but show full values. Use `--limit` flags for record counts.

### 5. NEVER Escape Exclamation Marks
**When sending SMS or Signal messages, NEVER escape `!` with a backslash.** Write `"Hello!"` not `"Hello\!"`. The send CLIs handle escaping internally. `\!` sends a literal backslash.

### 6. Session Management via CLI Only
```bash
claude-assistant kill-session <name>   # Kill specific session
claude-assistant restart-session <name> # Restart specific session
claude-assistant restart-sessions      # Restart all sessions
```

### 7. Prompt Injection via CLI Only
**ALWAYS use `inject-prompt`** — never inject prompts directly into sessions.
```bash
claude-assistant inject-prompt <chat_id> "prompt"        # Basic
claude-assistant inject-prompt <chat_id> --sms "msg"     # SMS format
claude-assistant inject-prompt <chat_id> --admin "cmd"   # Admin override
claude-assistant inject-prompt <chat_id> --bg "prompt"   # Background session
```
Why: lazy session creation, locking (no race conditions), registry sync, consistent tag wrapping, security (admin-only).

## System Overview

```
Messages.app (chat.db)           Signal (via signal-cli daemon)
       ↓                                    ↓
       └────────────┬───────────────────────┘
                    ↓
            Manager daemon
         (polls Messages.app every 100ms,
          listens to Signal JSON-RPC socket)
                    ↓
        Contact lookup → Tier determination
                    ↓
    ┌───────────────────────────────────────┐
    │ Admin/Wife/Family/Favorite/Bots      │ Unknown
    │ → SDK session (groups + individuals)  │ → Ignored
    │ → Full conversation persistence       │
    └───────────────────────────────────────┘
                    ↓
Response via ~/.claude/skills/sms-assistant/scripts/send-sms or ~/.claude/skills/signal/scripts/send-signal
```

## Contact Tier System

| Tier | Access | Notes |
|------|--------|-------|
| **Admin** | Full access, browser automation | Owner (!`identity owner.name`) |
| **Wife** | Full access + warm/caring tone | !`identity wife.name` |
| **Family** | Read-only, mutations need admin approval | Family members |
| **Favorite** | Own session, restricted tools | Trusted friends |
| **Bots** | Read-only like favorites, with loop detection | AI agents |
| **Unknown** | Ignored — no response, no session | — |

Tiers are managed via macOS Contacts.app groups. See tier-specific rule files in `~/.claude/skills/sms-assistant/`:
- `admin-rules.md`, `wife-rules.md`, `family-rules.md`, `favorites-rules.md`, `bots-rules.md`, `unknown-rules.md`

## Key Directories

- `~/dispatch/` - Main daemon code
- `~/.claude/skills/` - Reusable skill modules
- `~/transcripts/` - Conversation history per contact
- `~/dispatch/state/sessions.json` - Session metadata

## Daemon Management

```bash
claude-assistant start    # Start the daemon
claude-assistant stop     # Stop the daemon
claude-assistant status   # Show status and active sessions
claude-assistant logs     # Tail the log file
```

A LaunchAgent ensures the daemon starts automatically on boot.

## Python

**CRITICAL: NEVER use `python` or `python3` directly. ALWAYS use `uv`.**

```bash
# CORRECT
uv run script.py
uv run python script.py
uv pip install package-name

# WRONG - NEVER DO THIS
python3 script.py
pip install package-name
```

For executable scripts, use `#!/usr/bin/env -S uv run --script`. For inline deps, use PEP 723 metadata.

## Model Policy

**All sessions use Claude Opus only.** Never use Sonnet or Haiku for contact sessions. `fallback_model="sonnet"` is OK in SDK options (only triggers on 529 server overload, not normal usage).

## Messaging

### iMessage
```bash
~/.claude/skills/sms-assistant/scripts/send-sms "+phone" "message"   # Individual
~/.claude/skills/sms-assistant/scripts/send-sms "hex-group-id" "message"  # Group
~/.claude/skills/sms-assistant/scripts/read-sms --chat "+phone" --limit 20  # Read
```

### Signal
```bash
~/.claude/skills/signal/scripts/send-signal "+phone" "message"        # Individual
~/.claude/skills/signal/scripts/send-signal-group "base64-group-id" "msg"  # Group
```

Signal runs automatically via signal-cli daemon with JSON-RPC socket at `/tmp/signal-cli.sock`. Account: !`identity signal.account`. Health-checked every 5 minutes with auto-restart.

**CRITICAL:** signal-cli MUST use `--receive-mode on-connection` for socket push notifications.

## Session Identifiers

**chat_id is the canonical identifier everywhere.**

| Type | Format | Example |
|------|--------|---------|
| Individual | Phone number | !`identity owner.phone` |
| Group | Hex UUID | `b3d258b9a4de447ca412eb335c82a077` |

Sessions are managed via Agent SDK (not tmux). Each contact gets a persistent SDK session with resume support. Registry maps `chat_id → {session_name, contact_name, tier, ...}`.

## Smart Home

- **Hue**: !`identity hue.bridges.home.ip` (home), !`identity hue.bridges.office.ip` (office) — see `/hue` skill
- **Lutron Caseta**: !`identity lutron.bridge_ip` — see `/lutron` skill
- **Sonos**: SSDP discovery, no hardcoded IPs — see `/sonos` skill

## Non-Browser Screen Interaction

For native macOS apps, use `cliclick` — see `/screen-clicking` skill.

## API Keys

- Google AI (Gemini) key in `~/.claude/secrets.env`
- Anthropic API key configured for daemon

---

## Skills System

Skills are reusable capability modules in `~/.claude/skills/`. Each has a `SKILL.md` (with YAML frontmatter) and optional `scripts/` directory.

### Frontmatter Requirement

**Every SKILL.md MUST have YAML frontmatter** or Claude Code won't discover it:

```yaml
---
name: skill-name
description: What this skill does. Include trigger words.
---
```

### Content Guidelines

- **NEVER hardcode absolute paths** — use `~` or relative paths
- **NEVER hardcode individual contacts** — use contact lookup CLI or `!`identity`` dynamic prompts
- **ALWAYS use `uv` for Python** — never `python3` or `pip` directly

### How Skills Get Embedded into Sessions

1. Transcript directory created at `~/transcripts/<session-name>/`
2. Symlink: `~/transcripts/<session-name>/.claude -> ~/.claude` (gives access to all skills)
3. sms-assistant SKILL.md injected with placeholders replaced (`{{CONTACT_NAME}}`, `{{TIER}}`, `{{CHAT_ID}}`)
4. Contact memory loaded from Contacts.app notes
5. Tier-specific rules applied from rule files
