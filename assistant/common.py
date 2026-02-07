"""
Shared utilities used by both the daemon (manager.py) and CLI (cli.py).

Extracted from cli.py to eliminate the "fast path" imports where manager.py
imported tmux-specific functions directly from cli.py.
"""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any, Dict, Optional

# Paths
HOME = Path.home()
ASSISTANT_DIR = HOME / "dispatch"
STATE_DIR = ASSISTANT_DIR / "state"
LOGS_DIR = ASSISTANT_DIR / "logs"
SESSION_LOG_DIR = LOGS_DIR / "sessions"
SESSION_REGISTRY_FILE = STATE_DIR / "sessions.json"
MESSAGES_DB = HOME / "Library/Messages/chat.db"
SKILLS_DIR = HOME / ".claude/skills"
TRANSCRIPTS_DIR = HOME / "transcripts"
CLAUDE = HOME / ".local/bin/claude"
CLAUDE_ASSISTANT_CLI = str(HOME / "dispatch/bin/claude-assistant")
UV = str(HOME / ".local/bin/uv")
BUN = HOME / ".bun/bin/bun"

# Master session config
MASTER_SESSION = "master"
MASTER_TRANSCRIPT_DIR = TRANSCRIPTS_DIR / "master"

# Signal config
SIGNAL_CLI = "/opt/homebrew/bin/signal-cli"
SIGNAL_SOCKET = Path("/tmp/signal-cli.sock")
_SIGNAL_ACCOUNT = None


def signal_account() -> str:
    """Get Signal account phone number from config (lazy load)."""
    global _SIGNAL_ACCOUNT
    if _SIGNAL_ACCOUNT is None:
        from assistant import config
        _SIGNAL_ACCOUNT = config.get("signal.account", "")
    return _SIGNAL_ACCOUNT


# Backward compat — will be removed once all callers use signal_account()
SIGNAL_ACCOUNT = None  # Placeholder; callers must use signal_account()
SIGNAL_DIR = HOME / ".claude/skills/signal"


def normalize_chat_id(chat_id: str) -> str:
    """Normalize chat_id to canonical format.

    Phone numbers -> E.164 format (+1XXXXXXXXXX)
    Prefixed chat_ids (signal:, test:) -> preserve prefix
    Group UUIDs -> lowercase
    """
    from assistant.backends import BACKENDS

    # Check for any backend registry prefix
    prefix = ""
    bare_id = chat_id
    for cfg in BACKENDS.values():
        if cfg.registry_prefix and chat_id.startswith(cfg.registry_prefix):
            prefix = cfg.registry_prefix
            bare_id = chat_id[len(prefix):]
            break

    # Check if it looks like a group UUID (20+ hex chars)
    if re.match(r'^[a-fA-F0-9]{20,}$', bare_id):
        return f"{prefix}{bare_id.lower()}" if prefix else bare_id.lower()

    # Assume phone number - normalize to E.164
    phone = re.sub(r'[^\d+]', '', bare_id)

    if phone.startswith('+'):
        return f"{prefix}{phone}"

    if len(phone) == 10:
        return f"{prefix}+1{phone}"
    elif len(phone) == 11 and phone.startswith('1'):
        return f"{prefix}+{phone}"

    return chat_id


def is_group_chat_id(chat_id: str) -> bool:
    """Check if chat_id is a group UUID (vs phone number).

    iMessage groups: lowercase hex (32+ chars)
    Signal groups: base64 encoded (contains A-Z, a-z, 0-9, +, /, =)
    Phone numbers: start with +
    """
    # Strip any backend registry prefix before checking
    from assistant.backends import BACKENDS
    bare_id = chat_id
    for cfg in BACKENDS.values():
        if cfg.registry_prefix and chat_id.startswith(cfg.registry_prefix):
            bare_id = chat_id[len(cfg.registry_prefix):]
            break

    # Phone numbers start with +
    if bare_id.startswith('+'):
        return False

    # Signal group IDs are base64 encoded (44 chars typically)
    if re.match(r'^[A-Za-z0-9+/=]{40,}$', chat_id):
        return True

    # iMessage group IDs are hex UUIDs (32+ chars, lowercase)
    return bool(re.match(r'^[a-f0-9]{20,}$', chat_id.lower()))


def get_session_name(contact_name: str, source: str = "imessage") -> str:
    """Generate session name from contact name.

    Args:
        contact_name: Full name (e.g., "Jane Doe")
        source: "imessage" or "signal"

    Returns:
        Session name like "jane-doe" or "jane-doe-signal"
    """
    from assistant.backends import get_backend
    backend = get_backend(source)
    base_name = contact_name.lower().replace(" ", "-")
    return f"{base_name}{backend.session_suffix}"


def get_group_session_name_from_participants(participant_names: list) -> str:
    """Generate session name for group chat from participant first names.

    E.g., ["Andy Chen", "Jane Doe"] -> "andy-jane"
    """
    first_names = sorted([name.split()[0].lower() for name in participant_names if name])
    return "-".join(first_names) if first_names else "group-unknown"


def wrap_sms(prompt: str, contact_name: str, tier: str, chat_id: str,
             reply_to_guid: str = None, source: str = "imessage") -> str:
    """Wrap prompt in SMS format with reminder to send via CLI.

    If reply_to_guid is provided, walks the full reply chain and includes it as context.
    """
    reply_context = ""
    if reply_to_guid:
        chain = get_reply_chain(reply_to_guid, contact_name)
        if chain and len(chain) > 1:
            chain = chain[:-1]
        if chain:
            chain_lines = []
            for msg in chain:
                text = msg["text"]
                # No truncation - show full reply text (no-truncate rule)
                chain_lines.append(f'  {msg["sender"]}: "{text}"')
            reply_context = "\n[Reply thread (oldest to newest):\n" + "\n".join(chain_lines) + "]\n"

    from assistant.backends import get_backend
    backend = get_backend(source)
    send_cmd = backend.send_cmd.replace("{chat_id}", chat_id)

    return f"""
---{backend.label} FROM {contact_name} ({tier})---
Chat ID: {chat_id}{reply_context}
{prompt}
---END {backend.label}---
**Important:** You are in a text message session. Communicate back to the user with {send_cmd} "message"
"""


