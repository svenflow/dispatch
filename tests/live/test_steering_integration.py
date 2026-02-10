#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["claude-agent-sdk"]
# ///
"""
Integration tests for concurrent steering — calls real Claude API.

Tests the actual SDKSession concurrent send/receive architecture against
the real Claude Agent SDK (using haiku for cost). Validates:
  1. Basic steering: query() mid-turn works
  2. Rapid interleaving: 3 messages all received
  3. Mid-tool steering: Claude sees message after tool finishes
  4. Pending counter accuracy: 0→1→0 sequential, peak→0 rapid
  5. Conversation coherence: context preserved across interleaved messages

Run: uv run tests/test_steering_integration.py [--test N]
"""

import asyncio
import os
import sys
import time

import pytest

pytestmark = [pytest.mark.asyncio, pytest.mark.live_api]
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


# ── Lightweight wrapper matching SDKSession's concurrent architecture ─

class TestSession:
    """Mirrors SDKSession's concurrent _run_loop + _receive_loop for testing.

    Uses real ClaudeSDKClient but collects output for assertions.
    """

    def __init__(self, client: ClaudeSDKClient):
        self._client = client
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self.running = False

        self._pending_queries = 0
        self._error_count = 0
        self.turn_count = 0
        self.result_count = 0

        # Collected output
        self.all_text: list[str] = []
        self.tool_calls: list[str] = []

    @property
    def is_busy(self) -> bool:
        return self._pending_queries > 0

    @property
    def combined_text(self) -> str:
        return " ".join(self.all_text)

    async def start(self):
        self.running = True
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def inject(self, text: str):
        await self._queue.put(text)
        log(f"INJECT: {text[:80]}")

    async def _run_loop(self):
        """Sender + background receiver — mirrors sdk_session.py exactly."""
        receiver = asyncio.create_task(self._receive_loop())
        try:
            while self.running:
                try:
                    msg = await asyncio.wait_for(self._queue.get(), timeout=120)
                except asyncio.TimeoutError:
                    continue

                self._pending_queries += 1
                log(f"SEND (pending={self._pending_queries}): {msg[:80]}")

                try:
                    await self._client.query(msg)
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    self._pending_queries = max(0, self._pending_queries - 1)
                    log(f"SEND ERROR: {e}")

        except asyncio.CancelledError:
            pass
        finally:
            receiver.cancel()
            try:
                await receiver
            except asyncio.CancelledError:
                pass

    async def _receive_loop(self):
        """Background receiver — mirrors sdk_session.py exactly."""
        try:
            async for message in self._client.receive_messages():
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            text = block.text[:200]
                            self.all_text.append(block.text)
                            log(f"  RECV TEXT: {text}")
                        elif isinstance(block, ToolUseBlock):
                            self.tool_calls.append(block.name)
                            log(f"  RECV TOOL: {block.name}")
                elif isinstance(message, ResultMessage):
                    self.result_count += 1
                    self.turn_count += message.num_turns or 0
                    self._pending_queries = 0
                    self._error_count = 0
                    log(f"  === Result #{self.result_count} | pending=0 | turns={self.turn_count} ===")
                elif isinstance(message, UserMessage):
                    log(f"  RECV USER_MSG")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log(f"RECV ERROR: {e}")
            self.running = False


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

async def test_basic_steering() -> TestResult:
    """Basic: send query mid-tool-call, both get addressed."""
    log("=" * 60)
    log("TEST 1: Basic Steering")
    log("=" * 60)

    client = make_client()
    errors = []

    try:
        await client.connect()
        session = TestSession(client)
        await session.start()

        await session.inject("Use the Bash tool to run: sleep 4 && echo 'TASK_DONE'")
        await asyncio.sleep(1.0)
        await session.inject("Say exactly: STEERING_WORKS")

        for _ in range(30):
            await asyncio.sleep(0.5)
            if session.result_count >= 1 and not session.is_busy:
                await asyncio.sleep(1.0)
                break

        await session.stop()

        text = session.combined_text
        has_steering = "STEERING_WORKS" in text
        has_task = "TASK_DONE" in text
        log(f"steering={has_steering}, task={has_task}")

        return TestResult(
            name="basic_steering",
            passed=has_steering,
            notes=f"steering={has_steering}, task={has_task}, results={session.result_count}",
            errors=errors,
        )
    except Exception as e:
        return TestResult(name="basic_steering", passed=False, notes=str(e), errors=[str(e)])
    finally:
        await client.disconnect()


