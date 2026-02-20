---
name: google-suite
description: Access Google services (Gmail, Calendar, Drive, Docs, Sheets, Tasks, Contacts, Chat) via gogcli. Trigger words - google, gmail, email, calendar, drive, docs, sheets, tasks, meeting, event.
---

# Google Suite Skill

Access Gmail, Calendar, Drive, Docs, Sheets, Tasks, Contacts, and Chat via the `gog` CLI.

## Setup

```bash
# Install
brew install steipete/tap/gogcli

# Add OAuth credentials (download from Google Cloud Console)
gog auth credentials ~/Downloads/client_secret_....json

# Authorize an account
gog auth add you@gmail.com

# Check status
gog auth status
gog auth list --check
```

## Quick Reference

The CLI is at `/opt/homebrew/bin/gog`. Use `-a account@email.com` to specify account.

### Gmail

```bash
# Search emails
gog gmail search "from:boss subject:urgent"
gog gmail search "is:unread newer_than:1d"

# Read a message
gog gmail get <messageId>
gog gmail get <messageId> --format=raw  # full headers

# Send email
gog send --to "recipient@example.com" --subject "Hello" --body "Message body"
gog send --to "a@x.com,b@x.com" --cc "c@x.com" --subject "Meeting" --body "See you there"

# With attachments
gog send --to "x@y.com" --subject "Files" --body "Attached" --attach file1.pdf --attach file2.png

# HTML email
gog send --to "x@y.com" --subject "News" --html "<h1>Hello</h1><p>World</p>"

# Labels
gog gmail labels list
gog gmail thread modify <threadId> --add-labels "STARRED" --remove-labels "UNREAD"
```

### Calendar

```bash
# List calendars
gog calendar calendars

# List events (default: today forward)
gog cal events                           # all calendars
gog cal events primary                   # primary calendar only
gog cal events --from "2026-02-14" --to "2026-02-21"

# Search events
gog cal search "standup"

# Create event
gog cal create primary --title "Meeting" --start "2026-02-15T14:00:00" --end "2026-02-15T15:00:00"
gog cal create primary --title "Lunch" --start "2026-02-15" --all-day

# With attendees
gog cal create primary --title "Sync" --start "2026-02-15T10:00" --end "2026-02-15T11:00" \
  --attendees "alice@x.com,bob@x.com" --location "Conference Room A"

# Update/delete
gog cal update primary <eventId> --title "New Title"
gog cal delete primary <eventId>

# RSVP
gog cal respond primary <eventId> --response accepted
gog cal respond primary <eventId> --response declined --comment "Conflict"

# Find conflicts
gog cal conflicts --from "2026-02-14" --to "2026-02-21"

# Free/busy
gog cal freebusy "alice@x.com,bob@x.com" --from "2026-02-14" --to "2026-02-15"
```

### Drive

```bash
# List files
gog ls                         # root folder
gog ls --folder <folderId>     # specific folder
gog ls --trashed               # trash

# Search
gog search "quarterly report"
gog drive search "name contains 'invoice' and mimeType='application/pdf'"

# Download
gog download <fileId>
gog download <fileId> --output ~/Downloads/myfile.pdf

# Upload
gog upload ~/Documents/report.pdf
gog upload ~/Documents/report.pdf --folder <folderId> --name "Q1 Report"

# Create folder
gog drive mkdir "Project Files"
gog drive mkdir "Subfolder" --parent <parentFolderId>

# Share
gog drive share <fileId> --email "user@example.com" --role writer
gog drive share <fileId> --email "user@example.com" --role reader

# Permissions
gog drive permissions <fileId>
gog drive unshare <fileId> <permissionId>

# Move/rename/delete
gog drive move <fileId> --to <folderId>
gog drive rename <fileId> "New Name"
gog drive delete <fileId>
```

### Docs

