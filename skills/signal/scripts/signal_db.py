#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
signal_db.py - SQLite database for Signal message history

Stores Signal messages locally since signal-cli doesn't persist history.
Database location: ~/Library/Application Support/signal-cli/messages.db

Usage:
    from signal_db import SignalDB

    db = SignalDB()
    db.store_message(...)
    messages = db.read_messages(chat_id="+1234567890", limit=20)
"""

import sqlite3
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

# Database location (outside git repo, alongside signal-cli data)
DB_DIR = Path.home() / "Library/Application Support/signal-cli"
DB_PATH = DB_DIR / "messages.db"

# Schema version for migrations
SCHEMA_VERSION = 1


class SignalDB:
    """SQLite database for storing Signal message history."""

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._ensure_db()

    def _ensure_db(self):
        """Create database and tables if they don't exist."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        # Create messages table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                chat_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                is_from_me INTEGER NOT NULL DEFAULT 0,
                text TEXT,
                attachments TEXT,
                group_name TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Create indexes for fast lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_chat_id
            ON messages(chat_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp
            ON messages(timestamp DESC)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp
            ON messages(chat_id, timestamp DESC)
        """)

        # Index for deduplication queries (message_exists)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_dedup
            ON messages(timestamp, chat_id, sender)
        """)

        # Schema version table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            )
        """)
        cursor.execute("INSERT OR IGNORE INTO schema_version VALUES (?)", (SCHEMA_VERSION,))

        conn.commit()
        conn.close()

    def store_message(
        self,
        timestamp: int,
        chat_id: str,
        sender: str,
        text: Optional[str] = None,
        is_from_me: bool = False,
        attachments: Optional[list] = None,
        group_name: Optional[str] = None,
    ) -> int:
        """Store a message in the database.

        Args:
            timestamp: Unix timestamp in milliseconds
            chat_id: Phone number or group ID
            sender: Sender phone number or "me"
            text: Message text
            is_from_me: True if sent by us
            attachments: List of attachment dicts (serialized as JSON)
            group_name: Group name if group message

        Returns:
            The inserted row ID
        """
        import json

        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        attachments_json = json.dumps(attachments) if attachments else None

        cursor.execute("""
            INSERT INTO messages (timestamp, chat_id, sender, is_from_me, text, attachments, group_name)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (timestamp, chat_id, sender, 1 if is_from_me else 0, text, attachments_json, group_name))

        row_id = cursor.lastrowid
        conn.commit()
        conn.close()

        return row_id

    def read_messages(
        self,
        chat_id: str,
        limit: int = 20,
        since: Optional[str] = None,
        until: Optional[str] = None,
    ) -> list:
        """Read messages from a chat.

        Args:
            chat_id: Phone number or group ID
            limit: Max messages to return
            since: Start time filter (YYYY-MM-DD HH:MM:SS)
            until: End time filter (YYYY-MM-DD HH:MM:SS)

        Returns:
            List of message dicts in chronological order
        """
        import json

        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        query = """
            SELECT id, timestamp, sender, is_from_me, text, attachments, group_name
            FROM messages
            WHERE chat_id = ?
        """
        params = [chat_id]

        if since:
            since_dt = datetime.strptime(since, "%Y-%m-%d %H:%M:%S")
            since_ts = int(since_dt.timestamp() * 1000)
            query += " AND timestamp >= ?"
            params.append(since_ts)

        if until:
            until_dt = datetime.strptime(until, "%Y-%m-%d %H:%M:%S")
            until_ts = int(until_dt.timestamp() * 1000)
            query += " AND timestamp <= ?"
            params.append(until_ts)

        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)

        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        messages = []
        for row in rows:
            row_id, timestamp, sender, is_from_me, text, attachments_json, group_name = row

            # Convert timestamp to datetime string
            dt = datetime.fromtimestamp(timestamp / 1000)

            messages.append({
                "rowid": row_id,
                "timestamp": dt.strftime("%Y-%m-%d %H:%M:%S"),
                "phone": "me" if is_from_me else sender,
                "direction": "OUT" if is_from_me else "IN",
                "text": text or "",
                "attachments": json.loads(attachments_json) if attachments_json else [],
                "group_name": group_name,
            })

        # Return in chronological order (oldest first)
        return list(reversed(messages))

    def message_exists(self, timestamp: int, chat_id: str, sender: str) -> bool:
        """Check if a message already exists (for deduplication).

        Args:
            timestamp: Unix timestamp in milliseconds
            chat_id: Phone number or group ID
            sender: Sender identifier

        Returns:
            True if message exists
        """
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        cursor.execute("""
            SELECT 1 FROM messages
            WHERE timestamp = ? AND chat_id = ? AND sender = ?
            LIMIT 1
        """, (timestamp, chat_id, sender))

        exists = cursor.fetchone() is not None
        conn.close()

        return exists


# Convenience functions for CLI usage
def get_db() -> SignalDB:
    """Get a SignalDB instance."""
    return SignalDB()


if __name__ == "__main__":
    # Quick test
    db = SignalDB()
    print(f"Database initialized at: {db.db_path}")

    # Test insert
    row_id = db.store_message(
        timestamp=int(datetime.now().timestamp() * 1000),
        chat_id="+15555551234",
        sender="+15555551234",
        text="Test message",
        is_from_me=False,
    )
    print(f"Inserted test message with ID: {row_id}")

    # Test read
    messages = db.read_messages("+15555551234", limit=5)
    print(f"Found {len(messages)} messages")
    for msg in messages:
        print(f"  {msg['timestamp']} | {msg['phone']} | {msg['direction']} | {msg['text']}")
