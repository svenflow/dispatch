---
layout: default
title: Contact Tiers
nav_order: 3
---

# Contact Tiers
{: .no_toc }

Control who gets what level of access to your assistant.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Dispatch uses a tier system to control what each contact can do. Tiers are managed via macOS Contacts.app groups — simply add contacts to the appropriate group.

## Tier Levels

| Tier | Group Name | Access Level |
|------|------------|--------------|
| **Admin** | `Claude Admin` | Full computer control, browser automation, all tools |
| **Partner** | `Claude Partner` | Full access with personalized warm tone |
| **Family** | `Claude Family` | Read-only; mutations need admin approval |
| **Favorite** | `Claude Favorites` | Own session, restricted tools |
| **Bots** | `Claude Bots` | Read-only with loop detection |
| **Unknown** | (none) | Ignored (no session created) |

## Tier Details

### Admin

The owner tier. Admins have:
- Full computer control
- Browser automation
- All tools enabled
- `--dangerously-skip-permissions` mode

### Partner

Same access as admin, but with warmer, more personal tone. The assistant will:
- Be extra caring and supportive
- Go above and beyond to help
- Add personal touches to interactions

### Family

Read-only access with safety guardrails:
- Can read files and search
- Cannot modify files or run destructive commands
- Mutations require admin approval via SMS prompt

### Favorite

Trusted friends with their own session:
- Web search and image analysis
- Limited bash commands
- No file modifications
- Security-conscious responses

### Bots

Other AI agents with loop detection:
- Same restrictions as favorites
- Automatic conversation loop detection
- Will stop responding if no forward progress

### Unknown

Contacts not in any tier group are completely ignored — no session is created, no response is sent.

## Setting Up Tiers

### Via Contacts.app

1. Open **Contacts.app**
2. Create groups named exactly:
   - `Claude Admin`
   - `Claude Partner`
   - `Claude Family`
   - `Claude Favorites`
   - `Claude Bots`
3. Drag contacts into appropriate groups

### Via CLI

```bash
# List contacts by tier
~/.claude/skills/contacts/scripts/contacts list --tier admin

# Set a contact's tier
~/.claude/skills/contacts/scripts/contacts tier "John Smith" family

# Look up a contact
~/.claude/skills/contacts/scripts/contacts lookup +16175551234
```

## Tier Rules Files

Each tier has a rules file that gets injected into sessions:

```
~/.claude/skills/sms-assistant/admin-rules.md
~/.claude/skills/sms-assistant/partner-rules.md
~/.claude/skills/sms-assistant/family-rules.md
~/.claude/skills/sms-assistant/favorites-rules.md
~/.claude/skills/sms-assistant/bots-rules.md
~/.claude/skills/sms-assistant/unknown-rules.md
```

Edit these to customize behavior per tier.
