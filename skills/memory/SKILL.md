---
name: memory
description: Store and retrieve persistent memories about contacts. Use when asked what you know/remember about someone, viewing memories, or saving new memories. Trigger phrases - 'what do you know about', 'what's in memories', 'show memories', 'what do you remember', 'remember this'. Backed by memory-search daemon with SQLite FTS.
allowed-tools: Bash(uv:*)
---

# Memory System

Persistent memory for contacts backed by **memory-search** (SQLite with FTS5).

Storage tiers:
1. **memory-search SQLite** - Primary storage with full-text search at `http://localhost:7890`
2. **CLAUDE.md** (per transcript folder) - Hot cache summary, auto-loaded by Claude Code
3. **Contacts.app notes** - Contact facts (who they are)

## Prerequisites

The memory-search daemon must be running:
```bash
cd ~/dispatch/services/memory-search && ~/.bun/bin/bun run src/daemon.ts
```

Check health: `curl http://localhost:7890/health`

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

# Search across all memories (uses FTS5)
uv run ~/.claude/skills/memory/scripts/memory.py search "keyword"

# Ask with natural language (smart query)
uv run ~/.claude/skills/memory/scripts/memory.py ask "contact-name" "what are their preferences?"

# Get compact summary for session injection
uv run ~/.claude/skills/memory/scripts/memory.py summary "contact-name"

# Show memory statistics
uv run ~/.claude/skills/memory/scripts/memory.py stats

# Sync CLAUDE.md from database
uv run ~/.claude/skills/memory/scripts/memory.py sync "contact-name"

# Delete a memory by ID
uv run ~/.claude/skills/memory/scripts/memory.py delete 123
```

## HTTP API (Direct Access)

The memory system is exposed via HTTP endpoints:

```bash
# Save memory
curl -X POST http://localhost:7890/memory/save \
  -H "Content-Type: application/json" \
  -d '{"contact":"jane-doe","memory_text":"Loves hiking","type":"preference","importance":4}'

# Load memories for contact
curl "http://localhost:7890/memory/load?contact=jane-doe&limit=20"

# Search memories (FTS)
curl "http://localhost:7890/memory/search?q=hiking&contact=jane-doe"

# Get stats
curl "http://localhost:7890/memory/stats"

# Delete memory
curl -X POST http://localhost:7890/memory/delete \
  -H "Content-Type: application/json" \
  -d '{"id":123}'
```

## Memory Consolidation (Nightly to Contacts.app)

Extracts personal facts from conversations and writes them to Contacts.app notes.
Runs automatically at 2am via the manager daemon.

```bash
# Manual run for one contact
uv run ~/.claude/skills/memory/scripts/memory.py consolidate "contact-name"

# Run for all contacts
uv run ~/.claude/skills/memory/scripts/memory.py consolidate --all

# Dry run (preview without writing)
uv run ~/.claude/skills/memory/scripts/memory.py consolidate --dry-run "contact-name"

# Verbose output (shows extraction details)
uv run ~/.claude/skills/memory/scripts/memory.py consolidate --verbose "contact-name"
```

**What gets extracted:**
- Family/relationships (spouse, kids, pets)
- Location/living situation
- Hobbies/interests
- Important dates (birthday, anniversary)
- Preferences (food, music, travel)
- Life events (expecting baby, moving, new job)

**What does NOT get extracted:**
- Technical/coding preferences (those stay in CLAUDE.md)
- Transactional details ("asked about weather")
- System/infrastructure details

**Tier-aware prompts:** Wife tier gets extra emphasis on birthdays, anniversaries, and health info. Family tier emphasizes kids' names and where they live.

**Safety:**
- Backups saved to `~/.claude/state/notes-backup/` before each write
- User Notes section in Contacts.app is preserved
- 2-pass review rejects updates that lose important info

**Check status:** `claude-assistant status` shows last consolidation run.

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

Stored in memory-search SQLite: `~/.cache/memory-search/index.sqlite`

## Schema

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'fact',
  memory_text TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 3,
  tags TEXT,  -- JSON array
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL
);

-- Full-text search
CREATE VIRTUAL TABLE memories_fts USING fts5(
  contact, type, memory_text,
  tokenize='porter unicode61'
);
```

## CLAUDE.md Location

Per-contact summaries live in transcript folders:
`~/transcripts/{backend}/{sanitized_chat_id}/CLAUDE.md`

Examples:
- `~/transcripts/imessage/_15555550100/CLAUDE.md`
- `~/transcripts/signal/_15555550100/CLAUDE.md`

These are auto-loaded by Claude Code when working in that directory.
