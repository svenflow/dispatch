"""
Performance metrics collection via structured JSONL logging.

Usage:
    from assistant.perf import timing, incr, gauge, timed

    # Record a timing
    timing("poll_cycle_ms", 45.2, component="daemon")

    # Increment a counter
    incr("messages_read", count=3, component="daemon")

    # Record a gauge
    gauge("active_sessions", 5, component="daemon")

    # Context manager for timing a block
    with timed("inject_ms", component="daemon", session="imessage/+1234"):
        do_something()

    # Decorator for timing a function (sync or async)
    @timed_fn("contact_lookup_ms", component="daemon")
    def lookup_contact(phone):
        ...

    @timed_fn("claude_response_ms", component="session")
    async def get_response():
        ...

Logs are written to ~/dispatch/logs/perf-YYYY-MM-DD.jsonl
"""

import inspect
import json
import sys
import time
from contextlib import contextmanager
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any

PERF_DIR = Path.home() / "dispatch" / "logs"
SCHEMA_VERSION = 1
MAX_FILE_SIZE_MB = 100

# Sampling state for high-frequency metrics
_sample_counters: dict[str, int] = {}


def _log_metric(metric: str, value: float, **labels: Any) -> None:
    """Append metric to daily JSONL file. Never raises."""
    try:
        PERF_DIR.mkdir(parents=True, exist_ok=True)
        path = PERF_DIR / f"perf-{datetime.now():%Y-%m-%d}.jsonl"

        # Check file size limit
        if path.exists() and path.stat().st_size > MAX_FILE_SIZE_MB * 1024 * 1024:
            print(
                f"[perf] WARNING: {path} exceeds {MAX_FILE_SIZE_MB}MB, skipping",
                file=sys.stderr,
            )
            return

        entry = {
            "v": SCHEMA_VERSION,
            "ts": datetime.now().isoformat(),
            "metric": metric,
            "value": value,
            **labels,
        }
        with open(path, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print(f"[perf] WARNING: failed to log metric: {e}", file=sys.stderr)


def timing(metric: str, ms: float, *, sample_rate: int = 1, **labels: Any) -> None:
    """
    Record a timing metric in milliseconds.

    Args:
        metric: Metric name (e.g., "poll_cycle_ms")
        ms: Duration in milliseconds
        sample_rate: Only log every Nth call (default 1 = log all)
        **labels: Additional labels (component, session, etc.)
    """
    if sample_rate > 1:
        _sample_counters[metric] = _sample_counters.get(metric, 0) + 1
        if _sample_counters[metric] % sample_rate != 0:
            return
    _log_metric(metric, ms, **labels)


def incr(metric: str, count: int = 1, **labels: Any) -> None:
    """Record a counter increment."""
    _log_metric(metric, count, **labels)


def gauge(metric: str, value: float, **labels: Any) -> None:
    """Record a gauge metric (current value)."""
    _log_metric(metric, value, **labels)


@contextmanager
def timed(metric: str, *, sample_rate: int = 1, **labels: Any):
    """
    Context manager to time a block of code.

    Usage:
        with timed("inject_ms", component="daemon"):
            do_something()
    """
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        timing(metric, elapsed_ms, sample_rate=sample_rate, **labels)


def timed_fn(metric: str, *, sample_rate: int = 1, **labels: Any):
    """
    Decorator to time a function (handles both sync and async).

    Usage:
        @timed_fn("contact_lookup_ms", component="daemon")
        def lookup_contact(phone):
            ...

        @timed_fn("claude_response_ms", component="session")
        async def get_response():
            ...
    """

    def decorator(fn):
        if inspect.iscoroutinefunction(fn):

            @wraps(fn)
            async def async_wrapper(*args, **kwargs):
                start = time.perf_counter()
                try:
                    return await fn(*args, **kwargs)
                finally:
                    elapsed_ms = (time.perf_counter() - start) * 1000
                    timing(metric, elapsed_ms, sample_rate=sample_rate, **labels)

            return async_wrapper
        else:

            @wraps(fn)
            def sync_wrapper(*args, **kwargs):
                start = time.perf_counter()
                try:
                    return fn(*args, **kwargs)
                finally:
                    elapsed_ms = (time.perf_counter() - start) * 1000
                    timing(metric, elapsed_ms, sample_rate=sample_rate, **labels)

            return sync_wrapper

    return decorator


def error(error_type: str, **labels: Any) -> None:
    """Record an error occurrence."""
    incr("error_count", error_type=error_type, **labels)
