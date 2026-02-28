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
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from typing import TYPE_CHECKING

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
    UserMessage,
    PermissionResultAllow,
    PermissionResultDeny,
    HookMatcher,
)

if TYPE_CHECKING:
    from claude_agent_sdk.types import (
        SyncHookJSONOutput,
        HookContext,
        PreToolUseHookInput,
        PostToolUseHookInput,
        PostToolUseFailureHookInput,
        UserPromptSubmitHookInput,
        StopHookInput,
        SubagentStopHookInput,
        PreCompactHookInput,
    )
    # Union of all hook input types
    HookInputType = (
        PreToolUseHookInput | PostToolUseHookInput | PostToolUseFailureHookInput |
        UserPromptSubmitHookInput | StopHookInput | SubagentStopHookInput | PreCompactHookInput
    )

from assistant.common import SKILLS_DIR, UV
from assistant import perf

log = logging.getLogger(__name__)

# Per-session log directory
SESSION_LOG_DIR = Path.home() / "dispatch/logs/sessions"
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
        model: str = "opus",
    ):
        self.chat_id = chat_id
        self.contact_name = contact_name
        self.tier = tier
        self.cwd = cwd
        self.session_type = session_type
        self.source = source
        self.model = model

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
        self._consecutive_error_turns = 0

        # Deferred system prompt injection (set by sdk_backend, consumed by _inject_system_prompt_if_needed)
        self._needs_system_prompt: bool = False
        self._system_prompt_args: tuple | None = None
        self._system_prompt_type: str | None = None  # "individual" or "group"

        # Tool execution timing: maps tool_use_id -> (start_time, tool_input, tool_name)
        self._pending_tools: dict[str, tuple[float, dict, str]] = {}

        # Per-session logger
        from assistant.common import get_session_name
        session_name = get_session_name(chat_id, source)
        log_name = session_name.replace("/", "-")
        self._log = _get_session_logger(log_name)

    def get_transcript_file(self) -> Optional[Path]:
        """Return path to this session's active transcript JSONL."""
        from assistant.health import _find_transcript
        return _find_transcript(self.cwd, self.session_id)

    async def start(self, resume_session_id: Optional[str] = None):
        """Connect ClaudeSDKClient and start the message processing loop."""
        options = self._build_options(resume_session_id)
        self._client = ClaudeSDKClient(options=options)
        await self._client.connect()
        self.running = True
        self._task = asyncio.create_task(self._run_loop())
        self._log.info(f"SESSION_START | resume={resume_session_id} | tier={self.tier}")
        log.info(f"[{self.contact_name}] SDK session started (resume={resume_session_id})")

    async def _kill_subprocess(self):
        """Kill the Claude CLI subprocess to prevent zombies.

        Called from both stop() and _run_loop's finally block to ensure
        the subprocess is terminated when the session ends or crashes.
        """
        if not self._client:
            return

        try:
            transport = getattr(self._client, '_transport', None)
            if transport:
                process = getattr(transport, '_process', None)
                if process and process.returncode is None:
                    self._log.info("SUBPROCESS_KILL | Terminating Claude CLI subprocess")
                    process.terminate()
                    # Give it a moment to terminate gracefully
                    try:
                        await asyncio.wait_for(process.wait(), timeout=2.0)
                    except asyncio.TimeoutError:
                        process.kill()  # Force kill if terminate didn't work
                        self._log.warning("SUBPROCESS_KILL | Had to force kill")
        except Exception as e:
            self._log.warning(f"SUBPROCESS_KILL_ERROR | {e}")
        finally:
            self._client = None

    async def stop(self):
        """Stop the session by cancelling its task and killing the subprocess.

        We explicitly kill the subprocess to prevent zombie sessions from
        continuing to run after restart. The SDK's disconnect() method can
        cause anyio cancel scope issues, so we terminate the subprocess directly.
        """
        self.running = False

        # First cancel the task to stop the receive loop
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        await self._kill_subprocess()

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
        # API errors (e.g. context too large, image size limits)
        if self._consecutive_error_turns >= 3:
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
                # Check if receiver crashed
                if receiver.done():
                    self._log.warning("RECEIVER_CRASHED | Exiting main loop")
                    break

                try:
                    msg = await asyncio.wait_for(
                        self._message_queue.get(), timeout=30
                    )
                except asyncio.TimeoutError:
                    continue  # Check receiver health every 30s

                self.last_activity = datetime.now()
                self._log.info(f"IN | {msg}")
                self._pending_queries += 1

                try:
                    assert self._client is not None
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
            # Kill subprocess to prevent zombies when receiver crashes
            await self._kill_subprocess()

    async def _receive_loop(self):
        """Background receiver: continuously handle all messages from the SDK.

        Uses receive_messages() (infinite async iterator) instead of
        receive_response() (stops at ResultMessage). This allows the
        receiver to span multiple merged turns.
        """
        try:
            assert self._client is not None
            async for message in self._client.receive_messages():
                await self._handle_message(message)
                if isinstance(message, ResultMessage):
                    self._pending_queries = 0  # Reset: merged queries produce 1 ResultMessage
                    self._error_count = 0
                    # Note: _consecutive_error_turns is tracked in _handle_message
                    # Cleanup stale pending tools (edge case: tool call never got result)
                    self._cleanup_stale_pending_tools()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            self._error_count += 1
            self._log.error(f"RECEIVER_ERROR #{self._error_count} | {e}")
            log.error(f"[{self.contact_name}] Receiver error: {e}")
            # Buffer overflow is fatal - the SDK connection is broken
            error_str = str(e).lower()
            if "buffer" in error_str or "1048576" in error_str:
                self._log.error("RECEIVER_FATAL | Buffer overflow - marking session dead")
                self.running = False
            elif self._error_count >= 3:
                self._log.error("RECEIVER_DEAD | Stopping session")
                self.running = False

    def _cleanup_stale_pending_tools(self) -> None:
        """Remove pending tools older than 30 minutes.

        Edge case handling: if a tool call never receives a result (e.g. session
        killed mid-call), the entry would stay forever. This cleans them up.
        """
        now = time.perf_counter()
        stale_ids = [
            tid for tid, (start_time, _, _) in self._pending_tools.items()
            if now - start_time > 1800  # 30 minutes
        ]
        for tid in stale_ids:
            self._log.warning(f"PENDING_TOOL_STALE | tool_use_id={tid}")
            self._pending_tools.pop(tid, None)

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
            model=self.model,
            fallback_model="sonnet",  # Only triggers on 529 (server overloaded), not normal usage
            max_turns=turn_limit,
            max_buffer_size=10 * 1024 * 1024,  # 10MB - prevents crash on large Task outputs
            hooks={
                "PreToolUse": [HookMatcher(matcher="Read", hooks=[self._resize_image_hook])],
                "Stop": [HookMatcher(hooks=[self._stop_hook])],
            }
        )

        # Permission callback for tier-based security enforcement
        if self.tier in ("favorite", "family"):
            opts.can_use_tool = self._permission_check

        if resume_id:
            # Resume existing session with full conversation context
            opts.resume = resume_id
        else:
            # Generate fresh session ID to prevent auto-resume from sessions-index.json
            # The SDK/CLI auto-resumes from ~/.claude/projects/<cwd>/sessions-index.json
            # unless we explicitly provide a new session ID
            fresh_session_id = str(uuid.uuid4())
            opts.extra_args = {"session-id": fresh_session_id}

        return opts

    async def _permission_check(self, tool_name: str, tool_input: dict[str, Any], context: Any) -> PermissionResultAllow | PermissionResultDeny:
        """Security callback: enforce tier-based tool restrictions.

        Runs before every tool call. Better than system prompt alone -
        survives compaction.
        """
        self._log.info(f"PERM_CHECK | tool={tool_name} tier={self.tier}")

        if self.tier == "favorite":
            # Block file modifications
            if tool_name in ("Write", "Edit", "NotebookEdit"):
                return PermissionResultDeny(message=f"{tool_name} blocked for favorites tier")
            # Block dangerous bash
            if tool_name == "Bash":
                cmd = tool_input.get("command", "")
                if not cmd.startswith("osascript"):
                    return PermissionResultDeny(message="Only osascript allowed for favorites tier")
            # Block sensitive file reads
            if tool_name == "Read":
                path = tool_input.get("file_path", "")
                if any(s in path for s in [".ssh", ".env", "credentials", "secrets"]):
                    return PermissionResultDeny(message="Sensitive file blocked for favorites tier")

        return PermissionResultAllow()

    async def _resize_image_hook(self, input_data: "HookInputType", tool_use_id: str | None, context: "HookContext") -> "SyncHookJSONOutput":
        """PreToolUse hook for Read: block oversized images to prevent API errors.

        The API rejects images >2000px in multi-image conversations.
        If an image is too large, deny the read and tell Claude to resize first.
        """
        IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff"}
        MAX_DIM = 2000  # API limit for multi-image (>20 images) requests

        tool_input = input_data.get("tool_input", {})
        file_path = tool_input.get("file_path", "")
        if not file_path:
            return {}

        ext = Path(file_path).suffix.lower()
        if ext not in IMAGE_EXTS:
            return {}

        if not Path(file_path).exists():
            return {}

        try:
            result = subprocess.run(
                ["sips", "-g", "pixelWidth", "-g", "pixelHeight", file_path],
                capture_output=True, text=True, timeout=5,
            )
            width = height = 0
            for line in result.stdout.splitlines():
                if "pixelWidth" in line:
                    width = int(line.split(":")[-1].strip())
                elif "pixelHeight" in line:
                    height = int(line.split(":")[-1].strip())

            if width <= MAX_DIM and height <= MAX_DIM:
                return {}

            self._log.info(f"IMAGE_TOO_LARGE | {file_path} | {width}x{height}")
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Image is {width}x{height}px. The API rejects images >2000px when there are many images in the conversation. "
                        f"Resize first: sips --resampleHeightWidthMax {MAX_DIM} \"{file_path}\" then read again."
                    ),
                },
            }
        except Exception as e:
            self._log.warning(f"IMAGE_CHECK_ERROR | {file_path} | {e}")
            return {}

    async def _stop_hook(self, input_data: "HookInputType", tool_use_id: str | None, context: "HookContext") -> "SyncHookJSONOutput":
        """Stop hook: remind Claude to send updates via send-sms if needed.

        Only fires if the session is processing an incoming message (not idle turns).
        Checks if send-sms was already called to avoid duplicate sends.
        """
        # Check if we recently sent a message by looking at recent tool use
        from assistant.backends import get_backend
        backend = get_backend(self.source)
        # Extract CLI name from send_cmd template (e.g. "send-sms" from '~/.claude/skills/sms-assistant/scripts/send-sms "{chat_id}"')
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
                    # Track tool start time for performance logging
                    self._pending_tools[block.id] = (
                        time.perf_counter(),
                        block.input if isinstance(block.input, dict) else {},
                        block.name,
                    )

        elif isinstance(message, UserMessage):
            # UserMessage contains tool results - track completion timing
            for block in (message.content if isinstance(message.content, list) else []):
                if isinstance(block, ToolResultBlock):
                    tool_use_id = block.tool_use_id
                    if tool_use_id in self._pending_tools:
                        start_time, tool_input, tool_name = self._pending_tools.pop(tool_use_id)
                        duration_ms = (time.perf_counter() - start_time) * 1000
                        session_name = f"{self.source}/{self.chat_id}"
                        perf.log_tool_execution(
                            session=session_name,
                            tool=tool_name,
                            tool_input=tool_input,
                            duration_ms=duration_ms,
                            is_error=block.is_error or False,
                        )
                    else:
                        self._log.warning(f"TOOL_RESULT_ORPHAN | tool_use_id={tool_use_id}")

        elif isinstance(message, ResultMessage):
            self.turn_count += message.num_turns or 0
            if message.session_id:
                self.session_id = message.session_id
            self.last_activity = datetime.now()
            if message.is_error:
                self._consecutive_error_turns += 1
            else:
                self._consecutive_error_turns = 0
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
