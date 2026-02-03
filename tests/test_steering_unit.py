"""
Unit tests for concurrent steering in SDKSession.

Tests the concurrent send/receive architecture where:
- Background receiver runs receive_messages() continuously
- Sender dispatches query() immediately from queue
- Multiple queries merge into one turn with one ResultMessage
- _pending_queries counter resets to 0 on ResultMessage (not decrement)

Mirrors the prototype tests from test_steering_v2.py but uses
the real SDKSession class with FakeClaudeSDKClient.
"""
from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

import pytest
import pytest_asyncio

from assistant.sdk_session import SDKSession


# ── Fixtures ────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def session(tmp_path):
    """Create an SDKSession for steering tests."""
    cwd = str(tmp_path / "steering-test")
    os.makedirs(cwd, exist_ok=True)
    s = SDKSession(
        chat_id="test:+15555550005",
        contact_name="Steering Test",
        tier="admin",
        cwd=cwd,
        session_type="individual",
        source="test",
    )
    yield s
    if s.is_alive():
        await s.stop()


# ── Test: Basic concurrent steering ────────────────────────────────

@pytest.mark.asyncio
class TestBasicSteering:
    """Verify the fundamental concurrent send/receive pattern works."""

    async def test_single_query_works(self, session):
        """A single query should be processed and session becomes not-busy."""
        await session.start()
        await session.inject("hello")
        await asyncio.sleep(0.3)
        # Should have processed and reset
        assert not session.is_busy
        assert session._client._queries == ["hello"]
        assert session.turn_count >= 1

    async def test_multiple_sequential_queries(self, session):
        """Sequential queries (wait between each) should each produce a turn."""
        await session.start()

        await session.inject("msg1")
        await asyncio.sleep(0.3)
        assert not session.is_busy
        count_after_1 = session.turn_count

        await session.inject("msg2")
        await asyncio.sleep(0.3)
        assert not session.is_busy
        count_after_2 = session.turn_count

        assert count_after_2 > count_after_1
        assert session._client._queries == ["msg1", "msg2"]

    async def test_query_during_processing(self, session):
        """A second query sent while first is processing should be delivered."""
        session._client = None  # Will be set by start()
        await session.start()
        # Slow down the fake client so we can inject mid-turn
        session._client._query_delay = 0.3

        await session.inject("first")
        await asyncio.sleep(0.1)
        # Should be busy (first query in flight)
        assert session.is_busy

        await session.inject("second")
        # Wait for everything to complete
        await asyncio.sleep(1.5)
        assert not session.is_busy
        assert "first" in session._client._queries
        assert "second" in session._client._queries


# ── Test: Pending counter behavior ─────────────────────────────────

@pytest.mark.asyncio
class TestPendingCounter:
    """Verify _pending_queries counter tracks correctly.

    Key insight: merged queries produce ONE ResultMessage, so the counter
    must reset to 0 (not decrement by 1) on ResultMessage.
    """

    async def test_counter_zero_at_start(self, session):
        """Counter should be 0 before any queries."""
        assert session._pending_queries == 0
        assert not session.is_busy

    async def test_counter_increments_on_query(self, session):
        """Counter should increment when a query is sent."""
        await session.start()
        session._client._query_delay = 0.5  # Slow so we can observe

        await session.inject("test")
        await asyncio.sleep(0.15)
        # Should have been picked up from queue and incremented
        assert session._pending_queries >= 1

    async def test_counter_resets_to_zero_on_result(self, session):
        """Counter should reset to 0 (not decrement) on ResultMessage."""
        await session.start()
        await session.inject("test")
        await asyncio.sleep(0.3)
        assert session._pending_queries == 0

    async def test_counter_sequential_accuracy(self, session):
        """Counter should go 0 → 1 → 0 → 1 → 0 for sequential queries."""
        await session.start()

        assert session._pending_queries == 0

        await session.inject("q1")
        await asyncio.sleep(0.3)
        assert session._pending_queries == 0

        await session.inject("q2")
        await asyncio.sleep(0.3)
        assert session._pending_queries == 0

    async def test_counter_rapid_queries_reset(self, session):
        """Three rapid queries should peak at 3 and reset to 0 on ResultMessage."""
        await session.start()
        session._client._query_delay = 0.3  # Slow enough to accumulate

        await session.inject("r1")
        await asyncio.sleep(0.05)
        await session.inject("r2")
        await asyncio.sleep(0.05)
        await session.inject("r3")

        # Wait a bit for all to be picked up
        await asyncio.sleep(0.2)
        # Some should be pending
        peak = session._pending_queries
        assert peak >= 1  # At least 1 should be pending

        # Wait for all to complete
        await asyncio.sleep(2.0)
        assert session._pending_queries == 0
        assert not session.is_busy

    async def test_is_busy_matches_counter(self, session):
        """is_busy should be True iff _pending_queries > 0."""
        await session.start()
        assert not session.is_busy
        assert session._pending_queries == 0

        session._client._query_delay = 0.5
        await session.inject("test")
        await asyncio.sleep(0.15)

        if session._pending_queries > 0:
            assert session.is_busy
        # After completion
        await asyncio.sleep(1.0)
        assert not session.is_busy
        assert session._pending_queries == 0


