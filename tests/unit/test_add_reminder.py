"""Tests for add_reminder.py - time parsing logic."""
import pytest
import sys
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import patch

# Add skills path
sys.path.insert(0, str(Path.home() / ".claude/skills/reminders/scripts"))

from add_reminder import parse_time_spec


class TestParseTimeSpecRelative:
    """Tests for relative time parsing (5m, 2h, 1d)."""

    def test_parse_minutes_short(self):
        """Test parsing '5m' format."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("5m")
            expected = mock_now + timedelta(minutes=5)
            assert result == expected

    def test_parse_minutes_long(self):
        """Test parsing '5 minutes' format."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("5 minutes")
            expected = mock_now + timedelta(minutes=5)
            assert result == expected

    def test_parse_hours_short(self):
        """Test parsing '2h' format."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("2h")
            expected = mock_now + timedelta(hours=2)
            assert result == expected

    def test_parse_hours_long(self):
        """Test parsing '2 hours' format."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("2 hours")
            expected = mock_now + timedelta(hours=2)
            assert result == expected

    def test_parse_days_short(self):
        """Test parsing '1d' format."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("1d")
            expected = mock_now + timedelta(days=1)
            assert result == expected

    def test_parse_days_long(self):
        """Test parsing '1 day' format."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("1 day")
            expected = mock_now + timedelta(days=1)
            assert result == expected


class TestParseTimeSpecTomorrow:
    """Tests for 'tomorrow' time parsing."""

    def test_parse_tomorrow_default_9am(self):
        """Test 'tomorrow' defaults to 9am."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("tomorrow")
            expected = datetime(2026, 1, 25, 9, 0, 0)
            assert result == expected

    def test_parse_tomorrow_with_am(self):
        """Test 'tomorrow 9am' format."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("tomorrow 9am")
            expected = datetime(2026, 1, 25, 9, 0, 0)
            assert result == expected

    def test_parse_tomorrow_with_pm(self):
        """Test 'tomorrow 2pm' format."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("tomorrow 2pm")
            expected = datetime(2026, 1, 25, 14, 0, 0)
            assert result == expected

    def test_parse_tomorrow_12am_is_midnight(self):
        """Test 'tomorrow 12am' is midnight."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("tomorrow 12am")
            expected = datetime(2026, 1, 25, 0, 0, 0)
            assert result == expected

    def test_parse_tomorrow_12pm_is_noon(self):
        """Test 'tomorrow 12pm' is noon."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("tomorrow 12pm")
            expected = datetime(2026, 1, 25, 12, 0, 0)
            assert result == expected

    def test_parse_tomorrow_with_colon_time(self):
        """Test 'tomorrow 14:30' format."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("tomorrow 14:30")
            expected = datetime(2026, 1, 25, 14, 30, 0)
            assert result == expected


class TestParseTimeSpecISO:
    """Tests for ISO format time parsing."""

    def test_parse_iso_datetime(self):
        """Test parsing full ISO datetime."""
        result = parse_time_spec("2026-01-24 14:30")
        expected = datetime(2026, 1, 24, 14, 30, 0)
        assert result == expected

    def test_parse_iso_date_only(self):
        """Test parsing ISO date only."""
        result = parse_time_spec("2026-01-24")
        # Should parse to midnight
        expected = datetime(2026, 1, 24, 0, 0, 0)
        assert result == expected


class TestParseTimeSpecEdgeCases:
    """Tests for edge cases in time parsing."""

    def test_parse_strips_whitespace(self):
        """Test that whitespace is stripped."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("  5m  ")
            expected = mock_now + timedelta(minutes=5)
            assert result == expected

    def test_parse_case_insensitive(self):
        """Test that parsing is case insensitive."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("5M")
            expected = mock_now + timedelta(minutes=5)
            assert result == expected

    def test_parse_invalid_spec_raises(self):
        """Test that invalid spec raises ValueError."""
        with pytest.raises(ValueError, match="Could not parse"):
            parse_time_spec("invalid time")

    def test_parse_tomorrow_11pm(self):
        """Test 'tomorrow 11pm' works correctly."""
        with patch('add_reminder.datetime') as mock_dt:
            mock_now = datetime(2026, 1, 24, 10, 0, 0)
            mock_dt.now.return_value = mock_now
            mock_dt.side_effect = lambda *a, **k: datetime(*a, **k)

            result = parse_time_spec("tomorrow 11pm")
            expected = datetime(2026, 1, 25, 23, 0, 0)
            assert result == expected
