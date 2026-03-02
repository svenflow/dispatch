#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
WAL visibility test - compare persistent connection vs fresh connection polling.

Tests two approaches:
1. FRESH: New sqlite3.connect() each poll (current approach)
2. PERSISTENT: Single connection with isolation_level=None (autocommit)

Run this while sending test messages to see which approach has lower latency.
"""

import sqlite3
import time
import sys
from pathlib import Path
from datetime import datetime

MESSAGES_DB = Path.home() / "Library/Messages/chat.db"

# Apple's Cocoa epoch (2001-01-01 00:00:00 UTC)
COCOA_EPOCH = 978307200


def apple_to_unix(apple_ts: int) -> float:
    """Convert Apple nanosecond timestamp to Unix timestamp."""
    return (apple_ts / 1_000_000_000) + COCOA_EPOCH


def get_latest_message_fresh(db_path: Path, since_rowid: int) -> list:
    """Poll with fresh connection (current approach)."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ROWID, date, text
        FROM message
        WHERE ROWID > ?
        ORDER BY ROWID ASC
        LIMIT 10
    """, (since_rowid,))
    rows = cursor.fetchall()
    conn.close()
    return rows


def get_latest_message_persistent(conn: sqlite3.Connection, since_rowid: int) -> list:
    """Poll with persistent autocommit connection."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ROWID, date, text
        FROM message
        WHERE ROWID > ?
        ORDER BY ROWID ASC
        LIMIT 10
    """, (since_rowid,))
    rows = cursor.fetchall()
    cursor.close()  # Important: close cursor to finalize query
    return rows


def main():
    print("WAL Visibility Test")
    print("=" * 60)
    print(f"Database: {MESSAGES_DB}")
    print()

    # Get current max rowid
    conn = sqlite3.connect(MESSAGES_DB)
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(ROWID) FROM message")
    start_rowid = cursor.fetchone()[0] or 0
    conn.close()

    print(f"Starting from ROWID: {start_rowid}")
    print("Send test messages to your iMessage. Press Ctrl+C to stop.")
    print()
    print(f"{'Time':12} {'ROWID':8} {'Method':12} {'Latency':12} {'Message'}")
    print("-" * 80)

    # Create persistent connection with autocommit
    persistent_conn = sqlite3.connect(MESSAGES_DB, timeout=10, isolation_level=None)
    persistent_conn.execute("PRAGMA journal_mode=WAL")

    last_rowid_fresh = start_rowid
    last_rowid_persistent = start_rowid

    try:
        while True:
            now = time.time()

            # Test fresh connection
            rows_fresh = get_latest_message_fresh(MESSAGES_DB, last_rowid_fresh)
            for rowid, date, text in rows_fresh:
                msg_time = apple_to_unix(date)
                latency_ms = (now - msg_time) * 1000
                text_preview = (text or "")[:30].replace("\n", " ")
                print(f"{datetime.now().strftime('%H:%M:%S.%f')[:12]} {rowid:8} {'FRESH':12} {latency_ms:8.0f}ms   {text_preview}")
                last_rowid_fresh = max(last_rowid_fresh, rowid)

            # Test persistent connection
            rows_persistent = get_latest_message_persistent(persistent_conn, last_rowid_persistent)
            for rowid, date, text in rows_persistent:
                msg_time = apple_to_unix(date)
                latency_ms = (now - msg_time) * 1000
                text_preview = (text or "")[:30].replace("\n", " ")
                print(f"{datetime.now().strftime('%H:%M:%S.%f')[:12]} {rowid:8} {'PERSISTENT':12} {latency_ms:8.0f}ms   {text_preview}")
                last_rowid_persistent = max(last_rowid_persistent, rowid)

            time.sleep(0.1)  # 100ms poll

    except KeyboardInterrupt:
        print("\n\nStopped.")
    finally:
        persistent_conn.close()


if __name__ == "__main__":
    main()
