---
name: memory
description: Store and retrieve persistent memories about contacts. Use when asked what you know/remember about someone, viewing memories, or saving new memories. Trigger phrases - 'what do you know about', 'what's in memories', 'show memories', 'what do you remember', 'remember this'. Manages both DuckDB database and per-contact CLAUDE.md summaries.
allowed-tools: Bash(uv:*)
---

# Memory System

Persistent memory for contacts with three tiers:
1. **CLAUDE.md** (per transcript folder) - Hot cache summary, auto-loaded
2. **Contacts.app notes** - Contact facts (who they are)
3. **DuckDB** - Full queryable memory store

## Contact Identifier

All commands accept any of these formats:
- **Phone number**: `+16175551234` (looks up contact automatically)
- **Display name**: `Jane Doe` (converts to session format)
- **Session name**: `jane-doe` (used as-is)

## Quick Reference

```bash
# Save a memory (any identifier format works)
uv run ~/.claude/skills/memory/scripts/memory.py save "+16175551234" "memory text" --type preference
uv run ~/.claude/skills/memory/scripts/memory.py save "Jane Doe" "memory text"
uv run ~/.claude/skills/memory/scripts/memory.py save "jane-doe" "memory text"

# Load memories for contact
uv run ~/.claude/skills/memory/scripts/memory.py load "+16175551234"

# Search across all memories
uv run ~/.claude/skills/memory/scripts/memory.py search "keyword"

# Ask with natural language (smart query)
uv run ~/.claude/skills/memory/scripts/memory.py ask "contact-name" "what are their preferences?"

# Get compact summary for session injection
uv run ~/.claude/skills/memory/scripts/memory.py summary "contact-name"

# Run SQL query
uv run ~/.claude/skills/memory/scripts/memory.py query "SELECT * FROM memories WHERE type='lesson'"

# Sync CLAUDE.md from database
uv run ~/.claude/skills/memory/scripts/memory.py sync "contact-name"
```

## Memory Consolidation (Nightly)

Run this to review today's conversations and extract memories:

```bash
uv run ~/.claude/skills/memory/scripts/memory.py consolidate "contact-name"
```

This outputs today's messages for review. Then:
1. Review the conversation highlights
2. Save important memories: `memory save "contact" "insight" --type TYPE`
3. Sync CLAUDE.md: `memory sync "contact"`

The daemon triggers this at 2am for each contact with activity.

## Session Injection

The `summary` command outputs a compact format ideal for injecting into new sessions:

```
## Memory Context for Contact Name
**Preferences**: item1; item2; item3
**Facts**: item1
**Relationships**: item1
**Projects**: item1; item2
**Lessons**: item1; item2
```

This gets injected during session creation so Claude has immediate context.

## Memory Types

Claude decides the type when saving. Common types:
- `fact` - Personal facts ("birthday is March 5")
- `preference` - Likes/dislikes ("prefers dark mode")
- `lesson` - Things learned ("GCS needs no-cache headers")
- `project` - Work completed ("built podcast system")
- `relationship` - People connections ("wife is Jane")
- `context` - Ongoing situations ("working on memory system")

New types can be created organically as needed.

## Memory Permissions

**Who can see what:**
- Admin + Wife: Can access ALL memories
- Favorites: Can ONLY see their own memories
- Family/Unknown: No memory access (stateless)

**If a favorites user asks about other people's memories:**
- "What do you know about Sam?" → "I can only share what I remember about you."
- "What did the admin say?" → "I keep conversations private."

## When to Save Memories

**Explicit:** User says "remember this" or "note that..."

**Implicit (use judgment):**
- Preferences discovered during conversation
- Important personal info shared
- Lessons learned from troubleshooting
- Projects completed
- Recurring interests/topics

## Database Location

`~/.claude/memory.duckdb`

## Schema

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY,
  contact TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  type TEXT,
  memory_text TEXT NOT NULL,
  transcript_file TEXT,
  transcript_ref TEXT,
  importance INTEGER DEFAULT 3,
  tags TEXT[]
);
```

## Querying Transcripts

DuckDB can read transcript JSONLs directly:

```sql
-- Read all user messages from a contact's transcripts
SELECT * FROM read_json_auto(
  '~/.claude/projects/-Users-USERNAME-transcripts-<session-name>/*.jsonl'
) WHERE type = 'user';
```

## CLAUDE.md Location

Per-contact summaries live in transcript folders:
`~/transcripts/<contact-name>/CLAUDE.md`

These are auto-loaded by Claude Code when working in that directory.

## Discovering Memory Types

```sql
SELECT DISTINCT type, COUNT(*) as count
FROM memories
GROUP BY type
ORDER BY count DESC;
```
