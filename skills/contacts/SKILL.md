---
name: contacts
description: Look up contact information, tiers, and notes from macOS Contacts.app. Use when you need to know about a user, find their phone number, check their tier, or manage their contact data.
allowed-tools: Bash(~/code/contacts-cli/contacts*)
---

# Contacts Management Skill

This skill manages contacts using the native macOS Contacts.app. Tiers are implemented using Contact Groups.

## CLI Location

```bash
~/code/contacts-cli/contacts
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
~/code/contacts-cli/contacts list

# Filter by tier
~/code/contacts-cli/contacts list --tier family
~/code/contacts-cli/contacts list --tier admin
```

### Lookup Contact by Phone Number
```bash
~/code/contacts-cli/contacts lookup +16175551234
```
Returns: `Name | Phone | Tier`

### Add New Contact
```bash
# With tier
~/code/contacts-cli/contacts add "First" "Last" "+16175551234" --tier family

# Without tier (will be ignored by system)
~/code/contacts-cli/contacts add "First" "Last" "+16175551234"
```
Valid tiers: admin, wife, family, favorite

### Get/Set Contact Tier
```bash
# Get current tier
~/code/contacts-cli/contacts tier "First Last"

# Set new tier
~/code/contacts-cli/contacts tier "First Last" family

# Remove from all tiers (contact will be ignored)
~/code/contacts-cli/contacts tier "First Last" none
```

### Get/Set Contact Notes
```bash
# Get notes
~/code/contacts-cli/contacts notes "First Last"

# Set notes
~/code/contacts-cli/contacts notes "First Last" "Prefers morning texts. Works at Google."
```
Notes are useful for remembering preferences, context, etc.

## Important Notes

- Phone numbers should include country code (e.g., +1 for US)
- The Messages.app chat.db uses phone numbers as identifiers
- When a message comes in, lookup the phone number to determine tier and routing
