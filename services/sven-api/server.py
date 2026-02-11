#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "fastapi",
#     "uvicorn",
#     "pydantic",
# ]
# ///
"""
Sven API Server - receives voice transcripts from iOS app via Tailscale
and provides in-app responses with TTS audio.

Run with: uv run server.py
Or: ./server.py (if executable)

Listens on: http://0.0.0.0:8080

Endpoints:
- POST /prompt - Receive transcript, inject into sven-app session
- GET /messages - Poll for new messages
- GET /audio/{message_id} - Download TTS audio file
"""

import json
import logging
import sqlite3
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn

# Configure logging
LOG_DIR = Path.home() / "dispatch" / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "sven-api.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("sven-api")

app = FastAPI(title="Sven API", description="Voice assistant backend for Sven iOS app")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests and responses."""
    start_time = time.time()

    # Log incoming request
    logger.info(f"→ {request.method} {request.url.path} from {request.client.host if request.client else 'unknown'}")

    # Process request
    response = await call_next(request)

    # Log response
    duration_ms = (time.time() - start_time) * 1000
    logger.info(f"← {request.method} {request.url.path} → {response.status_code} ({duration_ms:.1f}ms)")

    return response


# Config
ALLOWED_TOKENS_FILE = Path(__file__).parent / "allowed_tokens.json"
DB_PATH = Path.home() / "dispatch" / "state" / "sven-messages.db"
AUDIO_DIR = Path.home() / "dispatch" / "state" / "sven-audio"
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 30  # requests per window

# In-memory rate limiting (reset on restart)
request_counts: dict[str, list[float]] = {}


class PromptRequest(BaseModel):
    """Request from Sven iOS app"""
    transcript: str
    token: str
    attestation: Optional[str] = None
    assertion: Optional[str] = None


class PromptResponse(BaseModel):
    """Response to iOS app"""
    status: str
    message: str
    request_id: str


class Message(BaseModel):
    """A message in the conversation"""
    id: str
    role: str
    content: str
    audio_url: Optional[str]
    created_at: str


class MessagesResponse(BaseModel):
    """Response for GET /messages"""
    messages: list[Message]


def init_db():
    """Initialize the SQLite database if it doesn't exist."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            audio_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def load_allowed_tokens() -> set[str]:
    """Load allowed device tokens from file"""
    if ALLOWED_TOKENS_FILE.exists():
        with open(ALLOWED_TOKENS_FILE) as f:
            data = json.load(f)
            return set(data.get("tokens", []))
    return set()


def save_allowed_tokens(tokens: set[str]):
    """Save allowed device tokens to file"""
    with open(ALLOWED_TOKENS_FILE, "w") as f:
        json.dump({"tokens": list(tokens)}, f, indent=2)


def is_rate_limited(token: str) -> bool:
    """Check if token has exceeded rate limit"""
    now = time.time()
    if token not in request_counts:
        request_counts[token] = []

    # Remove old entries outside window
    request_counts[token] = [t for t in request_counts[token] if now - t < RATE_LIMIT_WINDOW]

    if len(request_counts[token]) >= RATE_LIMIT_MAX:
        return True

    request_counts[token].append(now)
    return False


def store_user_message(message_id: str, content: str):
    """Store user message in SQLite database."""
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO messages (id, role, content) VALUES (?, ?, ?)",
        (message_id, "user", content)
    )
    conn.commit()
    conn.close()


