#!/usr/bin/env -S uv run --script
"""
Extract Apple's built-in audio transcription from iMessage audio messages.

Usage:
    python transcribe_audio.py                    # Get latest audio message transcription
    python transcribe_audio.py --rowid 1602       # Get specific message by ROWID
    python transcribe_audio.py --phone +1234567890 # Get latest audio from phone number
"""

import argparse
import sqlite3
import re
from pathlib import Path

MESSAGES_DB = Path.home() / "Library/Messages/chat.db"

def extract_transcription(attributed_body: bytes) -> str:
    """Extract IMAudioTranscription from attributedBody blob."""
    if not attributed_body:
        return ""

    # Decode as utf-8, ignoring errors
    text = attributed_body.decode('utf-8', errors='ignore')

    # Look for IMAudioTranscription followed by the text
    # The format is: IMAudioTranscription<length_byte><transcription_text>
    match = re.search(r'IMAudioTranscription.(.+?)(?:__kIM|$)', text, re.DOTALL)
    if match:
        raw = match.group(1)
        # Clean up: remove non-printable characters except spaces
        cleaned = ''.join(c for c in raw if c.isprintable() or c == ' ')
        # Remove leading length byte artifacts
        cleaned = cleaned.strip()
        if cleaned and cleaned[0].isdigit():
            # Skip leading digit (length indicator)
            cleaned = cleaned[1:].strip()
        # Remove trailing & or other artifacts
        cleaned = cleaned.rstrip('&').strip()
        return cleaned

    return ""

def get_latest_audio_transcription(phone: str | None = None) -> dict:
    """Get the most recent audio message transcription."""
    conn = sqlite3.connect(str(MESSAGES_DB))

    if phone:
        # Normalize phone number
        phone_clean = re.sub(r'[^\d+]', '', phone)
        query = """
            SELECT m.ROWID, m.attributedBody, m.date, h.id
            FROM message m
            JOIN handle h ON m.handle_id = h.ROWID
            WHERE m.is_audio_message = 1
            AND (h.id = ? OR h.id LIKE ?)
            ORDER BY m.ROWID DESC
            LIMIT 1
        """
        cursor = conn.execute(query, (phone_clean, f"%{phone_clean[-10:]}%"))
    else:
        query = """
            SELECT m.ROWID, m.attributedBody, m.date, h.id
            FROM message m
            JOIN handle h ON m.handle_id = h.ROWID
            WHERE m.is_audio_message = 1
            ORDER BY m.ROWID DESC
            LIMIT 1
        """
        cursor = conn.execute(query)

    row = cursor.fetchone()
    conn.close()

    if row:
        rowid, attr_body, date, sender = row
        transcription = extract_transcription(attr_body) if attr_body else ""
        return {
            "rowid": rowid,
            "transcription": transcription,
            "sender": sender,
            "has_transcription": bool(transcription)
        }

    return {"error": "No audio message found"}

def get_transcription_by_rowid(rowid: int) -> dict:
    """Get transcription for a specific message ROWID."""
    conn = sqlite3.connect(str(MESSAGES_DB))

    query = """
        SELECT m.ROWID, m.attributedBody, m.date, h.id
        FROM message m
        JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.ROWID = ?
    """
    cursor = conn.execute(query, (rowid,))
    row = cursor.fetchone()
    conn.close()

    if row:
        rowid, attr_body, date, sender = row
        transcription = extract_transcription(attr_body) if attr_body else ""
        return {
            "rowid": rowid,
            "transcription": transcription,
            "sender": sender,
            "has_transcription": bool(transcription)
        }

    return {"error": f"Message {rowid} not found"}

def main():
    parser = argparse.ArgumentParser(description="Extract audio transcription from iMessage")
    parser.add_argument("--rowid", type=int, help="Message ROWID to transcribe")
    parser.add_argument("--phone", type=str, help="Phone number to get latest audio from")

    args = parser.parse_args()

    if args.rowid:
        result = get_transcription_by_rowid(args.rowid)
    else:
        result = get_latest_audio_transcription(args.phone)

    if "error" in result:
        print(f"ERROR|{result['error']}")
    elif result.get("has_transcription"):
        print(f"TRANSCRIPTION|{result['sender']}|{result['transcription']}")
    else:
        print(f"NO_TRANSCRIPTION|{result['sender']}|Audio message has no transcription yet")

if __name__ == "__main__":
    main()
