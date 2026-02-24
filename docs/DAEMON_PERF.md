# Daemon Performance Monitoring (Future Work)

**Status:** Planned
**Created:** 2026-02-23

---

## Goal

Add comprehensive performance monitoring to the dispatch daemon to track latencies, throughput, and system health.

---

## Metrics to Track

### 1. Message Ingestion
- Poll cycle time (100ms target)
- Messages read per poll
- chat.db query latency
- Signal socket read latency

### 2. Contact Resolution
- Contacts CLI lookup time
- Tier determination time

### 3. Session Management
- Session create/resume latency
- inject_message queue time
- Time from inject → Claude API call

### 4. Claude Processing
- Time to first token
- Total response time
- Tool call count/latency

### 5. Response Delivery
- send-sms CLI latency
- Gemini vision analysis time (when images)

### 6. System Health
- Active session count
- Memory per session
- Queue depths

---

## Implementation Approach Options

### A) Structured Logging
Add timing logs, parse with grep/awk.
- Pros: Simple, no new deps
- Cons: Manual parsing, no aggregation

### B) Metrics Daemon
Separate process collecting via IPC.
- Pros: Isolated, can persist
- Cons: More complexity, IPC overhead

### C) SQLite Timeseries
Store in DB, query for dashboards.
- Pros: Simple queries, persistent
- Cons: Write overhead, schema management

### D) Prometheus (Recommended)
Industry standard metrics collection.
- Library: `prometheus-client` (PyPI)
- In-process: Yes, runs in daemon process
- Endpoint: Exposes `/metrics` on configurable port

```python
from prometheus_client import Counter, Histogram, start_http_server

# Define metrics
msg_processed = Counter('messages_processed_total', 'Messages processed')
inject_latency = Histogram('inject_latency_seconds', 'Time to inject message')

# Expose metrics endpoint
start_http_server(9090)  # /metrics on port 9090

# Use in code
with inject_latency.time():
    inject_message(...)
msg_processed.inc()
```

#### Prometheus Metric Types
- **Counter**: Only goes up (e.g., messages processed)
- **Gauge**: Up/down (e.g., active sessions)
- **Histogram**: Latency distributions with buckets
- **Summary**: Percentiles

#### Built-in Process Metrics
Auto-included: CPU usage, RAM, file descriptors, start time

#### Multiprocess Caveat
SDK sessions are separate processes. Options:
1. Use multiprocess mode in prometheus-client
2. Aggregate at scrape time
3. Separate metrics endpoint per session

---

## Next Steps

1. Add `prometheus-client` to pyproject.toml
2. Create `assistant/metrics.py` with metric definitions
3. Instrument key code paths in manager.py, sdk_backend.py
4. Expose `/metrics` endpoint (separate port from API)
5. Create `daemon-perf` skill for CLI access to metrics
6. (Optional) Set up Grafana dashboard

---

## Related Docs

- [MESSAGING_REFACTOR.md](./MESSAGING_REFACTOR.md) - Backend abstraction
- [CLAUDE.md](../CLAUDE.md) - Main system docs