```bash
# Read doc as plain text
gog docs cat <docId>

# Export
gog docs export <docId> --format pdf --output report.pdf
gog docs export <docId> --format docx
gog docs export <docId> --format txt

# Create doc
gog docs create "Meeting Notes"
gog docs create "Project Doc" --folder <folderId>

# Write/append content
gog docs write <docId> "New content at the end"
gog docs write <docId> --stdin < notes.txt

# Insert at position
gog docs insert <docId> "Inserted text" --index 1  # beginning

# Find and replace
gog docs find-replace <docId> "old text" "new text"
gog docs find-replace <docId> "old" "new" --all  # all occurrences

# Copy doc
gog docs copy <docId> "Copy of Doc"
```

### Sheets

```bash
# Read values
gog sheets get <spreadsheetId> "Sheet1!A1:D10"
gog sheets get <spreadsheetId> "A:A"  # whole column

# Update values
gog sheets update <spreadsheetId> "A1" "Hello"
gog sheets update <spreadsheetId> "A1:C1" "Val1" "Val2" "Val3"

# Append row
gog sheets append <spreadsheetId> "Sheet1" "Col1" "Col2" "Col3"

# Clear range
gog sheets clear <spreadsheetId> "A1:D10"

# Get metadata (sheet names, etc)
gog sheets metadata <spreadsheetId>

# Create new spreadsheet
gog sheets create "Budget 2026"

# Export
gog sheets export <spreadsheetId> --format xlsx
gog sheets export <spreadsheetId> --format csv --sheet "Sheet1"
```

### Tasks

```bash
# List task lists
gog tasks lists list

# List tasks in a list
gog tasks list <tasklistId>
gog tasks list <tasklistId> --show-completed

# Add task
gog tasks add <tasklistId> --title "Buy groceries"
gog tasks add <tasklistId> --title "Report" --due "2026-02-20" --notes "Q1 numbers"

# Complete/uncomplete
gog tasks done <tasklistId> <taskId>
gog tasks undo <tasklistId> <taskId>

# Update
gog tasks update <tasklistId> <taskId> --title "New title" --due "2026-02-25"

# Delete
gog tasks delete <tasklistId> <taskId>

# Clear completed
gog tasks clear <tasklistId>
```

### Contacts

```bash
# Search contacts
gog contacts search "John"
gog contacts search "john@example.com"

# List all contacts
gog contacts list
gog contacts list --limit 50

# Get contact details
gog contacts get <resourceName>

# Create contact
gog contacts create --name "John Doe" --email "john@example.com" --phone "+1234567890"

# Update contact
gog contacts update <resourceName> --name "John Smith"

# Delete contact
gog contacts delete <resourceName>
```

### Chat (Workspace only)

```bash
# List spaces
gog chat spaces list

# List messages in space
gog chat messages list <spaceName>

# Send message
gog chat messages create <spaceName> --text "Hello team!"

# DM a user
gog chat dm create <userId> --text "Hey!"
```

## Common Flags

| Flag | Description |
|------|-------------|
| `-a, --account` | Account email to use |
| `-j, --json` | Output JSON (for scripting) |
| `-p, --plain` | Output TSV (stable, parseable) |
| `--results-only` | JSON mode: omit envelope fields |
| `-n, --dry-run` | Preview without making changes |
| `-y, --force` | Skip confirmations |
| `--no-input` | Never prompt (for CI) |

## Multi-Account Usage

```bash
# Set default account
export GOG_ACCOUNT=work@company.com

# Or per-command
gog -a personal@gmail.com gmail search "is:unread"
gog -a work@company.com cal events
```

## Tips

1. **Get file/doc IDs**: Extract from Google URLs. `https://docs.google.com/document/d/DOCID/edit` → DOCID
2. **JSON output**: Use `-j --results-only` for clean JSON to pipe to `jq`
3. **Calendar IDs**: Use `primary` for your main calendar, or the full calendar ID for others
4. **Task list IDs**: Get from `gog tasks lists list`

## Auth Troubleshooting

```bash
# Re-authorize with more scopes
gog auth add you@gmail.com --services gmail,calendar,drive

# Check token validity
gog auth list --check

# Remove and re-add account
gog logout you@gmail.com
gog login you@gmail.com
```
