#!/usr/bin/env -S uv run --script
"""
Google Cloud Text-to-Speech converter.
Converts text to audio using Google Cloud TTS API.
"""

import argparse
import base64
import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

# Load API key from .env
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

API_KEY = os.getenv("GOOGLE_TTS_API_KEY")
TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"

# Maximum bytes per request (Google limit is 5000 bytes, ~5000 chars)
MAX_CHUNK_SIZE = 4500


def synthesize_text(text: str, voice: str = "en-US-Neural2-D", speaking_rate: float = 1.0) -> bytes:
    """Synthesize text to audio bytes."""
    if not API_KEY:
        raise ValueError("GOOGLE_TTS_API_KEY not found in environment")

    # Parse voice name to get language code
    parts = voice.split("-")
    language_code = f"{parts[0]}-{parts[1]}" if len(parts) >= 2 else "en-US"

    payload = {
        "input": {"text": text},
        "voice": {
            "languageCode": language_code,
            "name": voice,
        },
        "audioConfig": {
            "audioEncoding": "MP3",
            "speakingRate": speaking_rate,
            "pitch": 0,
        },
    }

    response = requests.post(
        f"{TTS_ENDPOINT}?key={API_KEY}",
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload),
    )

    if response.status_code != 200:
        raise Exception(f"TTS API error: {response.status_code} - {response.text}")

    result = response.json()
    audio_content = base64.b64decode(result["audioContent"])
    return audio_content


def chunk_text(text: str, max_size: int = MAX_CHUNK_SIZE) -> list[str]:
    """Split text into chunks that fit within API limits."""
    # Split by sentences first
    import re
    sentences = re.split(r'(?<=[.!?])\s+', text)
    
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        if len(current_chunk) + len(sentence) + 1 <= max_size:
            current_chunk += (" " if current_chunk else "") + sentence
        else:
            if current_chunk:
                chunks.append(current_chunk)
            # If single sentence is too long, split by words
            if len(sentence) > max_size:
                words = sentence.split()
                current_chunk = ""
                for word in words:
                    if len(current_chunk) + len(word) + 1 <= max_size:
                        current_chunk += (" " if current_chunk else "") + word
                    else:
                        if current_chunk:
                            chunks.append(current_chunk)
                        current_chunk = word
            else:
                current_chunk = sentence
    
    if current_chunk:
        chunks.append(current_chunk)
    
    return chunks


def text_to_speech(text: str, output_path: str, voice: str = "en-US-Neural2-D", speaking_rate: float = 1.0):
    """Convert text to speech and save to file."""
    chunks = chunk_text(text)
    
    print(f"Converting {len(chunks)} chunk(s) to audio...")
    
    audio_parts = []
    for i, chunk in enumerate(chunks):
        print(f"  Processing chunk {i+1}/{len(chunks)} ({len(chunk)} chars)...")
        audio = synthesize_text(chunk, voice, speaking_rate)
        audio_parts.append(audio)
    
    # Combine audio parts (simple concatenation works for MP3)
    combined = b"".join(audio_parts)
    
    with open(output_path, "wb") as f:
        f.write(combined)
    
    print(f"Saved audio to: {output_path}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Convert text to speech")
    parser.add_argument("text", nargs="?", help="Text to convert")
    parser.add_argument("--file", "-f", help="Read text from file")
    parser.add_argument("--output", "-o", required=True, help="Output audio file path")
    parser.add_argument("--voice", "-v", default="en-US-Neural2-D", help="Voice name")
    parser.add_argument("--rate", "-r", type=float, default=1.0, help="Speaking rate (0.25-4.0)")
    
    args = parser.parse_args()
    
    if args.file:
        with open(args.file, "r") as f:
            text = f.read()
    elif args.text:
        text = args.text
    else:
        # Read from stdin
        text = sys.stdin.read()
    
    if not text.strip():
        print("Error: No text provided", file=sys.stderr)
        sys.exit(1)
    
    text_to_speech(text, args.output, args.voice, args.rate)


if __name__ == "__main__":
    main()