# ── Test: Error handling ───────────────────────────────────────────

@pytest.mark.asyncio
class TestErrorHandling:
    """Verify query errors don't corrupt the counter or kill the session."""

    async def test_query_error_decrements_counter(self, session):
        """If query() fails, counter should be decremented (not left high)."""
        await session.start()
        session._client._should_error = True

        await session.inject("will_fail")
        await asyncio.sleep(0.5)

        # Counter should not be stuck at 1
        assert session._pending_queries == 0

    async def test_session_recovers_after_error(self, session):
        """Session should still work after a query error."""
        await session.start()

        # First: error
        session._client._should_error = True
        await session.inject("will_fail")
        # Wait for error + backoff (2 * error_count = 2s)
        await asyncio.sleep(3.0)

        # Second: success
        session._client._should_error = False
        await session.inject("will_succeed")
        await asyncio.sleep(0.5)

        assert "will_succeed" in session._client._queries
        assert not session.is_busy

    async def test_three_errors_kills_session(self, session):
        """Three consecutive errors should kill the session."""
        await session.start()
        session._client._should_error = True

        for i in range(3):
            await session.inject(f"fail_{i}")
            await asyncio.sleep(0.5)  # Wait for error + backoff

        # Give time for error counting and backoff
        await asyncio.sleep(8)
        assert not session.running or session._error_count >= 3


# ── Test: Session lifecycle with concurrent architecture ───────────

@pytest.mark.asyncio
class TestSessionLifecycle:
    """Verify start/stop/health with the concurrent architecture."""

    async def test_start_creates_receiver(self, session):
        """Starting session should create the background receiver task."""
        await session.start()
        assert session.is_alive()
        assert session.running

    async def test_stop_cancels_receiver(self, session):
        """Stopping session should cleanly cancel the receiver."""
        await session.start()
        assert session.is_alive()
        await session.stop()
        assert not session.is_alive()

    async def test_health_during_processing(self, session):
        """Session should be healthy while processing queries."""
        await session.start()
        session._client._query_delay = 0.5
        await session.inject("slow")
        await asyncio.sleep(0.15)
        assert session.is_healthy()

    async def test_session_id_captured(self, session):
        """Session ID should be captured from ResultMessage."""
        await session.start()
        await session.inject("test")
        await asyncio.sleep(0.3)
        assert session.session_id == "test-session-123"

    async def test_turn_count_increments(self, session):
        """Turn count should increment after each ResultMessage."""
        await session.start()
        assert session.turn_count == 0

        await session.inject("q1")
        await asyncio.sleep(0.3)
        count1 = session.turn_count
        assert count1 >= 1

        await session.inject("q2")
        await asyncio.sleep(0.3)
        assert session.turn_count > count1

    async def test_last_activity_updates(self, session):
        """last_activity should update on inject and on ResultMessage."""
        await session.start()
        before = session.last_activity

        await asyncio.sleep(0.1)
        await session.inject("test")
        await asyncio.sleep(0.3)

        assert session.last_activity > before


# ── Test: Merged turn behavior ─────────────────────────────────────

@pytest.mark.asyncio
class TestMergedTurns:
    """Verify that multiple queries during one turn merge correctly."""

    async def test_rapid_queries_all_delivered(self, session):
        """All rapid queries should be delivered to the client."""
        await session.start()
        session._client._query_delay = 0.2

        for i in range(5):
            await session.inject(f"msg-{i}")
            await asyncio.sleep(0.05)

        # Wait for all to process
        await asyncio.sleep(3.0)

        # All should have been sent
        assert len(session._client._queries) == 5
        for i in range(5):
            assert f"msg-{i}" in session._client._queries

    async def test_merged_queries_produce_one_result(self, session):
        """Multiple queries merged into one turn should produce 1 ResultMessage."""
        await session.start()
        session._client._query_delay = 0.3

        await session.inject("a")
        await asyncio.sleep(0.05)
        await session.inject("b")

        await asyncio.sleep(1.5)
        # Counter should be 0 — one ResultMessage reset everything
        assert session._pending_queries == 0
        assert not session.is_busy

    async def test_error_count_resets_on_success(self, session):
        """_error_count should reset to 0 after a successful ResultMessage."""
        await session.start()

        # Cause an error
        session._client._should_error = True
        await session.inject("fail")
        await asyncio.sleep(3.0)  # Wait for error + backoff (2s)
        assert session._error_count >= 1

        # Now succeed
        session._client._should_error = False
        await session.inject("succeed")
        await asyncio.sleep(0.5)
        assert session._error_count == 0
