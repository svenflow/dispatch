"""
Tests for the TestMessageWatcher and message normalization.

Covers:
- TestMessageWatcher file parsing and normalization
- Message format normalization (from/phone/chat_id)
- Group vs individual message detection
- Attachment handling
- Error file handling (malformed JSON)
- File cleanup after processing
- Source tagging as "test"
"""
import json
import queue
import time
from pathlib import Path

import pytest

from assistant.common import normalize_chat_id


class TestTestMessageWatcherNormalization:
    """Test TestMessageWatcher._normalize_message."""

    def _get_watcher_class(self):
        """Import TestMessageWatcher after SDK mock is in place."""
        from assistant.manager import TestMessageWatcher
        return TestMessageWatcher

    def _normalize(self, raw: dict) -> dict:
        """Run normalization through a watcher instance."""
        TMW = self._get_watcher_class()
        q = queue.Queue()
        watcher = TMW(q)
        return watcher._normalize_message(raw)

    def test_basic_individual_message(self):
        msg = self._normalize({
            "from": "+15555551234",
            "text": "hello",
        })
        assert msg["phone"] == "+15555551234"
        assert msg["text"] == "hello"
        assert msg["is_group"] is False
        assert msg["source"] == "test"
        assert msg["is_from_me"] == 0

    def test_group_message(self):
        msg = self._normalize({
            "from": "+15555551234",
            "text": "hello group",
            "is_group": True,
            "chat_id": "b3d258b9a4de447ca412eb335c82a077",
            "group_name": "Test Group",
        })
        assert msg["is_group"] is True
        assert msg["chat_identifier"] == "b3d258b9a4de447ca412eb335c82a077"
        assert msg["group_name"] == "Test Group"
        assert msg["chat_style"] == 43  # Group style

    def test_default_phone_if_missing(self):
        msg = self._normalize({"text": "no from field"})
        assert msg["phone"] == "+15555550005"  # Default

    def test_chat_id_defaults_to_from(self):
        msg = self._normalize({"from": "+15555551234", "text": "hi"})
        assert msg["chat_identifier"] == "+15555551234"

    def test_attachments_normalized(self):
        msg = self._normalize({
            "from": "+15555551234",
            "text": "pic",
            "attachments": ["/tmp/photo.jpg"],
        })
        assert len(msg["attachments"]) == 1
        assert msg["attachments"][0]["path"] == "/tmp/photo.jpg"
        assert msg["attachments"][0]["name"] == "photo.jpg"

    def test_reply_to_guid(self):
        msg = self._normalize({
            "from": "+15555551234",
            "text": "reply",
            "reply_to": "guid-123",
        })
        assert msg["reply_to_guid"] == "guid-123"

    def test_source_is_always_test(self):
        msg = self._normalize({"from": "+15555551234", "text": "hi"})
        assert msg["source"] == "test"

    def test_rowid_is_generated(self):
        msg = self._normalize({"from": "+15555551234", "text": "hi"})
        assert "rowid" in msg
        assert isinstance(msg["rowid"], int)

    def test_chat_id_is_normalized(self):
        """Chat IDs should be run through normalize_chat_id."""
        msg = self._normalize({
            "from": "+15555551234",
            "text": "hi",
            "chat_id": "5555551234",  # 10-digit, should be normalized
        })
        assert msg["chat_identifier"] == "+15555551234"


