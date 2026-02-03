---
name: notes-app
description: Read, write, search, and manage Apple Notes via AppleScript/osascript. Use when asked about notes, creating notes, reading notes, or managing Apple Notes content.
---

# Apple Notes Skill

Read, write, search, and manage Apple Notes programmatically via AppleScript.

## Quick Reference

```bash
# List all notes
osascript -e 'tell application "Notes" to get name of every note'

# Read a note by name
osascript -e 'tell application "Notes" to get body of note "My Note"'

# Create a note
osascript -e 'tell application "Notes" to make new note with properties {name:"Title", body:"Content"}'

# Delete a note
osascript -e 'tell application "Notes" to delete note "My Note"'
```

## Commands

### List Notes

```bash
# List all note names
osascript -e 'tell application "Notes" to get name of every note'

# Count notes
osascript -e 'tell application "Notes" to count notes'

# List notes in specific folder
osascript -e 'tell application "Notes" to get name of every note in folder "Work"'

# List all folders
osascript -e 'tell application "Notes" to get name of every folder'
```

### Read Notes

```bash
# Read note body (returns HTML)
osascript -e 'tell application "Notes" to get body of note "My Note"'

# Read note creation date
osascript -e 'tell application "Notes" to get creation date of note "My Note"'

# Read note modification date
osascript -e 'tell application "Notes" to get modification date of note "My Note"'

# Read specific note by index
osascript -e 'tell application "Notes" to get body of note 1'
```

### Create Notes

```bash
# Create simple note
osascript -e 'tell application "Notes" to make new note with properties {name:"Title", body:"Content"}'

# Create note in specific folder
osascript << 'EOF'
tell application "Notes"
    tell folder "Work"
        make new note with properties {name:"Meeting Notes", body:"<h1>Meeting</h1><p>Points...</p>"}
    end tell
end tell
EOF

# Create note with HTML formatting
osascript << 'EOF'
tell application "Notes"
    make new note with properties {name:"Formatted Note", body:"<h1>Header</h1><ul><li>Item 1</li><li>Item 2</li></ul>"}
end tell
EOF
```

### Update Notes

```bash
# Update note body
osascript -e 'tell application "Notes" to set body of note "My Note" to "New content"'

# Append to note
osascript << 'EOF'
tell application "Notes"
    set currentBody to body of note "My Note"
    set body of note "My Note" to currentBody & "<p>Appended content</p>"
end tell
EOF
```

### Delete Notes

```bash
# Delete by name
osascript -e 'tell application "Notes" to delete note "My Note"'

# Delete by index
osascript -e 'tell application "Notes" to delete note 1'
```

### Search Notes

```bash
# Search for notes containing text (requires iteration)
osascript << 'EOF'
tell application "Notes"
    set matchingNotes to {}
    repeat with aNote in every note
        if body of aNote contains "search term" then
            set end of matchingNotes to name of aNote
        end if
    end repeat
    return matchingNotes
end tell
EOF
```

### Working with Folders

```bash
# Create folder
osascript -e 'tell application "Notes" to make new folder with properties {name:"New Folder"}'

# Move note to folder
osascript << 'EOF'
tell application "Notes"
    move note "My Note" to folder "Archive"
end tell
EOF
```

### Working with Accounts

```bash
# List accounts (iCloud, On My Mac, etc.)
osascript -e 'tell application "Notes" to get name of every account'

# Create note in specific account
osascript << 'EOF'
tell application "Notes"
    tell account "iCloud"
        make new note with properties {name:"iCloud Note", body:"Synced everywhere"}
    end tell
end tell
EOF
```

## HTML Formatting

Notes use HTML for formatting. Supported tags:

- `<h1>` to `<h6>` - Headers
- `<p>` - Paragraphs
- `<ul>`, `<ol>`, `<li>` - Lists
- `<b>`, `<strong>` - Bold
- `<i>`, `<em>` - Italic
- `<u>` - Underline
- `<a href="...">` - Links
- `<br>` - Line breaks
- `<div>` - Containers

## Working with Shared Notes

Shared iCloud notes require accepting invitations before they're accessible via AppleScript.

### Accepting Shared Note Invitations

**Correct workflow:**

1. **Open Notes app** - `open -a Notes`
2. **Click "Shared" folder** in the left sidebar
3. **Look for "Invitations" section** - Pending invitations appear here
4. **Click on an invitation** - Select it to view details
5. **Click "View Note" button** - Use keyboard navigation (Tab + Enter) to activate it
6. **Note appears** - After accepting, the note becomes accessible via AppleScript

### Example: Accepting Invitations

```bash
# 1. Open Notes app
osascript -e 'tell application "Notes" to activate'

# 2. Wait for Notes to open
sleep 1

# 3. Use keyboard to navigate to and accept the invitation
# Tab to the "View Note" button and press Enter
osascript -e 'tell application "System Events" to keystroke tab'
sleep 0.5
osascript -e 'tell application "System Events" to keystroke tab'
sleep 0.5
osascript -e 'tell application "System Events" to keystroke return'

# 4. Wait for sync
sleep 2

# 5. Now the note is accessible via AppleScript
osascript -e 'tell application "Notes" to get name of every note'
```

### Reading Shared Notes

```bash
# List all notes (including newly accepted shared notes)
osascript -e 'tell application "Notes" to get name of every note'

# Read a shared note
osascript -e 'tell application "Notes" to get body of note "note name"'
```

### Important Notes

- **"View Note" button is not accessible** - cliclick and System Events cannot find it (it's in a web view)
- **Keyboard navigation works** - Tab + Enter successfully activates the button
- **No iCloud re-authentication needed** - If already signed into iCloud on the Mac, no password prompt appears
- **Invitations vs. Accepted notes** - The "Shared" folder count includes pending invitations, but AppleScript only sees accepted notes
- **Manual navigation required** - You must navigate Notes UI to the Shared folder → Invitations section first

## Limitations

1. **Password-protected notes** - Cannot read locked notes
2. **Attachments** - Images/attachments have limited support
3. **Tags** - Can read notes with tags but tags may be stripped from body
4. **Shared notes** - Must be accepted in Notes UI (keyboard navigation) before AppleScript can access them
5. **Performance** - Large operations can be slow via AppleScript

## Python Alternative

For more advanced operations, consider [macnotesapp](https://github.com/RhetTbull/macnotesapp):

```bash
# List notes
uv run --with macnotesapp notes --list

# Get note content
uv run --with macnotesapp notes --get "Note Name"
```

## Tips

- Notes app must have permission to be controlled (grant in System Preferences > Security & Privacy > Privacy > Automation)
- iCloud notes sync automatically after changes
- Use `activate` to bring Notes to foreground: `tell application "Notes" to activate`
- Note names must be unique within a folder