def wrap_admin(prompt: str) -> str:
    """Wrap prompt in ADMIN OVERRIDE tags."""
    from assistant import config
    owner_name = config.get("owner.name", "Admin")
    return f"""
---ADMIN OVERRIDE---
From: {owner_name} (admin)
{prompt}
---END ADMIN OVERRIDE---
"""


def wrap_group_message(chat_id: str, display_name: str, sender_name: str,
                       sender_tier: str, msg_body: str, reply_to_guid: str = None,
                       source: str = "imessage") -> str:
    """Wrap a group message for injection."""
    shown_name = display_name or "Group Chat"

    # ACL note for non-admin senders
    acl_note = ""
    if sender_tier == "family":
        acl_note = f"\n\nACL: {sender_name} is FAMILY tier. Read ~/.claude/skills/sms-assistant/family-rules.md - can analyze/read but mutations need admin approval."
    elif sender_tier == "favorite":
        acl_note = f"\n\nACL: {sender_name} is FAVORITE tier. Read ~/.claude/skills/sms-assistant/favorites-rules.md for what you can/cannot do for them."
    elif sender_tier == "bots":
        acl_note = f"\n\nACL: {sender_name} is BOTS tier. Read ~/.claude/skills/sms-assistant/bots-rules.md - loop detection required, respond selectively."

    # Reply chain context
    reply_context = ""
    if reply_to_guid:
        chain = get_reply_chain(reply_to_guid, sender_name)
        if chain and len(chain) > 1:
            chain = chain[:-1]
        if chain:
            chain_lines = []
            for msg in chain:
                txt = msg["text"]
                # No truncation - show full reply text (no-truncate rule)
                chain_lines.append(f'  {msg["sender"]}: "{txt}"')
            reply_context = "\n[Reply thread (oldest to newest):\n" + "\n".join(chain_lines) + "]"

    from assistant.backends import get_backend
    backend = get_backend(source)
    send_cmd = backend.send_group_cmd.replace("{chat_id}", chat_id)

    return f"""
---GROUP {backend.label} [{shown_name}] FROM {sender_name} [TIER: {sender_tier}]---
Chat ID: {chat_id}{reply_context}
{msg_body}
---END {backend.label}---{acl_note}

To reply to this group, use:
{send_cmd} "message"
"""


def format_message_body(text: str, attachments: list = None,
                        audio_transcription: str = None) -> str:
    """Format a message body with attachments and audio transcription."""
    msg_body = text or "(no text)"

    if audio_transcription:
        msg_body = f"(Audio message transcription: {audio_transcription})"

    if attachments:
        attachment_lines = []
        for att in attachments:
            size_kb = att['size'] // 1024
            attachment_lines.append(f"  - {att['name']} ({att['mime_type']}, {size_kb}KB)")
            attachment_lines.append(f"    Path: {att['path']}")
        msg_body += "\n\nATTACHMENTS:\n" + "\n".join(attachment_lines)
        msg_body += "\n\nYou can view images using the Read tool on the path above."

    return msg_body


def _parse_attributed_body(data: bytes) -> Optional[str]:
    """Extract plain text from macOS NSAttributedString binary data."""
    if not data:
        return None
    try:
        text = data.decode('utf-8', errors='ignore')
        # Look for the actual text content between known markers
        import re
        match = re.search(r'NSString.*?(.+?)(?:NSDictionary|NSAttributeInfo|$)', text, re.DOTALL)
        if match:
            extracted = match.group(1).strip()
            # Clean up any binary artifacts
            extracted = ''.join(c for c in extracted if c.isprintable() or c in '\n\t')
            return extracted.strip() if extracted.strip() else None
    except Exception:
        pass
    return None


def get_reply_chain(thread_originator_guid: str, contact_name: str, max_messages: int = 10) -> list:
    """Get all messages in a reply thread, sorted by timestamp.

    Returns list of dicts with 'sender' and 'text'.
    """
    if not thread_originator_guid or not MESSAGES_DB.exists():
        return []

    try:
        conn = sqlite3.connect(str(MESSAGES_DB))
        cursor = conn.cursor()

        cursor.execute("""
            SELECT text, attributedBody, is_from_me, date
            FROM message
            WHERE guid = ? OR thread_originator_guid = ?
            ORDER BY date ASC
            LIMIT ?
        """, (thread_originator_guid, thread_originator_guid, max_messages))

        rows = cursor.fetchall()
        conn.close()

        chain = []
        for text, attr_body, is_from_me, date_val in rows:
            if not text and attr_body:
                text = _parse_attributed_body(attr_body)
            if not text:
                continue
            sender = "You" if is_from_me else contact_name
            chain.append({"sender": sender, "text": text})

        return chain

    except Exception as e:
        import sys
        print(f"Warning: Failed to get reply chain for {thread_originator_guid}: {e}", file=sys.stderr)
        return []


def ensure_transcript_dir(session_name: str) -> Path:
    """Create transcript directory and .claude symlink for a session."""
    transcript_dir = TRANSCRIPTS_DIR / session_name
    transcript_dir.mkdir(parents=True, exist_ok=True)

    claude_symlink = transcript_dir / ".claude"
    if not claude_symlink.exists():
        claude_symlink.symlink_to(HOME / ".claude")

    return transcript_dir
