# 05: Contacts and Tier System

## Goal

Add access control so only approved contacts can interact with the assistant. Different tiers get different permissions.

## Why Tiers?

Without access control, anyone who texts your assistant's number gets full access. That's dangerous. Tiers let you:
- Ignore unknown senders completely
- Give family read-only access (they can ask questions but not run commands)
- Give trusted friends more access
- Reserve admin powers for yourself

## The Tier System

| Tier | Who | Access |
|------|-----|--------|
| **admin** | You (the owner) | Full access, all tools, browser automation |
| **wife/partner** | Significant other | Full access, warmer tone |
| **family** | Close family | Read-only. Mutations need admin approval |
| **favorite** | Trusted friends | Own session, restricted tools |
| **bots** | AI agents | Like favorite, with loop detection |
| **unknown** | Everyone else | Ignored - no response |

## Step 1: Use macOS Contacts for Tier Assignment

The cleanest approach: use Contacts.app groups. The group names must be exactly:
- `Claude Admin`
- `Claude Wife`
- `Claude Family`
- `Claude Favorites`
- `Claude Bots`

### If contacts are already syncing via iCloud

If your contacts and groups are already in iCloud and syncing to this Mac, verify:
```bash
osascript -e 'tell application "Contacts" to get name of groups'
# Should include: Claude Admin, Claude Wife, Claude Family, Claude Favorites, Claude Bots
```

> **Troubleshooting iCloud sync:** If contacts aren't appearing, check System Settings → Apple ID → iCloud → Show All → Contacts is ON. Toggle it off and back on to force a resync. Also check that contacts are stored in iCloud (not "On My Mac") on the source device.

### If creating contacts from scratch

Create the groups and contacts via AppleScript:

```bash
osascript <<'APPLESCRIPT'
tell application "Contacts"
    make new group with properties {name:"Claude Admin"}
    make new group with properties {name:"Claude Wife"}
    make new group with properties {name:"Claude Family"}
    make new group with properties {name:"Claude Favorites"}
    make new group with properties {name:"Claude Bots"}

    -- Example: add admin contact
    set admin to make new person with properties {first name:"John", last name:"Smith"}
    make new phone at end of phones of admin with properties {label:"mobile", value:"+15551234567"}
    add admin to group "Claude Admin"

    save
end tell
APPLESCRIPT
```

**Verify groups and contacts:**
```bash
osascript -e 'tell application "Contacts" to get name of groups'
osascript -e 'tell application "Contacts" to get name of every person of group "Claude Admin"'
```

## Step 2: Contacts Lookup CLI

Create `~/.claude/skills/contacts/scripts/lookup.py`:

```python
#!/usr/bin/env python3
"""Look up contact info from macOS Contacts."""

import subprocess
import json
import re

def normalize_phone(phone: str) -> str:
    """Normalize to E.164 format (+1XXXXXXXXXX)."""
    digits = re.sub(r'[^\d+]', '', phone)
    if digits.startswith('+'):
        return digits
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith('1'):
        return f"+{digits}"
    return phone

def lookup_contact(phone: str) -> dict:
    """Look up contact by phone number."""
    phone = normalize_phone(phone)

    # Use AppleScript to query Contacts
    script = f'''
    tell application "Contacts"
        set matchedPeople to people whose value of phones contains "{phone}"
        if (count of matchedPeople) > 0 then
            set p to item 1 of matchedPeople
            set contactName to name of p
            set groupNames to name of groups whose people contains p
            return contactName & "|" & (groupNames as string)
        end if
    end tell
    '''

    result = subprocess.run(
        ['osascript', '-e', script],
        capture_output=True,
        text=True
    )

    if result.returncode != 0 or not result.stdout.strip():
        return {'name': None, 'tier': 'unknown', 'phone': phone}

    parts = result.stdout.strip().split('|')
    name = parts[0] if parts else None
    groups = parts[1].lower() if len(parts) > 1 else ''

    # Determine tier from groups
    if 'admin' in groups:
        tier = 'admin'
    elif 'wife' in groups:
        tier = 'wife'
    elif 'family' in groups:
        tier = 'family'
    elif 'favorite' in groups:
        tier = 'favorite'
    elif 'bots' in groups:
        tier = 'bots'
    else:
        tier = 'unknown'

    return {'name': name, 'tier': tier, 'phone': phone}

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        result = lookup_contact(sys.argv[1])
        print(json.dumps(result))
```

