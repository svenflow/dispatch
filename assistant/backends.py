"""
Messaging backend configurations.

Each backend defines the source-specific strings (CLI commands, labels, suffixes)
needed throughout the codebase. Adding a new messaging backend = adding one entry here.
"""
from __future__ import annotations

from pydantic import BaseModel


class BackendConfig(BaseModel, frozen=True):
    """Configuration for a messaging backend. All source-specific strings in one place."""

    name: str              # "imessage", "signal", "test"
    label: str             # "SMS", "SIGNAL", "TEST" (for wrap headers)
    session_suffix: str    # "" for iMessage, "-signal" for Signal, "-test" for Test
    registry_prefix: str   # "" for iMessage, "signal:" for Signal, "test:" for Test

    # CLI command templates. {chat_id} is replaced at call site.
    send_cmd: str          # '~/.claude/skills/sms-assistant/scripts/send-sms "{chat_id}"'
    send_group_cmd: str    # same or different for groups
    history_cmd: str       # CLI template or "" if unavailable


BACKENDS: dict[str, BackendConfig] = {
    "imessage": BackendConfig(
        name="imessage",
        label="SMS",
        session_suffix="",
        registry_prefix="",
        send_cmd='~/.claude/skills/sms-assistant/scripts/send-sms "{chat_id}"',
        send_group_cmd='~/.claude/skills/sms-assistant/scripts/send-sms "{chat_id}"',
        history_cmd='~/.claude/skills/sms-assistant/scripts/read-sms --chat "{chat_id}" --limit {limit}',
    ),
    "signal": BackendConfig(
        name="signal",
        label="SIGNAL",
        session_suffix="-signal",
        registry_prefix="signal:",
        send_cmd='~/.claude/skills/signal/scripts/send-signal "{chat_id}"',
        send_group_cmd='~/.claude/skills/signal/scripts/send-signal-group "{chat_id}"',
        history_cmd='~/.claude/skills/signal/scripts/read-signal --chat "{chat_id}" --limit {limit}',
    ),
    "test": BackendConfig(
        name="test",
        label="TEST",
        session_suffix="-test",
        registry_prefix="test:",
        send_cmd='~/dispatch/tools/test-send "{chat_id}"',
        send_group_cmd='~/dispatch/tools/test-send "{chat_id}"',
        history_cmd='~/dispatch/tools/test-read --chat "{chat_id}" --limit {limit}',
    ),
    "sven-app": BackendConfig(
        name="sven-app",
        label="SVEN_APP",
        session_suffix="-sven-app",
        registry_prefix="sven-app:",
        send_cmd='~/.claude/skills/sven-app/scripts/reply-sven "{chat_id}"',
        send_group_cmd='~/.claude/skills/sven-app/scripts/reply-sven "{chat_id}"',
        history_cmd="",
    ),
}


def get_backend(source: str) -> BackendConfig:
    """Get backend config by source name. Defaults to imessage."""
    return BACKENDS.get(source, BACKENDS["imessage"])
