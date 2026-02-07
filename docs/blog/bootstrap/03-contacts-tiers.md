# 03: Contacts and Tier System

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
| **unknown** | Everyone else | Ignored - no response |

## Step 1: Use macOS Contacts for Tier Assignment

The cleanest approach: use Contacts.app groups.

1. Open **Contacts.app**
2. Create groups: `Admin`, `Wife`, `Family`, `Favorite`
3. Add contacts to appropriate groups
4. Your assistant reads these groups to determine tier

## Step 2: Contacts Lookup CLI

Create `~/code/assistant/contacts.py`:

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
python3 ~/code/assistant/contacts.py "+15551234567"
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

- [ ] Contacts.app has Admin, Family, Favorite groups
- [ ] contacts.py correctly identifies tiers
- [ ] Unknown senders are ignored (no response)
- [ ] Admin gets full access
- [ ] Family gets appropriate restrictions
- [ ] Tier is included in prompts to Claude

## What's Next

With tiers working, `04-send-receive.md` covers the full conversation flow and making responses feel natural.

---

## Alternative: SQLite Instead of AppleScript

AppleScript can be slow. For faster lookups, Contacts.app syncs to:
```
~/Library/Application Support/AddressBook/AddressBook-v22.abcddb
```

You can query this SQLite database directly, but the schema is complex. AppleScript is simpler to start.