**Test it:**
```bash
mkdir -p ~/.claude/skills/contacts/scripts
uv run ~/.claude/skills/contacts/scripts/lookup.py "+15551234567"
```

## Step 3: Integrate with Poller

Update the daemon to check tiers:

```python
from contacts import lookup_contact

def process_message(sender: str, text: str):
    contact = lookup_contact(sender)

    if contact['tier'] == 'unknown':
        print(f"Ignoring unknown sender: {sender}")
        return  # Don't respond

    name = contact['name'] or sender
    tier = contact['tier']

    # Include tier in the prompt so Claude knows permissions
    prompt = f"""
---SMS FROM {name} ({tier})---
{text}
---END SMS---

ACL: This contact is {tier} tier.
- admin: Full access to all tools
- wife: Full access, respond warmly
- family: Read-only, ask admin before mutations
- favorite: Limited tools, be helpful but cautious

Respond appropriately for their tier.
"""

    inject_into_claude(prompt)
```

## Step 4: Tier-Specific Rules Files

Create rule files Claude can read:

`~/.claude/skills/sms-assistant/admin-rules.md`:
```markdown
# Admin Rules
Full access. Can do anything. Run any command, access any file, control smart home, browser automation.
```

`~/.claude/skills/sms-assistant/family-rules.md`:
```markdown
# Family Rules
- Can ask questions, get information
- Can request things be done, but need admin approval for:
  - Purchases
  - Sending messages to others
  - Modifying files
  - Smart home changes
- Be friendly and helpful, but explain when you need approval
```

## Step 5: Admin Approval Flow

For family members requesting mutations:

```python
def request_admin_approval(contact_name: str, action: str, admin_phone: str):
    """Ask admin for approval via SMS."""
    message = f"{contact_name} wants to: {action}\n\nReply YES to approve, NO to deny."
    send_sms(admin_phone, message)
    # Store pending approval in state
    # When admin replies YES/NO, execute or deny
```

This creates a simple approval workflow without complex UIs.

## Verification Checklist

- [ ] Contacts.app has Claude Admin, Claude Wife, Claude Family, Claude Favorites, Claude Bots groups
- [ ] `lookup_phone_sqlite('+1ADMIN_PHONE')` returns `{'name': ..., 'tier': 'admin'}`
- [ ] Unknown senders are ignored (no response in daemon logs)
- [ ] Admin messages create a Claude session and get a response
- [ ] Full back-and-forth works: admin texts → daemon routes → Claude replies via send-sms

## What's Next

With tiers working, `06-skills-system.md` covers the skills folder structure so Claude can discover and use capabilities.

---

## Wiring Checklist (When Using Existing Repo Code)

The repo already contains `contacts_core.py` with SQLite-based lookups. To wire it up:

```bash
# 1. Verify the contacts skill is symlinked
ls ~/.claude/skills/contacts  # Should point to ~/dispatch/skills/contacts

# 2. Test the lookup
cd ~/dispatch
uv run python -c "
import sys; sys.path.insert(0, 'skills/contacts/scripts')
from contacts_core import lookup_phone_sqlite
print(lookup_phone_sqlite('+1ADMIN_PHONE'))
"
# Should print: {'name': 'Your Name', 'phone': '+1...', 'tier': 'admin'}

# 3. Restart daemon so it picks up the contacts
~/dispatch/bin/claude-assistant stop && sleep 2 && ~/dispatch/bin/claude-assistant start
```

## SQLite Lookup: Per-Source Database Gotcha

The production code uses SQLite against the AddressBook database (much faster than AppleScript):
```
~/Library/Application Support/AddressBook/AddressBook-v22.abcddb
```

**Important:** On some macOS setups, the root database is empty and contacts live in per-source databases:
```
~/Library/Application Support/AddressBook/Sources/<UUID>/AddressBook-v22.abcddb
```

The `contacts_core.py` handles this automatically — it checks the root DB first, and falls back to scanning source databases if the root is empty. If contacts lookup returns `None` despite contacts being visible in Contacts.app, this is likely the issue.
