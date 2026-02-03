"""
SDKSession: Wraps ClaudeSDKClient with async message queue for injection.

Each SDKSession manages a single Claude agent session for one contact.
Messages are sent via query() immediately and received by a background
receiver task using receive_messages(). This allows mid-turn steering:
new messages are injected while Claude is processing, and Claude sees
them as UserMessages between tool calls.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
    PermissionResultAllow,
    PermissionResultDeny,
    HookMatcher,
)

from assistant.common import SKILLS_DIR, UV

log = logging.getLogger(__name__)

# Per-session log directory
SESSION_LOG_DIR = Path.home() / "code/claude-assistant/logs/sessions"
SESSION_LOG_DIR.mkdir(parents=True, exist_ok=True)


def _get_session_logger(session_name: str) -> logging.Logger:
    """Create a per-session logger with rotating file handler."""
    from logging.handlers import RotatingFileHandler

    logger = logging.getLogger(f"session.{session_name}")
    # Clear existing handlers to prevent accumulation on session restarts
    logger.handlers.clear()
    if True:
        handler = RotatingFileHandler(
            SESSION_LOG_DIR / f"{session_name}.log",
            maxBytes=10 * 1024 * 1024,  # 10MB
            backupCount=5,
        )
        handler.setFormatter(logging.Formatter(
            '%(asctime)s | %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S',
        ))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger


class SDKSession:
    """Manages a single Claude Agent SDK session using ClaudeSDKClient.

    Uses concurrent send/receive architecture: a background receiver task
    runs receive_messages() continuously while the sender dispatches
    query() calls immediately from the queue. This enables mid-turn
    steering — new messages reach Claude between tool calls without
    waiting for the current turn to finish.
    """

    def __init__(
        self,
        chat_id: str,
        contact_name: str,
        tier: str,
        cwd: str,
        session_type: str = "individual",
        source: str = "imessage",
    ):
        self.chat_id = chat_id
        self.contact_name = contact_name
        self.tier = tier
        self.cwd = cwd
        self.session_type = session_type
        self.source = source

        self._client: Optional[ClaudeSDKClient] = None
        self._message_queue: asyncio.Queue[str] = asyncio.Queue()
        self._task: Optional[asyncio.Task] = None
        self._pending_queries = 0  # Tracks in-flight queries; reset to 0 on ResultMessage
        self.running = False

        # Metrics
        self.session_id: Optional[str] = None
        self.turn_count = 0
        self.created_at = datetime.now()
        self.last_activity = datetime.now()
        self._error_count = 0

        # Per-session logger
        from assistant.backends import get_backend
        backend = get_backend(source)
        session_name = contact_name.lower().replace(" ", "-") + backend.session_suffix
        self._log = _get_session_logger(session_name)

    async def start(self, resume_session_id: Optional[str] = None):
        """Connect ClaudeSDKClient and start the message processing loop."""
        options = self._build_options(resume_session_id)
        self._client = ClaudeSDKClient(options=options)
        await self._client.connect()
        self.running = True
        self._task = asyncio.create_task(self._run_loop())
        self._log.info(f"SESSION_START | resume={resume_session_id} | tier={self.tier}")
        log.info(f"[{self.contact_name}] SDK session started (resume={resume_session_id})")

    async def stop(self):
        """Disconnect client and cancel task.

        IMPORTANT: client.disconnect() is run in an isolated task because
        the SDK uses anyio cancel scopes internally that propagate
        CancelledError to the calling task. Running in a separate task
        ensures cancellation cannot leak to the main event loop.
        """
        self.running = False
        if self._client:
            client = self._client
            self._client = None

            async def _isolated_disconnect():
                try:
                    await client.disconnect()
                except (Exception, asyncio.CancelledError):
                    pass

            try:
                disconnect_task = asyncio.create_task(_isolated_disconnect())
                await asyncio.wait_for(asyncio.shield(disconnect_task), timeout=10)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                pass
            finally:
                # No matter what, clear any cancellation leaked to us
                task = asyncio.current_task()
                if task is not None:
                    while task.cancelling() > 0:
                        task.uncancel()

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._log.info(f"SESSION_STOP | turns={self.turn_count}")
        log.info(f"[{self.contact_name}] SDK session stopped (turns={self.turn_count})")

    async def inject(self, text: str):
        """Queue a message for delivery to the Claude session."""
        await self._message_queue.put(text)
        self._log.info(f"QUEUED | len={len(text)}")

    @property
    def is_busy(self) -> bool:
        return self._pending_queries > 0

    def is_alive(self) -> bool:
        return self.running and self._task is not None and not self._task.done()

    def is_healthy(self) -> bool:
        if not self.is_alive():
            return False
        if self._error_count >= 3:
            return False
        # Stale: messages pending but no activity for 10+ min
        if self._message_queue.qsize() > 0:
            idle = (datetime.now() - self.last_activity).total_seconds()
            if idle > 600:
                return False
        return True

    async def interrupt(self):
        """Interrupt a stuck session."""
        if self._client:
            await self._client.interrupt()
            self._log.info("INTERRUPTED")
            log.info(f"[{self.contact_name}] Session interrupted")

    async def _run_loop(self):
        """Main loop: start background receiver, then send queries from queue.

        The receiver runs receive_messages() continuously in the background.
        The sender dispatches query() calls immediately — Claude sees new
        messages as UserMessages between tool calls (mid-turn steering).
        Multiple queries during a single turn merge into one ResultMessage.
        """
        receiver = asyncio.create_task(self._receive_loop())
        try:
            while self.running:
                try:
                    msg = await asyncio.wait_for(
                        self._message_queue.get(), timeout=3600
                    )
                except asyncio.TimeoutError:
                    continue  # 1-hour idle, keep waiting

                self.last_activity = datetime.now()
                self._log.info(f"IN | {msg}")
                self._pending_queries += 1

                try:
                    await self._client.query(msg)
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    self._pending_queries = max(0, self._pending_queries - 1)
                    self._error_count += 1
                    self._log.error(f"ERROR #{self._error_count} | {e}")
                    log.error(f"[{self.contact_name}] Query error #{self._error_count}: {e}")
                    if self._error_count >= 3:
                        self._log.error("MAX_ERRORS | Session dead")
                        self.running = False
                        break
                    await asyncio.sleep(2 * self._error_count)

        except asyncio.CancelledError:
            self._log.info("LOOP_CANCELLED")
            raise
        finally:
            receiver.cancel()
            try:
                await receiver
            except asyncio.CancelledError:
                pass

    async def _receive_loop(self):
        """Background receiver: continuously handle all messages from the SDK.

        Uses receive_messages() (infinite async iterator) instead of
        receive_response() (stops at ResultMessage). This allows the
        receiver to span multiple merged turns.
        """
        try:
            async for message in self._client.receive_messages():
                await self._handle_message(message)
                if isinstance(message, ResultMessage):
                    self._pending_queries = 0  # Reset: merged queries produce 1 ResultMessage
                    self._error_count = 0
        except asyncio.CancelledError:
            pass
        except Exception as e:
            self._error_count += 1
            self._log.error(f"RECEIVER_ERROR #{self._error_count} | {e}")
            log.error(f"[{self.contact_name}] Receiver error: {e}")
            if self._error_count >= 3:
                self._log.error("RECEIVER_DEAD | Stopping session")
                self.running = False

    def _build_options(self, resume_id: Optional[str] = None) -> ClaudeAgentOptions:
        """Build ClaudeAgentOptions based on contact tier."""
        if self.tier in ("admin", "wife"):
            tools = [
                "Read", "Write", "Edit", "Bash", "Glob", "Grep",
                "WebSearch", "WebFetch", "Task", "NotebookEdit",
                "Skill", "AskUserQuestion",
            ]
            perm_mode = "bypassPermissions"
        elif self.tier == "family":
            tools = [
                "Read", "Write", "Edit", "Bash", "Glob", "Grep",
                "WebSearch", "WebFetch", "Task",
            ]
            perm_mode = "default"
        elif self.tier == "favorite":
            tools = ["Read", "WebSearch", "WebFetch", "Grep", "Glob", "Bash"]
            perm_mode = "default"
        else:
            # Group sessions, master, etc - full access
            tools = [
                "Read", "Write", "Edit", "Bash", "Glob", "Grep",
                "WebSearch", "WebFetch", "Task", "NotebookEdit",
                "Skill", "AskUserQuestion",
            ]
            perm_mode = "bypassPermissions"

        # Per-turn limit prevents unbounded costs (bug #15 fix)
        # Each inject gets up to max_turns before stopping.
        # Admin/wife get generous limits; restricted tiers get tighter limits.
        if self.tier in ("admin", "wife"):
            turn_limit = 200
        elif self.tier == "family":
            turn_limit = 50
        elif self.tier == "favorite":
            turn_limit = 30
        else:
            turn_limit = 30

        opts = ClaudeAgentOptions(
            cwd=self.cwd,
            allowed_tools=tools,
            permission_mode=perm_mode,
            setting_sources=["project"],  # Load CLAUDE.md + skills from cwd
            model="opus",
            fallback_model="sonnet",  # Only triggers on 529 (server overloaded), not normal usage
            max_turns=turn_limit,
            hooks={
                "Stop": [HookMatcher(hooks=[self._stop_hook])]
            }
        )

        # Permission callback for tier-based security enforcement
        if self.tier in ("favorite", "family"):
            opts.can_use_tool = self._permission_check

        if resume_id:
            opts.resume = resume_id

        return opts

    def _permission_check(self, context) -> PermissionResultAllow | PermissionResultDeny:
        """Security callback: enforce tier-based tool restrictions.

        Runs before every tool call. Better than system prompt alone -
        survives compaction.
        """
        tool_name = context.tool_name
        self._log.info(f"PERM_CHECK | tool={tool_name} tier={self.tier}")

        if self.tier == "favorite":
            # Block file modifications
            if tool_name in ("Write", "Edit", "NotebookEdit"):
                return PermissionResultDeny(reason=f"{tool_name} blocked for favorites tier")
            # Safely extract tool_input (may be dict or object with .get)
            tool_input = getattr(context, 'tool_input', None) or {}
            if isinstance(tool_input, dict):
                get_input = tool_input.get
            else:
                get_input = lambda k, d="": getattr(tool_input, k, d)
            # Block dangerous bash
            if tool_name == "Bash":
                cmd = get_input("command", "")
                if not cmd.startswith("osascript"):
                    return PermissionResultDeny(reason="Only osascript allowed for favorites tier")
            # Block sensitive file reads
            if tool_name == "Read":
                path = get_input("file_path", "")
                if any(s in path for s in [".ssh", ".env", "credentials", "secrets"]):
                    return PermissionResultDeny(reason="Sensitive file blocked for favorites tier")

        return PermissionResultAllow()

    async def _stop_hook(self, input_data: dict[str, Any], tool_use_id: str | None, context: Any) -> dict[str, Any]:
        """Stop hook: remind Claude to send updates via send-sms if needed.

        Only fires if the session is processing an incoming message (not idle turns).
        Checks if send-sms was already called to avoid duplicate sends.
        """
        # Check if we recently sent a message by looking at recent tool use
        from assistant.backends import get_backend
        backend = get_backend(self.source)
        # Extract CLI name from send_cmd template (e.g. "send-sms" from '~/code/sms-cli/send-sms "{chat_id}"')
        send_marker = backend.send_cmd.split("/")[-1].split('"')[0].strip()
        response = getattr(context, 'response', None) or {}
        messages = response.get('messages', []) if isinstance(response, dict) else []
        already_sent = any(
            send_marker in str(msg.get('content', ''))
            for msg in messages
            if msg.get('type') == 'tool_use'
        )
        if already_sent:
            return {}
        return {
            "systemMessage": (
                f"Reminder: If you haven't sent the user an update via {send_marker} yet, "
                "do so now to keep them informed of your progress or completion."
            )
        }

    async def _handle_message(self, message):
        """Handle messages from client.receive_response().

        NOTE: We do NOT auto-send text output as SMS. Claude calls send-sms
        explicitly via Bash tool when it wants to message the user.
        Auto-sending caused massive SMS spam (every intermediate TextBlock
        became a separate message).
        """
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    self._log.info(f"OUT | {block.text}")
                elif isinstance(block, ToolUseBlock):
                    self._log.info(f"TOOL_USE | {block.name}")

        elif isinstance(message, ResultMessage):
            self.turn_count += message.num_turns or 0
            if message.session_id:
                self.session_id = message.session_id
            self.last_activity = datetime.now()
            self._log.info(
                f"TURN | #{self.turn_count} | "
                f"duration={message.duration_ms}ms | error={message.is_error} | "
                f"sid={message.session_id}"
            )

        elif isinstance(message, SystemMessage):
            # Capture session_id from init message
            if hasattr(message, 'data') and isinstance(message.data, dict):
                sid = message.data.get('session_id')
                if sid and not self.session_id:
                    self.session_id = sid
            self._log.info(f"SYSTEM | {getattr(message, 'subtype', 'unknown')}")
