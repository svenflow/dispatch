---
name: ccusage
description: Check Claude Code API usage, token consumption, and quota remaining. Use when asked about usage, tokens, costs, quota, or how much Claude Code capacity is left.
---

# Claude Code Usage Tracking

Two data sources: **local** (ccusage npm package, reads JSONL logs) and **server-side** (daemon-cached quota from Anthropic API).

## Quick Commands

```bash
# Combined view: local block stats + server-side quota (default)
~/.claude/skills/ccusage/scripts/usage

# Local only
~/.claude/skills/ccusage/scripts/usage daily
~/.claude/skills/ccusage/scripts/usage weekly
~/.claude/skills/ccusage/scripts/usage monthly

# Server-side (reads from daemon cache by default — instant, no API call)
~/.claude/skills/ccusage/scripts/usage server              # Human-readable
~/.claude/skills/ccusage/scripts/usage server --json        # Raw JSON
~/.claude/skills/ccusage/scripts/usage server --check 80    # Exit 0 if < 80%
~/.claude/skills/ccusage/scripts/usage server --reset-time  # ISO 8601 reset time
~/.claude/skills/ccusage/scripts/usage server --hours-until-reset  # Hours as float
~/.claude/skills/ccusage/scripts/usage server --force       # Bypass cache, hit API directly
```

## Server-Side Usage Architecture

The daemon's health check loop fetches quota from Anthropic every ~15 min (adaptive backoff: 15min base → 2h cap on failures). Results are:

1. **Written to disk**: `~/dispatch/state/quota_cache.json` (atomic write)
2. **Emitted to bus**: `quota.fetched` event on `system` topic (with utilization + backoff state)
3. **Served via API**: `dispatch-api` reads `quota_cache.json` and serves it at `/api/dashboard/ccu`

The `server-usage` CLI reads from the cache file — **it never hits the Anthropic API** unless you pass `--force`. This prevents quota hammering and makes it instant.

### Cache file location
```
~/dispatch/state/quota_cache.json
```

### Auth methods (only used with --force)

#### 1. OAuth (preferred, no browser needed)
- **Endpoint**: `api.anthropic.com/api/oauth/usage`
- **Auth**: `Authorization: Bearer <oauth-token>`
- **Required header**: `anthropic-beta: oauth-2025-04-20`
- **Token location**:
  - macOS: keychain entry "Claude Code-credentials" → `claudeAiOauth.accessToken`
  - Linux: `~/.claude/.credentials.json` → `claudeAiOauth.accessToken`

#### 2. Chrome cookies (fallback)
- **Endpoint**: `claude.ai/api/organizations/{org_id}/usage`
- **Auth**: Chrome session cookies (requires being logged into claude.ai)
- **org_id**: From `lastActiveOrg` cookie

### Response fields
- **5-hour block**: Current utilization % and reset time
- **7-day all models**: Weekly quota utilization % and exact rolling reset time
- **7-day sonnet**: Separate sonnet-only quota
- **7-day opus**: Separate opus-only quota (if applicable)
- **Extra usage**: Credit-based overage spending (if enabled)
- **Rate limit tier**: Concurrent request limits per model (cookies only)

## Investigating Quota Changes via Bus

The bus stores every `quota.fetched` event with utilization snapshots. Use SQL to find big jumps and correlate with heavy sessions.

### Find big quota jumps (>5% increase between consecutive fetches)

```sql
-- Show quota changes over time, flagging big jumps
WITH quota_seq AS (
  SELECT
    offset,
    datetime(timestamp/1000, 'unixepoch', 'localtime') AS ts,
    timestamp,
    json_extract(payload, '$.five_hour.utilization') AS fh,
    json_extract(payload, '$.seven_day.utilization') AS sd,
    LAG(json_extract(payload, '$.five_hour.utilization')) OVER (ORDER BY offset) AS prev_fh,
    LAG(json_extract(payload, '$.seven_day.utilization')) OVER (ORDER BY offset) AS prev_sd,
    LAG(timestamp) OVER (ORDER BY offset) AS prev_ts
  FROM records
  WHERE topic = 'system' AND type = 'quota.fetched'
)
SELECT ts,
  fh || '%' AS five_hour,
  sd || '%' AS seven_day,
  CASE WHEN prev_fh IS NOT NULL THEN '+' || (fh - prev_fh) || '%' END AS fh_delta,
  CASE WHEN prev_sd IS NOT NULL THEN '+' || (sd - prev_sd) || '%' END AS sd_delta,
  CASE WHEN prev_ts IS NOT NULL THEN (timestamp - prev_ts) / 60000 || 'm' END AS gap
FROM quota_seq
WHERE prev_fh IS NULL OR (fh - prev_fh) > 5 OR (sd - prev_sd) > 2
ORDER BY offset DESC
LIMIT 20;
```

