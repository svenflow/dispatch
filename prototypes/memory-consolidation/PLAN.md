# Memory Consolidation ("Sleeping") System

## Goal

Nightly extraction of personal facts from conversations → Contacts.app notes

Each contact gets a `## About` section in their Contacts.app notes that captures WHO they are as a person - family, location, interests, preferences. Technical/coding preferences go in per-session CLAUDE.md instead.

## Format in Contacts.app Notes

```
<!-- CLAUDE-MANAGED:v1 -->
## About Ryan Eckert
- Has 2 kids (ages 13 and 9)
- Lives near Boston
- Planning family Maui trip for May 2026

## User Notes
(preserved section for human-added notes)

---
*Last updated: 2026-02-08 09:30*
```

- Version marker (`v1`) enables future format migrations
- "User Notes" section preserved if human adds their own content
- Timestamp enables incremental processing

## Data Sources (per person)

1. **iMessage 1:1**: `read-sms --chat <phone> --since <ts>`
2. **Signal 1:1**: parse `~/transcripts/signal/<phone>/` jsonl files (skip if empty)
3. **Group chats**: query all groups where contact is participant

Group chat query:
```sql
SELECT DISTINCT c.chat_identifier
FROM chat c
JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
JOIN handle h ON chj.handle_id = h.ROWID
WHERE h.id = ? AND c.style = 43
```

For group chats, extract facts ABOUT that person only (not other participants).

Participant → Contact mapping: use `contacts lookup <phone>` for each group member.

## 2-Pass Flow

### Pass 1 - Consolidate

- Reads: existing notes + new messages since last update
- Outputs: proposed memory list with deduplication
- Model: Sonnet (fast, cheap, good enough for extraction)
- Uses `claude -p` CLI (inherits environment, no API key management)
- **Tier-aware prompts**: Different emphasis based on relationship tier

**Base Extraction Prompt:**
```
You are extracting personal facts about {contact_name} from recent conversations.

EXTRACT (bullet points only):
- Family/relationships (spouse, kids, siblings, pets)
- Location/living situation
- Profession/employer (but NOT technical details of their work)
- Hobbies/interests
- Important dates (birthday, anniversary)
- Preferences (food, music, travel, etc.)
- Life events (expecting baby, moving, new job)

DO NOT EXTRACT:
- Transactional details ("asked about weather")
- Technical/coding preferences (those go in CLAUDE.md)
- Sensitive info (SSN, passwords, financial details)
- What we DID together - focus on WHO they ARE
- System/infrastructure details (what computer they use, smart home setup)
- Work project details

{tier_emphasis}

Output ONLY bullet points starting with "- ". No headers, no categories, no explanations.
Deduplicate similar facts. Max 15 items, most important first.
```

**Tier-Specific Emphasis (appended to base prompt):**

| Tier | Extra Emphasis |
|------|----------------|
| **wife** | Birthday, anniversary, favorite restaurants/foods, gift preferences, health info (allergies), love language |
| **family** | Birthday, kids' names/ages, where they live, health updates, major life events |
| **favorite** | How you know them, shared interests, major life events, family situation |
| **bots** | What system they're part of, capabilities, who created them |

### Pass 2 - Review & Write

- Compares old vs proposed
- Checks: no important info lost, no hallucinations, facts are genuinely new
- If approved → backup old notes → write new
- If rejected → log reason, skip (human can review later)

**Review Prompt:**
```
Compare the existing memories vs proposed update for {contact_name}.

Existing:
{existing}

Proposed:
{proposed}

Check:
1. Is any important existing information being lost?
2. Are the new facts plausible based on the conversation context?
3. Are facts genuinely new (not duplicates of existing)?

Output ONLY one of:
- APPROVED
- REJECTED: <reason>
```

## First-Run Backfill

- Default to epoch (1970-01-01) if no timestamp in notes
- Cap at 500 messages per consolidation run
- Track position in `~/dispatch/state/consolidation-progress.json`:
  ```json
  {
    "+15555550100": {
      "last_processed_ts": "2025-01-15T12:00:00",
      "contact_name": "Jane Doe"
    }
  }
  ```
