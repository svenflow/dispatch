"""
Fixtures for integration tests.

These fixtures set up test doubles (fake CLIs) and isolated test environments
so integration tests never touch real data or external services.
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path
from typing import Dict, List

import pytest

# Path to test binaries
TEST_BIN_DIR = Path(__file__).parent.parent / 'bin'


@pytest.fixture
def test_env(tmp_path):
    """
    Set up isolated test environment with all paths configured.

    Returns a dict with:
        - paths to all test artifacts
        - environment variables to set
        - cleanup function
    """
    # Create directory structure
    transcripts_dir = tmp_path / 'transcripts'
    transcripts_dir.mkdir()

    registry_path = tmp_path / 'registry.json'
    pid_file = tmp_path / 'daemon.pid'
    log_file = tmp_path / 'daemon.log'

    # Log files for test doubles
    claude_log = tmp_path / 'test-claude.log'
    sms_log = tmp_path / 'test-sms.log'
    contacts_log = tmp_path / 'test-contacts.log'
    contacts_db = tmp_path / 'test-contacts.json'

    # Environment variables for test doubles
    env = {
        'TEST_CLAUDE_LOG': str(claude_log),
        'TEST_CLAUDE_MODE': 'canned',
        'TEST_SMS_LOG': str(sms_log),
        'TEST_SMS_MODE': 'success',
        'TEST_CONTACTS_LOG': str(contacts_log),
        'TEST_CONTACTS_DB': str(contacts_db),
        # Override paths in manager
        'CLAUDE_ASSISTANT_REGISTRY': str(registry_path),
        'CLAUDE_ASSISTANT_TRANSCRIPTS': str(transcripts_dir),
        'CLAUDE_ASSISTANT_PID_FILE': str(pid_file),
        'CLAUDE_ASSISTANT_LOG_FILE': str(log_file),
        # Point to test binaries
        'CLAUDE_ASSISTANT_CLAUDE_BIN': str(TEST_BIN_DIR / 'test-claude'),
        'CLAUDE_ASSISTANT_SMS_BIN': str(TEST_BIN_DIR / 'test-sms'),
        'CLAUDE_ASSISTANT_CONTACTS_BIN': str(TEST_BIN_DIR / 'test-contacts'),
    }

    return {
        'tmp_path': tmp_path,
        'transcripts_dir': transcripts_dir,
        'registry_path': registry_path,
        'pid_file': pid_file,
        'log_file': log_file,
        'claude_log': claude_log,
        'sms_log': sms_log,
        'contacts_log': contacts_log,
        'contacts_db': contacts_db,
        'env': env,
    }


@pytest.fixture
def set_test_env(test_env, monkeypatch):
    """Apply test environment variables."""
    for key, value in test_env['env'].items():
        monkeypatch.setenv(key, value)
    return test_env


@pytest.fixture
def fake_chatdb(tmp_path):
    """
    Create a minimal Messages.app chat.db schema for testing.

    Returns the path to the test database.
    """
    db_path = tmp_path / 'chat.db'
    conn = sqlite3.connect(db_path)

    # Create minimal schema matching Messages.app
    conn.executescript('''
        CREATE TABLE handle (
            ROWID INTEGER PRIMARY KEY,
            id TEXT UNIQUE,
            service TEXT DEFAULT 'iMessage'
        );

        CREATE TABLE chat (
            ROWID INTEGER PRIMARY KEY,
            chat_identifier TEXT,
            display_name TEXT,
            group_id TEXT
        );

        CREATE TABLE message (
            ROWID INTEGER PRIMARY KEY,
            guid TEXT UNIQUE,
            text TEXT,
            handle_id INTEGER,
            date INTEGER,
            is_from_me INTEGER DEFAULT 0,
            cache_roomnames TEXT,
            associated_message_type INTEGER DEFAULT 0,
            FOREIGN KEY (handle_id) REFERENCES handle(ROWID)
        );

        CREATE TABLE chat_message_join (
            chat_id INTEGER,
            message_id INTEGER,
            PRIMARY KEY (chat_id, message_id)
        );

        CREATE TABLE chat_handle_join (
            chat_id INTEGER,
            handle_id INTEGER,
            PRIMARY KEY (chat_id, handle_id)
        );
    ''')
    conn.commit()
    conn.close()

    return db_path


@pytest.fixture
def chatdb_helper(fake_chatdb):
    """
    Helper class for manipulating the test chat database.
    """
    class ChatDBHelper:
        def __init__(self, db_path):
            self.db_path = db_path
            self._next_rowid = 1
            self._handles = {}
            self._chats = {}

        def _get_conn(self):
            return sqlite3.connect(self.db_path)

        def add_handle(self, phone: str) -> int:
            """Add a handle (contact) and return its ROWID."""
            if phone in self._handles:
                return self._handles[phone]

            conn = self._get_conn()
            cursor = conn.execute(
                'INSERT INTO handle (id) VALUES (?)',
                (phone,)
            )
            handle_id = cursor.lastrowid
            conn.commit()
            conn.close()

            self._handles[phone] = handle_id
            return handle_id

        def add_chat(self, chat_id: str, display_name: str | None = None, is_group: bool = False) -> int:
            """Add a chat and return its ROWID."""
            if chat_id in self._chats:
                return self._chats[chat_id]

            conn = self._get_conn()
            cursor = conn.execute(
                'INSERT INTO chat (chat_identifier, display_name, group_id) VALUES (?, ?, ?)',
                (chat_id, display_name, chat_id if is_group else None)
            )
            rowid = cursor.lastrowid
            conn.commit()
            conn.close()

            self._chats[chat_id] = rowid
            return rowid

        def add_message(
            self,
            text: str,
            sender_phone: str,
            chat_id: str | None = None,
            is_from_me: bool = False,
            timestamp: int | None = None,
        ) -> int:
            """
            Add a message to the database.

            Args:
                text: Message content
                sender_phone: Phone number of sender
                chat_id: Chat identifier (defaults to sender_phone for 1:1)
                is_from_me: Whether message is outgoing
                timestamp: Core Data timestamp (defaults to now)

            Returns:
                Message ROWID
            """
            import time

            # Default chat_id to sender for 1:1 chats
            if chat_id is None:
                chat_id = sender_phone

            # Ensure handle exists
            handle_id = self.add_handle(sender_phone)

            # Ensure chat exists
            is_group = chat_id != sender_phone
            chat_rowid = self.add_chat(chat_id, is_group=is_group)

            # Core Data timestamp (nanoseconds since 2001-01-01)
            if timestamp is None:
                # Convert Unix timestamp to Core Data
                unix_ts = time.time()
                timestamp = int((unix_ts - 978307200) * 1e9)

            conn = self._get_conn()

            # Insert message
            cursor = conn.execute('''
                INSERT INTO message (guid, text, handle_id, date, is_from_me, cache_roomnames)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                f'msg-{self._next_rowid}',
                text,
                handle_id,
                timestamp,
                1 if is_from_me else 0,
                chat_id if is_group else None,
            ))
            msg_rowid = cursor.lastrowid
            self._next_rowid += 1

            # Link to chat
            conn.execute(
                'INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)',
                (chat_rowid, msg_rowid)
            )

            # Link handle to chat
            conn.execute(
                'INSERT OR IGNORE INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)',
                (chat_rowid, handle_id)
            )

            conn.commit()
            conn.close()

            return msg_rowid

        def get_last_rowid(self) -> int:
            """Get the highest message ROWID."""
            conn = self._get_conn()
            cursor = conn.execute('SELECT MAX(ROWID) FROM message')
            result = cursor.fetchone()[0]
            conn.close()
            return result or 0

    return ChatDBHelper(fake_chatdb)


@pytest.fixture
def read_log():
    """Helper to read JSON log files created by test doubles."""
    def _read_log(log_path: Path) -> list[dict]:
        if not log_path.exists():
            return []
        entries = []
        with open(log_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    entries.append(json.loads(line))
        return entries

    return _read_log


@pytest.fixture
def clear_logs(test_env):
    """Clear all test double log files."""
    def _clear():
        for log_name in ['claude_log', 'sms_log', 'contacts_log']:
            log_path = test_env[log_name]
            if log_path.exists():
                log_path.unlink()

    return _clear