### Find what was heavy between two quota snapshots

```sql
-- Given a time window (between two quota.fetched events), find which sessions were active
-- Replace the timestamps with values from the quota jump query above
SELECT
  session_name,
  COUNT(*) AS events,
  SUM(duration_ms) / 1000.0 AS total_sec,
  COUNT(DISTINCT tool_name) AS unique_tools,
  GROUP_CONCAT(DISTINCT tool_name) AS tools_used
FROM sdk_events
WHERE timestamp BETWEEN 1743187827000 AND 1743188792000  -- replace with actual ms timestamps
  AND event_type = 'tool_result'
GROUP BY session_name
ORDER BY total_sec DESC;
```

### Quick one-liner: recent quota history

```bash
sqlite3 ~/dispatch/state/bus.db "
  SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') AS ts,
         json_extract(payload, '$.five_hour.utilization') || '%' AS fh,
         json_extract(payload, '$.seven_day.utilization') || '%' AS sd
  FROM records
  WHERE topic='system' AND type='quota.fetched'
  ORDER BY offset DESC LIMIT 20
"
```

### Find quota fetch failures and backoff state

```bash
sqlite3 ~/dispatch/state/bus.db "
  SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') AS ts,
         json_extract(payload, '$.backoff_seconds') AS backoff,
         json_extract(payload, '$.consecutive_failures') AS failures,
         json_extract(payload, '$.error') AS error
  FROM records
  WHERE topic='system' AND type='quota.fetch_failed'
  ORDER BY offset DESC LIMIT 10
"
```

## Understanding Blocks (Local)

Claude Code uses 5-hour billing blocks. The `blocks` command shows:

- **Current block**: When it started, time elapsed/remaining
- **Used %**: Tokens consumed in this block vs limit
- **Remaining %**: What's left in the current block
- **Projected %**: Estimated usage by block end (based on burn rate)

## Scheduling Heavy Tasks Around Reset

The `--hours-until-reset` flag enables quota-aware scheduling:

```bash
# In task scheduler: only run if reset is within 5 hours
HOURS=$(~/.claude/skills/ccusage/scripts/server-usage --hours-until-reset 2>/dev/null)
if [ "$(echo "$HOURS <= 5" | bc)" -eq 1 ]; then
  # Run heavy tasks — tokens would be wasted anyway
fi
```

## Quota-Gate Pattern for Expensive Tasks

When scheduling expensive agent tasks (bugfinder, latency finder, etc.), use this pattern to only run them when the weekly quota is about to reset — burning tokens that would otherwise be wasted:

```bash
# Quota-gate: skip if reset is more than 5 hours away
HOURS=$(~/.claude/skills/ccusage/scripts/server-usage --hours-until-reset 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$HOURS" ]; then
  echo "Could not check quota — skipping"
  exit 0
fi
if [ "$(echo "$HOURS > 5.0" | bc)" -eq 1 ]; then
  echo "Skipping — reset not within 5h window (${HOURS}h remaining)"
  exit 0
fi
# Proceed with expensive task...
```

In agent task prompts, use the inline version:
```
FIRST: Run ~/.claude/skills/ccusage/scripts/server-usage --hours-until-reset
If result > 5.0 hours, log 'Skipping — reset not within 5h window' and EXIT.
ONLY proceed if hours until reset <= 5.0.
```

This pattern is used by nightly bugfinder and latency finder tasks in `~/dispatch/scripts/setup-nightly-tasks.py`.

## SMS Response Format

When reporting to user via SMS, include both local and server numbers:

```
Server-side: X% weekly (resets Day Time)
5-hour block: X% used, Xh Xm remaining
Local estimate: XM tokens ($X) this block
```
