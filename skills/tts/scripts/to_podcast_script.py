#!/usr/bin/env -S uv run --script
"""
Convert text/documents to natural podcast scripts using Gemini.
Strips markdown, tables, special characters and rewrites as spoken monologue.
"""

import argparse
import os
import sys
from pathlib import Path

from google import genai

# Load API key from ~/code/.env (same as nano-banana)
env_path = Path.home() / "code" / ".env"
API_KEY = None
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            if line.startswith("GEMINI_API_KEY="):
                API_KEY = line.strip().split("=", 1)[1]
                break

SYSTEM_PROMPT = """You are a podcast script writer. Convert the following document into a natural, engaging podcast monologue.

CRITICAL RULES:
1. Write ONLY plain text that sounds natural when read aloud by text-to-speech
2. NO special characters: no dashes (--), asterisks (*), underscores (_), pipes (|), brackets, etc.
3. NO markdown formatting whatsoever
4. Convert all tables into flowing prose (e.g., "For cameras, Canon has the best SDK. For printers, expect a 50% failure rate...")
5. Convert bullet points into natural sentences and transitions
6. Numbers should be written as they'd be spoken (e.g., "$100 to $250 per hour" not "$100-250/hr")
7. Use conversational transitions: "Now let's talk about...", "Here's what's interesting...", "Moving on to..."
8. Keep the same information but make it sound like a person naturally explaining it
9. Add brief pauses with periods, not ellipses or dashes
10. Start with a brief intro like "Today we're looking at..." or "In this episode..."

The output should feel like listening to a knowledgeable friend explain the topic over coffee."""


def convert_to_script(text: str) -> str:
    """Convert text to podcast script using Gemini."""
    if not API_KEY:
        raise ValueError("GEMINI_API_KEY not found in ~/code/.env")

    client = genai.Client(api_key=API_KEY)

    prompt = f"{SYSTEM_PROMPT}\n\n---\n\nDOCUMENT TO CONVERT:\n\n{text}"

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt
    )
    return response.text


def main():
    parser = argparse.ArgumentParser(description="Convert text to podcast script")
    parser.add_argument("text", nargs="?", help="Text to convert")
    parser.add_argument("--file", "-f", help="Read text from file")
    parser.add_argument("--output", "-o", help="Output file (default: stdout)")

    args = parser.parse_args()

    if args.file:
        with open(args.file, "r") as f:
            text = f.read()
    elif args.text:
        text = args.text
    else:
        text = sys.stdin.read()

    if not text.strip():
        print("Error: No text provided", file=sys.stderr)
        sys.exit(1)

    print("Converting to podcast script...", file=sys.stderr)
    script = convert_to_script(text)

    if args.output:
        with open(args.output, "w") as f:
            f.write(script)
        print(f"Saved script to: {args.output}", file=sys.stderr)
    else:
        print(script)


if __name__ == "__main__":
    main()
