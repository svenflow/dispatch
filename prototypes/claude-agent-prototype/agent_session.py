#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["claude-agent-sdk"]
# ///
"""
Prototype: Claude Agent SDK session manager using ClaudeSDKClient.
Tests all critical design considerations for the migration from tmux+CLI to SDK.

Usage:
    uv run agent_session.py <test_name>

Tests: inject, basic, interrupt, resume, concurrent, error, permission, all
"""

import asyncio
import logging
import sys
import time
from pathlib import Path

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("agent")

CWD = str(Path(__file__).parent)
MODEL = "claude-sonnet-4-5"
ALLOWED_TOOLS = ["Read", "Bash", "Glob", "Grep"]
QUERY_TIMEOUT = 30  # seconds per query


def make_options(**overrides) -> ClaudeAgentOptions:
    """Build default test options."""
    opts = dict(
        allowed_tools=ALLOWED_TOOLS,
        permission_mode="bypassPermissions",
        cwd=CWD,
        setting_sources=[],
        model=MODEL,
    )
    opts.update(overrides)
    return ClaudeAgentOptions(**opts)


class SDKSession:
    """Wraps ClaudeSDKClient with async message queue for injection."""

    def __init__(self, name: str, options: ClaudeAgentOptions, response_callback=None):
        self.name = name
        self.options = options
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.response_callback = response_callback
        self.session_id: str | None = None
        self.turn_count = 0
        self.total_cost = 0.0
        self.client: ClaudeSDKClient | None = None
        self._loop_task: asyncio.Task | None = None
        self._busy = False  # True while processing a query

    async def start(self, initial_prompt: str | None = None):
        """Start the session and run loop."""
        self.client = ClaudeSDKClient(options=self.options)
        await self.client.connect(prompt=initial_prompt)
        if initial_prompt:
            # Process the initial prompt response
            await self._drain_response()
        self._loop_task = asyncio.create_task(self._run_loop())
        log.info(f"[{self.name}] Session started")

    async def stop(self):
        """Stop the session."""
        if self._loop_task:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass
        if self.client:
            await self.client.disconnect()
        log.info(f"[{self.name}] Session stopped (turns={self.turn_count}, cost=${self.total_cost:.4f})")

    async def inject(self, text: str):
        """Queue a message for processing."""
        await self.queue.put(text)
        log.info(f"[{self.name}] Queued: {text[:80]}")

    @property
    def is_busy(self) -> bool:
        return self._busy

    async def _drain_response(self) -> list[str]:
        """Read all messages from receive_response(), return text parts."""
        texts = []
        async for msg in self.client.receive_response():
            texts.extend(self._process_message(msg))
        return texts

    def _process_message(self, message) -> list[str]:
        """Process a single message, return any text content."""
        texts = []
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    texts.append(block.text)
                    log.info(f"[{self.name}] Text: {block.text[:150]}")
                elif isinstance(block, ToolUseBlock):
                    log.info(f"[{self.name}] Tool: {block.name}")
        elif isinstance(message, ResultMessage):
            self.turn_count += message.num_turns or 0
            self.total_cost += message.total_cost_usd or 0
            if message.session_id:
                self.session_id = message.session_id
            log.info(
                f"[{self.name}] Turn done: turns={message.num_turns}, "
                f"cost=${message.total_cost_usd or 0:.4f}, "
                f"duration={message.duration_ms}ms, "
                f"error={message.is_error}, sid={message.session_id}"
            )
        elif isinstance(message, SystemMessage):
            log.info(f"[{self.name}] System: {message}")
        return texts

    async def _run_loop(self):
        """Pull from queue, send to client, drain response."""
        try:
            while True:
                msg = await self.queue.get()
                log.info(f"[{self.name}] Processing: {msg[:80]}")
                self._busy = True
                try:
                    await self.client.query(msg)
                    texts = await self._drain_response()
                    if self.response_callback:
                        full = "\n".join(texts)
                        await self.response_callback(self.name, full)
                except Exception as e:
                    log.error(f"[{self.name}] Query error: {e}")
                finally:
                    self._busy = False
        except asyncio.CancelledError:
            log.info(f"[{self.name}] Loop cancelled")
            raise


# ═══════════════════════════════════════════════════════════════
# TESTS
# ═══════════════════════════════════════════════════════════════


async def test_basic():
    """Test 1: Basic multi-turn with context preservation."""
    log.info("=" * 60)
    log.info("TEST: basic - Multi-turn with context preservation")
    log.info("=" * 60)

    responses = []

    async def on_resp(name, text):
        responses.append(text)

    session = SDKSession("basic", make_options(), response_callback=on_resp)
    try:
        await session.start()
        await session.inject("Remember: the secret word is PAPAYA. Just say OK.")
        await asyncio.sleep(QUERY_TIMEOUT)

        await session.inject("What was the secret word? Reply with just the word.")
        await asyncio.sleep(QUERY_TIMEOUT)

        await session.stop()

        has_ok = len(responses) >= 1
        has_papaya = any("papaya" in r.lower() for r in responses)
        passed = has_ok and has_papaya
        log.info(f"Responses: {len(responses)}, has_papaya={has_papaya}")
        for i, r in enumerate(responses):
            log.info(f"  Response {i}: {r[:200]}")
        log.info(f"TEST basic: {'PASS' if passed else 'FAIL'}")
        return passed
    except Exception as e:
        log.error(f"TEST basic: FAIL - {e}", exc_info=True)
        try:
            await session.stop()
        except Exception:
            pass
        return False


