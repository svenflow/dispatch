#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
CLI for Apple Notes - list, read, search, create, update notes.
Handles both local and shared iCloud notes.
"""
import subprocess
import sys
import json
import time
from pathlib import Path


def ensure_notes_open():
    """Ensure Notes.app is running before AppleScript operations."""
    subprocess.run(["open", "-a", "Notes"], check=True)
    time.sleep(0.5)  # Brief pause for app to launch


def run_applescript(script: str) -> str:
    """Execute AppleScript and return output."""
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"AppleScript error: {result.stderr}")
    return result.stdout.strip()


def search_notes(query: str) -> list[str]:
    """Search notes by content or name."""
    script = f"""
    tell application "Notes"
        set matchingNotes to {{}}
        repeat with aNote in every note
            set noteName to name of aNote
            set noteBody to body of aNote
            if noteName contains "{query}" or noteBody contains "{query}" then
                set end of matchingNotes to name of aNote
            end if
        end repeat
        return matchingNotes
    end tell
    """
    output = run_applescript(script)
    if not output:
        return []
    # Parse comma-separated list
    return [n.strip() for n in output.split(",")]


def read_note(name: str) -> str:
    """Read note content by name."""
    script = f"""
    tell application "Notes"
        get body of note "{name}"
    end tell
    """
    return run_applescript(script)


def list_accounts() -> list[str]:
    """List all accounts (iCloud, On My Mac, etc.)."""
    script = """
    tell application "Notes"
        get name of every account
    end tell
    """
    output = run_applescript(script)
    if not output:
        return []
    return [a.strip() for a in output.split(",")]


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Apple Notes CLI")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Search notes
    search_parser = subparsers.add_parser("search", help="Search notes")
    search_parser.add_argument("query", help="Search query")

    # Read note
    read_parser = subparsers.add_parser("read", help="Read note content")
    read_parser.add_argument("name", help="Note name")

    # List accounts
    subparsers.add_parser("accounts", help="List accounts")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Ensure Notes.app is open before any operation
    ensure_notes_open()

    try:
        if args.command == "search":
            results = search_notes(args.query)
            for note_name in results:
                print(note_name)

        elif args.command == "read":
            content = read_note(args.name)
            print(content)

        elif args.command == "accounts":
            accounts = list_accounts()
            for account in accounts:
                print(account)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
