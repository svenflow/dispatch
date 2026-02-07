# 06: Skills System

## Goal

Create a modular skills system so Claude can discover and use capabilities without hardcoding them in prompts.

## What's a Skill?

A skill is a folder containing:
- `SKILL.md` - Documentation Claude reads to learn the skill
- `scripts/` - Executable tools Claude can call

```
~/.claude/skills/
├── hue/
│   ├── SKILL.md           # "How to control Hue lights"
│   └── scripts/
│       ├── hue-on         # Turn lights on
│       ├── hue-off        # Turn lights off
│       └── hue-scene      # Set a scene
├── sonos/
│   ├── SKILL.md
│   └── scripts/
│       ├── sonos-play
│       └── sonos-volume
└── contacts/
    ├── SKILL.md
    └── scripts/
        └── lookup
```

## Why This Structure?

1. **Self-documenting**: Claude reads SKILL.md to learn what it can do
2. **Modular**: Add/remove skills without changing core code
3. **Portable**: Skills work across different Claude sessions
4. **Testable**: Each script can be tested independently

## Step 1: SKILL.md Format

Every skill needs YAML frontmatter so Claude Code discovers it:

```markdown
---
name: hue
description: Control Philips Hue lights. Use when asked about lights, brightness, colors, or scenes.
---

# Philips Hue Control

## Quick Reference

\`\`\`bash
# Turn on living room
~/.claude/skills/hue/scripts/hue-on "Living Room"

# Set brightness (0-100)
~/.claude/skills/hue/scripts/hue-brightness "Living Room" 50

# Set color
~/.claude/skills/hue/scripts/hue-color "Living Room" "warm"
\`\`\`

## Available Commands

| Command | Args | Description |
|---------|------|-------------|
| hue-on | room | Turn on lights in room |
| hue-off | room | Turn off lights |
| hue-brightness | room, level | Set brightness 0-100 |
| hue-color | room, color | Set color (warm, cool, red, etc.) |

## Room Names

- "Living Room"
- "Bedroom"
- "Kitchen"
- "Office"
```

## Step 2: Symlink the Skills Folder (Not Individual Skills)

**Important:** Symlink the entire skills folder so new skills are automatically available:

```bash
# ~/.claude/skills should be a symlink to the dispatch skills folder
# This way, any new skill added to dispatch/skills is automatically available
ln -s ~/dispatch/skills ~/.claude/skills

# Verify it's a folder symlink (not individual skill symlinks)
ls -la ~/.claude/skills
# Should show: ~/.claude/skills -> ~/dispatch/skills
```

**Don't do this** (individual symlinks require manual updates):
```bash
# BAD - requires adding symlink for each new skill
ln -s ~/dispatch/skills/hue ~/.claude/skills/hue
ln -s ~/dispatch/skills/sonos ~/.claude/skills/sonos
```

## Step 3: Transcript Directory Access

Each contact's transcript directory needs access to skills via the `.claude` symlink:

```bash
# When creating a new session
mkdir -p ~/transcripts/john-doe
ln -s ~/.claude ~/transcripts/john-doe/.claude
```

Now when Claude runs in `~/transcripts/john-doe/`, it sees:
- `.claude/skills/` → all skills (via the chained symlinks)
- `.claude/CLAUDE.md` → global instructions

## Step 4: Core Skills to Build First

### contacts/
```bash
#!/bin/bash
# ~/.claude/skills/contacts/scripts/lookup
# Look up a contact by name or phone
uv run ~/.claude/skills/contacts/scripts/lookup.py "$@"
```

### sms-assistant/
The meta-skill that teaches Claude how to handle SMS:
- How to format responses
- Tier-specific rules
- When to stay quiet vs respond

### send-sms (already built)
If you followed 04-messaging-core.md, it's already in the right place:
```bash
ls ~/.claude/skills/sms-assistant/scripts/send-sms
```

If not, create the directory structure now:
```bash
mkdir -p ~/.claude/skills/sms-assistant/scripts
```

## Step 5: Skill Discovery

Claude Code automatically discovers skills from SKILL.md frontmatter. The key fields:

```yaml
---
name: skill-name          # Short identifier
description: When to use  # Triggers skill loading
---
```

When a user message matches the description, Claude loads the full SKILL.md.

## Step 6: Writing Good SKILL.md

### Do:
- Start with a quick reference (copy-paste commands)
- Include all available commands with examples
- Document expected output format
- Note any setup requirements

