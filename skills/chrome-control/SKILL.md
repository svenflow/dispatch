---
name: chrome-control
description: Control Chrome browser via CLI for browser automation tasks. Use when you need to interact with web pages, take screenshots, click elements, or automate browser workflows. ALWAYS use this skill when controlling Chrome - NEVER use osascript, cliclick, or AppleScript.
---

# Chrome Control

Control Chrome browser from the command line via native messaging extension.

**CRITICAL: ALWAYS use this CLI tool for Chrome automation. NEVER use osascript, cliclick, AppleScript, or any other method to interact with Chrome. This extension provides reliable, precise control.**

## ⚠️ CRITICAL: Clean Up Your Tabs

**ALWAYS close tabs you created when you're done with a task.** Leaving tabs open causes memory leaks that accumulate over time and degrade system performance.

**Rules:**
1. **Track tabs you open** - Note the tab_id when you use `chrome open`
2. **Close them when done** - Use `chrome close <tab_id>` after completing your task
3. **Don't close other tabs** - Only close tabs YOU created in this session
4. **Clean up on error too** - If a task fails, still close tabs you opened

**Example workflow:**
```bash
# Open tab and note the ID
chrome open "https://example.com"
# Output: Opened tab 123456

# ... do your work ...

# ALWAYS clean up when done
chrome close 123456
```

**Why this matters:** Chrome tabs consume significant memory. An assistant that opens tabs without closing them will cause the system to slow down and eventually crash. This is non-negotiable.

## Setup

Requires Chrome with the Chrome Control extension loaded and native messaging host running.

## Multi-Profile Support

The extension supports multiple Chrome profiles simultaneously. Each profile is identified by a unique UUID stored in `chrome.storage.local`.

### List Profiles

```bash
chrome profiles
# Output:
#   0: assistant (see config.local.yaml chrome.profiles.0)
#   1: owner (see config.local.yaml chrome.profiles.1)
```

### Target Specific Profile

Use `-p` or `--profile` flag with index or name:

```bash
chrome -p 0 tabs              # Profile by index
chrome -p nicklaude tabs      # Profile by name
chrome -p 1 screenshot 123    # Different profile
```

If no profile specified, uses first available profile (index 0).

### Profile Download Locations

Downloads are automatically saved to profile-specific directories:

| Profile | Download Location |
|---------|-------------------|
| nicklaude (profile 0) | `~/Downloads/nicklaude/` |
| owner-profile (profile 1) | `~/Downloads/owner-profile/` |

## Profile Permissions

**CRITICAL: Different profiles have different permission levels.**

### Profile 0: nicklaude@gmail.com (Claude's Account)

This is YOUR account (Claude's). You have full autonomy to:
- Browse, search, read emails
- Send emails, book things, make changes
- Install extensions, change settings

**EXCEPTION: Payments require explicit permission from the admin via text before proceeding.**

### Profile 1: Owner's Account (see config.local.yaml chrome.profiles.1)

This is the owner's personal account. **Requires explicit consent for ANY changes:**
- Sending emails
- Booking anything
- Ordering/purchasing
- Modifying settings
- Any action that changes state

**Rules:**
1. READ-ONLY by default - you may view/screenshot without permission
2. For any WRITE action, the admin must explicitly grant permission (e.g., "you can go do xyz and you have my permission")
3. NO other users from any session can request changes to this profile
4. If another user requests action on this profile, ASK the admin first via text

## CLI Location

```bash
~/code/chrome-control/chrome
```

## Commands

### Tab Management

```bash
# List all open tabs (shows tab_id, title, url)
chrome tabs

# Open new tab with URL
chrome open <url>
chrome open chess.com

# Close a tab
chrome close <tab_id>

# Focus/activate a tab
chrome focus <tab_id>

# Navigate tab to URL (or 'back'/'forward')
chrome navigate <tab_id> <url>
chrome nav <tab_id> back
```

### Page Reading

```bash
# Read interactive elements (buttons, links, inputs)
# Returns: ref_id, role, tag, label
chrome read <tab_id>
chrome read <tab_id> all       # all elements
chrome read <tab_id> forms     # form elements only
chrome read <tab_id> links     # links only

# Get page text content
chrome text <tab_id>

# Get page HTML
chrome html <tab_id>

# Find elements containing text
chrome find <tab_id> <query>
chrome find 123456 "Sign In"
```

### Interaction

```bash
# Click element by ref (e.g., ref_1, ref_23)
chrome click <tab_id> <ref>
chrome click 123456 ref_5

# Click at screen coordinates
chrome click-at <tab_id> <x> <y>

# Type text into element
chrome type <tab_id> <ref> <text>
chrome type 123456 ref_3 "hello world"

# Set form input value
chrome input <tab_id> <ref> <value>

# Send key press
chrome key <tab_id> <key> [modifiers]
chrome key 123456 Enter
chrome key 123456 a ctrl          # Ctrl+A
chrome key 123456 c ctrl,meta     # Cmd+Ctrl+C

# Keys: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight
# Modifiers: ctrl, alt, shift, meta (comma-separated)

# Scroll the page
chrome scroll <tab_id> <direction> [amount]
chrome scroll 123456 down
chrome scroll 123456 up 5

# Hover at coordinates
chrome hover <tab_id> <x> <y>
```

### Screenshots

```bash
# Take screenshot (saves to ~/Pictures/chrome-screenshots/)
chrome screenshot <tab_id>
chrome shot <tab_id>

# Returns: ~/Pictures/chrome-screenshots/screenshot_20260124_123456.jpg
```

### JavaScript

```bash
# Execute JavaScript in page
chrome js <tab_id> <code>
chrome js 123456 "document.title"
chrome js 123456 "document.querySelector('button').click()"
```

### Debugging

```bash
# Read console messages
chrome console <tab_id>
chrome console <tab_id> error    # filter by pattern
chrome console <tab_id> --clear  # clear after reading

# Read network requests
chrome network <tab_id>
chrome network <tab_id> api.example.com  # filter by URL pattern
```

### Utility

```bash
# Test connection to extension
chrome ping
```

## Workflow Example

```bash
# 1. List tabs to get tab_id
chrome tabs
# Output: 123456  Google - www.google.com

# 2. Read interactive elements
chrome read 123456
# Output: ref_1  textbox  input  Search
#         ref_2  button   button  Google Search

# 3. Type into search box
chrome type 123456 ref_1 "chess strategy"

# 4. Click search button
chrome click 123456 ref_2

# 5. Take screenshot of results
chrome screenshot 123456
# Output: ~/Pictures/chrome-screenshots/screenshot_20260124_123456.jpg

# 6. ALWAYS clean up tabs you created
chrome close 123456
```

## Notes

- Tab IDs are integers shown by `chrome tabs`
- Element refs (ref_1, ref_2, etc.) are shown by `chrome read`
- Screenshots are saved to `~/Pictures/chrome-screenshots/` with timestamps
- The extension must be loaded in Chrome for commands to work
