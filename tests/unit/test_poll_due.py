"""Tests for poll_due.py - reminder polling and tag parsing."""
import pytest
import sys
from pathlib import Path
from datetime import datetime, timedelta

# Add skills path
sys.path.insert(0, str(Path.home() / ".claude/skills/reminders/scripts"))

from poll_due import (
    parse_tags_from_notes,
    extract_contact_from_list,
    extract_target_from_notes,
    extract_cron_from_notes,
    CORE_DATA_EPOCH,
    CONTACT_LIST_PREFIX,
)


class TestParseTagsFromNotes:
    """Tests for parse_tags_from_notes function."""

    def test_parse_all_tags(self):
        """Test parsing notes with both target and cron tags."""
        notes = "[target:bg] [cron:0 9,21 * * *] Check daily stats"
        result = parse_tags_from_notes(notes)

        assert result["target"] == "bg"
        assert result["cron"] == "0 9,21 * * *"
        assert result["notes"] == "Check daily stats"

    def test_parse_target_only(self):
        """Test parsing notes with only target tag."""
        notes = "[target:fg] Regular reminder"
        result = parse_tags_from_notes(notes)

        assert result["target"] == "fg"
        assert result["cron"] is None
        assert result["notes"] == "Regular reminder"

    def test_parse_cron_only(self):
        """Test parsing notes with only cron tag."""
        notes = "[cron:30 8 * * 1-5] Weekday morning"
        result = parse_tags_from_notes(notes)

        assert result["target"] == "fg"  # Default
        assert result["cron"] == "30 8 * * 1-5"
        assert result["notes"] == "Weekday morning"

    def test_parse_no_tags(self):
        """Test parsing notes without any tags."""
        notes = "Simple reminder notes"
        result = parse_tags_from_notes(notes)

        assert result["target"] == "fg"  # Default
        assert result["cron"] is None
        assert result["notes"] == "Simple reminder notes"

    def test_parse_empty_notes(self):
        """Test parsing empty notes string."""
        result = parse_tags_from_notes("")

        assert result["target"] == "fg"
        assert result["cron"] is None
        assert result["notes"] is None

    def test_parse_none_notes(self):
        """Test parsing None notes."""
        result = parse_tags_from_notes(None)

        assert result["target"] == "fg"
        assert result["cron"] is None
        assert result["notes"] is None

    def test_parse_target_both(self):
        """Test parsing target:both value."""
        notes = "[target:both] Alert everyone"
        result = parse_tags_from_notes(notes)

        assert result["target"] == "both"
        assert result["notes"] == "Alert everyone"

    def test_parse_complex_cron(self):
        """Test parsing complex cron pattern."""
        notes = "[cron:*/15 * * * *] Every 15 minutes"
        result = parse_tags_from_notes(notes)

        assert result["cron"] == "*/15 * * * *"

    def test_parse_removes_extra_whitespace(self):
        """Test that extra whitespace is cleaned up."""
        notes = "[target:bg]   [cron:0 9 * * *]   Task description  "
        result = parse_tags_from_notes(notes)

        assert result["notes"] == "Task description"


class TestExtractContactFromList:
    """Tests for extract_contact_from_list function."""

    def test_extract_valid_contact(self):
        """Test extracting contact from valid list name."""
        list_name = "Claude: John Smith"
        result = extract_contact_from_list(list_name)
        assert result == "John Smith"

    def test_extract_no_prefix(self):
        """Test list name without Claude prefix."""
        list_name = "Reminders"
        result = extract_contact_from_list(list_name)
        assert result is None

    def test_extract_empty_string(self):
        """Test empty string list name."""
        result = extract_contact_from_list("")
        assert result is None

    def test_extract_none(self):
        """Test None list name."""
        result = extract_contact_from_list(None)
        assert result is None

    def test_extract_partial_prefix(self):
        """Test list name with partial prefix."""
        list_name = "Claude"
        result = extract_contact_from_list(list_name)
        assert result is None  # Missing ": "


class TestExtractTargetFromNotes:
    """Tests for extract_target_from_notes function."""

    def test_extract_fg_target(self):
        """Test extracting foreground target."""
        target, notes = extract_target_from_notes("[target:fg] Hello")
        assert target == "fg"
        assert notes == "Hello"

    def test_extract_bg_target(self):
        """Test extracting background target."""
        target, notes = extract_target_from_notes("[target:bg] Background task")
        assert target == "bg"
        assert notes == "Background task"

    def test_extract_both_target(self):
        """Test extracting both target."""
        target, notes = extract_target_from_notes("[target:both] Alert all")
        assert target == "both"
        assert notes == "Alert all"

    def test_default_target_no_tag(self):
        """Test default target when no tag present."""
        target, notes = extract_target_from_notes("Just a note")
        assert target == "fg"
        assert notes == "Just a note"

    def test_default_target_empty(self):
        """Test default target for empty notes."""
        target, notes = extract_target_from_notes("")
        assert target == "fg"
        assert notes is None

    def test_default_target_none(self):
        """Test default target for None notes."""
        target, notes = extract_target_from_notes(None)
        assert target == "fg"
        assert notes is None


class TestExtractCronFromNotes:
    """Tests for extract_cron_from_notes function."""

    def test_extract_simple_cron(self):
        """Test extracting simple cron pattern."""
        cron, notes = extract_cron_from_notes("[cron:0 9 * * *] Morning task")
        assert cron == "0 9 * * *"
        assert notes == "Morning task"

    def test_extract_complex_cron(self):
        """Test extracting complex cron pattern."""
        cron, notes = extract_cron_from_notes("[cron:0 9,21 * * 1-5] Weekday twice daily")
        assert cron == "0 9,21 * * 1-5"
        assert notes == "Weekday twice daily"

    def test_no_cron_tag(self):
        """Test notes without cron tag."""
        cron, notes = extract_cron_from_notes("Regular reminder")
        assert cron is None
        assert notes == "Regular reminder"

    def test_empty_notes(self):
        """Test empty notes."""
        cron, notes = extract_cron_from_notes("")
        assert cron is None
        assert notes is None

    def test_none_notes(self):
        """Test None notes."""
        cron, notes = extract_cron_from_notes(None)
        assert cron is None
        assert notes is None


class TestCoreDataTimestamp:
    """Tests for Core Data timestamp handling."""

    def test_core_data_epoch_value(self):
        """Verify Core Data epoch constant is correct (2001-01-01)."""
        # Core Data epoch is 978307200 seconds after Unix epoch
        # This equals 2001-01-01 00:00:00 UTC
        assert CORE_DATA_EPOCH == 978307200

    def test_timestamp_conversion_math(self):
        """Test timestamp conversion from Unix to Core Data."""
        # Current Unix timestamp
        now_unix = datetime.now().timestamp()

        # Convert to Core Data timestamp
        now_core_data = now_unix - CORE_DATA_EPOCH

        # Core Data timestamp should be positive and less than Unix timestamp
        assert now_core_data > 0
        assert now_core_data < now_unix

    def test_past_date_conversion(self):
        """Test converting a known past date."""
        # 2020-01-01 00:00:00 UTC = 1577836800 Unix
        unix_ts = 1577836800
        core_data_ts = unix_ts - CORE_DATA_EPOCH

        # Should be approximately 19 years worth of seconds
        expected = 1577836800 - 978307200  # = 599529600
        assert core_data_ts == expected
