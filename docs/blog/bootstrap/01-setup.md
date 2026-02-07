# 01: Human Setup (No Claude Yet)

## Goal

Set up a dedicated Mac with its own identity for the assistant. This machine will have Full Disk Access to read iMessage, accessibility permissions for automation, and its own iCloud account for Messages.

## Why a Separate Account?

1. **Messages isolation**: The assistant reads from `~/Library/Messages/chat.db`. You want it to have its own phone number/iCloud for receiving messages.
2. **Security boundary**: If something goes wrong, it's contained to this machine.
3. **Clean permissions**: No conflicts with your personal machine's security settings.

## Step 1: Dedicated Mac

Get a Mac that will run 24/7:
- Mac Mini (recommended - low power, headless-friendly)
- Old MacBook
- Even a Mac VM if you're adventurous

## Step 2: Create a Dedicated Gmail Account

Before anything else, create a Gmail account for your assistant. This will be used for:
- Apple ID registration
- Chrome profile (for browser automation later)
- Any services that need email verification

1. Go to accounts.google.com and create a new account
2. Use a name that reflects this is an assistant (e.g., `myassistant.bot@gmail.com`)
3. Use a strong password and save it in a password manager
4. **Skip phone verification if possible** - Gmail sometimes lets you skip this for new accounts

**Why Gmail specifically?**
- Apple ID accepts Gmail for registration
- Chrome profiles work best with Google accounts
- Google Voice (optional) can give you a free US phone number for SMS verification

## Step 3: Create a Dedicated iCloud Account

1. Go to appleid.apple.com and create a new Apple ID
2. Use the Gmail you just created (e.g., `myassistant.bot@gmail.com`)
3. This account will have its own phone number for iMessage

**Important**: During setup, Apple will ask to verify with a phone number. You have options:
- Get a cheap prepaid SIM just for verification
- Use Google Voice number (sometimes works)
- Use your real number for verification only (you can remove it later)

## Step 4: macOS Setup

1. Fresh install macOS (or create a new user account)
2. Sign in with the dedicated iCloud account
3. Enable iMessage in Messages.app
4. Verify you can send/receive iMessages

## Step 5: Prevent Sleep (Amphetamine)

This Mac needs to run 24/7. Install **Amphetamine** from the Mac App Store:

```bash
open "macappstore://apps.apple.com/app/id937984704"
```

This opens the App Store to Amphetamine (free). Install it, then configure via CLI:

```bash
# Kill Amphetamine first so settings stick
killall Amphetamine 2>/dev/null; sleep 1

# Configure: start session at launch, indefinite duration, start on wake
# NOTE: Must use the sandboxed container path, not plain `defaults write com.if.Amphetamine`
defaults write ~/Library/Containers/com.if.Amphetamine/Data/Library/Preferences/com.if.Amphetamine "Start Session At Launch" -int 1
defaults write ~/Library/Containers/com.if.Amphetamine/Data/Library/Preferences/com.if.Amphetamine "Default Duration" -int 0
defaults write ~/Library/Containers/com.if.Amphetamine/Data/Library/Preferences/com.if.Amphetamine "Start Session On Wake" -int 1

# Add to Login Items (launches at boot)
osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/Amphetamine.app", hidden:false}'

# Launch it
open -a Amphetamine
```

Verify it's working:
```bash
pmset -g assertions | grep Amphetamine
# Should show: PreventUserIdleSystemSleep named: "Amphetamine ..."
```

## Step 6: Enable iCloud Sync

Make sure these are syncing via iCloud (System Settings > Apple ID > iCloud > Show More Apps):

- **Contacts** — Required for tier system (reading contact groups). **Make sure the toggle is ON.**
- **Messages** — Core functionality
- **Notes** — Useful for persistent memory/scratchpad

### 6a. Enable Messages in iCloud (Critical!)

This is the most important sync setting. Without it, messages from new group chats won't sync to this Mac.

1. Open **Messages.app**
2. Go to **Messages > Settings** (Cmd+,)
3. Click the **iMessage** tab
4. Check **"Enable Messages in iCloud"**
5. Click **"Sync Now"** to force an initial sync

