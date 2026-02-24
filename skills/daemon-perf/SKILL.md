---
name: daemon-perf
description: Analyze daemon performance metrics. Trigger words - perf, performance, latency, metrics, slow, timing.
---

# Daemon Performance Analysis

Analyze performance metrics from the dispatch daemon and SDK sessions.

## Quick Start

```bash
# Summary of all metrics (today)
~/dispatch/bin/perf-analyze

# Specific metric details
~/dispatch/bin/perf-analyze poll_cycle_ms
~/dispatch/bin/perf-analyze inject_ms
~/dispatch/bin/perf-analyze send_sms_ms

# Last N days
~/dispatch/bin/perf-analyze --days 7

# Filter by component
~/dispatch/bin/perf-analyze --component daemon
~/dispatch/bin/perf-analyze --component session
~/dispatch/bin/perf-analyze --component sven-api
```

## Available Metrics

### Daemon Component
- `poll_cycle_ms` - Main poll loop time (sampled 1/10)
- `messages_read` - Messages ingested per poll (by source: imessage/signal)
- `contact_lookup_ms` - Contact tier lookup time
- `session_spawn_ms` - Time to create new SDK session
- `inject_ms` - Time to inject message into session
- `active_sessions` - Current session count (gauge)
- `gemini_vision_ms` - Gemini image analysis time
- `error_count` - Errors by type

### Session Component
- `send_sms_ms` - Time for send-sms CLI to complete

### sven-api Component
- `request_ms` - HTTP request latency (by endpoint)

## Log Location

Metrics are stored as JSONL in:
```
~/dispatch/logs/perf-YYYY-MM-DD.jsonl
```

## Log Format

Each line is a JSON object:
```json
{"v": 1, "ts": "2026-02-23T21:22:00.123", "metric": "poll_cycle_ms", "value": 45.2, "component": "daemon"}
```

Fields:
- `v` - Schema version (currently 1)
- `ts` - ISO timestamp
- `metric` - Metric name
- `value` - Numeric value
- `component` - Source component (daemon, session, sven-api)
- Additional labels vary by metric

## Raw Query Examples

```bash
# All poll cycle times today
jq 'select(.metric=="poll_cycle_ms")' ~/dispatch/logs/perf-*.jsonl

# Inject times over 1 second
jq 'select(.metric=="inject_ms" and .value > 1000)' ~/dispatch/logs/perf-*.jsonl

# Errors only
jq 'select(.metric=="error_count")' ~/dispatch/logs/perf-*.jsonl

# Group by component
jq -s 'group_by(.component) | map({component: .[0].component, count: length})' ~/dispatch/logs/perf-*.jsonl
```

## Interpreting Results

### Healthy Baselines
- `poll_cycle_ms` p95 < 100ms
- `inject_ms` p95 < 500ms
- `send_sms_ms` p95 < 5s (AppleScript is slow)
- `contact_lookup_ms` p95 < 10ms (SQLite cache)

### Warning Signs
- `poll_cycle_ms` p99 > 500ms - check iMessage FDA access
- `inject_ms` p95 > 2s - session may need restart
- `session_spawn_ms` > 10s - SDK slow to initialize
- `error_count` increasing - check specific error_type

## Log Rotation

Logs are kept for 30 days. Old files are cleaned by:
```bash
find ~/dispatch/logs -name "perf-*.jsonl" -mtime +30 -delete
```