def inject_prompt_to_sven_session(transcript: str) -> bool:
    """Inject the transcript into the dedicated sven-app session."""
    try:
        logger.info(f"inject_prompt: calling inject-prompt CLI...")
        # Use inject-prompt to send to the sven-app session
        # The session will respond via reply-sven CLI which stores in message bus
        result = subprocess.run(
            [
                "/Users/sven/dispatch/bin/claude-assistant", "inject-prompt",
                "sven-app:voice",  # Dedicated sven-app session
                "--sven-app",  # Format for Sven iOS app
                "--admin",  # Admin tier access (Nikhil is admin)
                transcript
            ],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            logger.error(f"inject_prompt: failed with code {result.returncode}")
            logger.error(f"inject_prompt: stderr={result.stderr}")
            logger.error(f"inject_prompt: stdout={result.stdout}")
            return False

        logger.info(f"inject_prompt: success - {transcript[:50]}...")
        return True

    except subprocess.TimeoutExpired:
        logger.error("inject_prompt: timed out after 30s")
        return False
    except Exception as e:
        logger.error(f"inject_prompt: exception: {type(e).__name__}: {e}")
        return False


def get_messages_since(since_timestamp: Optional[str] = None) -> list[dict]:
    """Get messages from database, optionally filtered by timestamp."""
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    if since_timestamp:
        cursor = conn.execute(
            "SELECT * FROM messages WHERE created_at > ? ORDER BY created_at ASC",
            (since_timestamp,)
        )
    else:
        cursor = conn.execute(
            "SELECT * FROM messages ORDER BY created_at ASC"
        )

    messages = []
    for row in cursor.fetchall():
        msg = dict(row)
        # Convert audio_path to URL if present
        if msg.get("audio_path"):
            msg["audio_url"] = f"/audio/{msg['id']}"
        else:
            msg["audio_url"] = None
        del msg["audio_path"]
        messages.append(msg)

    conn.close()
    return messages


@app.get("/")
async def root():
    """Health check endpoint"""
    return {"status": "ok", "service": "sven-api", "time": datetime.now().isoformat()}


@app.get("/health")
async def health():
    """Health check for monitoring"""
    return {"status": "healthy"}


@app.post("/prompt", response_model=PromptResponse)
async def receive_prompt(request: PromptRequest):
    """
    Receive voice transcript from Sven iOS app.

    Stores user message and injects into sven-app session.
    Response will appear via GET /messages polling.
    """
    token_short = request.token[:8] if request.token else "none"
    logger.info(f"POST /prompt: token={token_short}... transcript={request.transcript[:100] if request.transcript else 'empty'}...")

    # Validate transcript
    if not request.transcript or not request.transcript.strip():
        logger.warning(f"POST /prompt: empty transcript from token={token_short}")
        raise HTTPException(status_code=400, detail="Empty transcript")

    transcript = request.transcript.strip()

    # Token validation
    allowed_tokens = load_allowed_tokens()
    logger.debug(f"Allowed tokens: {len(allowed_tokens)} registered")

    # If no tokens registered yet, accept any token and register it (first-time setup)
    if not allowed_tokens:
        logger.info(f"First token registration: {token_short}...")
        allowed_tokens.add(request.token)
        save_allowed_tokens(allowed_tokens)
    elif request.token not in allowed_tokens:
        logger.warning(f"POST /prompt: unauthorized token={token_short}")
        raise HTTPException(status_code=401, detail="Unknown device token")

    # Rate limiting
    if is_rate_limited(request.token):
        logger.warning(f"POST /prompt: rate limited token={token_short}")
        raise HTTPException(status_code=429, detail="Too many requests")

    # Generate request ID
    request_id = str(uuid.uuid4())
    logger.info(f"POST /prompt: created request_id={request_id[:8]}... for transcript")

    # Store user message in message bus
    try:
        store_user_message(request_id, transcript)
        logger.info(f"POST /prompt: stored user message {request_id[:8]}...")
    except Exception as e:
        logger.error(f"POST /prompt: failed to store message: {e}")
        raise HTTPException(status_code=500, detail="Failed to store message")

    # Inject into sven-app session
    logger.info(f"POST /prompt: injecting into sven-app session...")
    success = inject_prompt_to_sven_session(transcript)

    if not success:
        logger.error(f"POST /prompt: failed to inject prompt for request_id={request_id[:8]}")
        raise HTTPException(status_code=500, detail="Failed to inject prompt")

    logger.info(f"POST /prompt: success! request_id={request_id[:8]}...")
    return PromptResponse(
        status="ok",
        message="Prompt received. Poll /messages for response.",
        request_id=request_id
    )


@app.get("/messages", response_model=MessagesResponse)
async def get_messages(since: Optional[str] = None, token: Optional[str] = None):
    """
    Get messages from the conversation.

    Args:
        since: ISO timestamp to get messages after (optional)
        token: Device token for auth (optional, recommended)
    """
    token_short = token[:8] if token else "none"
    logger.debug(f"GET /messages: since={since}, token={token_short}...")

    # Optional token validation for polling
    if token:
        allowed_tokens = load_allowed_tokens()
        if allowed_tokens and token not in allowed_tokens:
            logger.warning(f"GET /messages: unauthorized token={token_short}")
            raise HTTPException(status_code=401, detail="Unknown device token")

    try:
        messages_data = get_messages_since(since)
    except Exception as e:
        logger.error(f"GET /messages: database error: {e}")
        raise HTTPException(status_code=500, detail="Database error")

    messages = [
        Message(
            id=m["id"],
            role=m["role"],
            content=m["content"],
            audio_url=m["audio_url"],
            created_at=m["created_at"]
        )
        for m in messages_data
    ]

    logger.debug(f"GET /messages: returning {len(messages)} messages")
    return MessagesResponse(messages=messages)


@app.get("/audio/{message_id}")
async def get_audio(message_id: str, token: Optional[str] = None):
    """
    Download TTS audio file for a message.

    Args:
        message_id: The message ID
        token: Device token for auth (optional)
    """
    token_short = token[:8] if token else "none"
    logger.info(f"GET /audio/{message_id[:8]}...: token={token_short}...")

    # Optional token validation
    if token:
        allowed_tokens = load_allowed_tokens()
        if allowed_tokens and token not in allowed_tokens:
            logger.warning(f"GET /audio: unauthorized token={token_short}")
            raise HTTPException(status_code=401, detail="Unknown device token")

    audio_path = AUDIO_DIR / f"{message_id}.wav"

    if not audio_path.exists():
        logger.warning(f"GET /audio: file not found: {audio_path}")
        raise HTTPException(status_code=404, detail="Audio not found")

    logger.info(f"GET /audio: serving {audio_path.name} ({audio_path.stat().st_size} bytes)")
    return FileResponse(
        path=audio_path,
        media_type="audio/wav",
        filename=f"{message_id}.wav"
    )


@app.delete("/messages")
async def clear_messages(token: Optional[str] = None):
    """
    Clear all messages (for testing/reset).

    Args:
        token: Device token for auth (optional)
    """
    if token:
        allowed_tokens = load_allowed_tokens()
        if allowed_tokens and token not in allowed_tokens:
            raise HTTPException(status_code=401, detail="Unknown device token")

    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM messages")
    conn.commit()
    conn.close()

    # Also clear audio files
    if AUDIO_DIR.exists():
        for audio_file in AUDIO_DIR.glob("*.wav"):
            audio_file.unlink()

    return {"status": "ok", "message": "All messages cleared"}


@app.post("/register")
async def register_token(token: str):
    """
    Register a new device token (admin endpoint).
    """
    allowed_tokens = load_allowed_tokens()
    allowed_tokens.add(token)
    save_allowed_tokens(allowed_tokens)
    return {"status": "ok", "message": "Token registered"}


@app.get("/tokens")
async def list_tokens():
    """List registered tokens (admin endpoint, shows truncated tokens)"""
    allowed_tokens = load_allowed_tokens()
    return {"tokens": [t[:8] + "..." for t in allowed_tokens]}


@app.post("/restart-session")
async def restart_session(token: Optional[str] = None):
    """
    Restart the sven-app Claude session.
    Useful when the session gets stuck or needs a fresh context.
    """
    token_short = token[:8] if token else "none"
    logger.info(f"POST /restart-session: token={token_short}...")

    # Optional token validation
    if token:
        allowed_tokens = load_allowed_tokens()
        if allowed_tokens and token not in allowed_tokens:
            logger.warning(f"POST /restart-session: unauthorized token={token_short}")
            raise HTTPException(status_code=401, detail="Unknown device token")

    try:
        result = subprocess.run(
            [
                "/Users/sven/dispatch/bin/claude-assistant", "restart-session",
                "sven-app:voice"
            ],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            logger.error(f"restart-session: failed with code {result.returncode}")
            logger.error(f"restart-session: stderr={result.stderr}")
            raise HTTPException(status_code=500, detail="Failed to restart session")

        logger.info("restart-session: success")
        return {"status": "ok", "message": "Session restarted"}

    except subprocess.TimeoutExpired:
        logger.error("restart-session: timed out after 30s")
        raise HTTPException(status_code=500, detail="Timeout restarting session")
    except Exception as e:
        logger.error(f"restart-session: exception: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("Starting Sven API server...")
    logger.info(f"Log file: {LOG_FILE}")
    logger.info(f"Allowed tokens file: {ALLOWED_TOKENS_FILE}")
    logger.info(f"Database: {DB_PATH}")
    logger.info(f"Audio directory: {AUDIO_DIR}")
    logger.info("Listening on http://0.0.0.0:8080")
    logger.info("Tailscale IP: 100.127.42.15:8080")
    logger.info("=" * 60)

    # Initialize database on startup
    init_db()

    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="warning")
