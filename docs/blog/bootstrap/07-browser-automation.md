# 07: Browser Automation

## Goal

Give Claude the ability to control Chrome - open tabs, click elements, fill forms, take screenshots, and execute JavaScript.

## Why a Chrome Extension?

AppleScript/osascript for Chrome is unreliable and limited. A native Chrome extension with a CLI wrapper gives you:
- Direct DOM access via content scripts
- Console and network capture
- Multi-profile support
- Reliable element interaction

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │ background  │◄──►│  content    │◄──►│   popup     │ │
│  │ service     │    │  scripts    │    │   (UI)      │ │
│  │ worker      │    │  (per tab)  │    │             │ │
│  └──────┬──────┘    └─────────────┘    └─────────────┘ │
│         │                                               │
│         │ Native Messaging                              │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │ native_host │ ◄─── JSON-RPC over stdin/stdout       │
│  └──────┬──────┘                                        │
└─────────┼───────────────────────────────────────────────┘
          │
          ▼
   ┌─────────────┐
   │  chrome CLI │  ◄─── Claude calls this via Bash
   └─────────────┘
```

## Implementation

**GitHub:** [`skills/chrome-control/`](https://github.com/nicklaude/dispatch/tree/main/skills/chrome-control)

The complete implementation includes:

| File | Purpose |
|------|---------|
| `scripts/chrome` | Main CLI (17KB Python) |
| `scripts/native_host.py` | Native messaging host |
| `scripts/install_native_host.sh` | Installation script |
| `extension/manifest.json` | Extension manifest |
| `extension/background.js` | Service worker (19KB) |
| `extension/content.js` | Content script (11KB) |
| `SKILL.md` | Claude documentation |

## Step 1: Install the Extension

```bash
# Clone if you haven't already
cd ~/dispatch/skills/chrome-control

# Install native messaging host
./scripts/install_native_host.sh
```

Then load the extension in Chrome:
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `~/dispatch/skills/chrome-control/extension/`

## Step 2: Verify CLI Works

```bash
# List Chrome profiles
~/dispatch/skills/chrome-control/scripts/chrome profiles

# List open tabs
~/dispatch/skills/chrome-control/scripts/chrome tabs

# Open a URL
~/dispatch/skills/chrome-control/scripts/chrome open "https://example.com"
```

## Step 3: Key Commands

```bash
CHROME=~/dispatch/skills/chrome-control/scripts/chrome

# Tab management
$CHROME tabs                          # List all tabs
$CHROME open "https://url"            # Open new tab
$CHROME close <tab_id>                # Close tab

# Page interaction
$CHROME read <tab_id>                 # Get interactive elements
$CHROME click <tab_id> <ref>          # Click element by ref
$CHROME type <tab_id> <ref> "text"    # Type into element

# Debugging
$CHROME screenshot <tab_id>           # Take screenshot
$CHROME js <tab_id> "code"            # Execute JavaScript
$CHROME console <tab_id>              # Get console logs
$CHROME network <tab_id>              # Get network requests
```

## Step 4: Multi-Profile Support

The extension supports multiple Chrome profiles simultaneously:

```bash
# Each profile has a unique UUID
$CHROME profiles
# Profile 0: Default (UUID: abc123...)
# Profile 1: Work (UUID: def456...)

# Commands target specific profiles
$CHROME tabs --profile 1
$CHROME open "https://url" --profile 1
```

**Download folders per profile:**
- Profile 0 (assistant): `~/Downloads/assistant/`
- Profile 1 (owner): `~/Downloads/owner-profile/`

## Step 5: Symlink for Skills

```bash
# Make available to all sessions
ln -sf ~/dispatch/skills/chrome-control ~/.claude/skills/chrome-control
```

## SKILL.md Reference

The [`SKILL.md`](https://github.com/nicklaude/dispatch/blob/main/skills/chrome-control/SKILL.md) teaches Claude:
- When to use browser automation
- Command syntax and examples
- Profile permissions (assistant vs owner)
- Download handling

## Verification Checklist

- [ ] Extension loaded in Chrome (`chrome://extensions`)
- [ ] Native host installed (`chrome profiles` works)
- [ ] Can open/close tabs
- [ ] Can read page elements
- [ ] Can click and type
- [ ] Screenshots work
- [ ] Multi-profile works (if using multiple profiles)

## What's Next

`08-smart-home.md` covers Hue, Lutron, and Sonos integrations for home automation.

---

## Gotchas

1. **Extension must be loaded first**: The CLI won't work without the extension running in Chrome.

2. **Permissions**: Chrome may prompt for permissions on first use. Accept them.

3. **Profile isolation**: Each profile needs the extension loaded separately.

4. **Native host registration**: If `chrome profiles` fails, re-run `install_native_host.sh`.
