#!/usr/bin/env python3
"""FastAPI server for Chat Viewer."""
from __future__ import annotations

import json
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

CHAT_DB = Path.home() / "Library/Messages/chat.db"
CLAUDE_PROJECTS = Path.home() / ".claude/projects"
CONTACTS_SCRIPT = Path.home() / ".claude/skills/contacts/scripts/lookup_phone.scpt"
ATTACHMENTS_DIR = Path.home() / "Library/Messages/Attachments"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve attachments
app.mount("/attachments", StaticFiles(directory=str(ATTACHMENTS_DIR)), name="attachments")


def lookup_contact_name(phone: str) -> str | None:
    """Look up contact name from phone number."""
    if not CONTACTS_SCRIPT.exists():
        return None
    try:
        result = subprocess.run(
            ["osascript", str(CONTACTS_SCRIPT), phone],
            capture_output=True, text=True, timeout=2
        )
        output = result.stdout.strip()
        if output.startswith("FOUND|"):
            parts = output.split("|")
            if len(parts) >= 2:
                return parts[1]
    except:
        pass
    return None


def get_group_participants(cursor, chat_identifier: str) -> list[str]:
    """Get participant names for a group chat."""
    cursor.execute("""
        SELECT h.id
        FROM handle h
        JOIN chat_handle_join chj ON h.ROWID = chj.handle_id
        JOIN chat c ON chj.chat_id = c.ROWID
        WHERE c.chat_identifier = ?
    """, (chat_identifier,))

    participants = []
    for row in cursor.fetchall():
        phone = row[0]
        name = lookup_contact_name(phone)
        participants.append(name if name else phone)
    return participants


def get_attachment_info(cursor, message_rowid: int) -> dict | None:
    """Get attachment info for a message."""
    cursor.execute("""
        SELECT a.mime_type, a.filename, a.uti, a.total_bytes
        FROM attachment a
        JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
        WHERE maj.message_id = ?
        LIMIT 1
    """, (message_rowid,))

    row = cursor.fetchone()
    if not row:
        return None

    mime_type, filename, uti, total_bytes = row

    # Determine attachment type
    if mime_type:
        if mime_type.startswith("image/"):
            att_type = "image"
        elif mime_type.startswith("video/"):
            att_type = "video"
        elif mime_type.startswith("audio/"):
            att_type = "audio"
        elif "vcard" in mime_type:
            att_type = "contact"
        else:
            att_type = "file"
    else:
        att_type = "file"

    # Get relative path for serving
    url = None
    if filename and "Library/Messages/Attachments" in filename:
        # Extract path after Attachments/
        rel_path = filename.split("Library/Messages/Attachments/")[-1]
        url = f"/attachments/{rel_path}"

    return {
        "type": att_type,
        "mime_type": mime_type,
        "filename": Path(filename).name if filename else None,
        "url": url,
        "size": total_bytes,
    }


@app.get("/api/chats")
def get_chats():
    """Get list of conversations."""
    conversations = []

    try:
        conn = sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                c.chat_identifier,
                c.display_name,
                c.style,
                MAX(m.date) as last_date,
                (SELECT text FROM message m2
                 JOIN chat_message_join cmj2 ON m2.ROWID = cmj2.message_id
                 WHERE cmj2.chat_id = c.ROWID
                 ORDER BY m2.date DESC LIMIT 1) as last_text
            FROM chat c
            LEFT JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
            LEFT JOIN message m ON cmj.message_id = m.ROWID
            GROUP BY c.ROWID
            HAVING last_date IS NOT NULL
            ORDER BY last_date DESC
            LIMIT 50
        """)

        for row in cursor.fetchall():
            chat_id, display_name, style, last_date, last_text = row

            phone = ""
            if style == 43:  # Group chat
                participants = get_group_participants(cursor, chat_id)
                name = ", ".join(participants[:3])
                if len(participants) > 3:
                    name += f" +{len(participants) - 3}"
            elif chat_id.startswith("+"):
                phone = chat_id
                contact_name = lookup_contact_name(chat_id)
                name = contact_name if contact_name else chat_id
            elif display_name:
                name = display_name
            else:
                name = chat_id

            if last_date:
                timestamp = last_date / 1e9 + 978307200
                dt = datetime.fromtimestamp(timestamp)
                if dt.date() == datetime.now().date():
                    time_str = dt.strftime("%I:%M %p")
                else:
                    time_str = dt.strftime("%b %d")
            else:
                time_str = ""

            conversations.append({
                "chat_id": chat_id,
                "name": name,
                "phone": phone,
                "preview": (last_text or "")[:50],
                "last_time": time_str,
                "is_group": style == 43,
            })

        conn.close()
    except Exception as e:
        print(f"Error: {e}")

    return conversations


@app.get("/api/chats/{chat_id:path}/messages")
def get_messages(chat_id: str, limit: int = 100):
    """Get messages for a specific chat."""
    messages = []

    try:
        conn = sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                m.ROWID,
                m.text,
                m.is_from_me,
                m.date
            FROM message m
            JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            JOIN chat c ON cmj.chat_id = c.ROWID
            WHERE c.chat_identifier = ?
            ORDER BY m.date DESC
            LIMIT ?
        """, (chat_id, limit))

        for row in cursor.fetchall():
            rowid, text, is_from_me, date = row

            # Check for attachment if no text
            attachment = None
            if not text:
                attachment = get_attachment_info(cursor, rowid)

            if date:
                timestamp = date / 1e9 + 978307200
                dt = datetime.fromtimestamp(timestamp)
                time_str = dt.strftime("%I:%M %p")
            else:
                time_str = ""

            messages.append({
                "text": text,
                "is_from_me": bool(is_from_me),
                "time": time_str,
                "attachment": attachment,
            })

        conn.close()
        messages.reverse()
    except Exception as e:
        print(f"Error: {e}")

    return messages


