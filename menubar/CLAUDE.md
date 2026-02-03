# Menu Bar App

macOS menu bar app for Claude Assistant using `rumps`.

## Running

```bash
# Via CLI
claude-assistant menubar

# Or directly
uv run python menubar/app.py
```

## Features

- **Status indicator** - 🟢 running, 🔴 stopped
- **Daemon controls** - Start/Stop/Restart
- **Sessions** - List active tmux sessions, click to attach in Terminal
- **Skills** - List all skills, click to open SKILL.md in default editor
- **View Logs** - Opens manager.log in Console.app

## Auto-start

```bash
claude-assistant menubar-install    # Install LaunchAgent
claude-assistant menubar-uninstall  # Remove LaunchAgent
```

## Dependencies

- `rumps` - Python macOS menu bar framework

## How Skills Work

Skills submenu lists all skills from `~/.claude/skills/`. Clicking a skill opens its `SKILL.md` in your default text editor.
