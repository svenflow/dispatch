#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["claude-agent-sdk"]
# ///
"""
Steering Experiment: Concurrent send/receive pattern from official SDK docs.

Uses the blessed pattern from streaming_mode.py:
- Background task: receive_messages() continuously
- Foreground: query() whenever new messages arrive

Run: uv run tests/test_steering.py [--test N]
"""

import asyncio
import contextlib
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

pytestmark = [pytest.mark.asyncio, pytest.mark.live_api]

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

# ── Logging helpers ──────────────────────────────────────────────────

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
    elif isinstance(message, SystemMessage):
        log(f"  {prefix} SYSTEM: {getattr(message, 'subtype', 'unknown')}")
    elif isinstance(message, UserMessage):
        log(f"  {prefix} USER_MSG (mid-turn injection)")
    else:
        log(f"  {prefix} OTHER: {type(message).__name__}")


# ── Test infrastructure ──────────────────────────────────────────────

@dataclass
class TestResult:
    name: str
    passed: bool
    notes: str
    errors: list[str] = field(default_factory=list)


def make_client(cwd: str | None = None) -> ClaudeSDKClient:
    opts = ClaudeAgentOptions(
        cwd=cwd or str(Path.home() / "code/claude-assistant"),
        allowed_tools=["Bash", "Read"],
        permission_mode="bypassPermissions",
        model="haiku",
        max_turns=50,
    )
    return ClaudeSDKClient(options=opts)


