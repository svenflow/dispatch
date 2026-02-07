# 01: Machine Setup

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

## Step 5: Install Prerequisites

```bash
# Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Python via uv (better than brew python)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Claude Code CLI
# (Follow Anthropic's installation instructions)

# Git
brew install git

# For Signal integration later
brew install signal-cli
```

## Step 6: Grant Permissions

The daemon needs to read `~/Library/Messages/chat.db`. This requires Full Disk Access.

1. Open **System Settings > Privacy & Security > Full Disk Access**
2. Click + and add **Terminal.app**
3. If using iTerm2 or another terminal, add that instead
4. You may also need to add the Python interpreter later

**Test it works:**
```bash
sqlite3 ~/Library/Messages/chat.db "SELECT COUNT(*) FROM message;"
```

If you get a number (not an error), permissions are correct.

## Step 7: Accessibility Permissions (for later)

For browser automation and UI control, you'll need:

1. **System Settings > Privacy & Security > Accessibility**
2. Add Terminal.app (or your terminal)
3. Later: add any automation tools (cliclick, etc.)

## Step 8: Create Directory Structure

```bash
mkdir -p ~/code
mkdir -p ~/transcripts
mkdir -p ~/.claude/skills
mkdir -p ~/.claude/test-messages
```

## Step 9: Set Up Claude Code

```bash
# Authenticate with Anthropic
claude auth

# Verify it works
claude "Hello, are you there?"
```

## Verification Checklist

- [ ] Dedicated Gmail account created
- [ ] Mac is set up with dedicated iCloud account (using that Gmail)
- [ ] iMessage is working (send yourself a test message from your phone)
- [ ] Terminal has Full Disk Access
- [ ] `sqlite3 ~/Library/Messages/chat.db` works
- [ ] `uv --version` works
- [ ] `claude "hello"` responds
- [ ] Directory structure exists

## What's Next

With the machine set up, you're ready to build the messaging daemon in `02-messaging-core.md`.

---

## Notes for the Human

This setup takes 30-60 minutes. Don't rush the iCloud account creation - Apple's verification can be finicky. If Messages.app isn't syncing, sign out of iCloud and back in.

The dedicated account approach means your assistant has its own phone number. People text that number to reach the assistant, not you directly. This is cleaner than trying to filter your personal messages.
