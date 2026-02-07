# 03: Identity Setup

## Goal

Configure the assistant's identity and your personal settings before building the messaging system. This creates `config.local.yaml` with all the values needed by the daemon.

## Why This Matters

The daemon needs to know:
- **Who you are** (owner name, phone, email)
- **Who the assistant is** (name, email, phone for Signal)
- **Your partner** (if applicable, for the "wife" tier)
- **Smart home IPs** (Hue bridges, Lutron, etc.)

Without this config, the daemon can't route messages or control your home.

## The Config System

```
config.example.yaml  ──copy──▶  config.local.yaml
     (template)                   (your values)
     (checked in)                 (gitignored)
```

**GitHub:**
- Template: [`config.example.yaml`](https://github.com/nicklaude/dispatch/blob/main/config.example.yaml)
- Loader: [`assistant/config.py`](https://github.com/nicklaude/dispatch/blob/main/assistant/config.py)
- Identity CLI: [`bin/identity`](https://github.com/nicklaude/dispatch/blob/main/bin/identity)
- SOUL template: [`templates/SOUL.md`](https://github.com/nicklaude/dispatch/blob/main/templates/SOUL.md)
- Global CLAUDE.md template: [`templates/CLAUDE.global.md`](https://github.com/nicklaude/dispatch/blob/main/templates/CLAUDE.global.md)

## Step 1: Copy the Template

```bash
cd ~/dispatch
cp config.example.yaml config.local.yaml
```

## Step 2: Gather Your Information

Claude will ask you for the following information using `AskUserQuestion`. Have these ready:

### Required Settings

| Setting | Example | Used For |
|---------|---------|----------|
| Your name | "John Smith" | Owner identification |
| Your phone | "+15551234567" | Admin tier routing |
| Your email | "john@example.com" | Notifications |
| Assistant name | "Jarvis" | How the assistant refers to itself |
| Assistant email | "jarvis@example.com" | Gmail for iCloud/Chrome |

### Optional Settings

| Setting | Example | Used For |
|---------|---------|----------|
| Partner name | "Jane Smith" | Wife tier (special privileges) |
| Signal number | "+15559876543" | Signal messaging channel |
| Hue bridge IP | "10.10.10.23" | Philips Hue lights |
| Lutron bridge IP | "10.10.10.22" | Lutron Caseta dimmers |

## Step 3: Interactive Setup

When Claude asks, provide your information. Example interaction:

```
Claude: What is your name (the owner)?
You: John Smith

Claude: What is your phone number in E.164 format (+1XXXXXXXXXX)?
You: +15551234567

Claude: What name should the assistant use for itself?
You: Jarvis

Claude: Do you have a partner who should get special "wife" tier access?
You: Yes, Jane Smith

Claude: What is your Hue bridge IP? (or "skip" if you don't have Hue)
You: 10.10.10.23
```

## Step 4: Edit config.local.yaml

After gathering info, update the config file:

```yaml
# config.local.yaml

owner:
  name: "John Smith"
  phone: "+15551234567"
  email: "john@example.com"

wife:
  name: "Jane Smith"

assistant:
  name: "Jarvis"
  email: "jarvis.assistant@gmail.com"

signal:
  account: "+15559876543"

hue:
  bridges:
    home:
      ip: "10.10.10.23"

lutron:
  bridge_ip: "10.10.10.22"

chrome:
  profiles:
    0:
      name: "jarvis"
      email: "jarvis.assistant@gmail.com"
    1:
      name: "owner"
      email: "john@example.com"
```

## Step 5: Verify Config Loads

```bash
cd ~/dispatch
uv run python -c "from assistant.config import get; print(get('owner.name'))"
# Should print: John Smith
```

## Config Access in Code

The daemon and skills access config via dot-path:

```python
from assistant.config import get, require

# Optional value with default
name = get("assistant.name", "Dispatch")

# Required value (raises if missing)
phone = require("owner.phone")

# Nested values
hue_ip = get("hue.bridges.home.ip")
```

## What Gets Configured

| Section | Purpose | Required |
|---------|---------|----------|
| `owner` | Your identity (admin tier) | Yes |
| `wife` | Partner with special tier | No |
| `assistant` | Assistant's identity | Yes |
| `signal` | Signal phone number | No |
| `hue` | Philips Hue bridges | No |
| `lutron` | Lutron Caseta bridge | No |
| `chrome` | Browser profile mapping | No |

## Step 6: Identity CLI for Dynamic Prompts

The `identity` CLI reads from your config and outputs values for use in skills:

**GitHub:** [`bin/identity`](https://github.com/nicklaude/dispatch/blob/main/bin/identity)

```bash
# Test the identity CLI
~/dispatch/bin/identity owner.name      # → "John Smith"
~/dispatch/bin/identity owner.phone     # → "+15551234567"
~/dispatch/bin/identity assistant.email # → "jarvis@example.com"
~/dispatch/bin/identity wife.name       # → "Jane Smith"
```

### Dynamic Prompts in Skills

Skills use the `!`command`` syntax to inject identity at runtime:

```markdown
# In any SKILL.md
The owner is !`identity owner.name` and their email is !`identity owner.email`.
```

When Claude Code loads the skill, it:
1. Runs `identity owner.name`
2. Replaces the placeholder with the output
3. Claude sees the actual value

This keeps PII out of checked-in files while still personalizing skills.

## Step 7: Set Up Global CLAUDE.md

Copy the global CLAUDE.md template - this provides system-wide instructions for all Claude sessions:

```bash
cp ~/dispatch/templates/CLAUDE.global.md ~/.claude/CLAUDE.md
```

This template uses dynamic prompts like `!`identity owner.name`` so your identity is injected at runtime without hardcoding PII.

## Step 8: Set Up SOUL.md

Copy the SOUL template - this defines the assistant's personality:

```bash
cp ~/dispatch/templates/SOUL.md ~/.claude/SOUL.md
```

The template uses dynamic prompts throughout, so your identity is injected at runtime.

## Verification Checklist

- [ ] `config.local.yaml` exists
- [ ] `config.local.yaml` is in `.gitignore`
- [ ] Owner name/phone/email filled in
- [ ] Assistant name filled in
- [ ] Config loads without errors
- [ ] `identity owner.name` returns your name
- [ ] `identity self` returns assistant name
- [ ] CLAUDE.md copied to `~/.claude/`
- [ ] SOUL.md copied to `~/.claude/`

## What's Next

With identity configured, `04-messaging-core.md` builds the daemon that polls iMessage and routes to Claude.

---

## Security Notes

1. **Never commit `config.local.yaml`** - it contains PII
2. **The template is safe** - `config.example.yaml` has only placeholders
3. **Phone numbers in E.164** - Always use `+1XXXXXXXXXX` format
4. **Test suite validates** - Tests ensure no real PII in example config