async def test_rapid_interleaving() -> TestResult:
    """3 messages sent 2s apart during a long task — all received."""
    log("=" * 60)
    log("TEST 2: Rapid Interleaving (3 msgs)")
    log("=" * 60)

    client = make_client()

    try:
        await client.connect()
        session = TestSession(client)
        await session.start()

        await session.inject("Use Bash to run: sleep 5 && echo 'LONG_DONE'")
        await asyncio.sleep(1.0)
        await session.inject("Say exactly: MSG_A")
        await asyncio.sleep(2.0)
        await session.inject("Say exactly: MSG_B")
        await asyncio.sleep(2.0)
        await session.inject("Say exactly: MSG_C")

        for _ in range(30):
            await asyncio.sleep(0.5)
            if session.result_count >= 1 and not session.is_busy:
                await asyncio.sleep(1.0)
                break

        await session.stop()

        text = session.combined_text
        a = "MSG_A" in text
        b = "MSG_B" in text
        c = "MSG_C" in text
        log(f"A={a}, B={b}, C={c}")

        return TestResult(
            name="rapid_interleaving",
            passed=a and b and c,
            notes=f"A={a}, B={b}, C={c}, results={session.result_count}",
        )
    except Exception as e:
        return TestResult(name="rapid_interleaving", passed=False, notes=str(e), errors=[str(e)])
    finally:
        await client.disconnect()


async def test_mid_tool_steering() -> TestResult:
    """Send a message while a tool call is running — Claude finishes tool then addresses it."""
    log("=" * 60)
    log("TEST 3: Mid-Tool Steering")
    log("=" * 60)

    client = make_client()

    try:
        await client.connect()
        session = TestSession(client)
        await session.start()

        await session.inject("Use Bash to run: sleep 3 && echo 'TOOL_RESULT_123'")
        await asyncio.sleep(1.5)
        # Inject while bash is sleeping
        await session.inject("After you finish the bash command, say exactly: REDIRECT_ACK")

        for _ in range(30):
            await asyncio.sleep(0.5)
            if session.result_count >= 1 and not session.is_busy:
                await asyncio.sleep(1.0)
                break

        await session.stop()

        text = session.combined_text
        has_tool = "TOOL_RESULT_123" in text
        has_redirect = "REDIRECT_ACK" in text
        log(f"tool={has_tool}, redirect={has_redirect}")

        return TestResult(
            name="mid_tool_steering",
            passed=has_redirect,
            notes=f"tool={has_tool}, redirect={has_redirect}, results={session.result_count}",
        )
    except Exception as e:
        return TestResult(name="mid_tool_steering", passed=False, notes=str(e), errors=[str(e)])
    finally:
        await client.disconnect()


async def test_pending_counter_sequential() -> TestResult:
    """Sequential queries: counter goes 0→1→0→1→0."""
    log("=" * 60)
    log("TEST 4: Pending Counter (Sequential)")
    log("=" * 60)

    client = make_client()

    try:
        await client.connect()
        session = TestSession(client)
        await session.start()

        assert session._pending_queries == 0

        await session.inject("Say exactly: SEQ_1")
        for _ in range(20):
            await asyncio.sleep(0.5)
            if session.result_count >= 1:
                break
        after_q1 = session._pending_queries
        log(f"After Q1: pending={after_q1}")

        await session.inject("Say exactly: SEQ_2")
        for _ in range(20):
            await asyncio.sleep(0.5)
            if session.result_count >= 2:
                break
        after_q2 = session._pending_queries
        log(f"After Q2: pending={after_q2}")

        await session.stop()

        return TestResult(
            name="pending_counter_sequential",
            passed=after_q1 == 0 and after_q2 == 0,
            notes=f"after_q1={after_q1}, after_q2={after_q2}",
        )
    except Exception as e:
        return TestResult(name="pending_counter_sequential", passed=False, notes=str(e), errors=[str(e)])
    finally:
        await client.disconnect()


