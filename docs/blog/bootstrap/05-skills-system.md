# 05: Skills System

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

## Step 2: Symlink for Session Access

Each contact's transcript directory needs access to skills:

```bash
# When creating a new session
mkdir -p ~/transcripts/john-doe
ln -s ~/.claude ~/transcripts/john-doe/.claude
```

Now when Claude runs in `~/transcripts/john-doe/`, it sees:
- `.claude/skills/` → all skills
- `.claude/CLAUDE.md` → global instructions

## Step 3: Core Skills to Build First

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
If you followed 03-messaging-core.md, it's already in the right place:
```bash
ls ~/.claude/skills/sms-assistant/scripts/send-sms
```

If not, create the directory structure now:
```bash
mkdir -p ~/.claude/skills/sms-assistant/scripts
```

## Step 4: Skill Discovery

Claude Code automatically discovers skills from SKILL.md frontmatter. The key fields:

```yaml
---
name: skill-name          # Short identifier
description: When to use  # Triggers skill loading
---
```

When a user message matches the description, Claude loads the full SKILL.md.

## Step 5: Writing Good SKILL.md

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

- [ ] `~/.claude/skills/` directory exists
- [ ] At least sms-assistant and contacts skills present
- [ ] Each skill has SKILL.md with proper frontmatter
- [ ] Scripts are executable (`chmod +x`)
- [ ] Symlink works in transcript directories

## What's Next

`06-session-management.md` covers persistent sessions so Claude remembers context across messages.
