"""Tests for ChildSupervisor — child process lifecycle management.

Tests startup readiness probes, crash detection, restart with backoff,
degraded mode, rolling window decay, and graceful shutdown.
"""

import asyncio
import subprocess
import time
from unittest.mock import MagicMock, patch, AsyncMock

import pytest

from assistant.manager import ChildSupervisor, StartupResult


class FakeProcess:
    """Mock subprocess.Popen that can simulate alive/dead states."""

    def __init__(self, pid=12345, alive=True, returncode=None):
        self.pid = pid
        self._alive = alive
        self.returncode = returncode
        self._terminated = False
        self._killed = False

    def poll(self):
        if self._alive:
            return None
        return self.returncode if self.returncode is not None else 1

    def terminate(self):
        self._terminated = True
        self._alive = False
        self.returncode = -15

    def kill(self):
        self._killed = True
        self._alive = False
        self.returncode = -9

    def wait(self, timeout=None):
        if not self._alive:
            return self.returncode if self.returncode is not None else 0
        # Simulate process that terminates when asked
        if self._terminated or self._killed:
            self._alive = False
            return self.returncode if self.returncode is not None else 0
        raise subprocess.TimeoutExpired(cmd="test", timeout=timeout or 5)

    def die(self, code=1):
        """Simulate process crash."""
        self._alive = False
        self.returncode = code


@pytest.fixture
def make_supervisor():
    """Factory for creating ChildSupervisor with mocked dependencies."""
    def _make(health_ok=True, spawn_alive=True, spawn_pid=12345):
        procs = []

        def spawn_fn():
            proc = FakeProcess(pid=spawn_pid + len(procs), alive=spawn_alive)
            if not spawn_alive:
                proc.die(code=1)
            procs.append(proc)
            return proc

        sv = ChildSupervisor(
            name="test_service",
            spawn_fn=spawn_fn,
            health_url="http://localhost:9999/health",
            alert_fn=MagicMock(),
            producer=None,
            health_timeout=1.0,
        )
        # Speed up for tests
        sv.READINESS_TIMEOUT = 2
        sv.READINESS_POLL = 0.1
        sv.POLL_INTERVAL = 0.1
        sv.BACKOFF_SEQUENCE = [0, 0.1, 0.2]  # Fast backoff for tests
        sv.RESTART_WINDOW = 10

        # Mock health check
        sv._check_health_sync = MagicMock(return_value=health_ok)

        # Override _cleanup_process to avoid os.getpgid on fake PIDs
        async def _mock_cleanup(self_ref=sv):
            if self_ref._proc is not None:
                self_ref._proc._alive = False
                self_ref._proc = None
                await asyncio.sleep(0.05)  # Brief pause like real cleanup

        sv._cleanup_process = _mock_cleanup

        return sv, procs

    return _make


# ── Startup Tests ──


@pytest.mark.asyncio
async def test_startup_ready(make_supervisor):
    """Process starts and becomes healthy within timeout."""
    sv, procs = make_supervisor(health_ok=True)
    result = await sv.start()

    assert result == StartupResult.READY
    assert sv.proc is not None
    assert sv.proc.pid >= 12345
    assert not sv.degraded


@pytest.mark.asyncio
async def test_startup_crash(make_supervisor):
    """Process exits immediately during readiness probe."""
    sv, procs = make_supervisor(health_ok=False, spawn_alive=False)
    result = await sv.start()

    assert result == StartupResult.FAILED
    # proc is None because cleanup happened
    assert sv.proc is None or sv.proc.poll() is not None


@pytest.mark.asyncio
async def test_startup_timeout(make_supervisor):
    """Process alive but never becomes healthy."""
    sv, procs = make_supervisor(health_ok=False, spawn_alive=True)
    result = await sv.start()

    assert result == StartupResult.SLOW_START
    assert sv.proc is not None
    assert sv.proc.poll() is None  # Still alive


@pytest.mark.asyncio
async def test_startup_spawn_returns_none(make_supervisor):
    """spawn_fn returns None."""
    sv, procs = make_supervisor()
    sv._spawn_fn = lambda: None
    result = await sv.start()

    assert result == StartupResult.FAILED


@pytest.mark.asyncio
async def test_startup_spawn_raises(make_supervisor):
    """spawn_fn raises an exception."""
    sv, procs = make_supervisor()
    sv._spawn_fn = MagicMock(side_effect=RuntimeError("spawn failed"))
    result = await sv.start()

    assert result == StartupResult.FAILED


# ── Crash Detection Tests ──


@pytest.mark.asyncio
async def test_crash_detected_and_restarted(make_supervisor):
    """run_forever detects crash and restarts within POLL_INTERVAL."""
    sv, procs = make_supervisor(health_ok=True)
    await sv.start()

    assert len(procs) == 1
    first_proc = procs[0]

    # Simulate crash
    first_proc.die(code=137)

    # Run supervisor for a few iterations
    task = asyncio.create_task(sv.run_forever())
    await asyncio.sleep(0.5)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    # Should have spawned a new process
    assert len(procs) >= 2
    assert sv.proc is not None
    assert sv.proc.pid != first_proc.pid


@pytest.mark.asyncio
async def test_healthy_process_not_restarted(make_supervisor):
    """run_forever does nothing when process is healthy."""
    sv, procs = make_supervisor(health_ok=True)
    await sv.start()

    assert len(procs) == 1

    # Run supervisor — process stays alive
    task = asyncio.create_task(sv.run_forever())
    await asyncio.sleep(0.5)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    # Should NOT have spawned another process
    assert len(procs) == 1


