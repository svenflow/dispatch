"""
Tests for performance, concurrency, and reliability.

Covers:
- Concurrent session creation (lock contention)
- Rapid message injection throughput
- Registry write performance under load
- Session creation latency
- Queue ordering under concurrent injection
- Memory: no session leaks after kill_all
- Concurrent inject_message for different contacts
- Lock fairness: no starvation
"""
import asyncio
import time
from datetime import datetime

import pytest
import pytest_asyncio


@pytest.mark.asyncio
class TestConcurrentSessionCreation:
    """Test lock behavior under concurrent session requests."""

    async def test_concurrent_create_same_session(self, sdk_backend):
        """Two concurrent creates for the same chat_id should yield one session."""
        results = await asyncio.gather(
            sdk_backend.create_session("User", "test:+15555550006", "admin", source="test"),
            sdk_backend.create_session("User", "test:+15555550006", "admin", source="test"),
        )
        # Both should return a session
        assert all(r is not None for r in results)
        # But only one session should exist
        assert len([k for k in sdk_backend.sessions if k == "test:+15555550006"]) == 1

    async def test_concurrent_create_different_sessions(self, sdk_backend):
        """Creating different sessions concurrently should all succeed."""
        tasks = [
            sdk_backend.create_session(f"User{i}", f"test:+1{i:010d}", "admin", source="test")
            for i in range(5)
        ]
        results = await asyncio.gather(*tasks)
        assert all(r is not None for r in results)
        assert len(sdk_backend.sessions) == 5

    async def test_concurrent_inject_different_contacts(self, sdk_backend):
        """Injecting messages for different contacts concurrently."""
        tasks = [
            sdk_backend.inject_message(
                f"User{i}", f"+1{i:010d}", f"msg {i}",
                tier="admin", source="test",
            )
            for i in range(5)
        ]
        results = await asyncio.gather(*tasks)
        assert all(results)
        assert len(sdk_backend.sessions) == 5


@pytest.mark.asyncio
class TestRapidMessageInjection:
    """Test message throughput and ordering."""

    async def test_rapid_inject_100_messages(self, sdk_backend):
        """Inject 100 messages rapidly into one session."""
        await sdk_backend.create_session("User", "test:+15555550006", "admin", source="test")
        session = sdk_backend.sessions["test:+15555550006"]

        for i in range(100):
            await session.inject(f"msg-{i:03d}")

        # Wait for processing
        await asyncio.sleep(2)

        # All messages should have been queried in order
        queries = session._client._queries
        # First query is the system prompt from create_session
        msg_queries = [q for q in queries if q.startswith("msg-")]
        assert len(msg_queries) == 100
        # Verify FIFO order
        for i, q in enumerate(msg_queries):
            assert q == f"msg-{i:03d}", f"Expected msg-{i:03d}, got {q}"

    async def test_inject_while_busy(self, sdk_backend):
        """Messages injected while session is busy should queue up."""
        await sdk_backend.create_session("User", "test:+15555550006", "admin", source="test")
        session = sdk_backend.sessions["test:+15555550006"]

        # Make processing slow
        session._client._query_delay = 0.2

        # Inject several messages rapidly
        for i in range(5):
            await session.inject(f"msg-{i}")

        # First message should be processing, rest in queue
        await asyncio.sleep(0.1)
        assert session.is_busy
        assert session._message_queue.qsize() >= 3

        # Wait for all to complete
        await asyncio.sleep(2)
        assert not session.is_busy
        assert session._message_queue.qsize() == 0