class MessageCollector:
    """Background receiver that collects all messages."""

    def __init__(self, client: ClaudeSDKClient):
        self.client = client
        self.all_text: list[str] = []
        self.tool_calls: list[str] = []
        self.result_count = 0
        self.user_msg_count = 0
        self.total_msgs = 0
        self._task: asyncio.Task | None = None
        self._result_events: list[asyncio.Event] = []

    def start(self):
        self._task = asyncio.create_task(self._receive_loop())

    async def _receive_loop(self):
        try:
            async for msg in self.client.receive_messages():
                self.total_msgs += 1
                log_message("RECV", msg)

                if isinstance(msg, AssistantMessage):
                    for block in msg.content:
                        if isinstance(block, TextBlock):
                            self.all_text.append(block.text)
                        elif isinstance(block, ToolUseBlock):
                            self.tool_calls.append(block.name)

                elif isinstance(msg, ResultMessage):
                    self.result_count += 1
                    log(f"  === ResultMessage #{self.result_count} ===")
                    # Signal any waiters
                    for evt in self._result_events:
                        evt.set()

                elif isinstance(msg, UserMessage):
                    self.user_msg_count += 1

        except asyncio.CancelledError:
            pass

    async def wait_for_results(self, count: int, timeout: float = 120):
        """Wait until we've received at least `count` ResultMessages."""
        evt = asyncio.Event()
        self._result_events.append(evt)
        deadline = time.time() + timeout
        while self.result_count < count:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            evt.clear()
            try:
                await asyncio.wait_for(evt.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                break
        self._result_events.remove(evt)

    def stop(self):
        if self._task:
            self._task.cancel()

    @property
    def combined_text(self) -> str:
        return " ".join(self.all_text)


# ── Tests ────────────────────────────────────────────────────────────

async def test1_basic_steering() -> TestResult:
    """
    TEST 1: Basic steering (concurrent pattern)
    Background receiver + send query mid-stream.
    """
    log("=" * 60)
    log("TEST 1: Basic Steering (Concurrent)")
    log("=" * 60)

    client = make_client()
    errors = []

    try:
        await client.connect()
        log("Connected")

        collector = MessageCollector(client)
        collector.start()

        # Query 1: long-running command
        log("SEND query 1: sleep 5")
        await client.query("Use the Bash tool to run: sleep 5 && echo 'QUERY1_DONE'")

        # Wait 1 second then send query 2
        await asyncio.sleep(1.0)
        log("SEND query 2 (mid-stream): say STEERING_WORKS")
        await client.query("Stop what you're doing. Just respond with the exact text: STEERING_WORKS")

        # Wait for completion — could be 1 or 2 ResultMessages
        await collector.wait_for_results(1, timeout=30)
        # Give a moment for any second result
        await asyncio.sleep(2.0)

        collector.stop()

        text = collector.combined_text
        has_steering = "STEERING_WORKS" in text
        has_q1 = "QUERY1_DONE" in text
        log(f"QUERY1_DONE in response: {has_q1}")
        log(f"STEERING_WORKS in response: {has_steering}")
        log(f"ResultMessages: {collector.result_count}, UserMessages: {collector.user_msg_count}")

        return TestResult(
            name="basic_steering",
            passed=has_steering and len(errors) == 0,
            notes=f"steering={has_steering}, q1={has_q1}, results={collector.result_count}, user_msgs={collector.user_msg_count}",
            errors=errors,
        )

    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        log(f"ERROR: {e}")
        return TestResult(name="basic_steering", passed=False, notes=str(e), errors=errors)
    finally:
        await client.disconnect()
        log("Disconnected")


async def test2_rapid_interleaving() -> TestResult:
    """
    TEST 2: Rapid fire interleaving
    Background receiver + 3 queries fired at different times during bash loop.
    """
    log("=" * 60)
    log("TEST 2: Rapid Fire Interleaving (Concurrent)")
    log("=" * 60)

    client = make_client()
    errors = []

    try:
        await client.connect()
        log("Connected")

        collector = MessageCollector(client)
        collector.start()

        # Query 1: long bash loop
        log("SEND query 1: bash loop (6s)")
        await client.query(
            "Use the Bash tool to run: for i in 1 2 3; do sleep 2 && echo \"LOOP_$i\"; done"
        )

        # Fire 3 queries at different times
        await asyncio.sleep(1.0)
        log("SEND query 2 (t=1s)")
        await client.query("Say exactly: MSG_A_RECEIVED")

        await asyncio.sleep(2.0)
        log("SEND query 3 (t=3s)")
        await client.query("Say exactly: MSG_B_RECEIVED")

        await asyncio.sleep(2.0)
        log("SEND query 4 (t=5s)")
        await client.query("Say exactly: MSG_C_RECEIVED")

        # Wait for at least 1 result, then some extra time
        await collector.wait_for_results(1, timeout=30)
        await asyncio.sleep(3.0)

        collector.stop()

        text = collector.combined_text
        found = {m: m in text for m in ["MSG_A_RECEIVED", "MSG_B_RECEIVED", "MSG_C_RECEIVED"]}
        for marker, present in found.items():
            log(f"  {'✅' if present else '❌'} {marker}")

        all_found = all(found.values())
        return TestResult(
            name="rapid_interleaving",
            passed=all_found and len(errors) == 0,
            notes=f"found={sum(found.values())}/3, results={collector.result_count}, user_msgs={collector.user_msg_count}",
            errors=errors,
        )

    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        log(f"ERROR: {e}")
        return TestResult(name="rapid_interleaving", passed=False, notes=str(e), errors=errors)
    finally:
        await client.disconnect()
        log("Disconnected")


async def test3_steering_mid_tool_use() -> TestResult:
    """
    TEST 3: Steering mid-tool-use
    Start a multi-step tool chain, then redirect mid-chain.
    Does Claude pivot or finish the chain?
    """
    log("=" * 60)
    log("TEST 3: Steering Mid-Tool-Use (Concurrent)")
    log("=" * 60)

    client = make_client()
    errors = []

    try:
        await client.connect()
        log("Connected")

        collector = MessageCollector(client)
        collector.start()

        # Query 1: 4-step bash chain
        log("SEND query 1: 4-step bash chain")
        await client.query(
            "Do these steps one at a time: "
            "1) Use Bash to run 'ls /tmp' "
            "2) Use Bash to run 'sleep 3 && echo step2' "
            "3) Use Bash to run 'echo step3' "
            "4) Use Bash to run 'echo ALL_STEPS_DONE'"
        )

        # After 2s, redirect
        await asyncio.sleep(2.0)
        log("SEND query 2: REDIRECT")
        await client.query(
            "STOP what you're doing. Ignore all previous steps. Just say exactly: REDIRECTED_SUCCESSFULLY"
        )

        await collector.wait_for_results(1, timeout=60)
        await asyncio.sleep(2.0)
        collector.stop()

        text = collector.combined_text
        redirected = "REDIRECTED_SUCCESSFULLY" in text
        completed_all = "ALL_STEPS_DONE" in text

        log(f"Redirect acknowledged: {redirected}")
        log(f"Completed all original steps: {completed_all}")
        log(f"Tool calls: {collector.tool_calls}")
        log(f"Bash calls: {sum(1 for t in collector.tool_calls if t == 'Bash')}")

        return TestResult(
            name="steering_mid_tool_use",
            passed=len(errors) == 0,
            notes=f"redirected={redirected}, completed_all={completed_all}, bash_calls={sum(1 for t in collector.tool_calls if t == 'Bash')}",
            errors=errors,
        )

    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        log(f"ERROR: {e}")
        return TestResult(name="steering_mid_tool_use", passed=False, notes=str(e), errors=errors)
    finally:
        await client.disconnect()
        log("Disconnected")


async def test4_conflicting_instructions() -> TestResult:
    """
    TEST 4: Conflicting instructions
    Send two conflicting file writes nearly simultaneously.
    Which wins?
    """
    log("=" * 60)
    log("TEST 4: Conflicting Instructions (Concurrent)")
    log("=" * 60)

    client = make_client()
    errors = []
    test_file = "/tmp/steering_test_conflict.txt"

    try:
        await client.connect()
        log("Connected")

        collector = MessageCollector(client)
        collector.start()

        log("SEND query 1: write ALPHA")
        await client.query(
            f"Use Bash to run: echo 'ALPHA' > {test_file} && echo 'WROTE_ALPHA'"
        )

        await asyncio.sleep(0.1)
        log("SEND query 2: write BETA")
        await client.query(
            f"Use Bash to run: echo 'BETA' > {test_file} && echo 'WROTE_BETA'"
        )

        await collector.wait_for_results(1, timeout=30)
        await asyncio.sleep(2.0)
        collector.stop()

        result = subprocess.run(["cat", test_file], capture_output=True, text=True)
        final_content = result.stdout.strip()
        text = collector.combined_text
        wrote_alpha = "WROTE_ALPHA" in text
        wrote_beta = "WROTE_BETA" in text

        log(f"Final file content: '{final_content}'")
        log(f"WROTE_ALPHA: {wrote_alpha}")
        log(f"WROTE_BETA: {wrote_beta}")

        return TestResult(
            name="conflicting_instructions",
            passed=len(errors) == 0,
            notes=f"final='{final_content}', alpha={wrote_alpha}, beta={wrote_beta}",
            errors=errors,
        )

    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        log(f"ERROR: {e}")
        return TestResult(name="conflicting_instructions", passed=False, notes=str(e), errors=errors)
    finally:
        await client.disconnect()
        log("Disconnected")


async def test5_conversation_coherence() -> TestResult:
    """
    TEST 5: Conversation coherence
    Establish context, start long task, ask about context mid-task.
    """
    log("=" * 60)
    log("TEST 5: Conversation Coherence (Concurrent)")
    log("=" * 60)

    client = make_client()
    errors = []

    try:
        await client.connect()
        log("Connected")

        collector = MessageCollector(client)
        collector.start()

        # Establish context
        log("SEND query 1: remember 42")
        await client.query("Remember this secret number: 42. Just say 'OK remembered.'")

        await collector.wait_for_results(1, timeout=15)
        log("Query 1 done")

        # Start long task
        log("SEND query 2: counting loop")
        await client.query(
            "Use Bash to run: for i in $(seq 1 5); do sleep 1 && echo \"counting $i\"; done"
        )

        # Mid-task, ask about the number
        await asyncio.sleep(2.0)
        log("SEND query 3: recall number")
        await client.query("What was the secret number I told you to remember? Just say the number.")

        # Wait for query 2+3 to complete (merged into one turn)
        await collector.wait_for_results(2, timeout=30)
        await asyncio.sleep(2.0)
        collector.stop()

        text = collector.combined_text
        remembered = "42" in text

        log(f"Remembered 42: {remembered}")
        log(f"Results: {collector.result_count}, User msgs: {collector.user_msg_count}")

        return TestResult(
            name="conversation_coherence",
            passed=remembered and len(errors) == 0,
            notes=f"remembered_42={remembered}, results={collector.result_count}",
            errors=errors,
        )

    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        log(f"ERROR: {e}")
        return TestResult(name="conversation_coherence", passed=False, notes=str(e), errors=errors)
    finally:
        await client.disconnect()
        log("Disconnected")


async def test6_queue_depth_stress() -> TestResult:
    """
    TEST 6: Queue depth stress
    Send a blocking command, then rapidly fire 10 messages.
    Are all delivered?
    """
    log("=" * 60)
    log("TEST 6: Queue Depth Stress (Concurrent)")
    log("=" * 60)

    client = make_client()
    errors = []

    try:
        await client.connect()
        log("Connected")

        collector = MessageCollector(client)
        collector.start()

        log("SEND query 1: sleep 8")
        await client.query("Use Bash to run: sleep 8 && echo 'BLOCKING_DONE'")

        await asyncio.sleep(0.5)
        for i in range(10):
            log(f"SEND query {i+2}: STRESS_{i}")
            await client.query(f"Say exactly: STRESS_{i}")
            await asyncio.sleep(0.05)

        # Wait generously
        await collector.wait_for_results(1, timeout=60)
        await asyncio.sleep(5.0)
        collector.stop()

        text = collector.combined_text
        received = [i for i in range(10) if f"STRESS_{i}" in text]

        log(f"Stress messages received: {received} ({len(received)}/10)")
        log(f"Results: {collector.result_count}")

        return TestResult(
            name="queue_depth_stress",
            passed=len(received) >= 8 and len(errors) == 0,  # Allow some to merge
            notes=f"received={len(received)}/10, results={collector.result_count}",
            errors=errors,
        )

    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        log(f"ERROR: {e}")
        return TestResult(name="queue_depth_stress", passed=False, notes=str(e), errors=errors)
    finally:
        await client.disconnect()
        log("Disconnected")


# ── Main ─────────────────────────────────────────────────────────────

ALL_TESTS = [
    test1_basic_steering,
    test2_rapid_interleaving,
    test3_steering_mid_tool_use,
    test4_conflicting_instructions,
    test5_conversation_coherence,
    test6_queue_depth_stress,
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

    # Summary
    print("\n" + "=" * 60, flush=True)
    print("SUMMARY", flush=True)
    print("=" * 60, flush=True)
    for r in results:
        status = "✅ PASS" if r.passed else "❌ FAIL"
        print(f"  {status} | {r.name} | {r.notes}", flush=True)
        if r.errors:
            for e in r.errors:
                print(f"         ERROR: {e}", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    asyncio.run(main())