### Don't:
- Hardcode paths (use `~` or relative paths)
- Include PII (phone numbers, API keys)
- Assume state from previous runs
- Write novels - Claude skims like humans do

## Example: Complete Hue Skill

`~/.claude/skills/hue/SKILL.md`:
```markdown
---
name: hue
description: Control Philips Hue lights (on/off, brightness, colors). Use when asked about lights or lighting.
---

# Philips Hue Control

Control lights via your Hue bridge. Set the bridge IP in `~/.claude/secrets.env` as `HUE_BRIDGE_IP`.

## Quick Reference

\`\`\`bash
HUE=~/.claude/skills/hue/scripts

# Basics
$HUE/hue-on "Living Room"
$HUE/hue-off "Living Room"
$HUE/hue-brightness "Living Room" 75

# Colors and scenes
$HUE/hue-color "Living Room" warm
$HUE/hue-scene "Relax"
\`\`\`

## All Rooms

- Living Room
- Bedroom
- Kitchen
- Office
- Bathroom

## Color Options

warm, cool, daylight, red, blue, green, purple, orange, pink
```

`~/.claude/skills/hue/scripts/hue-on`:
```bash
#!/bin/bash
# Load secrets (HUE_BRIDGE_IP, HUE_TOKEN)
source ~/.claude/secrets.env

ROOM="$1"
curl -s -X PUT "http://${HUE_BRIDGE_IP}/api/${HUE_TOKEN}/groups/${ROOM}/action" \
  -d '{"on":true}'
echo "Turned on $ROOM"
```

## Verification Checklist

- [ ] `~/.claude/skills` is a symlink to `~/dispatch/skills` (folder symlink, not individual)
- [ ] At least sms-assistant and contacts skills present
- [ ] Each skill has SKILL.md with proper frontmatter
- [ ] Scripts are executable (`chmod +x`)
- [ ] Transcript directories have `.claude` symlink to `~/.claude`

```bash
# Verify folder symlink (not individual skills)
ls -la ~/.claude/skills
# Should show: ~/.claude/skills -> ~/dispatch/skills

# Verify all skills are accessible
ls ~/.claude/skills/ | wc -l
# Should show 29+ skills

# Verify transcript access works
ls ~/transcripts/*/.claude/skills/ | head -5
```

---

## Session Management (How It Works)

Each contact gets their own persistent Claude session with context that survives across messages and daemon restarts.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     SDKBackend                          │
│                                                         │
│  sessions = {                                           │
│    "+15551234567": SDKSession(contact="John"),         │
│    "+15559876543": SDKSession(contact="Jane"),         │
│    "abc123...":    SDKSession(group="Family Chat"),    │
│  }                                                      │
│                                                         │
│  Each SDKSession has:                                   │
│    - ClaudeSDKClient instance                          │
│    - Message queue (async)                              │
│    - Session ID (for resume)                           │
│    - Run loop (processes queue)                        │
└─────────────────────────────────────────────────────────┘
```

### Key Files

Session management lives in `~/dispatch/assistant/`:
- `sdk_session.py` - The SDKSession class
- `sdk_backend.py` - The SDKBackend that manages all sessions
- `common.py` - Shared utilities

### Session Registry

Tracks session metadata in `~/dispatch/state/sessions.json`:

```json
{
  "+15551234567": {
    "session_name": "john-doe",
    "contact_name": "John Doe",
    "tier": "favorite",
    "session_id": "abc-123-def",
    "last_message_time": "2026-02-07T14:30:00"
  }
}
```

The `session_id` enables resume after daemon restarts.

### Key Behaviors

1. **Lazy creation**: Sessions created on first message, not at daemon startup
2. **Auto-resume**: On restart, sessions resume with full context via session_id
3. **Health checks**: Run every 5 minutes, restart unhealthy sessions
4. **Idle reaping**: Sessions idle for 2+ hours are killed to free resources
5. **Steering**: New messages while Claude is responding are handled naturally

### Session Verification

```bash
# Check active sessions
~/dispatch/bin/claude-assistant status

# Check registry has entries
cat ~/dispatch/state/sessions.json | jq keys

# Verify sessions have session_id for resume
cat ~/dispatch/state/sessions.json | jq '.[].session_id'
```

## What's Next

`08-browser-automation.md` covers Chrome control for web tasks.
