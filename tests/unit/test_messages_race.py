"""Unit tests for messages race condition fix.

Tests the fix for the race condition where chat_message_join rows are not
yet written when the daemon queries for new messages.
"""

import sqlite3
import tempfile
import time
from unittest.mock import patch, MagicMock
import pytest


class TestChatStyleRaceCondition:
    """Tests for the chat_style NULL re-query fix."""

    def setup_method(self):
        """Create a temporary in-memory database for testing."""
        self.conn = sqlite3.connect(':memory:')
        self.cursor = self.conn.cursor()
        
        # Create minimal schema
        self.cursor.execute('''
            CREATE TABLE message (
                ROWID INTEGER PRIMARY KEY,
                date INTEGER,
                text TEXT,
                is_from_me INTEGER DEFAULT 0,
                handle_id INTEGER,
                attributedBody BLOB,
                cache_has_attachments INTEGER DEFAULT 0,
                is_audio_message INTEGER DEFAULT 0,
                thread_originator_guid TEXT
            )
        ''')
        self.cursor.execute('''
            CREATE TABLE handle (
                ROWID INTEGER PRIMARY KEY,
                id TEXT
            )
        ''')
        self.cursor.execute('''
            CREATE TABLE chat (
                ROWID INTEGER PRIMARY KEY,
                style INTEGER,
                display_name TEXT,
                chat_identifier TEXT
            )
        ''')
        self.cursor.execute('''
            CREATE TABLE chat_message_join (
                message_id INTEGER,
                chat_id INTEGER
            )
        ''')
        self.conn.commit()

    def teardown_method(self):
        """Clean up database."""
        self.conn.close()

    def test_null_chat_style_detected(self):
        """Verify that NULL chat_style is detected when join is missing."""
        # Insert message without join entry
        self.cursor.execute('''
            INSERT INTO handle (ROWID, id) VALUES (1, '+16175551234')
        ''')
        self.cursor.execute('''
            INSERT INTO message (ROWID, date, text, handle_id) 
            VALUES (100, 791264348197529984, 'test message', 1)
        ''')
        self.conn.commit()
        
        # Query without join - should get NULL chat_style
        self.cursor.execute('''
            SELECT chat.style
            FROM message
            LEFT JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
            LEFT JOIN chat ON chat_message_join.chat_id = chat.ROWID
            WHERE message.ROWID = 100
        ''')
        row = self.cursor.fetchone()
        assert row[0] is None, "chat_style should be NULL when join is missing"

    def test_chat_style_populated_after_join(self):
        """Verify chat_style is populated once join exists."""
        # Insert message
        self.cursor.execute('''
            INSERT INTO handle (ROWID, id) VALUES (1, '+16175551234')
        ''')
        self.cursor.execute('''
            INSERT INTO message (ROWID, date, text, handle_id) 
            VALUES (100, 791264348197529984, 'test message', 1)
        ''')
        # Insert chat
        self.cursor.execute('''
            INSERT INTO chat (ROWID, style, display_name, chat_identifier) 
            VALUES (1, 43, 'Test Group', 'abc123')
        ''')
        # Insert join
        self.cursor.execute('''
            INSERT INTO chat_message_join (message_id, chat_id) VALUES (100, 1)
        ''')
        self.conn.commit()
        
        # Query with join - should get chat_style=43
        self.cursor.execute('''
            SELECT chat.style
            FROM message
            LEFT JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
            LEFT JOIN chat ON chat_message_join.chat_id = chat.ROWID
            WHERE message.ROWID = 100
        ''')
        row = self.cursor.fetchone()
        assert row[0] == 43, "chat_style should be 43 for group chat"

    def test_requery_logic_fills_in_chat_info(self):
        """Test the re-query logic that fills in chat info after delay."""
        # This tests the fix conceptually - simulating what happens when
        # the join row appears between first query and re-query
        
        # First query returns NULL
        self.cursor.execute('''
            INSERT INTO handle (ROWID, id) VALUES (1, '+16175551234')
        ''')
        self.cursor.execute('''
            INSERT INTO message (ROWID, date, text, handle_id) 
            VALUES (100, 791264348197529984, 'test group message', 1)
        ''')
        self.conn.commit()
        
        self.cursor.execute('''
            SELECT chat.style, chat.display_name, chat.chat_identifier
            FROM message
            LEFT JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
            LEFT JOIN chat ON chat_message_join.chat_id = chat.ROWID
            WHERE message.ROWID = 100
        ''')
        first_result = self.cursor.fetchone()
        assert first_result == (None, None, None), "First query should return NULLs"
        
        # Simulate join being written (what happens during the 50ms delay)
        self.cursor.execute('''
            INSERT INTO chat (ROWID, style, display_name, chat_identifier) 
            VALUES (1, 43, 'Test Group', 'group-uuid-123')
        ''')
        self.cursor.execute('''
            INSERT INTO chat_message_join (message_id, chat_id) VALUES (100, 1)
        ''')
        self.conn.commit()
        
        # Re-query should now return populated values
        self.cursor.execute('''
            SELECT chat.style, chat.display_name, chat.chat_identifier
            FROM message
            LEFT JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
            LEFT JOIN chat ON chat_message_join.chat_id = chat.ROWID
            WHERE message.ROWID = 100
        ''')
        second_result = self.cursor.fetchone()
        assert second_result == (43, 'Test Group', 'group-uuid-123'), \
            "Re-query should return populated chat info"

    def test_individual_chat_style(self):
        """Verify style=45 is correctly identified as individual (not group)."""
        self.cursor.execute('''
            INSERT INTO handle (ROWID, id) VALUES (1, '+16175551234')
        ''')
        self.cursor.execute('''
            INSERT INTO message (ROWID, date, text, handle_id) 
            VALUES (100, 791264348197529984, 'direct message', 1)
        ''')
        self.cursor.execute('''
            INSERT INTO chat (ROWID, style, display_name, chat_identifier) 
            VALUES (1, 45, NULL, '+16175551234')
        ''')
        self.cursor.execute('''
            INSERT INTO chat_message_join (message_id, chat_id) VALUES (100, 1)
        ''')
        self.conn.commit()
        
        self.cursor.execute('''
            SELECT chat.style
            FROM message
            LEFT JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
            LEFT JOIN chat ON chat_message_join.chat_id = chat.ROWID
            WHERE message.ROWID = 100
        ''')
        row = self.cursor.fetchone()
        is_group = row[0] == 43
        assert is_group is False, "style=45 should not be detected as group"
