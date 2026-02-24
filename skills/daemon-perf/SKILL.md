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

## Visualization

Generate scatter plots of metrics over time with percentile lines:

```bash
cat > /tmp/plot_perf.py << 'EOF'
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["matplotlib"]
# ///

import json
import matplotlib.pyplot as plt
from collections import defaultdict
from datetime import datetime
import sys

# Read JSONL
metrics_data = defaultdict(list)
with open(sys.argv[1]) as f:
    for line in f:
        entry = json.loads(line)
        metric = entry['metric']
        value = entry['value']
        ts = datetime.fromisoformat(entry['ts'])
        metrics_data[metric].append((ts, value))

# Filter to timing metrics only
timing_metrics = ['send_sms_ms', 'inject_ms', 'session_spawn_ms', 'poll_cycle_ms', 'contact_lookup_ms']
timing_data = {k: v for k, v in metrics_data.items() if k in timing_metrics}

# Create figure with subplots
fig, axes = plt.subplots(len(timing_data), 1, figsize=(12, 3*len(timing_data)))
if len(timing_data) == 1:
    axes = [axes]

colors = {'send_sms_ms': '#e74c3c', 'inject_ms': '#3498db', 'session_spawn_ms': '#2ecc71',
          'poll_cycle_ms': '#9b59b6', 'contact_lookup_ms': '#f39c12'}

for idx, (metric, data) in enumerate(sorted(timing_data.items())):
    ax = axes[idx]
    times, values = zip(*data)
    ax.scatter(times, values, alpha=0.7, c=colors.get(metric, '#333'), s=50)
    ax.set_ylabel(f'{metric}\n(ms)')
    ax.grid(True, alpha=0.3)

    # Add horizontal lines for percentiles
    sorted_vals = sorted(values)
    p50 = sorted_vals[len(sorted_vals)//2]
    p95 = sorted_vals[int(len(sorted_vals)*0.95)] if len(sorted_vals) > 1 else sorted_vals[0]
    ax.axhline(y=p50, color='green', linestyle='--', alpha=0.7, label=f'p50={p50:.1f}ms')
    ax.axhline(y=p95, color='orange', linestyle='--', alpha=0.7, label=f'p95={p95:.1f}ms')
    ax.legend(loc='upper right')

plt.suptitle('Daemon Performance Metrics Over Time', fontsize=14, fontweight='bold')
plt.tight_layout()
plt.savefig('/tmp/perf_plot.png', dpi=150, bbox_inches='tight')
print('saved to /tmp/perf_plot.png')
EOF

# Run it
uv run /tmp/plot_perf.py ~/dispatch/logs/perf-$(date +%Y-%m-%d).jsonl
```

Output goes to `/tmp/perf_plot.png`.

## Log Rotation

Logs are kept for 30 days. Old files are cleaned by:
```bash
find ~/dispatch/logs -name "perf-*.jsonl" -mtime +30 -delete
```
