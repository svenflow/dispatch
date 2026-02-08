#!/usr/bin/env python3
"""Extract recent conversation context from Claude transcript files."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional


def get_transcript_path(session_name: str) -> Optional[Path]:
    """Find the most recent transcript file for a session."""
    # Claude stores transcripts in ~/.claude/projects/-Users-{Path.home().name}-transcripts-<session>/
    projects_dir = Path.home() / ".claude/projects"

    # Try the exact session name (sanitize "/" to "-" to match SDK path format)
    sanitized = session_name.replace("/", "-")
    session_dir = projects_dir / f"-Users-{Path.home().name}-transcripts-{sanitized}"

    if not session_dir.exists():
        return None

    # Check sessions-index.json for the most recent session
    index_path = session_dir / "sessions-index.json"
    if index_path.exists():
        try:
            with open(index_path) as f:
                index = json.load(f)
            entries = index.get("entries", [])
            if entries:
                # Sort by modified timestamp, get most recent
                entries.sort(key=lambda e: e.get("modified", ""), reverse=True)
                most_recent = entries[0]
                transcript_path = Path(most_recent["fullPath"])
                if transcript_path.exists():
                    return transcript_path
        except (json.JSONDecodeError, KeyError):
            pass

    # Fallback: find most recent .jsonl file by mtime
    jsonl_files = list(session_dir.glob("*.jsonl"))
    if not jsonl_files:
        return None

    jsonl_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    return jsonl_files[0]


def extract_messages(transcript_path: Path, limit: int = 10) -> list[dict]:
    """Extract the last N user/assistant messages from a transcript."""
    messages = []

    # Read file in reverse to get most recent messages
    with open(transcript_path, 'r') as f:
        lines = f.readlines()

    for line in reversed(lines):
        if len(messages) >= limit:
            break

        try:
            obj = json.loads(line)
            msg_type = obj.get('type', '')

            if msg_type not in ('user', 'assistant'):
                continue

            content = obj.get('message', {}).get('content', '')

            # Skip tool results (they're lists)
            if isinstance(content, list):
                continue

            # Skip empty or very short messages
            if not content or len(content.strip()) < 5:
                continue

            messages.append({
                'role': msg_type,
                'content': content,
                'timestamp': obj.get('timestamp', '')
            })

        except json.JSONDecodeError:
            continue

    # Reverse to get chronological order
    messages.reverse()
    return messages


def clean_sms_content(content: str) -> tuple[str, bool]:
    """Extract just the message text from SMS injection format.

    Returns (cleaned_content, is_sms) - is_sms indicates if this was an actual SMS.
    """
    import re

    # Skip system prompts / startup injections
    if content.startswith("IMPORTANT: Read and follow"):
        return "", False
    if "sms-assistant" in content and "SKILL.md" in content:
        return "", False

    # Extract text between ---SMS FROM ... --- and ---END SMS---
    match = re.search(r'---SMS FROM [^-]+---\n(.*?)\n---END SMS---', content, re.DOTALL)
    if match:
        return match.group(1).strip(), True

    # Extract text from GROUP SMS format
    match = re.search(r'---GROUP SMS .+---\n(.*?)\n---END SMS---', content, re.DOTALL)
    if match:
        return match.group(1).strip(), True

    # If it's an assistant response (not a tool use), include it
    if content.startswith("I'll") or content.startswith("Let me") or content.startswith("I've"):
        lines = content.split('\n')
        return lines[0][:200] if lines else content[:200], False

    return content, False


def format_context(messages: list[dict], max_chars: int = 2000) -> str:
    """Format messages into a readable context summary."""
    if not messages:
        return "No previous conversation history."

    lines = ["RECENT CONVERSATION HISTORY:"]
    total_chars = 0
    has_content = False

    for msg in messages:
        role = "Human" if msg['role'] == 'user' else "You"
        content, is_sms = clean_sms_content(msg['content'].strip())

        # Skip empty after cleaning (includes system prompts)
        if not content or len(content) < 2:
            continue

        has_content = True

        # Truncate long messages
        if len(content) > 300:
            content = content[:300] + "..."

        # Skip if we've hit the character limit
        if total_chars + len(content) > max_chars:
            lines.append("... (earlier messages truncated)")
            break

        lines.append(f"[{role}]: {content}")
        total_chars += len(content)

    if not has_content:
        return "No previous conversation history."

    return "\n".join(lines)


def get_session_context(session_name: str, limit: int = 10, max_chars: int = 2000) -> str:
    """Get formatted conversation context for a session."""
    transcript_path = get_transcript_path(session_name)

    if not transcript_path:
        return "No previous conversation history found."

    messages = extract_messages(transcript_path, limit=limit)
    return format_context(messages, max_chars=max_chars)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: transcript.py <session-name> [limit]")
        sys.exit(1)

    session = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    context = get_session_context(session, limit=limit)
    print(context)