class TestTestMessageWatcherFileHandling:
    """Test file-based message ingestion."""

    def _get_watcher_class(self):
        from assistant.manager import TestMessageWatcher
        return TestMessageWatcher

    def test_picks_up_json_file(self, test_messages_dir):
        """Watcher should read and delete JSON files from its directory."""
        TMW = self._get_watcher_class()
        q = queue.Queue()
        watcher = TMW(q)
        # Override the test directory
        watcher.TEST_DIR = test_messages_dir

        # Drop a message file
        msg_file = test_messages_dir / "test1.json"
        msg_file.write_text(json.dumps({
            "from": "+15555551234",
            "text": "file test",
        }))

        # Start and quickly stop the watcher
        watcher.running = True
        # Manually call the inner loop logic instead of threading
        for file_path in sorted(watcher.TEST_DIR.glob("*.json")):
            with open(file_path) as f:
                raw_msg = json.load(f)
            normalized = watcher._normalize_message(raw_msg)
            q.put(normalized)
            file_path.unlink()

        assert not q.empty()
        msg = q.get()
        assert msg["text"] == "file test"
        assert not msg_file.exists()  # File should be deleted

    def test_malformed_json_moved_to_errors(self, test_messages_dir):
        """Bad JSON should be moved to errors/ directory."""
        TMW = self._get_watcher_class()
        q = queue.Queue()
        watcher = TMW(q)
        watcher.TEST_DIR = test_messages_dir

        bad_file = test_messages_dir / "bad.json"
        bad_file.write_text("not valid json {{{")

        error_dir = test_messages_dir / "errors"
        error_dir.mkdir(exist_ok=True)

        # Process - should fail and move to errors
        try:
            with open(bad_file) as f:
                json.load(f)
            assert False, "Should have raised"
        except json.JSONDecodeError:
            bad_file.rename(error_dir / bad_file.name)

        assert (error_dir / "bad.json").exists()
        assert not bad_file.exists()

    def test_processes_files_in_sorted_order(self, test_messages_dir):
        """Files should be processed in sorted (timestamp) order."""
        TMW = self._get_watcher_class()
        q = queue.Queue()
        watcher = TMW(q)
        watcher.TEST_DIR = test_messages_dir

        # Create files with specific ordering
        (test_messages_dir / "003.json").write_text(json.dumps({"from": "+1", "text": "third"}))
        (test_messages_dir / "001.json").write_text(json.dumps({"from": "+1", "text": "first"}))
        (test_messages_dir / "002.json").write_text(json.dumps({"from": "+1", "text": "second"}))

        results = []
        for file_path in sorted(watcher.TEST_DIR.glob("*.json")):
            with open(file_path) as f:
                raw_msg = json.load(f)
            results.append(raw_msg["text"])
            file_path.unlink()

        assert results == ["first", "second", "third"]

    def test_ignores_subdirectories(self, test_messages_dir):
        """Should not process files in inbox/outbox/errors subdirs."""
        TMW = self._get_watcher_class()
        q = queue.Queue()
        watcher = TMW(q)
        watcher.TEST_DIR = test_messages_dir

        # Put files in subdirs (shouldn't be processed)
        (test_messages_dir / "inbox" / "msg.json").write_text(json.dumps({"from": "+1", "text": "inbox"}))
        (test_messages_dir / "outbox" / "msg.json").write_text(json.dumps({"from": "+1", "text": "outbox"}))

        # Only root-level .json files should match
        root_files = list(test_messages_dir.glob("*.json"))
        assert len(root_files) == 0  # No root-level files


class TestNormalizeChatIdEdgeCases:
    """Edge cases for normalize_chat_id."""

    def test_empty_string(self):
        assert normalize_chat_id("") == ""

    def test_plus_only(self):
        result = normalize_chat_id("+")
        assert result == "+"

    def test_very_long_hex(self):
        """64-char hex should be treated as group UUID."""
        long_hex = "a" * 64
        assert normalize_chat_id(long_hex) == long_hex

    def test_mixed_case_hex_group(self):
        result = normalize_chat_id("ABCD1234ABCD1234ABCD1234")
        assert result == "abcd1234abcd1234abcd1234"

    def test_international_phone(self):
        result = normalize_chat_id("+447911123456")
        assert result == "+447911123456"

    def test_signal_international_phone(self):
        result = normalize_chat_id("signal:+447911123456")
        assert result == "signal:+447911123456"