async def test_inject():
    """Test 2: CRITICAL - Async injection while agent is working."""
    log.info("=" * 60)
    log.info("TEST: inject - Async prompt injection while agent works")
    log.info("=" * 60)

    responses = []

    async def on_resp(name, text):
        responses.append(text)
        log.info(f"RESPONSE #{len(responses)}: {text[:150]}")

    session = SDKSession("inject", make_options(), response_callback=on_resp)
    try:
        await session.start()

        # Send a long task
        await session.inject(
            "Use the Bash tool to run: for i in $(seq 1 20); do echo \"Number: $i\"; sleep 0.5; done. "
            "Then say DONE_COUNTING."
        )

        # Wait a moment for it to start processing
        await asyncio.sleep(3)

        # Inject while busy - this should queue
        log.info(f"Agent busy? {session.is_busy}")
        await session.inject("After you finish counting, also say INJECTED_MESSAGE_RECEIVED.")

        # Wait for both to complete
        await asyncio.sleep(QUERY_TIMEOUT * 2)
        await session.stop()

        has_counting = any("DONE_COUNTING" in r for r in responses)
        has_injected = any("INJECTED" in r.upper() for r in responses)
        got_both = len(responses) >= 2

        log.info(f"Responses: {len(responses)}, counting={has_counting}, injected={has_injected}")
        for i, r in enumerate(responses):
            log.info(f"  Response {i}: {r[:200]}")

        passed = got_both and has_injected
        log.info(f"TEST inject: {'PASS' if passed else 'FAIL'}")
        return passed
    except Exception as e:
        log.error(f"TEST inject: FAIL - {e}", exc_info=True)
        try:
            await session.stop()
        except Exception:
            pass
        return False


async def test_interrupt():
    """Test 3: Interrupt a long-running task, verify session still works."""
    log.info("=" * 60)
    log.info("TEST: interrupt - Interrupt and continue")
    log.info("=" * 60)

    responses = []

    async def on_resp(name, text):
        responses.append(text)

    session = SDKSession("interrupt", make_options(), response_callback=on_resp)
    try:
        await session.start()

        # Start a long task
        await session.inject(
            "Use Bash to run: for i in $(seq 1 100); do echo $i; sleep 1; done"
        )

        # Wait for it to start, then interrupt
        await asyncio.sleep(5)
        log.info("Sending interrupt...")
        await session.client.interrupt()

        # Wait for the interrupt to settle
        await asyncio.sleep(5)

        # Clear busy state and queue a new message to verify session works
        session._busy = False
        await session.inject("Say INTERRUPT_RECOVERED if you can hear me.")
        await asyncio.sleep(QUERY_TIMEOUT)
        await session.stop()

        recovered = any("INTERRUPT_RECOVERED" in r for r in responses)
        log.info(f"Responses: {len(responses)}, recovered={recovered}")
        for i, r in enumerate(responses):
            log.info(f"  Response {i}: {r[:200]}")

        log.info(f"TEST interrupt: {'PASS' if recovered else 'FAIL'}")
        return recovered
    except Exception as e:
        log.error(f"TEST interrupt: FAIL - {e}", exc_info=True)
        try:
            await session.stop()
        except Exception:
            pass
        return False


async def test_resume():
    """Test 4: Session persistence via resume."""
    log.info("=" * 60)
    log.info("TEST: resume - Session persistence")
    log.info("=" * 60)

    responses = []

    async def on_resp(name, text):
        responses.append(text)

    # Session 1: establish context
    s1 = SDKSession("resume-1", make_options(), response_callback=on_resp)
    try:
        await s1.start()
        await s1.inject("Remember: the code is ZEBRA-42. Just say OK.")
        await asyncio.sleep(QUERY_TIMEOUT)
        sid = s1.session_id
        await s1.stop()
        log.info(f"Session 1 done, session_id={sid}")

        if not sid:
            log.error("No session_id captured")
            log.info("TEST resume: FAIL")
            return False

        # Session 2: resume and verify context
        responses.clear()
        s2 = SDKSession("resume-2", make_options(resume=sid), response_callback=on_resp)
        await s2.start()
        await s2.inject("What was the code I told you? Reply with just the code.")
        await asyncio.sleep(QUERY_TIMEOUT)
        await s2.stop()

        found = any("zebra" in r.lower() and "42" in r for r in responses)
        log.info(f"Responses: {len(responses)}, found_code={found}")
        for i, r in enumerate(responses):
            log.info(f"  Response {i}: {r[:200]}")

        log.info(f"TEST resume: {'PASS' if found else 'FAIL'}")
        return found
    except Exception as e:
        log.error(f"TEST resume: FAIL - {e}", exc_info=True)
        return False


