---
name: appstore-connect
description: Manage App Store Connect via API - list apps, TestFlight testers, beta groups, crash reports. Use when managing TestFlight distribution or app metadata.
---

# App Store Connect

CLI for managing App Store Connect via the API.

## Usage

```bash
~/.claude/skills/appstore-connect/scripts/asc list-apps
~/.claude/skills/appstore-connect/scripts/asc list-testers [--app APP_ID]
~/.claude/skills/appstore-connect/scripts/asc list-groups --app APP_ID
~/.claude/skills/appstore-connect/scripts/asc add-tester EMAIL --group GROUP_ID
~/.claude/skills/appstore-connect/scripts/asc tester-status EMAIL
~/.claude/skills/appstore-connect/scripts/asc list-builds --app APP_ID
~/.claude/skills/appstore-connect/scripts/asc list-crashes --app APP_ID [--build BUILD_ID]
~/.claude/skills/appstore-connect/scripts/asc get-crash SUBMISSION_ID
```

## Crash Reports

TestFlight crash reports are available via API. No need to wait for Xcode Organizer sync.

```bash
# List recent crash submissions for an app
~/.claude/skills/appstore-connect/scripts/asc list-crashes --app 6758918985

# Get full crash log text (symbolicated stack trace)
~/.claude/skills/appstore-connect/scripts/asc get-crash ALbH3h77xb__p-AXFB8l18A
```

Output columns: `SUBMISSION_ID`, `CREATED_DATE`, `DEVICE`, `OS_VERSION`, `PLATFORM`, `CRASH_LOG_ID`

## Authentication

Requires App Store Connect API key. Set environment variables or configure in `~/.claude/secrets.env`:
- `ASC_KEY_ID` - API key ID
- `ASC_ISSUER_ID` - Issuer ID
- `ASC_KEY_PATH` - Path to .p8 private key file
