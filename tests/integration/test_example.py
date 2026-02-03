"""
Example integration tests demonstrating test infrastructure.

These tests show how to use the test doubles and fixtures.
Run with: uv run pytest tests/integration/ -v
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

# Path to test binaries
TEST_BIN_DIR = Path(__file__).parent.parent / 'bin'


class TestTestDoubles:
    """Verify the test doubles work correctly."""

    def test_test_claude_responds(self, test_env):
        """Test that test-claude returns canned responses."""
        result = subprocess.run(
            [str(TEST_BIN_DIR / 'test-claude'), 'Hello there'],
            capture_output=True,
            text=True,
            env={**dict(__import__('os').environ), **test_env['env']},
        )

        assert result.returncode == 0
        assert 'test-claude' in result.stdout or 'Hello' in result.stdout

    def test_test_claude_logs_invocation(self, test_env, read_log):
        """Test that test-claude logs what it receives."""
        subprocess.run(
            [str(TEST_BIN_DIR / 'test-claude'), '-r', '-p', 'Test prompt'],
            capture_output=True,
            text=True,
            env={**dict(__import__('os').environ), **test_env['env']},
        )

        logs = read_log(test_env['claude_log'])
        assert len(logs) == 1
        assert logs[0]['args']['resume'] is True
        assert logs[0]['args']['print_mode'] is True
        assert logs[0]['args']['prompt'] == 'Test prompt'

    def test_test_sms_logs_message(self, test_env, read_log):
        """Test that test-sms logs messages without sending."""
        result = subprocess.run(
            [str(TEST_BIN_DIR / 'test-sms'), '+16175551234', 'Hello world'],
            capture_output=True,
            text=True,
            env={**dict(__import__('os').environ), **test_env['env']},
        )

        assert result.returncode == 0
        assert 'sent' in result.stdout.lower()

        logs = read_log(test_env['sms_log'])
        assert len(logs) == 1
        assert logs[0]['phone'] == '+16175551234'
        assert logs[0]['message'] == 'Hello world'
        assert logs[0]['success'] is True

    def test_test_contacts_lookup(self, test_env, read_log):
        """Test that test-contacts returns test data."""
        result = subprocess.run(
            [str(TEST_BIN_DIR / 'test-contacts'), 'lookup', '+16175551234'],
            capture_output=True,
            text=True,
            env={**dict(__import__('os').environ), **test_env['env']},
        )

        assert result.returncode == 0
        contact = json.loads(result.stdout)
        assert contact['name'] == 'Test Admin'
        assert contact['tier'] == 'admin'

        logs = read_log(test_env['contacts_log'])
        assert len(logs) == 1
        assert logs[0]['operation'] == 'lookup'


class TestChatDBFixture:
    """Test the fake chat database fixtures."""

    def test_chatdb_add_message(self, chatdb_helper):
        """Test adding messages to fake chat.db."""
        rowid = chatdb_helper.add_message(
            text='Hello from test',
            sender_phone='+16175551234',
        )

        assert rowid == 1
        assert chatdb_helper.get_last_rowid() == 1

    def test_chatdb_multiple_messages(self, chatdb_helper):
        """Test adding multiple messages."""
        chatdb_helper.add_message('First', '+16175551234')
        chatdb_helper.add_message('Second', '+16175555678')
        chatdb_helper.add_message('Third', '+16175551234')

        assert chatdb_helper.get_last_rowid() == 3

    def test_chatdb_group_message(self, chatdb_helper):
        """Test adding group chat messages."""
        group_id = 'abc123def456'
        chatdb_helper.add_message(
            text='Hello group',
            sender_phone='+16175551234',
            chat_id=group_id,
        )

        assert chatdb_helper.get_last_rowid() == 1


class TestEnvironmentIsolation:
    """Verify tests are properly isolated."""

    def test_env_variables_set(self, set_test_env):
        """Test that environment variables are properly set."""
        import os

        assert 'CLAUDE_ASSISTANT_REGISTRY' in os.environ
        assert 'test-claude' in os.environ.get('CLAUDE_ASSISTANT_CLAUDE_BIN', '')

    def test_logs_isolated_between_tests_1(self, test_env, read_log):
        """First test - writes to log."""
        subprocess.run(
            [str(TEST_BIN_DIR / 'test-sms'), '+16175551234', 'Test 1'],
            env={**dict(__import__('os').environ), **test_env['env']},
        )

        logs = read_log(test_env['sms_log'])
        # Should only have our message, not from other tests
        assert len(logs) == 1
        assert logs[0]['message'] == 'Test 1'

    def test_logs_isolated_between_tests_2(self, test_env, read_log):
        """Second test - should have fresh logs."""
        subprocess.run(
            [str(TEST_BIN_DIR / 'test-sms'), '+16175559999', 'Test 2'],
            env={**dict(__import__('os').environ), **test_env['env']},
        )

        logs = read_log(test_env['sms_log'])
        # Should only have our message, not from test 1
        assert len(logs) == 1
        assert logs[0]['message'] == 'Test 2'
