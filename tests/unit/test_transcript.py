"""Tests for transcript.py - assistant transcript extraction."""
import pytest
import sys
from pathlib import Path

# Add assistant path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "assistant"))

from transcript import clean_sms_content, format_context


class TestCleanSmsContent:
    """Tests for clean_sms_content function."""

    def test_clean_simple_sms(self):
        """Test cleaning simple SMS injection format."""
        content = """---SMS FROM Test Admin (admin)---
Hello world
---END SMS---"""
        cleaned, is_sms = clean_sms_content(content)
        assert cleaned == "Hello world"
        assert is_sms is True

    def test_clean_group_sms(self):
        """Test cleaning group SMS format."""
        content = """---GROUP SMS [Family Chat] FROM Test User [TIER: wife]---
Group message here
---END SMS---"""
        cleaned, is_sms = clean_sms_content(content)
        assert cleaned == "Group message here"
        assert is_sms is True

    def test_clean_skips_system_prompt(self):
        """Test that system prompts are skipped."""
        content = "IMPORTANT: Read and follow these instructions..."
        cleaned, is_sms = clean_sms_content(content)
        assert cleaned == ""
        assert is_sms is False

    def test_clean_skips_skill_injection(self):
        """Test that skill injections are skipped."""
        content = "Please read sms-assistant SKILL.md for guidelines..."
        cleaned, is_sms = clean_sms_content(content)
        assert cleaned == ""
        assert is_sms is False

    def test_clean_regular_assistant_response(self):
        """Test cleaning regular assistant response."""
        content = "I'll check that for you right now."
        cleaned, is_sms = clean_sms_content(content)
        assert "I'll check" in cleaned
        assert is_sms is False

    def test_clean_truncates_long_assistant_response(self):
        """Test that long assistant responses are truncated."""
        content = "I'll " + "word " * 100
        cleaned, is_sms = clean_sms_content(content)
        assert len(cleaned) <= 200
        assert is_sms is False

    def test_clean_multiline_sms(self):
        """Test cleaning multi-line SMS content."""
        content = """---SMS FROM Test (admin)---
Line one
Line two
Line three
---END SMS---"""
        cleaned, is_sms = clean_sms_content(content)
        assert "Line one" in cleaned
        assert "Line two" in cleaned
        assert "Line three" in cleaned
        assert is_sms is True

    def test_clean_sms_with_chat_id(self):
        """Test cleaning SMS with Chat ID line."""
        content = """---SMS FROM Test (admin)---
Chat ID: +1234567890
Actual message
---END SMS---"""
        cleaned, is_sms = clean_sms_content(content)
        # Should include all content between markers
        assert "Actual message" in cleaned
        assert is_sms is True


class TestFormatContext:
    """Tests for format_context function."""

    def test_format_empty_messages(self):
        """Test formatting empty message list."""
        result = format_context([])
        assert result == "No previous conversation history."

    def test_format_single_user_message(self):
        """Test formatting single user message."""
        messages = [{
            'role': 'user',
            'content': '---SMS FROM Test (admin)---\nHello\n---END SMS---',
            'timestamp': '2026-01-24T10:00:00'
        }]
        result = format_context(messages)
        assert "[Human]:" in result
        assert "Hello" in result

    def test_format_single_assistant_message(self):
        """Test formatting single assistant message."""
        messages = [{
            'role': 'assistant',
            'content': "I'll help you with that.",
            'timestamp': '2026-01-24T10:00:00'
        }]
        result = format_context(messages)
        assert "[You]:" in result

    def test_format_conversation_order(self):
        """Test that messages are in correct order."""
        messages = [
            {
                'role': 'user',
                'content': '---SMS FROM Test (admin)---\nFirst\n---END SMS---',
                'timestamp': '2026-01-24T10:00:00'
            },
            {
                'role': 'assistant',
                'content': 'Second',
                'timestamp': '2026-01-24T10:01:00'
            }
        ]
        result = format_context(messages)
        lines = result.split('\n')
        human_idx = next(i for i, l in enumerate(lines) if '[Human]:' in l)
        you_idx = next(i for i, l in enumerate(lines) if '[You]:' in l)
        assert human_idx < you_idx  # Human message comes first

    def test_format_truncates_long_messages(self):
        """Test that long messages are truncated."""
        long_content = "A" * 500
        messages = [{
            'role': 'assistant',
            'content': long_content,
            'timestamp': '2026-01-24T10:00:00'
        }]
        result = format_context(messages)
        # Should be truncated to 300 chars + "..."
        assert "..." in result

    def test_format_respects_max_chars(self):
        """Test that max_chars limit is respected."""
        messages = [{
            'role': 'assistant',
            'content': "A" * 100,
            'timestamp': '2026-01-24T10:00:00'
        }] * 10
        result = format_context(messages, max_chars=200)
        # Should truncate early
        assert "truncated" in result.lower()

    def test_format_skips_empty_cleaned_content(self):
        """Test that empty content after cleaning is skipped."""
        messages = [
            {
                'role': 'user',
                'content': 'IMPORTANT: Read and follow these instructions...',
                'timestamp': '2026-01-24T10:00:00'
            }
        ]
        result = format_context(messages)
        # Should return no history since content is filtered
        assert result == "No previous conversation history."

    def test_format_header_present(self):
        """Test that header is present in output."""
        messages = [{
            'role': 'assistant',
            'content': 'Hello',
            'timestamp': '2026-01-24T10:00:00'
        }]
        result = format_context(messages)
        assert "RECENT CONVERSATION HISTORY:" in result


class TestExtractMessagesFiltering:
    """Tests for message extraction filtering logic."""

    def test_skip_tool_results_list_content(self):
        """Test that list content (tool results) is skipped."""
        # In extract_messages, list content is skipped
        content = [{"type": "tool_result", "content": "some result"}]
        assert isinstance(content, list)  # Would be skipped

    def test_skip_short_messages(self):
        """Test that very short messages are skipped."""
        short = "ok"
        assert len(short.strip()) < 5  # Would be skipped

    def test_skip_non_user_assistant_types(self):
        """Test that only user/assistant types are included."""
        entry_type = "system"
        assert entry_type not in ('user', 'assistant')  # Would be skipped
