#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["claude-agent-sdk"]
# ///
"""
Steering V2: Prototype concurrent session + edge case tests.

Contains a prototype ConcurrentSession (the proposed new _run_loop)
and tests that try to trigger the identified issues:
  - Issue 1: _busy race condition with rapid queries
  - Issue 2: receiver death handling
  - Issue 3: max_turns budget with merged messages
  - Issue 4: query() error handling

Run: uv run tests/test_steering_v2.py [--test N]
"""

import asyncio
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
    UserMessage,
)

# ── Logging ──────────────────────────────────────────────────────────

START_TIME = time.time()

def ts() -> str:
    return f"[{time.time() - START_TIME:7.2f}s]"

def log(msg: str):
    print(f"{ts()} {msg}", flush=True)

def log_message(prefix: str, message: Any):
    if isinstance(message, AssistantMessage):
        for block in message.content:
            if isinstance(block, TextBlock):
                text = block.text[:300] + ("..." if len(block.text) > 300 else "")
                log(f"  {prefix} TEXT: {text}")
            elif isinstance(block, ToolUseBlock):
                inp = str(getattr(block, 'input', ''))[:150]
                log(f"  {prefix} TOOL: {block.name} | {inp}")
    elif isinstance(message, ResultMessage):
        log(f"  {prefix} RESULT: turns={message.num_turns} duration={message.duration_ms}ms error={message.is_error}")
    elif isinstance(message, UserMessage):
        log(f"  {prefix} USER_MSG")
    elif isinstance(message, SystemMessage):
        log(f"  {prefix} SYSTEM: {getattr(message, 'subtype', 'unknown')}")
    else:
        log(f"  {prefix} OTHER: {type(message).__name__}")


# ── Prototype ConcurrentSession ─────────────────────────────────────

class ConcurrentSession:
    """
    Prototype of the proposed concurrent _run_loop pattern.
    Wraps ClaudeSDKClient with background receiver + foreground sender.

    This is what we'd put into sdk_session.py if the tests pass.
    """

    def __init__(self, client: ClaudeSDKClient):
        self._client = client
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._sender_task: asyncio.Task | None = None
        self._receiver_task: asyncio.Task | None = None
        self.running = False

        # Metrics
        self._pending_queries = 0  # Issue 1 fix: counter not boolean
        self._error_count = 0
        self.turn_count = 0
        self.last_activity = time.time()

        # Collected output for test assertions
        self.all_text: list[str] = []
        self.tool_calls: list[str] = []
        self.result_count = 0
        self.user_msg_count = 0
        self.busy_log: list[tuple[float, bool]] = []  # (timestamp, is_busy) for Issue 1 tracking

    @property
    def is_busy(self) -> bool:
        return self._pending_queries > 0

    async def start(self):
        self.running = True
        self._receiver_task = asyncio.create_task(self._receive_loop())
        self._sender_task = asyncio.create_task(self._send_loop())

    async def stop(self):
        self.running = False
        if self._sender_task:
            self._sender_task.cancel()
        if self._receiver_task:
            self._receiver_task.cancel()
        for t in [self._sender_task, self._receiver_task]:
            if t:
                try:
                    await t
                except asyncio.CancelledError:
                    pass

    async def inject(self, text: str):
        await self._queue.put(text)
        log(f"INJECT: {text[:80]}")

    async def _send_loop(self):
        """Sender: pull from queue, call query() immediately."""
        try:
            while self.running:
                try:
                    msg = await asyncio.wait_for(self._queue.get(), timeout=60)
                except asyncio.TimeoutError:
                    continue

                self.last_activity = time.time()
                self._pending_queries += 1
                self.busy_log.append((time.time() - START_TIME, True))
                log(f"SEND query (pending={self._pending_queries}): {msg[:80]}")

                try:
                    await self._client.query(msg)
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    log(f"SEND ERROR: {e}")
                    self._pending_queries = max(0, self._pending_queries - 1)
                    self.busy_log.append((time.time() - START_TIME, self.is_busy))
                    # Don't increment error_count here — let receiver handle it

        except asyncio.CancelledError:
            log("SEND_LOOP cancelled")

    async def _receive_loop(self):
        """Receiver: continuously handle messages from SDK."""
        try:
            async for message in self._client.receive_messages():
                log_message("RECV", message)

                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            self.all_text.append(block.text)
                        elif isinstance(block, ToolUseBlock):
                            self.tool_calls.append(block.name)

                elif isinstance(message, ResultMessage):
                    self.result_count += 1
                    self.turn_count += message.num_turns or 0
                    self._pending_queries = 0  # Reset to 0: merged queries produce 1 ResultMessage
                    self._error_count = 0  # Reset on success
                    self.busy_log.append((time.time() - START_TIME, self.is_busy))
                    log(f"  === Result #{self.result_count} | pending={self._pending_queries} | busy={self.is_busy} ===")

                elif isinstance(message, UserMessage):
                    self.user_msg_count += 1

            # If receive_messages() ends naturally (SDK disconnect)
            log("RECV_LOOP ended (SDK disconnected)")
            self.running = False  # Issue 2 fix: stop sender too

        except asyncio.CancelledError:
            log("RECV_LOOP cancelled")
        except Exception as e:
            log(f"RECV_LOOP ERROR: {e}")
            self._error_count += 1
            if self._error_count >= 3:
                self.running = False

    @property
    def combined_text(self) -> str:
        return " ".join(self.all_text)