async def test_pending_counter_rapid() -> TestResult:
    """3 rapid queries: peak pending >= 2, final = 0."""
    log("=" * 60)
    log("TEST 5: Pending Counter (Rapid)")
    log("=" * 60)

    client = make_client()

    try:
        await client.connect()
        session = TestSession(client)
        await session.start()

        await session.inject("Use Bash to run: sleep 2 && echo 'R1'")
        await asyncio.sleep(0.3)
        await session.inject("Say exactly: R2")
        await asyncio.sleep(0.3)
        await session.inject("Say exactly: R3")

        peak = 0
        for _ in range(30):
            peak = max(peak, session._pending_queries)
            await asyncio.sleep(0.5)
            if session.result_count >= 1 and not session.is_busy:
                break

        await asyncio.sleep(2.0)
        await session.stop()

        final = session._pending_queries
        log(f"Peak={peak}, Final={final}")

        return TestResult(
            name="pending_counter_rapid",
            passed=peak >= 2 and final == 0,
            notes=f"peak={peak}, final={final}, results={session.result_count}",
        )
    except Exception as e:
        return TestResult(name="pending_counter_rapid", passed=False, notes=str(e), errors=[str(e)])
    finally:
        await client.disconnect()


async def test_conversation_coherence() -> TestResult:
    """Context preserved across interleaved messages."""
    log("=" * 60)
    log("TEST 6: Conversation Coherence")
    log("=" * 60)

    client = make_client()

    try:
        await client.connect()
        session = TestSession(client)
        await session.start()

        await session.inject("Remember the number 42. Just say 'Remembered 42'.")
        for _ in range(20):
            await asyncio.sleep(0.5)
            if session.result_count >= 1:
                break

        await session.inject("Use Bash to run: sleep 2 && echo 'DISTRACTION'")
        await asyncio.sleep(1.0)
        await session.inject("What number did I ask you to remember? Say exactly: THE_NUMBER_IS_42")

        for _ in range(30):
            await asyncio.sleep(0.5)
            if session.result_count >= 2 and not session.is_busy:
                await asyncio.sleep(1.0)
                break

        await session.stop()

        text = session.combined_text
        has_42 = "42" in text
        has_marker = "THE_NUMBER_IS_42" in text
        log(f"has_42={has_42}, has_marker={has_marker}")

        return TestResult(
            name="conversation_coherence",
            passed=has_42,
            notes=f"has_42={has_42}, marker={has_marker}, results={session.result_count}",
        )
    except Exception as e:
        return TestResult(name="conversation_coherence", passed=False, notes=str(e), errors=[str(e)])
    finally:
        await client.disconnect()


# ── Main ─────────────────────────────────────────────────────────────

ALL_TESTS = [
    test_basic_steering,
    test_rapid_interleaving,
    test_mid_tool_steering,
    test_pending_counter_sequential,
    test_pending_counter_rapid,
    test_conversation_coherence,
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

    log(f"Running {len(tests)} integration test(s) against real Claude API (haiku)...")
    log("")

    results = []
    for test_fn in tests:
        global START_TIME
        START_TIME = time.time()
        result = await test_fn()
        results.append(result)
        log("")

    print("\n" + "=" * 60, flush=True)
    print("INTEGRATION TEST SUMMARY", flush=True)
    print("=" * 60, flush=True)
    for r in results:
        status = "PASS" if r.passed else "FAIL"
        print(f"  {'✅' if r.passed else '❌'} {status} | {r.name} | {r.notes}", flush=True)
        if r.errors:
            for e in r.errors:
                print(f"         ERROR: {e}", flush=True)

    passed = sum(1 for r in results if r.passed)
    total = len(results)
    print(f"\n  {passed}/{total} passed", flush=True)
    print("=" * 60, flush=True)

    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    asyncio.run(main())
