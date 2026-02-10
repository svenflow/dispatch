#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Export SMS messages from iMessage chat.db to markdown files for indexing.
Each contact gets their own markdown file with their conversation history.
"""

import argparse
import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path


CHAT_DB = Path.home() / "Library/Messages/chat.db"


def get_conversations(db_path: Path, since_days: int = 30) -> dict[str, list[dict]]:
    """Get conversations grouped by chat identifier."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # macOS epoch offset (2001-01-01)
    macos_epoch = datetime(2001, 1, 1)
    since_date = datetime.now() - timedelta(days=since_days)
    since_ns = int((since_date - macos_epoch).total_seconds() * 1e9)

    query = """
        SELECT
            c.chat_identifier,
            c.display_name,
            m.text,
            m.date,
            m.is_from_me,
            h.id as sender_phone
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.date > ?
        AND m.text IS NOT NULL
        AND m.text != ''
        ORDER BY c.chat_identifier, m.date
    """

    conversations: dict[str, list[dict]] = {}

    for row in conn.execute(query, (since_ns,)):
        chat_id = row['chat_identifier']

        # Convert timestamp
        ts_seconds = row['date'] / 1e9
        msg_time = macos_epoch + timedelta(seconds=ts_seconds)

        msg = {
            'text': row['text'],
            'time': msg_time,
            'is_from_me': row['is_from_me'],
            'sender': row['sender_phone'] or 'Me',
            'display_name': row['display_name'] or chat_id,
        }

        if chat_id not in conversations:
            conversations[chat_id] = []
        conversations[chat_id].append(msg)

    conn.close()
    return conversations


def export_to_markdown(conversations: dict, output_dir: Path):
    """Export conversations to markdown files."""
    output_dir.mkdir(parents=True, exist_ok=True)

    for chat_id, messages in conversations.items():
        if not messages:
            continue

        # Create safe filename
        safe_name = chat_id.replace('+', '').replace('@', '_').replace('.', '_')
        if len(safe_name) > 50:
            safe_name = safe_name[:50]

        filename = output_dir / f"{safe_name}.md"
        display_name = messages[0]['display_name']

        with open(filename, 'w') as f:
            f.write(f"# SMS Conversation: {display_name}\n\n")
            f.write(f"Chat ID: {chat_id}\n\n")
            f.write("---\n\n")

            current_date = None
            for msg in messages:
                msg_date = msg['time'].strftime('%Y-%m-%d')
                if msg_date != current_date:
                    f.write(f"\n## {msg_date}\n\n")
                    current_date = msg_date

                time_str = msg['time'].strftime('%H:%M')
                sender = "Me" if msg['is_from_me'] else msg['sender']
                text = msg['text'].replace('\n', '\n  ')

                f.write(f"**{time_str} {sender}:** {text}\n\n")

        print(f"Exported: {filename.name} ({len(messages)} messages)")


def main():
    parser = argparse.ArgumentParser(description="Export SMS to markdown")
    parser.add_argument("--output", "-o", default="~/.cache/jsmith-search/sms-export",
                        help="Output directory")
    parser.add_argument("--days", "-d", type=int, default=30,
                        help="Export messages from last N days (default: 30)")
    parser.add_argument("--chat", "-c", help="Export only this chat ID")
    args = parser.parse_args()

    output_dir = Path(args.output).expanduser()

    print(f"Exporting SMS from last {args.days} days...")
    conversations = get_conversations(CHAT_DB, args.days)

    if args.chat:
        conversations = {k: v for k, v in conversations.items() if k == args.chat}

    print(f"Found {len(conversations)} conversations")
    export_to_markdown(conversations, output_dir)
    print(f"\nExported to: {output_dir}")


if __name__ == "__main__":
    main()
