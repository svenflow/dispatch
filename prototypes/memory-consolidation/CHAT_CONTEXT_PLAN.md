# Per-Chat Context Consolidation

## Goal

Nightly extraction of conversation-level context → CONTEXT.md per chat

Complements person-facts (who they ARE) with conversation context (what we're DOING).

## When

2am, triggered by manager daemon alongside person-facts consolidation.

## What to Extract

1. **Ongoing projects/tasks** - things we're actively working on
2. **Pending follow-ups** - things they asked me to do or remind them about
3. **Recent topics** - last 3-5 discussion threads (for continuity)
4. **Communication preferences** - explicitly stated preferences

## Storage

```
~/transcripts/{backend}/{chat_id}/CONTEXT.md
```

Lives in the transcript directory where the session runs.

## Format

```markdown
<!-- CLAUDE-MANAGED:v1 -->
## Ongoing
- Helping plan Maui trip (May 19-26) [2026-02-15]
- Debugging MCP server setup [2026-02-10]

## Pending
- Remind them to book flights by Feb 20

## Recent Topics
- Memory consolidation system architecture
- 3-pass extraction vs 2-pass

## Preferences
- Prefers concise responses
- Uses Signal for sensitive topics

---
*Last updated: 2026-02-17 02:00*
```

## Decay/Staleness

- Each item has a last-mentioned date in brackets
- Items not mentioned in 14+ days are pruned automatically
- Recent Topics keeps only last 5 (most recent)
- Max file size: 2KB (prioritize most recent)

## 3-Pass Architecture

Like person-facts, uses 3 agents:

### Pass A: Suggester
- Reads last 7 days of messages (or since last consolidation)
- Extracts candidate context items with supporting quotes
- Categories: ongoing, pending, topics, preferences

### Pass B: Reviewer
- Verifies quotes exist in transcript
- Checks items aren't already completed/resolved
- Merges with existing CONTEXT.md
- Prunes stale items (14+ days)

### Pass C: Committer
- Writes CONTEXT.md atomically (temp file + rename)
- Ensures max size limit
- Updates timestamp

## Injection

On session start/restart, manager injects CONTEXT.md after contact notes:

```python
async def _build_individual_system_prompt(...):
    # ... existing code ...
    chat_context = await self._get_chat_context(transcript_dir)

    # Add to system prompt:
    ## Current Conversation Context
    {chat_context}
```

## Group Chat Handling

For group chats:
- Extract context for the GROUP, not individuals
- Track who initiated each topic when relevant
- Shared context for all participants

## Edge Cases

1. **Race condition**: Atomic writes via temp file + rename
2. **Stale context**: Prune items not mentioned in 14+ days
3. **Context overflow**: 2KB max, prioritize recent
4. **Long silence**: If context older than 7 days, inject with note

## CLI Interface

```bash
consolidate_chat.py <chat_id>           # Single chat
consolidate_chat.py --all               # All active chats
consolidate_chat.py --dry-run <chat_id> # Preview without writing
consolidate_chat.py --verbose <chat_id> # Show all passes
```

## Files

```
~/dispatch/prototypes/memory-consolidation/
  CHAT_CONTEXT_PLAN.md     # This file
  consolidate_chat.py      # Main consolidation logic

~/transcripts/{backend}/{chat_id}/
  CONTEXT.md               # Per-chat context (created by consolidation)
```

## Integration (DONE)

1. ✅ Added to manager.py `_run_nightly_consolidation()` - runs after person-facts
2. ✅ Added `_get_chat_context()` helper to sdk_backend.py
3. ✅ Injected into both `_build_individual_system_prompt()` and `_build_group_system_prompt()`
4. TODO: Add to `claude-assistant status` output

## Files Modified

- `~/dispatch/assistant/manager.py` - 2am job runs both consolidations
- `~/dispatch/assistant/sdk_backend.py` - CONTEXT.md injection on session startup
- `~/dispatch/prototypes/memory-consolidation/consolidate_chat.py` - 3-pass extraction

## Testing

Dry runs completed on:
- ab3876ca883949d2b0ce9c4cd5d1d633 (admin dev chat) ✅
- b3d258b9a4de447ca412eb335c82a077 (ski trip chat) ✅

Both correctly extracted ongoing projects, pending tasks, recent topics, and preferences.
