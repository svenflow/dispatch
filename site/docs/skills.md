---
layout: default
title: Skills System
nav_order: 4
---

# Skills System
{: .no_toc }

Modular capabilities that give Claude superpowers.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Skills are reusable capability modules that give Claude specific abilities. Each skill is a folder in `~/.claude/skills/` containing:

- `SKILL.md` — Documentation with YAML frontmatter
- `scripts/` — CLI executables (optional)

## Built-in Skills (67+)

### Messaging & Communication
- `sms-assistant` — Messaging guidelines and tier rules
- `signal` — Signal messaging via signal-cli daemon
- `contacts` — Contact lookup and tier management

### Browser Automation
- `chrome-control` — Full browser automation (clicks, typing, screenshots)
- `webfetch` — Fetch web pages with headless browser

### Smart Home
- `hue` — Philips Hue light control
- `lutron` — Lutron Caseta dimmers and shades
- `sonos` — Sonos speaker control and TTS announcements
- `vivint` — Security cameras and RTSP streams

### Development
- `ios-app` — iOS development and TestFlight
- `cad` — 3D CAD model generation
- `blender` — 3D rendering and animation
- `touchdesigner` — Generative art and visual programming

### AI & Vision
- `gemini` — Google Gemini chat and vision
- `nano-banana` — Image generation via Gemini
- `vision` — Segmentation, depth estimation, edge detection
- `image-to-3d` — Generate 3D models from images
- `image-to-video` — Generate videos from images

### Productivity
- `reminders` — macOS Reminders integration
- `notes-app` — Apple Notes access
- `google-suite` — Gmail, Calendar, Drive, Docs, Sheets
- `memory` — Persistent memory with FTS search

### Media
- `tts` — Text-to-speech (Kokoro, Qwen3-TTS)
- `transcribe` — Audio transcription via whisper.cpp
- `podcast` — Podcast feed management
- `sheet-music` — Sheet music search

### And many more...

## Skill Structure

```
~/.claude/skills/my-skill/
├── SKILL.md           # Required: description, triggers, usage
└── scripts/           # Optional: CLI executables
    ├── main-command   # Main CLI tool
    └── helper         # Additional scripts
```

### SKILL.md Format

```yaml
---
name: my-skill
description: What this skill does. Include trigger words.
allowed_tiers:        # Optional: restrict to specific tiers
  - admin
  - partner
---

# My Skill

Usage documentation goes here...
```

## Creating a Skill

1. Create the skill directory:
   ```bash
   mkdir -p ~/.claude/skills/my-skill/scripts
   ```

2. Create `SKILL.md`:
   ```bash
   cat > ~/.claude/skills/my-skill/SKILL.md << 'EOF'
   ---
   name: my-skill
   description: Does something useful. Trigger: do the thing.
   ---

   # My Skill

   ## Usage

   Run `scripts/do-thing` to do the thing.
   EOF
   ```

3. Create scripts (Python example with uv):
   ```python
   #!/usr/bin/env -S uv run --script
   # /// script
   # dependencies = ["httpx"]
   # ///

   import httpx

   def main():
       # Your code here
       pass

   if __name__ == "__main__":
       main()
   ```

4. Make executable:
   ```bash
   chmod +x ~/.claude/skills/my-skill/scripts/do-thing
   ```

## Template Variables

Skills can use placeholders that get replaced at runtime:

| Variable | Description |
|----------|-------------|
| `{{CONTACT_NAME}}` | Current contact's name |
| `{{TIER}}` | Current contact's tier |
| `{{CHAT_ID}}` | Current chat identifier |

## Skill Discovery

Claude automatically discovers skills via the frontmatter:

```yaml
description: Control lights. Trigger words: lights, hue, brightness.
```

Include trigger words to help Claude know when to use your skill.
