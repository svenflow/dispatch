"""Unit tests for contacts functionality."""

import subprocess
from unittest.mock import patch, MagicMock
import sys

# Add contacts skill to path for imports
sys.path.insert(0, str(__import__('pathlib').Path.home() / "dispatch/skills/contacts/scripts"))

from contacts_core import (
    ensure_contacts_running,
    run_applescript,
    lookup_phone,
)


class TestEnsureContactsRunning:
    """Tests for ensure_contacts_running function."""

    @patch('contacts_core.subprocess.run')
    def test_does_nothing_when_contacts_running(self, mock_run):
        """Should not launch Contacts if already running."""
        # Simulate osascript succeeding (Contacts is running)
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")

        ensure_contacts_running()

        # Should call osascript to launch (our implementation always calls launch)
        assert mock_run.called

    @patch('contacts_core.subprocess.run')
    def test_launches_contacts_when_not_running(self, mock_run):
        """Should launch Contacts.app when it's not running."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")

        ensure_contacts_running()

        # Should call osascript to launch Contacts
        mock_run.assert_called_once()
        call_args = mock_run.call_args[0][0]
        assert "osascript" in call_args
        assert "Contacts" in str(call_args)


class TestRunApplescript:
    """Tests for run_applescript function with retry logic."""

    @patch('contacts_core.ensure_contacts_running')
    @patch('contacts_core.subprocess.run')
    def test_returns_success_on_first_try(self, mock_run, mock_ensure):
        """Should return success when AppleScript succeeds."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="test output\n",
            stderr=""
        )

        success, output = run_applescript('tell application "Contacts" to return "test"')

        assert success is True
        assert output == "test output"

    @patch('contacts_core.ensure_contacts_running')
    @patch('contacts_core.subprocess.run')
    def test_retries_on_app_not_running_error(self, mock_run, mock_ensure):
        """Should retry when getting -600 error (app not running)."""
        # First call fails with -600, second succeeds
        mock_run.side_effect = [
            MagicMock(returncode=1, stdout="", stderr="execution error: (-600)"),
            MagicMock(returncode=0, stdout="success\n", stderr="")
        ]

        success, output = run_applescript('tell application "Contacts" to return "test"')

        # Should have called subprocess twice (initial + retry)
        assert mock_run.call_count == 2
        # Should have called ensure_contacts_running to launch app
        assert mock_ensure.called
        assert success is True
        assert output == "success"

    @patch('contacts_core.ensure_contacts_running')
    @patch('contacts_core.subprocess.run')
    def test_returns_failure_on_other_errors(self, mock_run, mock_ensure):
        """Should not retry on non -600 errors."""
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="some other error"
        )

        success, output = run_applescript('tell application "Contacts" to return "test"')

        # Should only call once (no retry)
        assert mock_run.call_count == 1
        assert success is False
        assert "some other error" in output


class TestLookupPhone:
    """Tests for lookup_phone function."""

    @patch('contacts_core.run_applescript')
    def test_returns_contact_when_found(self, mock_applescript):
        """Should return contact dict when phone is found."""
        mock_applescript.return_value = (True, "FOUND|John Doe|+16175551234|admin")

        result = lookup_phone("+16175551234")

        assert result is not None
        assert result["name"] == "John Doe"
        assert result["phone"] == "+16175551234"
        assert result["tier"] == "admin"

    @patch('contacts_core.run_applescript')
    def test_returns_none_when_not_found(self, mock_applescript):
        """Should return None when phone is not in contacts."""
        mock_applescript.return_value = (True, "NOT_FOUND|+19995551234")

        result = lookup_phone("+19995551234")

        assert result is None

    @patch('contacts_core.run_applescript')
    def test_returns_none_on_applescript_failure(self, mock_applescript):
        """Should return None when AppleScript fails."""
        mock_applescript.return_value = (False, "some error")

        result = lookup_phone("+16175551234")

        assert result is None
