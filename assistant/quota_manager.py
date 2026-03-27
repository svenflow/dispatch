"""
Quota-aware model degradation manager.

Two states: NORMAL and DEGRADED.
File-as-source-of-truth: state/model_override.json present = DEGRADED, absent = NORMAL.

Transitions:
  NORMAL → DEGRADED: when 5h or 7d-opus quota ≥ 90%, or on API quota errors (429/529)
  DEGRADED → NORMAL: when 5h AND 7d-opus quota < 70%

Includes a circuit breaker for deep heal Haiku calls to prevent hammering a dead API.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Patterns that indicate a quota/rate-limit error (not a generic failure).
# Uses regex to avoid false positives (e.g., "port 4290" matching "429").
import re

QUOTA_ERROR_PATTERNS = [
    re.compile(r"\b429\b"),            # HTTP 429 status code
    re.compile(r"\b529\b"),            # HTTP 529 status code
    re.compile(r"rate.?limit", re.I),  # rate limit / rate_limit
    re.compile(r"overloaded", re.I),
    re.compile(r"quota.?exceeded", re.I),
    re.compile(r"too many requests", re.I),
]


def is_quota_error(error_text: str) -> bool:
    """Check if an error message indicates API quota/rate-limit exhaustion."""
    return any(p.search(error_text) for p in QUOTA_ERROR_PATTERNS)


class QuotaManager:
    """Manages global model override based on API quota utilization.

    State is derived from disk:
      - model_override.json absent → NORMAL
      - model_override.json present (valid or corrupt) → DEGRADED
    """

    DEGRADE_THRESHOLD = 90   # degrade when >= 90%
    RECOVER_THRESHOLD = 70   # recover when < 70%
    COOLDOWN_SECONDS = 300   # 5 min between transitions
    STUCK_REMINDER_HOURS = 6

    def __init__(self, state_dir: Path):
        self.state_dir = state_dir
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.override_path = state_dir / "model_override.json"
        self.history_path = state_dir / "quota_transitions.jsonl"
        # Separate cooldowns per direction to avoid degrade blocking recovery
        self.last_degrade_at: float | None = None
        self.last_recover_at: float | None = None
        self._last_reminder_at: float | None = None

    @property
    def state(self) -> str:
        """Derived from disk. File present (valid or corrupt) = degraded."""
        if self.override_path.exists():
            return "degraded"
        return "normal"

    def get_effective_model(self, chat_id: str, registry_model: str, default_model: str) -> tuple[str, str]:
        """Resolve the effective model for a session.

        Returns (model, source) where source is one of:
          "override" — global model override is active
          "registry" — per-session model from registry
          "default"  — hardcoded default

        Fault-tolerant: corrupt override file = sonnet (safe degraded state).
        """
        try:
            if self.override_path.exists():
                data = json.loads(self.override_path.read_text())
                if "model" in data:
                    return data["model"], "override"
                # File exists but no model key — treat as degraded, default sonnet
                return "sonnet", "override"
        except (json.JSONDecodeError, OSError) as e:
            log.warning(f"QUOTA_MANAGER | override file corrupt, defaulting to sonnet: {e}")
            return "sonnet", "override"

        if registry_model:
            return registry_model, "registry"
        return default_model, "default"

    def get_override_info(self) -> dict[str, Any] | None:
        """Read the current override file. Returns None if absent."""
        try:
            if self.override_path.exists():
                return json.loads(self.override_path.read_text())
        except (json.JSONDecodeError, OSError):
            return {"model": "sonnet", "error": "corrupt_file"}
        return None

    def check_and_transition(self, quota_5h_pct: float, quota_7d_opus_pct: float) -> list[str]:
        """Called from health check loop every 5 min. Returns list of action strings.

        Possible actions: "sms_degraded", "sms_recovered", "sms_still_degraded"

        Cooldowns are per-direction: a degrade doesn't block recovery and vice versa.
        """
        now = time.time()
        actions = []
        current = self.state

        if current == "normal":
            # Cooldown only checks last degrade time
            if self.last_degrade_at and (now - self.last_degrade_at) < self.COOLDOWN_SECONDS:
                return []
            if quota_5h_pct >= self.DEGRADE_THRESHOLD or quota_7d_opus_pct >= self.DEGRADE_THRESHOLD:
                trigger = f"auto_quota_5h={quota_5h_pct:.0f}_7d={quota_7d_opus_pct:.0f}"
                self._write_override("sonnet", trigger)
                self._log_transition("normal", "degraded", trigger, quota_5h_pct, quota_7d_opus_pct)
                self.last_degrade_at = now
                actions.append("sms_degraded")
                log.warning(
                    f"QUOTA_MANAGER | DEGRADED | 5h={quota_5h_pct:.0f}% 7d_opus={quota_7d_opus_pct:.0f}% | "
                    f"global model → sonnet"
                )

        elif current == "degraded":
            # Cooldown only checks last recover time
            if self.last_recover_at and (now - self.last_recover_at) < self.COOLDOWN_SECONDS:
                return []
            if quota_5h_pct < self.RECOVER_THRESHOLD and quota_7d_opus_pct < self.RECOVER_THRESHOLD:
                self._clear_override()
                trigger = f"recovered_5h={quota_5h_pct:.0f}_7d={quota_7d_opus_pct:.0f}"
                self._log_transition("degraded", "normal", trigger, quota_5h_pct, quota_7d_opus_pct)
                self.last_recover_at = now
                actions.append("sms_recovered")
                log.info(
                    f"QUOTA_MANAGER | RECOVERED | 5h={quota_5h_pct:.0f}% 7d_opus={quota_7d_opus_pct:.0f}% | "
                    f"global model → per-session defaults"
                )

            else:
                hours = self._should_send_reminder()
                if hours is not None:
                    actions.append("sms_still_degraded")
                    self.last_degraded_hours = hours
                    self._last_reminder_at = now

        return actions

    def fast_degrade(self) -> list[str]:
        """Emergency degrade triggered by quota-specific API errors (429/529).

        Idempotent — safe to call from multiple sessions concurrently.
        The benign race: two sessions may both pass the state check and both write
        the override file, but the result is the same (sonnet override + duplicate
        JSONL entry). The duplicate SMS is prevented by the caller deduplicating.
        """
        if self.state == "degraded":
            return []  # already degraded
        self._write_override("sonnet", "api_quota_error_detected")
        self._log_transition("normal", "degraded", "api_quota_errors", -1, -1)
        self.last_degrade_at = time.time()
        log.warning("QUOTA_MANAGER | FAST_DEGRADE | API quota errors detected | global model → sonnet")
        return ["sms_outage"]

    def set_global_model(self, model: str, trigger: str = "manual") -> None:
        """Manually set the global model override."""
        prev = self.state
        if model.lstrip("-") == "clear":
            self._clear_override()
            self._log_transition(prev, "normal", "manual_clear", -1, -1)
            log.info("QUOTA_MANAGER | CLEARED | manual override removed")
        else:
            self._write_override(model, trigger)
            self._log_transition(prev, "degraded", f"manual_{model}", -1, -1)
            log.info(f"QUOTA_MANAGER | SET | global model → {model} (trigger={trigger})")

    # ── Internal helpers ──────────────────────────────────────────

    def _write_override(self, model: str, trigger: str) -> None:
        """Atomic write: temp file + os.replace to prevent partial writes on crash."""
        data = json.dumps({
            "model": model,
            "set_at": datetime.now(timezone.utc).isoformat(),
            "trigger": trigger,
        })
        tmp = self.override_path.with_suffix(".tmp")
        tmp.write_text(data)
        os.replace(tmp, self.override_path)

    def _clear_override(self) -> None:
        self.override_path.unlink(missing_ok=True)

    def _log_transition(self, from_state: str, to_state: str, trigger: str,
                        q5h: float, q7d: float) -> None:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "from": from_state,
            "to": to_state,
            "trigger": trigger,
            "quota_5h": round(q5h, 1) if q5h >= 0 else None,
            "quota_7d_opus": round(q7d, 1) if q7d >= 0 else None,
        }
        try:
            with open(self.history_path, "a") as f:
                f.write(json.dumps(entry) + "\n")
        except OSError as e:
            log.warning(f"QUOTA_MANAGER | Failed to write transition log: {e}")

    def _should_send_reminder(self) -> float | None:
        """Check if we should send a 'still degraded' reminder.

        Returns hours_degraded if reminder should be sent, None otherwise.
        """
        info = self.get_override_info()
        if not info:
            return None

        now = time.time()

        # Don't send reminder if we sent one recently (within STUCK_REMINDER_HOURS)
        if self._last_reminder_at and (now - self._last_reminder_at) < self.STUCK_REMINDER_HOURS * 3600:
            return None

        # Check how long we've been degraded
        set_at = info.get("set_at")
        if not set_at:
            return None
        try:
            set_dt = datetime.fromisoformat(set_at)
            if set_dt.tzinfo is None:
                set_dt = set_dt.replace(tzinfo=timezone.utc)
            hours_degraded = (datetime.now(timezone.utc) - set_dt).total_seconds() / 3600
            if hours_degraded >= self.STUCK_REMINDER_HOURS:
                return hours_degraded
            return None
        except (ValueError, TypeError):
            return None


class HaikuCircuitBreaker:
    """Circuit breaker for deep heal Haiku calls.

    Prevents hammering a dead API with Haiku health-check calls.

    States:
      CLOSED — normal operation, Haiku calls allowed
      OPEN — Haiku calls blocked after consecutive failures
      HALF_OPEN — allow one probe call to test recovery
    """

    FAILURE_THRESHOLD = 3     # consecutive failures to trip open
    HALF_OPEN_SECONDS = 300   # 5 min = one health check cycle

    def __init__(self):
        self.consecutive_failures = 0
        self.state = "closed"  # closed | open | half_open
        self.opened_at: float | None = None

    def is_open(self) -> bool:
        """Check if circuit is open (Haiku calls should be skipped).

        Returns False if closed or if enough time has passed to try half-open probe.
        """
        if self.state == "open":
            if self.opened_at and time.time() - self.opened_at >= self.HALF_OPEN_SECONDS:
                self.state = "half_open"
                log.info("CIRCUIT_BREAKER | HALF_OPEN | trying one Haiku probe")
                return False  # allow one probe
            return True
        return False

    def record_success(self) -> None:
        """Record a successful Haiku call."""
        if self.state == "half_open":
            log.info("CIRCUIT_BREAKER | CLOSED | Haiku probe succeeded")
        self.state = "closed"
        self.consecutive_failures = 0

    def record_failure(self) -> list[str]:
        """Record a failed Haiku call. Returns action list.

        Possible actions: "sms_circuit_open"
        """
        self.consecutive_failures += 1
        actions: list[str] = []

        if self.state == "half_open":
            self.state = "open"
            self.opened_at = time.time()
            log.info("CIRCUIT_BREAKER | OPEN | half-open probe failed, reopening")
        elif self.consecutive_failures >= self.FAILURE_THRESHOLD and self.state == "closed":
            self.state = "open"
            self.opened_at = time.time()
            log.warning(
                f"CIRCUIT_BREAKER | OPEN | {self.consecutive_failures} consecutive Haiku failures"
            )
            actions.append("sms_circuit_open")

        return actions
