---
name: ccusage
description: Check Claude Code API usage, token consumption, and quota remaining. Use when asked about usage, tokens, costs, quota, or how much Claude Code capacity is left.
---

# Claude Code Usage Tracking

Track your Claude Code API consumption using the `ccusage` tool.

## Quick Commands

```bash
# Current block status (most useful - shows % remaining)
~/.bun/bin/bun x ccusage blocks

# Daily usage
~/.bun/bin/bun x ccusage daily

# Monthly usage
~/.bun/bin/bun x ccusage monthly

# Weekly usage
~/.bun/bin/bun x ccusage weekly
```

## Understanding Blocks

Claude Code uses 5-hour billing blocks. The `blocks` command shows:

- **Current block**: When it started, time elapsed/remaining
- **Used %**: Tokens consumed in this block vs limit
- **Remaining %**: What's left in the current block
- **Projected %**: Estimated usage by block end (based on burn rate)

Example output interpretation:
```
Current 5-hour block (started 12pm):
- Used: 50% (88M tokens)
- Remaining: 50% (88M tokens)
- Time left: 2h 5m
- Projected: 86% by block end
```

## When to Use This Skill

- "How much usage do I have left?"
- "What's my Claude Code quota?"
- "How many tokens have I used today?"
- "Am I going to hit my limit?"
- "What's my burn rate?"

## SMS Response Format

When reporting to user via SMS, format like this:

```
Current 5-hour block (started Xpm):
- Used: X% (XM tokens, $X)
- Remaining: X% (XM tokens)
- Time left: Xh Xm
- Projected: X% by block end

Today: $X (XM tokens)
```