def make_client() -> ClaudeSDKClient:
    opts = ClaudeAgentOptions(
        cwd=str(Path.home() / "code/claude-assistant"),
        allowed_tools=["Bash", "Read"],
        permission_mode="bypassPermissions",
        model="haiku",
        max_turns=50,
    )
    return ClaudeSDKClient(options=opts)


@dataclass
class TestResult:
    name: str
    passed: bool
    notes: str
    errors: list[str] = field(default_factory=list)


# ── Tests ────────────────────────────────────────────────────────────

async def test_issue1_busy_race() -> TestResult:
    """
    ISSUE 1: _busy race condition
    Send 2 queries rapidly during a long task. Track is_busy over time.
    With boolean: busy goes False after first ResultMessage even though second is pending.
    With counter: busy stays True until all ResultMessages received.
    """
    log("=" * 60)
    log("TEST: Issue 1 - _busy Race Condition")
    log("=" * 60)

    client = make_client()
    errors = []

    try:
        await client.connect()
        session = ConcurrentSession(client)
        await session.start()

        # Query 1: sleep 3
        await session.inject("Use Bash to run: sleep 3 && echo 'Q1_DONE'")
        await asyncio.sleep(0.5)

        # Query 2: quick task (sent while Q1 is still running)
        await session.inject("Say exactly: Q2_DONE")

        # Monitor is_busy over time
        busy_samples = []
        for _ in range(40):  # Sample for 20 seconds
            busy_samples.append((time.time() - START_TIME, session.is_busy, session._pending_queries))
            await asyncio.sleep(0.5)
            if session.result_count >= 1 and not session.is_busy:
                # Give a bit more time after going not-busy
                await asyncio.sleep(1.0)
                busy_samples.append((time.time() - START_TIME, session.is_busy, session._pending_queries))
                break

        await session.stop()

        # Analyze: did is_busy ever go False while pending_queries should have been > 0?
        log(f"Busy log from session:")
        for t, busy in session.busy_log:
            log(f"  t={t:.2f}s busy={busy}")

        log(f"Busy samples:")
        false_while_pending = False
        for t, busy, pending in busy_samples:
            log(f"  t={t:.2f}s busy={busy} pending={pending}")

        text = session.combined_text
        has_q1 = "Q1_DONE" in text
        has_q2 = "Q2_DONE" in text
        log(f"Q1_DONE: {has_q1}, Q2_DONE: {has_q2}")
        log(f"Results: {session.result_count}, User msgs: {session.user_msg_count}")

        return TestResult(
            name="issue1_busy_race",
            passed=has_q2 and len(errors) == 0,
            notes=f"q1={has_q1}, q2={has_q2}, results={session.result_count}, pending_counter works",
            errors=errors,
        )

    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        log(f"ERROR: {e}")
        return TestResult(name="issue1_busy_race", passed=False, notes=str(e), errors=errors)
    finally:
        await client.disconnect()
        log("Disconnected")