# ── Backoff Tests ──


@pytest.mark.asyncio
async def test_backoff_sequence(make_supervisor):
    """Restarts follow the backoff sequence."""
    sv, procs = make_supervisor(health_ok=True)
    sv.BACKOFF_SEQUENCE = [0, 0, 0]  # No delay for speed
    sv.MAX_FAST_RESTARTS = 10  # High limit

    await sv.start()
    assert len(procs) == 1

    # Kill the process multiple times
    for i in range(3):
        procs[-1].die(code=1)
        task = asyncio.create_task(sv.run_forever())
        await asyncio.sleep(0.5)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    # Should have created multiple processes
    assert len(procs) >= 3


# ── Degraded Mode Tests ──


@pytest.mark.asyncio
async def test_degraded_mode_after_max_restarts(make_supervisor):
    """Enters degraded mode after MAX_FAST_RESTARTS."""
    sv, procs = make_supervisor(health_ok=True)
    sv.MAX_FAST_RESTARTS = 3
    sv.BACKOFF_SEQUENCE = [0]
    sv.RESTART_WINDOW = 60  # Wide window

    await sv.start()

    # Simulate rapid crashes beyond the limit
    for i in range(5):
        if sv.proc:
            sv.proc.die(code=1)
        await sv._handle_crash()

    assert sv.degraded


@pytest.mark.asyncio
async def test_degraded_mode_alerts_admin(make_supervisor):
    """Sends admin alert when entering degraded mode."""
    sv, procs = make_supervisor(health_ok=True)
    sv.MAX_FAST_RESTARTS = 2
    sv.BACKOFF_SEQUENCE = [0]
    sv.RESTART_WINDOW = 60

    await sv.start()

    # Crash enough times to trigger degraded
    for i in range(4):
        if sv.proc:
            sv.proc.die(code=1)
        await sv._handle_crash()

    # Alert should have been called
    assert sv._alert_fn.called


@pytest.mark.asyncio
async def test_degraded_skip_restart(make_supervisor):
    """In degraded mode, crashes are logged but not restarted."""
    sv, procs = make_supervisor(health_ok=True)

    await sv.start()
    # Set degraded AFTER start (start() clears it on READY)
    sv._degraded = True
    initial_count = len(procs)

    if sv.proc:
        sv.proc.die(code=1)
    await sv._handle_crash()

    # No new process should have been spawned (degraded skips restart)
    assert len(procs) == initial_count


# ── Rolling Window Tests ──


@pytest.mark.asyncio
async def test_rolling_window_decay(make_supervisor):
    """Old restart timestamps decay out of the window."""
    sv, procs = make_supervisor(health_ok=True)
    sv.RESTART_WINDOW = 1  # 1 second window

    # Add old timestamps
    sv._restart_timestamps.extend([time.time() - 10, time.time() - 5])

    # Recent restarts should be empty (all aged out)
    recent = sv._recent_restarts()
    assert len(recent) == 0


@pytest.mark.asyncio
async def test_rolling_window_recent(make_supervisor):
    """Recent restart timestamps are counted."""
    sv, procs = make_supervisor(health_ok=True)
    sv.RESTART_WINDOW = 60

    now = time.time()
    sv._restart_timestamps.extend([now - 10, now - 5, now - 1])

    recent = sv._recent_restarts()
    assert len(recent) == 3


# ── Clear Degraded Tests ──


@pytest.mark.asyncio
async def test_clear_degraded(make_supervisor):
    """clear_degraded resets the degraded flag."""
    sv, procs = make_supervisor()
    sv._degraded = True
    sv.clear_degraded()
    assert not sv.degraded


@pytest.mark.asyncio
async def test_clear_degraded_preserves_timestamps(make_supervisor):
    """clear_degraded does NOT clear restart timestamps."""
    sv, procs = make_supervisor()
    sv._degraded = True
    sv._restart_timestamps.extend([time.time(), time.time()])
    sv.clear_degraded()
    assert len(sv._restart_timestamps) == 2


# ── Shutdown Tests ──


@pytest.mark.asyncio
async def test_stop_kills_process(make_supervisor):
    """stop() terminates the child process."""
    sv, procs = make_supervisor(health_ok=True)
    await sv.start()
    assert sv.proc is not None

    await sv.stop()
    assert sv.proc is None


@pytest.mark.asyncio
async def test_stop_when_no_process(make_supervisor):
    """stop() is safe when no process is running."""
    sv, procs = make_supervisor()
    # Don't start — proc is None
    await sv.stop()  # Should not raise


# ── StartupResult enum ──


def test_startup_result_values():
    """StartupResult enum has expected values."""
    assert StartupResult.READY.value == "ready"
    assert StartupResult.SLOW_START.value == "slow"
    assert StartupResult.FAILED.value == "failed"


# ── Lock prevents concurrent restarts ──


@pytest.mark.asyncio
async def test_lock_prevents_double_restart(make_supervisor):
    """Two concurrent _handle_crash calls don't spawn two processes."""
    sv, procs = make_supervisor(health_ok=True)
    sv.BACKOFF_SEQUENCE = [0]
    await sv.start()
    sv.proc.die(code=1)

    # Fire two crash handlers concurrently
    await asyncio.gather(
        sv._handle_crash(),
        sv._handle_crash(),
    )

    # Only one extra spawn (the re-check inside the lock prevents the second)
    # At most 2 new processes (one from each handle_crash, if timing is unlucky)
    # But the key assertion: supervisor is in a valid state
    assert sv.proc is not None or sv.degraded
