"""Tests for QuotaManager and HaikuCircuitBreaker."""
import json
import os
import tempfile
import time
from pathlib import Path

import pytest

from assistant.quota_manager import QuotaManager, HaikuCircuitBreaker, is_quota_error


@pytest.fixture
def state_dir():
    with tempfile.TemporaryDirectory() as d:
        yield Path(d)


@pytest.fixture
def qm(state_dir):
    return QuotaManager(state_dir)


class TestQuotaManager:
    def test_initial_state_is_normal(self, qm):
        assert qm.state == "normal"
        assert qm.get_override_info() is None

    def test_normal_to_degraded_at_threshold(self, qm):
        actions = qm.check_and_transition(90.0, 50.0)
        assert "sms_degraded" in actions
        assert qm.state == "degraded"
        assert qm.override_path.exists()
        override = json.loads(qm.override_path.read_text())
        assert override["model"] == "sonnet"
        assert "auto_quota" in override["trigger"]

    def test_normal_to_degraded_on_7d_opus(self, qm):
        """7-day opus quota hitting 90% should also trigger degradation."""
        actions = qm.check_and_transition(50.0, 92.0)
        assert "sms_degraded" in actions
        assert qm.state == "degraded"

    def test_recovery_below_threshold(self, qm):
        # First degrade
        qm.check_and_transition(90.0, 50.0)
        assert qm.state == "degraded"
        # Recovery cooldown is independent — no need to reset degrade cooldown
        # Now recover
        actions = qm.check_and_transition(69.0, 60.0)
        assert "sms_recovered" in actions
        assert qm.state == "normal"
        assert not qm.override_path.exists()

    def test_hysteresis_no_flap(self, qm):
        """Between 70% and 90%, no transition should happen."""
        # Degrade first
        qm.check_and_transition(90.0, 50.0)
        assert qm.state == "degraded"
        # 85% is above recover threshold (70%) — should stay degraded
        actions = qm.check_and_transition(85.0, 50.0)
        assert actions == []
        assert qm.state == "degraded"

    def test_cooldown_prevents_rapid_same_direction(self, qm):
        """Per-direction cooldown blocks repeated transitions in same direction."""
        # Degrade
        actions = qm.check_and_transition(90.0, 50.0)
        assert "sms_degraded" in actions
        # Recovery is NOT blocked (different direction, no recover cooldown)
        actions = qm.check_and_transition(50.0, 50.0)
        assert "sms_recovered" in actions
        # But immediate re-degrade IS blocked (degrade cooldown still active)
        actions = qm.check_and_transition(95.0, 50.0)
        assert actions == []  # blocked by degrade cooldown

    def test_corrupt_file_means_degraded(self, qm):
        """A corrupt override file should be treated as degraded (safe default)."""
        qm.override_path.write_text("not valid json {{{")
        assert qm.state == "degraded"
        model, source = qm.get_effective_model("test", "opus", "opus")
        assert model == "sonnet"
        assert source == "override"

    def test_absent_file_means_normal(self, qm):
        assert qm.state == "normal"
        model, source = qm.get_effective_model("test", "opus", "opus")
        assert model == "opus"
        assert source == "registry"

    def test_fast_degrade_idempotent(self, qm):
        actions1 = qm.fast_degrade()
        assert "sms_outage" in actions1
        assert qm.state == "degraded"
        actions2 = qm.fast_degrade()
        assert actions2 == []  # already degraded, no action

    def test_effective_model_override_wins(self, qm):
        """Global override should take precedence over registry model."""
        qm.set_global_model("sonnet")
        model, source = qm.get_effective_model("test", "opus", "opus")
        assert model == "sonnet"
        assert source == "override"

    def test_effective_model_registry_when_no_override(self, qm):
        model, source = qm.get_effective_model("test", "sonnet", "opus")
        assert model == "sonnet"
        assert source == "registry"

    def test_effective_model_default_when_no_registry(self, qm):
        model, source = qm.get_effective_model("test", "", "opus")
        assert model == "opus"
        assert source == "default"

    def test_set_and_clear_global_model(self, qm):
        qm.set_global_model("haiku")
        assert qm.state == "degraded"
        override = qm.get_override_info()
        assert override["model"] == "haiku"

        qm.set_global_model("--clear")
        assert qm.state == "normal"
        assert qm.get_override_info() is None

    def test_clear_without_dashes(self, qm):
        """set_global_model('clear') should work same as '--clear'."""
        qm.set_global_model("sonnet")
        assert qm.state == "degraded"
        qm.set_global_model("clear")
        assert qm.state == "normal"

    def test_get_override_info_corrupt_file(self, qm):
        """Corrupt file should return fallback dict with error key."""
        qm.override_path.write_text("not valid json {{{")
        info = qm.get_override_info()
        assert info is not None
        assert info["model"] == "sonnet"
        assert info["error"] == "corrupt_file"

    def test_transition_log_written(self, qm):
        qm.check_and_transition(95.0, 50.0)
        assert qm.history_path.exists()
        lines = qm.history_path.read_text().strip().split("\n")
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["from"] == "normal"
        assert entry["to"] == "degraded"
        assert entry["quota_5h"] == 95.0

    def test_state_persists_across_instances(self, state_dir):
        """State derived from disk should persist across QuotaManager instances."""
        qm1 = QuotaManager(state_dir)
        qm1.set_global_model("sonnet")
        assert qm1.state == "degraded"

        qm2 = QuotaManager(state_dir)
        assert qm2.state == "degraded"
        model, _ = qm2.get_effective_model("test", "opus", "opus")
        assert model == "sonnet"

    def test_degrade_cooldown_does_not_block_recovery(self, qm):
        """Per-direction cooldowns: degrade cooldown must NOT block recovery."""
        # Degrade (sets last_degrade_at to now)
        actions = qm.check_and_transition(95.0, 50.0)
        assert "sms_degraded" in actions
        assert qm.state == "degraded"
        # Immediately try to recover — last_recover_at is None, so no cooldown
        actions = qm.check_and_transition(50.0, 50.0)
        assert "sms_recovered" in actions
        assert qm.state == "normal"

    def test_recover_cooldown_does_not_block_degrade(self, qm):
        """Per-direction cooldowns: recover cooldown must NOT block degrade."""
        # Degrade then recover
        qm.check_and_transition(95.0, 50.0)
        actions = qm.check_and_transition(50.0, 50.0)
        assert "sms_recovered" in actions
        # Expire degrade cooldown so it doesn't interfere
        qm.last_degrade_at = time.time() - 600
        # last_recover_at is now set, but degrade should still work (different direction)
        actions = qm.check_and_transition(95.0, 50.0)
        assert "sms_degraded" in actions

    def test_degrade_cooldown_blocks_repeated_degrade(self, qm):
        """Degrade cooldown prevents repeated degrade transitions."""
        # Degrade, then clear manually, then try to degrade again immediately
        qm.check_and_transition(95.0, 50.0)
        assert qm.state == "degraded"
        qm._clear_override()  # manually clear so state is normal again
        assert qm.state == "normal"
        # Within degrade cooldown — should be blocked
        actions = qm.check_and_transition(95.0, 50.0)
        assert actions == []

    def test_recover_cooldown_blocks_repeated_recover(self, qm):
        """Recover cooldown prevents repeated recover transitions."""
        # Degrade, recover, manually re-degrade, try to recover again
        qm.check_and_transition(95.0, 50.0)
        qm.check_and_transition(50.0, 50.0)
        assert qm.state == "normal"
        qm._write_override("sonnet", "test")  # manually degrade
        assert qm.state == "degraded"
        # Within recover cooldown — should be blocked
        actions = qm.check_and_transition(50.0, 50.0)
        assert actions == []

    def test_fast_degrade_then_check_and_transition_recovery(self, qm):
        """fast_degrade followed by check_and_transition should allow recovery."""
        actions = qm.fast_degrade()
        assert "sms_outage" in actions
        assert qm.state == "degraded"
        # Recovery should work (no recover cooldown set)
        actions = qm.check_and_transition(50.0, 50.0)
        assert "sms_recovered" in actions
        assert qm.state == "normal"

    def test_reminder_not_sent_before_threshold(self, qm):
        """Reminder should not be sent if degraded less than STUCK_REMINDER_HOURS."""
        from datetime import datetime, timezone
        # Degrade with recent timestamp
        qm._write_override("sonnet", "test")
        # check_and_transition with quotas in hysteresis zone (won't recover)
        actions = qm.check_and_transition(80.0, 80.0)
        assert "sms_still_degraded" not in actions

    def test_reminder_sent_after_threshold(self, qm):
        """Reminder should be sent if degraded for >= STUCK_REMINDER_HOURS."""
        from datetime import datetime, timezone, timedelta
        # Write override with old timestamp
        old_time = (datetime.now(timezone.utc) - timedelta(hours=7)).isoformat()
        qm.override_path.write_text(json.dumps({
            "model": "sonnet",
            "set_at": old_time,
            "trigger": "test",
        }))
        actions = qm.check_and_transition(80.0, 80.0)
        assert "sms_still_degraded" in actions
        # Should also expose degraded duration
        assert hasattr(qm, "last_degraded_hours")
        assert qm.last_degraded_hours >= 7.0

    def test_reminder_not_repeated_within_interval(self, qm):
        """Reminder should not repeat within STUCK_REMINDER_HOURS of last reminder."""
        from datetime import datetime, timezone, timedelta
        old_time = (datetime.now(timezone.utc) - timedelta(hours=7)).isoformat()
        qm.override_path.write_text(json.dumps({
            "model": "sonnet",
            "set_at": old_time,
            "trigger": "test",
        }))
        # First reminder
        actions = qm.check_and_transition(80.0, 80.0)
        assert "sms_still_degraded" in actions
        # Second call should NOT send reminder (too soon)
        actions = qm.check_and_transition(80.0, 80.0)
        assert "sms_still_degraded" not in actions


