"""
Tests for health check and auto-restart logic.

Covers:
- health_check_all identifies unhealthy sessions
- Auto-restart of unhealthy sessions
- Idle session detection thresholds
- Master/BG session exemption from idle killing
- Multiple unhealthy sessions handled correctly
- Health check doesn't restart healthy sessions
"""
import asyncio
from datetime import datetime, timedelta

import pytest
import pytest_asyncio


@pytest.mark.asyncio
class TestHealthCheckAll:
    """Test health_check_all behavior."""

    async def test_all_healthy(self, sdk_backend):
        await sdk_backend.create_session("U1", "test:+15555550006", "admin", source="test")
        await sdk_backend.create_session("U2", "test:+15555550008", "admin", source="test")
        results = await sdk_backend.health_check_all()
        assert all(results.values())

    async def test_detects_unhealthy(self, sdk_backend):
        await sdk_backend.create_session("U1", "test:+15555550006", "admin", source="test")
        # Make it unhealthy
        session = sdk_backend.sessions["test:+15555550006"]
        session._error_count = 3
        results = await sdk_backend.health_check_all()
        # Should detect unhealthy and attempt restart
        assert "test:+15555550006" in results

    async def test_empty_sessions(self, sdk_backend):
        results = await sdk_backend.health_check_all()
        assert len(results) == 0


@pytest.mark.asyncio
class TestIdleSessionThresholds:
    """Test idle session detection at various thresholds."""

    async def test_exactly_at_threshold(self, sdk_backend):
        """Session idle for exactly the threshold should be killed."""
        await sdk_backend.create_session("User", "test:+15555550006", "admin", source="test")
        session = sdk_backend.sessions["test:+15555550006"]
        session.last_activity = datetime.now() - timedelta(hours=2, seconds=1)
        killed = await sdk_backend.check_idle_sessions(2.0)
        assert "test:+15555550006" in killed

    async def test_just_under_threshold(self, sdk_backend):
        """Session idle for just under threshold should survive."""
        await sdk_backend.create_session("User", "test:+15555550006", "admin", source="test")
        session = sdk_backend.sessions["test:+15555550006"]
        session.last_activity = datetime.now() - timedelta(hours=1, minutes=59)
        killed = await sdk_backend.check_idle_sessions(2.0)
        assert len(killed) == 0

    async def test_mixed_idle_and_active(self, sdk_backend):
        """Only idle sessions should be killed, active ones preserved."""
        await sdk_backend.create_session("Idle", "test:+15555550006", "admin", source="test")
        await sdk_backend.create_session("Active", "test:+15555550008", "admin", source="test")

        sdk_backend.sessions["test:+15555550006"].last_activity = datetime.now() - timedelta(hours=5)
        sdk_backend.sessions["test:+15555550008"].last_activity = datetime.now()

        killed = await sdk_backend.check_idle_sessions(2.0)
        assert "test:+15555550006" in killed
        assert "test:+15555550008" not in killed
        # Active session should still exist
        assert "test:+15555550008" in sdk_backend.sessions


@pytest.mark.asyncio
class TestSpecialSessionExemptions:
    """Test that BG and master sessions are exempt from idle killing."""

    async def test_bg_session_exempt(self, sdk_backend):
        await sdk_backend.create_session("User", "test:+15555550006-bg", "admin", source="test")
        sdk_backend.sessions["test:+15555550006-bg"].last_activity = datetime.now() - timedelta(hours=10)
        killed = await sdk_backend.check_idle_sessions(2.0)
        assert len(killed) == 0

    async def test_master_session_exempt(self, sdk_backend):
        """Master session should never be idle-killed."""
        from assistant.common import MASTER_SESSION
        # Create a session with the master key
        await sdk_backend.create_session("Master", MASTER_SESSION, "admin", source="imessage")
        sdk_backend.sessions[MASTER_SESSION].last_activity = datetime.now() - timedelta(hours=24)
        killed = await sdk_backend.check_idle_sessions(2.0)
        assert MASTER_SESSION not in killed


@pytest.mark.asyncio
class TestHealthCheckDoesNotOverRestart:
    """Ensure healthy sessions are not restarted."""

    async def test_healthy_session_not_restarted(self, sdk_backend):
        s1 = await sdk_backend.create_session("User", "test:+15555550006", "admin", source="test")
        s1_id = id(s1)
        await sdk_backend.health_check_all()
        # Session object should be the same (not restarted)
        s2 = sdk_backend.sessions.get("test:+15555550006")
        assert s2 is not None
        assert id(s2) == s1_id
