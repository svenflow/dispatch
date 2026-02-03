---
name: system-info
description: Show system resource usage dashboard including CPU, memory, Claude processes, Chrome tabs, and SDK sessions. Use when asked about system health, memory pressure, or resource usage.
---

# System Info Dashboard

Shows a comprehensive breakdown of system resources with focus on the claude-assistant workload.

## Quick Usage

```bash
uv run ~/.claude/skills/system-info/scripts/sysinfo.py
```

**When invoked:** Run the script above and display the output to the user.

## Output Includes

- **System specs**: Total RAM, CPU cores
- **Memory**: Used, free, compressed, pressure status
- **CPU**: Usage percentage, load average
- **Claude processes**: Count, memory, CPU, breakdown by category (sessions, interactive, chrome-mcp)
- **SDK sessions**: Active session counts from registry
- **Chrome**: Process count, memory, CPU, tabs per profile

## JSON Output

For programmatic use:

```bash
uv run ~/.claude/skills/system-info/scripts/sysinfo.py --json
```

## Memory Pressure Indicators

| Status | Meaning |
|--------|---------|
| OK | > 500MB free |
| WARNING | 200-500MB free |
| CRITICAL | < 200MB free |

## Example Output

```
==================================================
  SYSTEM DASHBOARD
==================================================

System: 8GB RAM, 8 cores

MEMORY
  Used:           7.2GB (90%)
  Free:           178MB
  Compressed:     2.6GB
  Status:       CRITICAL (< 200MB free)

CPU
  Used:          44.2%
  Load Avg:       4.07

CLAUDE PROCESSES
  Count:             5
  Memory:         2.1GB
  CPU:           12.3%
  Breakdown:
    session:jane-doe: 2 (950MB)
    interactive: 1 (700MB)
    chrome-mcp: 2 (50MB)

SDK SESSIONS
  Active:            2
  Background:        0
  Sessions:   jane-doe, john-smith

CHROME
  Processes:        25
  Memory:         1.2GB
  CPU:           35.5%
  Profile 0:         2 tabs
  Profile 1:         1 tabs

==================================================
```

## When to Use

- System feels slow or unresponsive
- Before/after cleanup to measure impact
- Debugging memory issues
- Checking if sessions need cleanup