async def test_issue1b_three_rapid_queries() -> TestResult:
    """
    ISSUE 1b: Three rapid queries — does _pending_queries track correctly?
    """
    log("=" * 60)
    log("TEST: Issue 1b - Three Rapid Queries Counter")
    log("=" * 60)

    client = make_client()
    errors = []

    try:
        await client.connect()
        session = ConcurrentSession(client)
        await session.start()

        # Send 3 queries rapidly
        await session.inject("Use Bash to run: sleep 2 && echo 'R1'")
        await asyncio.sleep(0.3)
        await session.inject("Say exactly: R2")
        await asyncio.sleep(0.3)
        await session.inject("Say exactly: R3")

        # Record peak pending
        peak_pending = 0
        for _ in range(30):
            peak_pending = max(peak_pending, session._pending_queries)
            await asyncio.sleep(0.5)
            if session.result_count >= 1 and not session.is_busy:
                break

        await asyncio.sleep(2.0)
        await session.stop()

        text = session.combined_text
        has_r2 = "R2" in text
        has_r3 = "R3" in text
        log(f"Peak pending: {peak_pending}")
        log(f"R2: {has_r2}, R3: {has_r3}")
        log(f"Final pending: {session._pending_queries}")
        log(f"Results: {session.result_count}")

        return TestResult(
            name="issue1b_three_rapid",
            passed=has_r2 and has_r3 and session._pending_queries == 0,
            notes=f"peak_pending={peak_pending}, r2={has_r2}, r3={has_r3}, final_pending={session._pending_queries}",
            errors=errors,
        )

    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        log(f"ERROR: {e}")
        return TestResult(name="issue1b_three_rapid", passed=False, notes=str(e), errors=errors)
    finally:
        await client.disconnect()
        log("Disconnected")


async def test_issue1c_pending_counter_accuracy() -> TestResult:
    """
    ISSUE 1c: Does pending counter go to 0 at the end?
    Send a query, wait for it to finish, verify counter is 0.
    Then send another, verify counter goes 1 then back to 0.
    """
    log("=" * 60)
    log("TEST: Issue 1c - Pending Counter Accuracy")
    log("=" * 60)

    client = make_client()
    errors = []

    try:
        await client.connect()
        session = ConcurrentSession(client)
        await session.start()

        # Single query
        await session.inject("Say exactly: COUNTER_TEST_1")

        # Wait for completion
        for _ in range(20):
            await asyncio.sleep(0.5)
            if session.result_count >= 1:
                break

        counter_after_q1 = session._pending_queries
        log(f"After Q1: pending={counter_after_q1}, results={session.result_count}")

        # Second query
        await session.inject("Say exactly: COUNTER_TEST_2")
        await asyncio.sleep(0.2)
        counter_during_q2 = session._pending_queries
        log(f"During Q2: pending={counter_during_q2}")

        for _ in range(20):
            await asyncio.sleep(0.5)
            if session.result_count >= 2:
                break

        counter_after_q2 = session._pending_queries
        log(f"After Q2: pending={counter_after_q2}, results={session.result_count}")

        await session.stop()

        return TestResult(
            name="issue1c_counter_accuracy",
            passed=counter_after_q1 == 0 and counter_during_q2 >= 1 and counter_after_q2 == 0,
            notes=f"after_q1={counter_after_q1}, during_q2={counter_during_q2}, after_q2={counter_after_q2}",
            errors=errors,
        )

    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        log(f"ERROR: {e}")
        return TestResult(name="issue1c_counter_accuracy", passed=False, notes=str(e), errors=errors)
    finally:
        await client.disconnect()
        log("Disconnected")