**Why this matters:** New group chats created on other devices won't appear in `chat.db` unless Messages in iCloud is enabled. The `ck_sync_state` field in the database will be 0 for unsynced chats, causing messages to be silently dropped.

### 6b. Verify Sync is Working

1. Open Contacts.app — should see your contacts (not just 1 local contact)
2. Open Notes.app — should see your notes
3. Open Messages.app — should see message history from all devices

> **Troubleshooting:** If contacts aren't syncing, go to System Settings → Apple ID → iCloud → "Show More Apps" (or "See All") and make sure Contacts is toggled ON. You may need to sign out and back into iCloud if it's stuck.
>
> **Troubleshooting Messages:** If group chats aren't syncing, check Messages > Settings > iMessage and ensure "Enable Messages in iCloud" is checked. You can verify by running:
> ```bash
> sqlite3 ~/Library/Messages/chat.db "SELECT chat_identifier, ck_sync_state FROM chat WHERE LENGTH(chat_identifier) = 32 LIMIT 5"
> ```
> All chats should have `ck_sync_state = 1`. If any show `0`, click "Sync Now" in Messages settings.

## Step 7: Set Up Terminal

You can use any terminal. Popular options:
- **Terminal.app** (built-in)
- **iTerm2** (install via Homebrew after next step)
- **Ghostty** (fast, GPU-accelerated - install via Homebrew after next step)

Whichever terminal you choose, you'll grant it Full Disk Access later.

## Step 8: Install Homebrew and Prerequisites

```bash
# Homebrew (macOS package manager - install this FIRST)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Follow the post-install instructions to add brew to your PATH
# Usually something like:
echo >> ~/.zshrc
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
source ~/.zshrc
```

Now install prerequisites:

```bash
# Terminal (if you want Ghostty or iTerm2)
brew install --cask ghostty    # Or: brew install --cask iterm2

# Git (install early, needed for Claude Code)
brew install git

# GitHub CLI (needed for repo access)
brew install gh

# Node.js (required for Claude Code)
brew install node

# Python via uv (better than brew python)
# Either method works:
brew install uv
# Or: curl -LsSf https://astral.sh/uv/install.sh | sh

# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# For Signal integration later
brew install signal-cli
```

**Important**: After installing uv, restart your terminal or run `source ~/.zshrc` to pick up the new PATH.

**Optional but recommended**: Add a quick alias for headless Claude sessions:
```bash
echo 'alias cl="claude --dangerously-skip-permissions"' >> ~/.zshrc
source ~/.zshrc
```

## Step 9: Install Google Chrome

Chrome is used for browser automation. The assistant can control Chrome to browse the web, fill forms, etc.

```bash
brew install --cask google-chrome
```

**Configure Chrome for automation:**

1. Open Chrome and sign in with the Gmail account you created
2. Go to **Settings > Downloads**
3. Change download location to `~/Downloads/Default` (or `~/Downloads/Profile1` for additional profiles)
4. **Disable "Ask where to save each file"** - this prevents download dialogs from blocking automation

**Why the custom download folder?**
- Each Chrome profile can have its own download folder
- Automation scripts know exactly where to find downloaded files
- No prompts interrupting automated workflows

## Step 10: Grant macOS Permissions

The assistant needs several macOS permissions to function. Grant ALL of these now to avoid issues later.

### Open System Settings > Privacy & Security

You'll be adding your terminal (Terminal.app, iTerm2, or Ghostty) to multiple permission categories.

### 10a. Full Disk Access (Required)

Needed to read the iMessage database (`~/Library/Messages/chat.db`).

1. Open **Privacy & Security > Full Disk Access**
2. Click + and add your terminal
3. **Also add `/bin/bash`** — press Cmd+Shift+G and type `/bin/bash`. This is required for the LaunchAgent (auto-start on boot) to have FDA, since the daemon wrapper is a bash script.
4. Restart your terminal after granting

**Test it works:**
```bash
sqlite3 ~/Library/Messages/chat.db "SELECT COUNT(*) FROM message;"
```
If you get a number (not an error), it's working.

> **Why `/bin/bash`?** The LaunchAgent starts `~/dispatch/bin/claude-assistant` which is a bash script. LaunchAgent processes don't inherit your terminal's FDA. Granting FDA to `/bin/bash` ensures the daemon can read `chat.db` when started automatically on boot.