class TestHaikuCircuitBreaker:
    def test_initially_closed(self):
        cb = HaikuCircuitBreaker()
        assert cb.state == "closed"
        assert not cb.is_open()

    def test_opens_at_3_failures(self):
        cb = HaikuCircuitBreaker()
        cb.record_failure()
        cb.record_failure()
        assert cb.state == "closed"
        actions = cb.record_failure()
        assert cb.state == "open"
        assert "sms_circuit_open" in actions

    def test_open_blocks_calls(self):
        cb = HaikuCircuitBreaker()
        for _ in range(3):
            cb.record_failure()
        assert cb.is_open()

    def test_half_open_after_timeout(self):
        cb = HaikuCircuitBreaker()
        for _ in range(3):
            cb.record_failure()
        assert cb.state == "open"
        # Simulate timeout
        cb.opened_at = time.time() - 301
        assert not cb.is_open()  # should transition to half_open
        assert cb.state == "half_open"

    def test_half_open_success_closes(self):
        cb = HaikuCircuitBreaker()
        for _ in range(3):
            cb.record_failure()
        cb.opened_at = time.time() - 301
        cb.is_open()  # transition to half_open
        cb.record_success()
        assert cb.state == "closed"
        assert cb.consecutive_failures == 0

    def test_half_open_failure_reopens(self):
        cb = HaikuCircuitBreaker()
        for _ in range(3):
            cb.record_failure()
        cb.opened_at = time.time() - 301
        cb.is_open()  # transition to half_open
        cb.record_failure()
        assert cb.state == "open"

    def test_success_resets_failures(self):
        cb = HaikuCircuitBreaker()
        cb.record_failure()
        cb.record_failure()
        cb.record_success()
        assert cb.consecutive_failures == 0
        # Should need 3 more failures to trip
        cb.record_failure()
        cb.record_failure()
        assert cb.state == "closed"


class TestIsQuotaError:
    def test_429_detected(self):
        assert is_quota_error("HTTP 429 Too Many Requests")

    def test_rate_limit_detected(self):
        assert is_quota_error("Rate limit exceeded for organization")

    def test_overloaded_detected(self):
        assert is_quota_error("Server overloaded, please try again")

    def test_529_detected(self):
        assert is_quota_error("Error 529: API overloaded")

    def test_generic_error_not_detected(self):
        assert not is_quota_error("Command failed with exit code 1")

    def test_bad_prompt_not_detected(self):
        assert not is_quota_error("Invalid prompt format")

    def test_port_number_not_false_positive(self):
        """Port 4290 should NOT trigger quota error (word boundary check)."""
        assert not is_quota_error("Connection to port 4290 failed")
        assert not is_quota_error("Service running on 5290")

    def test_quota_exceeded_detected(self):
        assert is_quota_error("API quota_exceeded for this organization")
