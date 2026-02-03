---
name: setup-wizard
description: Setup wizard for fresh Dispatch system installation. Use when setting up a new machine, checking system health, or diagnosing missing permissions/tools.
user-invocable: true
allowed-tools: Bash(*)
---

# Setup Wizard

Checks and guides through ALL requirements for the Dispatch personal assistant system on a fresh macOS machine.

## Usage

```bash
uv run ~/.claude/skills/setup-wizard/scripts/check.py
uv run ~/.claude/skills/setup-wizard/scripts/check.py --fix    # Auto-fix what it can
uv run ~/.claude/skills/setup-wizard/scripts/check.py --quiet  # Only show failures
```

## What It Checks

### Phase 1: System Tools (can auto-fix)
- Xcode Command Line Tools
- Homebrew
- tmux, cliclick
- uv (Python package manager)
- Claude CLI
- bun (JavaScript runtime)

### Phase 2: TCC Permissions (requires manual grant)
- Full Disk Access (for Messages.app database)
- Contacts access (for tier system)
- Reminders access (for reminder skill)
- Accessibility (for cliclick/screen automation)

### Phase 3: API Keys & Secrets
- `~/.claude/secrets.env` exists
- `~/.claude/skills/tts/.env` (Google TTS key)
- `~/code/.env` (Gemini key for nano-banana)
- Anthropic API key accessible

### Phase 4: Chrome Extension
- Native messaging host manifest installed
- Extension directory exists
- Chrome profiles configured

### Phase 5: Smart Home (optional)
- Hue bridge configs (`~/.hue/*.json`)
- Lutron certificates (`~/.config/pylutron_caseta/`)
- Sonos speakers discoverable on network

### Phase 6: Daemon & LaunchAgents
- LaunchAgent plists installed
- Daemon state directory exists
- Session registry writable
- Log directory writable

### Phase 7: Database Access
- `~/Library/Messages/chat.db` readable
- `~/.claude/memory.duckdb` writable
- Transcript directories exist with correct symlinks
