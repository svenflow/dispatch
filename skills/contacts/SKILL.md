---
name: contacts
description: Look up contact information, tiers, and notes from macOS Contacts.app. Use when you need to know about a user, find their phone number, check their tier, or manage their contact data.
allowed-tools: Bash(~/.claude/skills/contacts/scripts/contacts*)
---

# Contacts Management Skill

This skill manages contacts using the native macOS Contacts.app. Tiers are implemented using Contact Groups.

## CLI Location

```bash
~/.claude/skills/contacts/scripts/contacts
```

## Architecture

**Tier System via Contact Groups (priority order):**
- `Claude Admin` - Full access users who can control the main Claude session
- `Claude Wife` - Special tier for spouse with elevated privileges
- `Claude Family` - Family members with read access, mutations need admin approval
- `Claude Favorites` - Priority users with a dedicated locked-down Claude
- No group = Unknown/ignored (messages from contacts not in any group are ignored)

**Data Storage:**
- All contact data lives in macOS Contacts.app
- Tiers are determined by group membership
- Phone numbers are the primary identifier for incoming messages

## Commands

### List All Contacts
```bash
# All contacts with tiers
~/.claude/skills/contacts/scripts/contacts list

# Filter by tier
~/.claude/skills/contacts/scripts/contacts list --tier family
~/.claude/skills/contacts/scripts/contacts list --tier admin
```

### Lookup Contact by Phone Number
```bash
~/.claude/skills/contacts/scripts/contacts lookup +16175551234
```
Returns: `Name | Phone | Tier`

### Add New Contact
```bash
# With tier
~/.claude/skills/contacts/scripts/contacts add "First" "Last" "+16175551234" --tier family

# Without tier (will be ignored by system)
~/.claude/skills/contacts/scripts/contacts add "First" "Last" "+16175551234"
```
Valid tiers: admin, wife, family, favorite

### Get/Set Contact Tier
```bash
# Get current tier
~/.claude/skills/contacts/scripts/contacts tier "First Last"

# Set new tier
~/.claude/skills/contacts/scripts/contacts tier "First Last" family

# Remove from all tiers (contact will be ignored)
~/.claude/skills/contacts/scripts/contacts tier "First Last" none
```

### Get/Set Contact Notes
```bash
# Get notes
~/.claude/skills/contacts/scripts/contacts notes "First Last"

# Set notes
~/.claude/skills/contacts/scripts/contacts notes "First Last" "Prefers morning texts. Works at Google."
```
Notes are useful for remembering preferences, context, etc.

## Important Notes

- Phone numbers should include country code (e.g., +1 for US)
- The Messages.app chat.db uses phone numbers as identifiers
- When a message comes in, lookup the phone number to determine tier and routing

## Technical Details

**Hybrid read/write path:**
- **Reads**: SQLite queries against AddressBook-v22.abcddb (fast, no Contacts.app dependency)
- **Writes**: AppleScript via Contacts.app (required by macOS for mutations)

**Multi-source database architecture:**
macOS stores contacts across multiple SQLite databases when iCloud is enabled:
- `~/Library/Application Support/AddressBook/AddressBook-v22.abcddb` (root, may be stale)
- `~/Library/Application Support/AddressBook/Sources/<UUID>/AddressBook-v22.abcddb` (per-source)

The same contact can exist in multiple source DBs with different data. AppleScript writes go to
the active iCloud source (most recently modified). SQLite reads query all sources, sorted by
modification time (newest first), so "first match wins" returns the most recent version.

If notes appear to not persist, it may be an iCloud sync issue - check all source DBs manually.
