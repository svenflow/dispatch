# 08: Browser Automation

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

**GitHub:** [`skills/chrome-control/`](https://github.com/jsmith/dispatch/tree/main/skills/chrome-control)

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

## Step 1: Load the Extension in Chrome

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select `~/dispatch/skills/chrome-control/extension/`
5. **Copy the extension ID** (shown under the extension name, e.g., `deamgongmklmhlafakppcjffdpkmacjk`)

## Step 2: Install Native Messaging Host

```bash
cd ~/dispatch/skills/chrome-control

# Install native messaging host (creates manifest with placeholder)
./scripts/install_native_host.sh
```

**Important:** The install script creates a manifest with a wildcard origin. You must update it with your specific extension ID:

```bash
# Edit the native host manifest
cat > ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.dispatch.chrome_control.json << EOF
{
  "name": "com.dispatch.chrome_control",
  "description": "Chrome Control Native Messaging Host",
  "path": "$HOME/.claude/skills/chrome-control/scripts/native_host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID_HERE/"
  ]
}
EOF
```

Replace `YOUR_EXTENSION_ID_HERE` with the ID you copied in Step 1.

## Step 3: Reload Extension and Verify

1. Go back to `chrome://extensions`
2. Click the refresh icon on Chrome Control extension
3. Verify the connection:

```bash
# Should show your profile
~/dispatch/skills/chrome-control/scripts/chrome profiles

# Should list open tabs
~/dispatch/skills/chrome-control/scripts/chrome tabs
```

## Step 4: Key Commands

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

The [`SKILL.md`](https://github.com/jsmith/dispatch/blob/main/skills/chrome-control/SKILL.md) teaches Claude:
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

`09-health-reliability.md` covers health checks, idle reaping, and error recovery.

---

## Gotchas

1. **Extension must be loaded first**: The CLI won't work without the extension running in Chrome.

2. **Permissions**: Chrome may prompt for permissions on first use. Accept them.

3. **Profile isolation**: Each profile needs the extension loaded separately.

4. **Native host registration**: If `chrome profiles` fails, re-run `install_native_host.sh`.