def name_to_session(name: str) -> str:
    """Convert contact name to session name format."""
    # "Sam McGrail" -> "sam-mcgrail"
    return name.lower().replace(" ", "-").replace(",", "").strip()


@app.get("/api/chats/{chat_id:path}/transcript")
def get_transcript(chat_id: str, name: str = ""):
    """Get Claude transcript for a chat with full tool call details."""
    entries = []

    # Try to find matching project directory
    session_name = name_to_session(name) if name else chat_id.lower().replace(" ", "-").replace("+", "").replace("@", "").split(".")[0]

    project_dir = None
    for d in CLAUDE_PROJECTS.iterdir():
        if not d.is_dir():
            continue
        if f"transcripts-{session_name}" in d.name.lower():
            project_dir = d
            break

    if not project_dir:
        return entries

    jsonl_files = list(project_dir.glob("*.jsonl"))
    if not jsonl_files:
        return entries

    latest_file = max(jsonl_files, key=lambda f: f.stat().st_mtime)

    # Store tool calls to match with results
    pending_tool_calls = {}

    try:
        with open(latest_file) as f:
            for line in f:
                try:
                    entry = json.loads(line)
                    entry_type = entry.get("type")

                    if entry_type not in ("user", "assistant"):
                        continue

                    message = entry.get("message", {})
                    role = message.get("role", entry_type)
                    content = message.get("content", "")

                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict):
                                item_type = item.get("type")

                                if item_type == "text":
                                    text = item.get("text", "")
                                    if text.strip():
                                        entries.append({
                                            "type": "text",
                                            "role": role,
                                            "content": text,
                                        })

                                elif item_type == "thinking":
                                    thinking = item.get("thinking", "")
                                    if thinking.strip():
                                        entries.append({
                                            "type": "thinking",
                                            "role": "assistant",
                                            "content": thinking[:1000] + ("..." if len(thinking) > 1000 else ""),
                                        })

                                elif item_type == "tool_use":
                                    tool_id = item.get("id")
                                    tool_name = item.get("name", "unknown")
                                    tool_input = item.get("input", {})

                                    # Store for matching with result
                                    pending_tool_calls[tool_id] = len(entries)

                                    entries.append({
                                        "type": "tool_call",
                                        "role": "assistant",
                                        "tool_name": tool_name,
                                        "tool_id": tool_id,
                                        "input": tool_input,
                                        "output": None,
                                        "is_error": False,
                                    })

                                elif item_type == "tool_result":
                                    tool_id = item.get("tool_use_id")
                                    result_content = item.get("content", "")
                                    is_error = item.get("is_error", False)

                                    # Find and update the matching tool call
                                    if tool_id in pending_tool_calls:
                                        idx = pending_tool_calls[tool_id]
                                        if idx < len(entries):
                                            entries[idx]["output"] = result_content[:2000] + ("..." if len(result_content) > 2000 else "")
                                            entries[idx]["is_error"] = is_error
                                        del pending_tool_calls[tool_id]

                            elif isinstance(item, str) and item.strip():
                                entries.append({
                                    "type": "text",
                                    "role": role,
                                    "content": item,
                                })

                    elif isinstance(content, str) and content.strip():
                        entries.append({
                            "type": "text",
                            "role": role,
                            "content": content,
                        })

                except Exception as e:
                    continue
    except Exception as e:
        print(f"Error: {e}")

    return entries[-100:]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
