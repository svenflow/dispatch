---
name: reminders
description: Create and manage reminders using macOS Reminders.app. Use when asked to set a reminder, check reminders, or schedule something for later.
---

# Reminders Skill

## ⚠️ CRITICAL: Reminders MUST have a contact

**Reminders without a contact are SILENTLY SKIPPED by the daemon.**

Always use `--contact "Name"` when creating reminders, or put them in a `Claude: <Name>` list. The daemon routes reminders to sessions by contact - no contact = no injection.

```bash
# WRONG - will be silently skipped
uv run ~/.claude/skills/reminders/scripts/add_reminder.py "Do something" --due "5m"

# CORRECT - has a contact
uv run ~/.claude/skills/reminders/scripts/add_reminder.py "Do something" --due "5m" --contact "Jane Doe"
```

---

**IMPORTANT**: Reminders are TASKS FOR CLAUDE TO EXECUTE, not text notifications to the user. When a reminder fires, Claude should DO the task described in the reminder title, then report results to the user (for FG) or work silently (for BG).

Example: "Check the weather and text forecast" → Claude checks weather API, then texts the user the forecast.

Manage macOS Reminders.app with per-contact reminder lists. Each contact gets their own list (`Claude: <contact>`) so reminders can be routed back to the right person.

## Add a Reminder

```bash
# For a specific contact (creates "Claude: John Smith" list if needed)
uv run ~/.claude/skills/reminders/scripts/add_reminder.py "Check the chess game" --due "5m" --contact "John Smith"

# General reminder
uv run ~/.claude/skills/reminders/scripts/add_reminder.py "Reminder title" --due "5m"

# Background task reminder (injects into background session)
uv run ~/.claude/skills/reminders/scripts/add_reminder.py "Consolidate memories" --due "1h" --contact "John Smith" --target bg

# Both sessions (foreground AND background)
uv run ~/.claude/skills/reminders/scripts/add_reminder.py "Sync all data" --due "2h" --contact "John Smith" --target both
```

### Due Time Formats
- `5m`, `5 minutes` - minutes from now
- `2h`, `2 hours` - hours from now
- `1d`, `1 day` - days from now
- `tomorrow` - tomorrow at 9am
- `tomorrow 2pm` - tomorrow at 2pm
- `2026-01-24 14:30` - specific datetime

### Options
- `--contact`, `-c` - **REQUIRED** - Contact name (auto-creates `Claude: <contact>` list)
- `--due`, `-d` - When the reminder is due (required for timed reminders)
- `--notes`, `-n` - Notes/body text
- `--list`, `-l` - Explicit list name (ignored if --contact is set)
- `--target`, `-t` - Target session: `fg` (foreground, default), `bg` (background), or `both`

### Target Sessions
- **fg** (default): Inject into the contact's main foreground session (for interactive tasks)
- **bg**: Inject into the contact's background session (for automated/scheduled tasks like memory consolidation)
- **both**: Inject into both sessions

## Recurring (Cron) Reminders

For recurring reminders, add a cron pattern to the notes field. Cron reminders are never marked complete - they fire every time the pattern matches.

**Cron reminders can have an "until" date** - set the due date to when the reminder should stop firing. After that time, the reminder is auto-completed.

### Create via AppleScript (recommended for cron)
```bash
osascript -e '
tell application "Reminders"
    -- IMPORTANT: Must be in a "Claude: <Name>" list for daemon to process
    set targetList to list "Claude: John Smith"

    -- Set due date as "until" time (optional - cron stops after this)
    set untilDate to current date
    set hours of untilDate to 8
    set minutes of untilDate to 0
    -- set day/month/year as needed for future dates

    make new reminder in targetList with properties {name:"Flight status check", body:"[target:fg] [cron:0 * * * *] Check flight and text update", due date:untilDate}
end tell'
```

### Cron Pattern Format
Standard cron: `minute hour day-of-month month day-of-week`
- `0 9,21 * * *` - 9am and 9pm daily
- `30 8 * * 1-5` - 8:30am weekdays
- `0 12 1 * *` - Noon on the 1st of each month

### Tags in Notes
Both tags can be combined in the notes field:
- `[target:fg]` or `[target:bg]` or `[target:both]`
- `[cron:PATTERN]`

Example: `[target:bg] [cron:0 9,21 * * *]` - fires at 9am/9pm, injects to background session

### Cron vs One-Time
- **One-time**: Has a due date, marked complete after firing
- **Cron**: No due date, has cron pattern in notes, never marked complete

## Poll for Due Reminders

```bash
# Get all due reminders (past due time, not completed)
uv run ~/.claude/skills/reminders/scripts/poll_due.py

# Filter by contact
uv run ~/.claude/skills/reminders/scripts/poll_due.py --contact "John Smith"

# Get all incomplete reminders (including future)
uv run ~/.claude/skills/reminders/scripts/poll_due.py --all

# Output as JSON (for daemon integration)
uv run ~/.claude/skills/reminders/scripts/poll_due.py --json
```

### JSON Output Format
```json
[
  {
    "id": 4,
    "title": "Check the chess game",
    "due_date": "2026-01-24T10:14:53",
    "due_timestamp": 1769267693,
    "notes": "Optional notes here",
    "priority": 0,
    "list": "Claude: John Smith",
    "contact": "John Smith",
    "target": "fg"
  }
]
```

The `target` field indicates which session to inject into: `fg`, `bg`, or `both`.

## Mark Reminder Complete

```bash
# By contact (recommended)
uv run ~/.claude/skills/reminders/scripts/poll_due.py --complete "Check the chess game" --contact "John Smith"

# By explicit list
uv run ~/.claude/skills/reminders/scripts/poll_due.py --complete "Reminder title" --list "List Name"
```

## Example User Flow

1. User texts: "remind me to check the chess game in 5 minutes"
2. Claude creates reminder: `add_reminder.py "check the chess game" --due "5m" --contact "Jane Doe"`
3. Manager daemon polls every N seconds
4. When due, daemon injects into user's session: `REMINDER: check the chess game`
5. Claude in session sees reminder and takes action
6. Reminder is marked complete

## List Naming Convention

- Contact lists: `Claude: <Full Name>` (e.g., `Claude: John Smith`)
- This allows easy identification and routing back to the correct contact session
