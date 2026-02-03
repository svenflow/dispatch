# Dispatch

A personal assistant daemon that turns Claude into a full computer-controlling agent with SMS/Signal messaging, smart home control, browser automation, and persistent memory.

## What is this?

Dispatch is a daemon that:
- Receives SMS/iMessage and Signal messages from contacts
- Routes them to Claude SDK sessions based on contact tier (admin, family, favorites, etc.)
- Gives Claude full computer control: browser automation, file management, smart home, and more
- Maintains persistent memory across conversations
- Supports skills (modular capabilities) that can be loaded per-session

## Architecture

```
Messages.app / Signal
        ↓
   Manager daemon
   (polls chat.db, listens to Signal socket)
        ↓
   Contact lookup → Tier check
        ↓
   Claude SDK session (per contact)
        ↓
   Response via send-sms/send-signal
```

Each contact gets their own persistent Claude session with:
- Conversation history (transcripts)
- Memory (facts, preferences, lessons learned)
- Tier-appropriate tool access

## Requirements

- macOS (uses Messages.app, Contacts.app, AppleScript)
- Python 3.12+ with `uv` package manager
- Claude API access (Anthropic)
- Optional: Signal CLI daemon for Signal messaging
- Optional: Companion CLIs for full functionality:
  - `sms-cli` - Send/read iMessages
  - `contacts-cli` - Contact lookup and tier management
  - `chrome-control` - Browser automation
  - `signal-cli` - Signal messaging

## Installation

```bash
# Clone the repo
git clone https://github.com/nicklaude/dispatch.git ~/code/claude-assistant
cd ~/code/claude-assistant

# Install dependencies
uv sync

# Copy and edit config
cp config.example.yaml config.local.yaml
# Edit config.local.yaml with your settings

# Run the daemon
uv run claude-assistant start
```

## Configuration

See `config.example.yaml` for all options. Key settings:
- `assistant.name` - Your assistant's name
- `contacts.owner_phone` - Your phone number (gets admin tier)
- `messaging.enabled_backends` - Which messaging backends to use

## Skills

Skills are modular capabilities in `skills/`. Each skill has:
- `SKILL.md` - Documentation and trigger words
- `scripts/` - Executable CLIs (optional)

Built-in skills include:
- `sms-assistant` - Message handling guidelines
- `memory` - Persistent contact memory
- `chrome-control` - Browser automation
- `hue`, `lutron`, `sonos` - Smart home control
- `ios-app` - iOS development and TestFlight
- And many more...

## Usage

Once running, text your assistant from any registered contact:
- Admin: Full computer control
- Wife: Full access with personalized tone
- Favorites: Own session, restricted tools
- Family: Read-only, mutations need approval

## Development

```bash
# Run tests
uv run pytest tests/

# Check for PII before committing
uv run pytest tests/unit/test_no_pii_anywhere.py -v

# Manage sessions
uv run claude-assistant status
uv run claude-assistant restart-sessions
```

## License

MIT