### 10b. Automation (Required)

Needed to control Messages.app, Reminders.app, Contacts.app, and Notes.app via AppleScript.

1. Open **Privacy & Security > Automation**
2. Add your terminal
3. Enable all app toggles (Messages, Reminders, Contacts, Notes, System Events)

**Test it works:**
```bash
osascript -e 'tell application "Messages" to count of chats'
osascript -e 'tell application "Reminders" to count of lists'
osascript -e 'tell application "Contacts" to count of people'
```
Each should return a number without errors or hanging.

### 10c. Accessibility (Required for screen clicking)

Needed for `cliclick` and other UI automation.

1. Open **Privacy & Security > Accessibility**
2. Add your terminal
3. Later: add `cliclick` when you install it

**Test it works:**
```bash
brew install cliclick
cliclick p:.
# Should print coordinates without errors
```

### 10d. Contacts Access (Required)

The tier system reads contact groups from Contacts.app.

1. Open **Privacy & Security > Contacts**
2. Add your terminal

This is usually granted automatically when you first run an AppleScript that accesses Contacts, but check it's enabled.

### 10e. Reminders Access (Optional but recommended)

Needed for the reminder/scheduling system.

1. Open **Privacy & Security > Reminders**
2. Add your terminal

### 10f. Screen & System Audio Recording (Optional)

Needed for taking screenshots with `screencapture`.

1. Open **Privacy & Security > Screen & System Audio Recording**
2. Add your terminal

**Test it works:**
```bash
screencapture -x /tmp/test.png && echo "Screenshot saved" && rm /tmp/test.png
```

### Permission Troubleshooting

If osascript commands hang forever:
- You may need to **restart your Mac** after granting Automation permissions
- Check that the app isn't showing a permission dialog in the background
- Try running the command from Terminal.app first (it sometimes gets permissions more reliably)

If permissions don't stick:
- Some permissions require a terminal restart
- Full Disk Access often requires logging out and back in

## Step 12: Create Directory Structure

```bash
mkdir -p ~/code
mkdir -p ~/transcripts
mkdir -p ~/.claude/skills
mkdir -p ~/.claude/test-messages
```

## Step 13: Set Up Claude Code

```bash
# Authenticate with Anthropic
claude auth

# Verify it works
claude "Hello, are you there?"
```

## Verification Checklist

### Account Setup
- [ ] Dedicated Gmail account created
- [ ] Mac is set up with dedicated iCloud account (using that Gmail)
- [ ] iMessage is working (send yourself a test message from your phone)
- [ ] iCloud Contacts syncing (contacts visible in Contacts.app)

### System Configuration
- [ ] Amphetamine installed, set to launch at login, running indefinitely
- [ ] Homebrew installed (`brew --version` works)
- [ ] `uv --version` works
- [ ] `claude "hello"` responds
- [ ] Directory structure exists (`~/code`, `~/transcripts`, `~/.claude/skills`)

### Permissions (test each with the command shown)
- [ ] Full Disk Access (terminal): `sqlite3 ~/Library/Messages/chat.db "SELECT 1;"` returns 1
- [ ] Full Disk Access (`/bin/bash`): Added to FDA for LaunchAgent
- [ ] Automation/Messages: `osascript -e 'tell application "Messages" to count of chats'` returns a number
- [ ] Automation/Contacts: `osascript -e 'tell application "Contacts" to count of people'` returns a number
- [ ] Automation/Reminders: `osascript -e 'tell application "Reminders" to count of lists'` returns a number
- [ ] Accessibility: `cliclick p:.` prints coordinates
- [ ] Screen Recording: `screencapture -x /tmp/test.png && rm /tmp/test.png && echo OK` prints OK

## What's Next

With the machine set up, you're ready to hand off to Claude using `02-claude-bootstrap.md`.

---

## Notes for the Human

This setup takes 30-60 minutes. Don't rush the iCloud account creation - Apple's verification can be finicky. If Messages.app isn't syncing, sign out of iCloud and back in.

The dedicated account approach means your assistant has its own phone number. People text that number to reach the assistant, not you directly. This is cleaner than trying to filter your personal messages.