@pytest.mark.asyncio
class TestRegistryWritePerformance:
    """Test registry I/O under load."""

    async def test_registry_50_rapid_updates(self, registry):
        """50 rapid last_message_time updates should complete quickly."""
        for i in range(10):
            registry.register(chat_id=f"test:+1{i:010d}", session_name=f"user-{i}")

        start = time.time()
        for _ in range(5):
            for i in range(10):
                registry.update_last_message_time(f"test:+1{i:010d}")
        elapsed = time.time() - start

        # 50 atomic JSON writes should complete in < 2 seconds
        assert elapsed < 2.0, f"Registry writes too slow: {elapsed:.2f}s for 50 updates"

    async def test_registry_preserves_data_under_load(self, registry):
        """All data should be preserved after rapid writes."""
        for i in range(20):
            registry.register(
                chat_id=f"test:+1{i:010d}",
                session_name=f"user-{i}",
                tier="admin",
                contact_name=f"User {i}",
            )

        for i in range(20):
            for _ in range(5):
                registry.update_last_message_time(f"test:+1{i:010d}")

        # Verify all entries intact
        all_data = registry.all()
        assert len(all_data) == 20
        for i in range(20):
            data = registry.get(f"test:+1{i:010d}")
            assert data is not None
            assert data["contact_name"] == f"User {i}"


@pytest.mark.asyncio
class TestSessionCreationLatency:
    """Measure session creation time."""

    async def test_single_session_creation_time(self, sdk_backend):
        start = time.time()
        await sdk_backend.create_session("User", "test:+15555550006", "admin", source="test")
        elapsed = time.time() - start
        # Session creation with fake SDK should be very fast
        assert elapsed < 2.0, f"Session creation too slow: {elapsed:.2f}s"

    async def test_5_sequential_sessions(self, sdk_backend):
        """Create 5 sessions sequentially - measures stagger delay impact."""
        start = time.time()
        for i in range(5):
            await sdk_backend.create_session(
                f"User{i}", f"test:+1{i:010d}", "admin", source="test"
            )
        elapsed = time.time() - start
        # With 0.5s stagger per session, 5 sessions should take ~2.5s
        # But with fake SDK, connect is instant, so stagger is the bottleneck
        assert elapsed < 10.0, f"5 sessions too slow: {elapsed:.2f}s"


@pytest.mark.asyncio
class TestNoSessionLeaks:
    """Ensure sessions are properly cleaned up."""

    async def test_kill_all_cleans_up(self, sdk_backend):
        for i in range(5):
            await sdk_backend.create_session(
                f"User{i}", f"test:+1{i:010d}", "admin", source="test"
            )
        assert len(sdk_backend.sessions) == 5

        await sdk_backend.kill_all_sessions()
        assert len(sdk_backend.sessions) == 0

    async def test_restart_doesnt_leak(self, sdk_backend):
        """Restarting a session shouldn't leave orphaned sessions."""
        await sdk_backend.create_session("User", "test:+15555550006", "admin", source="test")
        assert len(sdk_backend.sessions) == 1

        await sdk_backend.restart_session("test:+15555550006")
        assert len(sdk_backend.sessions) == 1

    async def test_rapid_create_kill_cycle(self, sdk_backend):
        """Create and kill sessions rapidly - no leaks."""
        for _ in range(10):
            await sdk_backend.create_session("User", "test:+15555550006", "admin", source="test")
            await sdk_backend.kill_session("test:+15555550006")
        assert len(sdk_backend.sessions) == 0


@pytest.mark.asyncio
class TestLockFairness:
    """Test that the asyncio.Lock doesn't cause starvation."""

    async def test_interleaved_create_and_inject(self, sdk_backend):
        """Creates and injects interleaved should all complete."""
        # Create first session
        await sdk_backend.create_session("User0", "test:+15555550005", "admin", source="test")

        # Now interleave creates and injects
        tasks = []
        for i in range(1, 5):
            tasks.append(sdk_backend.create_session(
                f"User{i}", f"test:+1{i:010d}", "admin", source="test"
            ))
            tasks.append(sdk_backend.inject_message(
                "User0", "+15555550005", f"msg during create {i}",
                tier="admin", source="test",
            ))

        results = await asyncio.gather(*tasks)
        # All should succeed
        assert all(r is not None for r in results)
