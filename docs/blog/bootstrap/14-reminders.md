# 14: Reminders System

## Goal

Give Claude the ability to schedule tasks for later execution. Reminders let you:
- Set one-time reminders ("remind me to check the weather in 5 minutes")
- Create recurring tasks with cron patterns ("check flight status every hour until 8am")
- Route reminders to foreground or background sessions

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 macOS Reminders.app                      │
│                                                          │
│  Lists:                                                  │
│    "Claude: John Smith" - reminders for John            │
│    "Claude: Jane Doe"   - reminders for Jane            │
│                                                          │
│  Each reminder has:                                      │
│    - title (the task to execute)                        │
│    - due date (when to fire)                            │
│    - notes: [target:fg|bg|both] [cron:PATTERN]         │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   ReminderPoller                         │
│                   (in manager.py)                        │
│                                                          │
│  Every 5 seconds:                                        │
│    1. Poll SQLite DB for due reminders                  │
│    2. Check cron patterns against current time          │
│    3. Inject into contact's session (fg, bg, or both)   │
│    4. Mark one-time reminders complete                  │
└─────────────────────────────────────────────────────────┘
```

**GitHub:**
- [`skills/reminders/`](https://github.com/jsmith/dispatch/tree/main/skills/reminders) - Scripts and SKILL.md
- [`assistant/manager.py`](https://github.com/jsmith/dispatch/blob/main/assistant/manager.py) - ReminderPoller class

## Key Components

### 1. Per-Contact Lists

Each contact gets their own Reminders.app list named `Claude: <Name>`. This allows:
- Routing reminders to the correct session
- Easy organization in Reminders.app
- Filtering by contact when polling

### 2. Scripts

| Script | Purpose |
|--------|---------|
| `add_reminder.py` | Create a reminder with time parsing |
| `poll_due.py` | Query SQLite for due/cron reminders |

### 3. Target Sessions

Reminders can target different sessions:
- **fg** (default): Foreground/interactive session
- **bg**: Background session (for automated tasks)
- **both**: Fire in both sessions

## Step 1: Verify Skill is Symlinked

```bash
# Check skill exists
ls -la ~/.claude/skills/reminders/

# Should show:
# SKILL.md
# scripts/add_reminder.py
# scripts/poll_due.py
```

## Step 2: Test Creating a Reminder

```bash
# Create a test reminder (requires --contact!)
uv run ~/.claude/skills/reminders/scripts/add_reminder.py \
    "Test reminder" \
    --due "1m" \
    --contact "Your Name"
```

⚠️ **CRITICAL**: The `--contact` flag is required. Reminders without a contact are silently skipped by the daemon.

## Step 3: Verify in Reminders.app

1. Open Reminders.app
2. Look for a list named `Claude: Your Name`
3. Confirm the reminder appears with due date

## Step 4: Test Polling

```bash
# Get all due reminders as JSON
uv run ~/.claude/skills/reminders/scripts/poll_due.py --json

# Filter by contact
uv run ~/.claude/skills/reminders/scripts/poll_due.py --contact "Your Name" --json

# Get all (including future) reminders
uv run ~/.claude/skills/reminders/scripts/poll_due.py --all --json
```

## Step 5: Verify Daemon Integration

The manager daemon polls every 5 seconds. Check the logs:

```bash
# Look for reminder processing
tail -f ~/dispatch/logs/manager.log | grep -i reminder
```

You should see:
```
INFO: Injected reminder to FG: Test reminder
INFO: Marked reminder complete: Test reminder (list: Claude: Your Name)
```

## Due Time Formats

The `--due` flag accepts various formats:

| Format | Example | Meaning |
|--------|---------|---------|
| Relative | `5m`, `2h`, `1d` | Minutes, hours, days from now |
| Tomorrow | `tomorrow`, `tomorrow 2pm` | Tomorrow at 9am or specified time |
| ISO | `2026-01-24 14:30` | Specific datetime |

## Cron Reminders

For recurring tasks, add a cron pattern in the notes:

```bash
# Via AppleScript (for cron reminders)
osascript -e '
tell application "Reminders"
    set targetList to list "Claude: John Smith"
    make new reminder in targetList with properties {
        name:"Check flight status",
        body:"[target:fg] [cron:0 * * * *]"
    }
end tell'
```

### Cron Pattern Examples

| Pattern | Meaning |
|---------|---------|
| `0 9,21 * * *` | 9am and 9pm daily |
| `30 8 * * 1-5` | 8:30am on weekdays |
| `0 * * * *` | Every hour on the hour |

### Cron with Until Date

Set the due date as an "until" time - the cron stops firing after that:

```applescript
set untilDate to current date
set month of untilDate to 1
set day of untilDate to 25
set year of untilDate to 2026
set hours of untilDate to 8
make new reminder with properties {
    name:"Flight check",
    body:"[cron:0 * * * *]",
    due date:untilDate
}
```

## How Reminders Work in Practice

1. **User asks**: "Remind me to check the chess game in 5 minutes"

2. **Claude creates reminder**:
   ```bash
   uv run ~/.claude/skills/reminders/scripts/add_reminder.py \
       "Check the chess game" --due "5m" --contact "John Smith"
   ```

3. **Daemon polls** (every 5 seconds) and finds the due reminder

4. **Daemon injects** into John's session:
   ```
   ---REMINDER---
   Due: 2026-02-07 10:30:00
   Task: Check the chess game

   Execute this task now. Report results to the user.
   ---END REMINDER---
   ```

5. **Claude in session** sees the reminder, checks the chess game, texts the result

6. **Daemon marks complete** (unless it's a cron reminder)

## Verification Checklist

- [ ] Skill symlinked to `~/.claude/skills/reminders/`
- [ ] `add_reminder.py` creates reminders with correct list
- [ ] `poll_due.py --json` returns due reminders
- [ ] Daemon logs show "Injected reminder" messages
- [ ] One-time reminders get marked complete
- [ ] Cron reminders fire at correct times

## What's Next

This completes the core skill set. See `13-open-source.md` for sanitizing the system for public release.

---

## Gotchas

1. **Contact is required**: Reminders without `--contact` are silently skipped. The daemon routes by contact.

2. **Database access**: The poll script reads the Reminders SQLite database directly. If macOS updates the schema, the script may need updating.

3. **Cron requires croniter**: The daemon uses the `croniter` package for cron pattern matching. It's included in the project dependencies.

4. **Background sessions**: Use `--target bg` for tasks that shouldn't interrupt the user (like memory consolidation).