- Resume from checkpoint on next run

## Safety

- **Backup before write**: `~/.claude/state/notes-backup/{identifier}.txt`
  - Location is ~/.claude (not ~/dispatch) since backups contain PII
  - Identifier: phone if available, else slugified name
- **Version marker**: Enables future format migrations
- **Preserve user content**: "User Notes" section is kept intact
- **Checkpoint progress**: Resume from last contact if daemon restarts

## Who to Process

- All tiers (admin, wife, family, favorite, bots)
- Only known contacts (in Contacts.app with phone number)
- Skip if no messages since last update
- Group-only contacts: still get memories from group participation

## Schedule

- **When**: 2am, triggered by existing manager daemon
- **Stagger**: 5 second delay between contacts to avoid rate limits
- **Triggered by**: manager.py (no new launchd plist needed)

## Logging & Metrics

- Log to `~/dispatch/logs/memory-consolidation.log`
- Track: contacts processed, facts added/updated/unchanged, errors
- Surface in `claude-assistant status`

## CLI Interface

```bash
# Standalone prototype CLI
~/dispatch/prototypes/memory-consolidation/consolidate.py <contact>
~/dispatch/prototypes/memory-consolidation/consolidate.py --all
~/dispatch/prototypes/memory-consolidation/consolidate.py --dry-run <contact>
~/dispatch/prototypes/memory-consolidation/consolidate.py --verbose <contact>

# Future: Add to memory.py CLI
memory consolidate <contact>
memory consolidate --all
```

## Files Created

```
~/dispatch/prototypes/memory-consolidation/
  PLAN.md                    # This file
  consolidate.py             # Main consolidation logic (prototype)

~/dispatch/state/
  consolidation-progress.json  # Checkpoint file (created on first run)

~/.claude/state/
  notes-backup/                # Backup directory (contains PII, not in dispatch)
```

## Files to Modify (future, after prototype validated)

```
~/.claude/skills/memory/scripts/memory.py
  - Add consolidate subcommand with --all, --dry-run flags

~/dispatch/assistant/manager.py
  - Add 2am consolidation trigger

~/dispatch/assistant/cli.py
  - Add consolidation status to `status` command

~/.claude/skills/memory/SKILL.md
  - Document new consolidate command
```

## Dependencies (all verified to exist)

- `contacts list` - get all contacts with tiers
- `contacts notes "Name"` - get notes
- `contacts notes "Name" "content"` - set notes
- `read-sms --chat <id> --since <ts>` - read messages with date filter
- `claude -p` CLI - call Claude for extraction/review (inherits shell environment)
- SQLite chat.db - query group chat participants

## Implementation Notes (from prototype testing)

1. **API Key**: Use `claude -p` CLI instead of Anthropic SDK to inherit shell environment
2. **Model**: Sonnet is sufficient for extraction, faster and cheaper than Opus
3. **Output format**: Prompt must be strict about "bullet points only" or LLM adds headers
4. **Technical leakage**: Prompt needs explicit "DO NOT EXTRACT system/infrastructure details"
5. **Group chats**: Query works, successfully extracted facts from group conversations
6. **Review pass**: Works - caught temporal inconsistencies in Ryan's extraction

## Prototype Test Results

| Contact | Status | Sample Facts |
|---------|--------|--------------|
| Ryan Eckert | REJECTED (temporal error) | 2 kids, Boston, Hawaii trip, built Pangserve |
| John Smith | APPROVED | Birthday Apr 12 1996, back pain, loves IPAs, has dog |
| Sam McGrail | APPROVED | Chess 1122 rating, expecting baby, cooks steak well |
| Jane Doe | APPROVED | Sister uses Airbnb, wife John |

## Open Questions

1. Should we consolidate memories TO the memory-search SQLite as well, or just Contacts.app?
2. How to handle contacts that change phone numbers?
3. Should memories sync bidirectionally (if human edits notes, update memory-search)?
