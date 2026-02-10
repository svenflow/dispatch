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
and injects them into the user's SMS session.

Run with: uv run server.py
Or: ./server.py (if executable)

Listens on: http://0.0.0.0:8080
"""

import json
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="Sven API", description="Voice-to-SMS bridge for Sven iOS app")

# Config
ALLOWED_TOKENS_FILE = Path(__file__).parent / "allowed_tokens.json"
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 30  # requests per window

# In-memory rate limiting (reset on restart)
request_counts: dict[str, list[float]] = {}


class PromptRequest(BaseModel):
    """Request from Sven iOS app"""
    transcript: str
    token: str
    # App Attest fields (optional for now, will add later)
    attestation: Optional[str] = None
    assertion: Optional[str] = None


class PromptResponse(BaseModel):
    """Response to iOS app (actual response comes via SMS)"""
    status: str
    message: str


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


def echo_to_imessage(transcript: str) -> bool:
    """Send the transcript to iMessage so user has a record of what they said."""
    try:
        # Send via send-sms so it appears in iMessage history
        result = subprocess.run(
            [
                "/Users/sven/.claude/skills/sms-assistant/scripts/send-sms",
                "+15555550001",  # Nikhil's chat
                f"🎤 {transcript}"  # Prefix with mic emoji to show it came from Sven app
            ],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            print(f"echo send-sms failed: {result.stderr}")
            return False

        print(f"Echoed to iMessage: {transcript[:100]}...")
        return True

    except subprocess.TimeoutExpired:
        print("echo send-sms timed out")
        return False
    except Exception as e:
        print(f"echo send-sms error: {e}")
        return False


def inject_prompt(transcript: str) -> bool:
    """Inject the transcript into Nikhil's 1:1 session via inject-prompt CLI"""
    try:
        # Use inject-prompt to send to Nikhil's 1:1 session (not group chat)
        # The chat_id for Nikhil's individual chat is +15555550001
        # --sven-app flag adds 🎤 prefix to indicate it came from the app
        result = subprocess.run(
            [
                "/Users/sven/dispatch/bin/claude-assistant", "inject-prompt",
                "+15555550001",  # Nikhil's 1:1 chat_id
                "--sms",  # Format as SMS
                "--sven-app",  # Mark as Sven app message (adds 🎤 prefix)
                transcript
            ],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            print(f"inject-prompt failed: {result.stderr}")
            return False

        print(f"Injected prompt: {transcript[:100]}...")
        return True

    except subprocess.TimeoutExpired:
        print("inject-prompt timed out")
        return False
    except Exception as e:
        print(f"inject-prompt error: {e}")
        return False


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

    The transcript is injected into the user's SMS session,
    and the response comes back via SMS (not HTTP).
    """
    # Validate transcript
    if not request.transcript or not request.transcript.strip():
        raise HTTPException(status_code=400, detail="Empty transcript")

    transcript = request.transcript.strip()

    # Token validation
    allowed_tokens = load_allowed_tokens()

    # If no tokens registered yet, accept any token and register it (first-time setup)
    if not allowed_tokens:
        print(f"First token registration: {request.token[:8]}...")
        allowed_tokens.add(request.token)
        save_allowed_tokens(allowed_tokens)
    elif request.token not in allowed_tokens:
        raise HTTPException(status_code=401, detail="Unknown device token")

    # Rate limiting
    if is_rate_limited(request.token):
        raise HTTPException(status_code=429, detail="Too many requests")

    # TODO: App Attest verification
    # For now, we rely on Tailscale network isolation + token
    # Will add App Attest verification when iOS app implements it

    # First, echo to iMessage so user has a record of what they said
    # (voice messages are invisible in iMessage history otherwise)
    echo_to_imessage(transcript)

    # Then inject into session for Claude to respond
    success = inject_prompt(transcript)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to inject prompt")

    return PromptResponse(
        status="ok",
        message="Prompt received. Response will come via SMS."
    )


@app.post("/register")
async def register_token(token: str):
    """
    Register a new device token (admin endpoint).
    In production, this would require authentication.
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


if __name__ == "__main__":
    print("Starting Sven API server...")
    print(f"Allowed tokens file: {ALLOWED_TOKENS_FILE}")
    print("Listening on http://0.0.0.0:8080")
    print("Tailscale IP: 100.127.42.15:8080")
    uvicorn.run(app, host="0.0.0.0", port=8080)
