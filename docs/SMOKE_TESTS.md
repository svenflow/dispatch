# Smoke Tests: Performance & Reliability

Manual integration tests for the claude-assistant system. These test real integrations (iMessage, Signal, Agent SDK) that can't be covered by unit tests with mocks.

## How to Run

```bash
cd ~/code/claude-assistant
uv run python tests/smoke/run_smoke_tests.py
```

Each test prints PASS/FAIL with timing. Tests that hit the Claude API are marked `[API]` and cost credits.

---

## Test 1: iMessage Send Latency

**What:** Measure send-sms → chat.db write time.
**Why:** Validates AppleScript bridge isn't degrading.
**How:**
1. Record current max ROWID in chat.db
2. Send test message via `send-sms` to own number
3. Poll chat.db for new ROWID
4. Verify `is_from_me=1` (loop prevention)
5. Report: send time, db write time, total

**Expected:** <500ms total. `is_from_me=1` always.

---

## Test 2: Signal Send Latency

**What:** Measure send-signal → JSON-RPC response time.
**Why:** Validates signal-cli socket health.
**How:**
1. Send test message via `send-signal` to own number (use signal.account from config.local.yaml)
2. Measure round-trip to JSON-RPC success response
3. Test socket connect/subscribe latency separately

**Expected:** <500ms send. <10ms socket subscribe.

---

## Test 3: Daemon Message Throughput

**What:** Burst test messages via TestMessageWatcher, measure processing rate.
**Why:** Validates the message pipeline doesn't bottleneck under load.
**How:**
1. Drop 20 JSON test messages into `~/.claude/test-messages/` simultaneously
2. Measure time until all files consumed (deleted by watcher)
3. Check daemon log for processing timestamps
4. Verify unknown contacts correctly rejected
5. Test with known contact (admin phone) - verify routing to session

**Expected:** All 20 picked up in <200ms. Per-message routing <10ms.

---

## Test 4: Agent SDK Lifecycle [API]

**What:** Full ClaudeSDKClient connect → query → response → disconnect cycle.
**Why:** Validates SDK integration works end-to-end.
**How:**
1. Create ClaudeSDKClient with minimal options
2. Measure connect time
3. Send simple query ("Respond with: PONG"), measure first response + total
4. Disconnect, measure cleanup time
5. Resume with session_id, verify context recall
6. Test concurrent: spin up 3 sessions simultaneously

**Expected:** Connect <2s. Query <3s. Resume recalls context. No crashes.

---

## Test 5: Interrupt & Failure Recovery [API]

**What:** Verify sessions survive interrupts and failures gracefully.
**Why:** Sessions must be resilient to network issues, timeouts, crashes.
**How:**
1. Start query, interrupt mid-response - verify session still usable
2. Start query, force disconnect - verify clean cleanup (no crash)
3. Post-interrupt query works normally

**Expected:** Interrupt <10ms. Post-interrupt query succeeds. No orphan processes.

---

## Test 6: Memory & Resource Leaks

**What:** Create/destroy SDK sessions repeatedly, check for leaks.
**Why:** Long-running daemon can't afford memory growth.
**How:**
1. Record baseline memory and async task count
2. Create and destroy 5 real SDK sessions (connect, query, disconnect)
3. Check memory delta and task count
4. Test registry: 20 entries with 2000 rapid updates, check file size
5. Verify no orphan async tasks

**Expected:** Memory delta <1MB. Task delta = 0. Registry stays compact.

---

## Test 7: Signal Socket Stress

**What:** Rapid connect/disconnect to signal-cli socket.
**Why:** Socket must handle reconnects (daemon health checks do this).
**How:**
1. Connect to /tmp/signal-cli.sock, send subscribe, verify response
2. Rapid 10x connect/disconnect cycle
3. Verify 0 failures

**Expected:** Subscribe <10ms. 10/10 connects succeed.

---

## Test 8: Registry Persistence Under Load

**What:** Verify registry survives rapid writes and process interruption.
**Why:** Registry is the source of truth for session state.
**How:**
1. Create temp registry with 20 entries
2. Run 100 rapid update_last_message_time cycles (2000 total writes)
3. Flush, verify all data intact
4. Verify file size is reasonable (<10KB for 20 entries)
5. Test debounce: 100 rapid updates should result in far fewer disk writes

**Expected:** All data preserved. File <10KB. Debounce working.

---

## Baseline Numbers (2026-02-01)

| Metric | Value |
|--------|-------|
| send-sms latency | 154ms |
| chat.db write latency | 111ms |
| Signal send latency | 294ms |
| Signal socket subscribe | 7ms |
| Daemon msg pickup (10 msgs) | <1ms |
| Daemon msg routing (per msg) | ~7ms |
| SDK connect | 1.3s |
| SDK first response | 29ms |
| SDK full query cycle | 1.5s |
| SDK disconnect | 8ms |
| SDK resume connect | 1.0s |
| Interrupt latency | 4ms |
| Force disconnect during query | 315ms |
| Memory per 5 session cycles | 368KB |
| Orphan tasks after cleanup | 0 |
| Registry 20 entries + 2000 updates | 6KB |