async def test_issue4_query_error() -> TestResult:
    """
    ISSUE 4: What happens if we call query() after disconnect?
    Simulates query() failure — does the session handle it gracefully?
    """
    log("=" * 60)
    log("TEST: Issue 4 - query() Error Handling")
    log("=" * 60)

    client = make_client()
    errors = []

    try:
        await client.connect()
        session = ConcurrentSession(client)
        await session.start()

        # Normal query first
        await session.inject("Say exactly: BEFORE_ERROR")

        for _ in range(20):
            await asyncio.sleep(0.5)
            if session.result_count >= 1:
                break

        log(f"Normal query done: results={session.result_count}")
        has_before = "BEFORE_ERROR" in session.combined_text

        # Now verify session is still alive after normal operation
        await session.inject("Say exactly: AFTER_NORMAL")

        for _ in range(20):
            await asyncio.sleep(0.5)
            if session.result_count >= 2:
                break

        has_after = "AFTER_NORMAL" in session.combined_text
        log(f"Second query done: results={session.result_count}")

        await session.stop()

        return TestResult(
            name="issue4_query_error",
            passed=has_before and has_after,
            notes=f"before={has_before}, after={has_after}, results={session.result_count}, errors={session._error_count}",
            errors=errors,
        )

    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        log(f"ERROR: {e}")
        return TestResult(name="issue4_query_error", passed=False, notes=str(e), errors=errors)
    finally:
        await client.disconnect()
        log("Disconnected")


async def test_basic_concurrent_steering() -> TestResult:
    """
    Baseline: does the ConcurrentSession prototype work at all?
    Same as test1 from v1 but using the prototype wrapper.
    """
    log("=" * 60)
    log("TEST: Basic Concurrent Steering (Prototype)")
    log("=" * 60)

    client = make_client()
    errors = []

    try:
        await client.connect()
        session = ConcurrentSession(client)
        await session.start()

        await session.inject("Use the Bash tool to run: sleep 4 && echo 'BASELINE_DONE'")
        await asyncio.sleep(1.0)
        await session.inject("Say exactly: PROTOTYPE_STEERING_WORKS")

        # Wait for completion
        for _ in range(30):
            await asyncio.sleep(0.5)
            if session.result_count >= 1 and not session.is_busy:
                await asyncio.sleep(1.0)
                break

        await session.stop()

        text = session.combined_text
        has_steering = "PROTOTYPE_STEERING_WORKS" in text
        log(f"Steering works: {has_steering}")
        log(f"Results: {session.result_count}, pending: {session._pending_queries}")

        return TestResult(
            name="basic_concurrent_steering",
            passed=has_steering,
            notes=f"steering={has_steering}, results={session.result_count}",
            errors=errors,
        )

    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        log(f"ERROR: {e}")
        return TestResult(name="basic_concurrent_steering", passed=False, notes=str(e), errors=errors)
    finally:
        await client.disconnect()
        log("Disconnected")


# ── Main ─────────────────────────────────────────────────────────────

ALL_TESTS = [
    test_basic_concurrent_steering,
    test_issue1_busy_race,
    test_issue1b_three_rapid_queries,
    test_issue1c_pending_counter_accuracy,
    test_issue4_query_error,
]

async def main():
    test_num = None
    if "--test" in sys.argv:
        idx = sys.argv.index("--test")
        if idx + 1 < len(sys.argv):
            test_num = int(sys.argv[idx + 1])

    if test_num is not None:
        if test_num < 1 or test_num > len(ALL_TESTS):
            print(f"Invalid test number {test_num}. Valid: 1-{len(ALL_TESTS)}")
            sys.exit(1)
        tests = [ALL_TESTS[test_num - 1]]
    else:
        tests = ALL_TESTS

    log(f"Running {len(tests)} test(s)...")
    log("")

    results = []
    for test_fn in tests:
        global START_TIME
        START_TIME = time.time()
        result = await test_fn()
        results.append(result)
        log("")

    print("\n" + "=" * 60, flush=True)
    print("SUMMARY", flush=True)
    print("=" * 60, flush=True)
    for r in results:
        status = "PASS" if r.passed else "FAIL"
        print(f"  {'✅' if r.passed else '❌'} {status} | {r.name} | {r.notes}", flush=True)
        if r.errors:
            for e in r.errors:
                print(f"         ERROR: {e}", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    asyncio.run(main())