async def test_concurrent():
    """Test 5: Multiple sessions simultaneously."""
    log.info("=" * 60)
    log.info("TEST: concurrent - 3 sessions simultaneously")
    log.info("=" * 60)

    results = {}

    async def run_one(name: str, word: str):
        resps = []

        async def on_resp(n, text):
            resps.append(text)

        s = SDKSession(name, make_options(), response_callback=on_resp)
        await s.start()
        await s.inject(f"Say the word '{word}' and nothing else.")
        await asyncio.sleep(QUERY_TIMEOUT)
        await s.stop()
        results[name] = any(word.lower() in r.lower() for r in resps)
        log.info(f"  {name}: got_word={results[name]}, responses={len(resps)}")

    try:
        await asyncio.gather(
            run_one("concurrent-A", "ALPHA"),
            run_one("concurrent-B", "BRAVO"),
            run_one("concurrent-C", "CHARLIE"),
        )

        all_pass = all(results.values()) and len(results) == 3
        log.info(f"TEST concurrent: {'PASS' if all_pass else 'FAIL'} - {results}")
        return all_pass
    except Exception as e:
        log.error(f"TEST concurrent: FAIL - {e}", exc_info=True)
        return False


async def test_error():
    """Test 6: Error recovery - verify client stays usable after error."""
    log.info("=" * 60)
    log.info("TEST: error - Error recovery")
    log.info("=" * 60)

    responses = []

    async def on_resp(name, text):
        responses.append(text)

    session = SDKSession("error", make_options(), response_callback=on_resp)
    try:
        await session.start()

        # Send something that might cause tool error
        await session.inject(
            "Use Bash to run: cat /nonexistent/file/that/does/not/exist. "
            "Then say ERROR_HANDLED."
        )
        await asyncio.sleep(QUERY_TIMEOUT)

        # Verify session still works
        await session.inject("Say STILL_ALIVE if you can hear me.")
        await asyncio.sleep(QUERY_TIMEOUT)
        await session.stop()

        alive = any("STILL_ALIVE" in r for r in responses)
        log.info(f"Responses: {len(responses)}, alive={alive}")
        log.info(f"TEST error: {'PASS' if alive else 'FAIL'}")
        return alive
    except Exception as e:
        log.error(f"TEST error: FAIL - {e}", exc_info=True)
        return False


async def test_permission():
    """Test 7: can_use_tool callback for tier-based security."""
    log.info("=" * 60)
    log.info("TEST: permission - can_use_tool callback")
    log.info("=" * 60)

    blocked_tools = []
    responses = []

    async def on_resp(name, text):
        responses.append(text)

    def permission_check(context):
        """Block Write tool, allow everything else."""
        from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny
        tool_name = context.tool_name
        if tool_name == "Write":
            blocked_tools.append(tool_name)
            log.info(f"BLOCKED tool: {tool_name}")
            return PermissionResultDeny(reason="Write tool is blocked for this tier")
        return PermissionResultAllow()

    opts = make_options(
        can_use_tool=permission_check,
        permission_mode="default",  # Need non-bypass for callback to matter
    )
    session = SDKSession("permission", opts, response_callback=on_resp)
    try:
        await session.start()
        await session.inject(
            "Try to use the Write tool to create /tmp/test_perm.txt with content 'hello'. "
            "If it's blocked, just say WRITE_BLOCKED."
        )
        await asyncio.sleep(QUERY_TIMEOUT)
        await session.stop()

        was_blocked = len(blocked_tools) > 0 or any("BLOCK" in r.upper() for r in responses)
        log.info(f"Blocked tools: {blocked_tools}, responses: {len(responses)}")
        log.info(f"TEST permission: {'PASS' if was_blocked else 'FAIL'}")
        return was_blocked
    except Exception as e:
        log.error(f"TEST permission: FAIL - {e}", exc_info=True)
        return False


TESTS = {
    "basic": test_basic,
    "inject": test_inject,
    "interrupt": test_interrupt,
    "resume": test_resume,
    "concurrent": test_concurrent,
    "error": test_error,
    "permission": test_permission,
}


async def main():
    test_name = sys.argv[1] if len(sys.argv) > 1 else "basic"

    if test_name == "all":
        results = {}
        for name, fn in TESTS.items():
            try:
                results[name] = await fn()
            except Exception as e:
                log.error(f"{name}: FAIL - {e}", exc_info=True)
                results[name] = False
        log.info("=" * 60)
        log.info("FINAL RESULTS:")
        for name, passed in results.items():
            log.info(f"  {name}: {'PASS' if passed else 'FAIL'}")
        total = sum(results.values())
        log.info(f"  {total}/{len(results)} passed")
    elif test_name in TESTS:
        result = await TESTS[test_name]()
        print(f"\n{'PASS' if result else 'FAIL'}: {test_name}")
    else:
        print(f"Unknown test: {test_name}")
        print(f"Available: {', '.join(TESTS.keys())}, all")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
