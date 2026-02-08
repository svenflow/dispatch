#!/usr/bin/env -S uv run --script
# /// script
# dependencies = []
# ///
"""
Transcript folder migration script.

Migrates transcript folders from flat structure to backend-prefixed structure:
  ~/transcripts/nikhil-thorat/ -> ~/transcripts/imessage/_16175969496/

Usage:
  uv run ~/dispatch/scripts/migrate_transcripts.py --dry-run  # Preview changes
  uv run ~/dispatch/scripts/migrate_transcripts.py            # Execute migration
"""
import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

TRANSCRIPTS_DIR = Path.home() / "transcripts"
REGISTRY_PATH = Path.home() / "dispatch/state/sessions.json"

# Registry prefixes by backend
REGISTRY_PREFIXES = {
    "imessage": "",
    "signal": "signal:",
    "test": "test:",
}


def sanitize_chat_id(chat_id: str) -> str:
    """Strip registry prefix, escape + for filesystem."""
    bare_id = chat_id
    for prefix in REGISTRY_PREFIXES.values():
        if prefix and chat_id.startswith(prefix):
            bare_id = chat_id[len(prefix):]
            break
    return bare_id.replace("+", "_")


def get_new_session_name(chat_id: str, source: str) -> str:
    """Generate new session name: {backend}/{sanitized_chat_id}."""
    return f"{source}/{sanitize_chat_id(chat_id)}"


def get_new_transcript_dir(chat_id: str, source: str) -> Path:
    """Generate new transcript directory path."""
    return TRANSCRIPTS_DIR / source / sanitize_chat_id(chat_id)


def load_registry() -> dict:
    """Load the sessions registry."""
    if not REGISTRY_PATH.exists():
        print(f"ERROR: Registry not found at {REGISTRY_PATH}", file=sys.stderr)
        sys.exit(1)
    return json.loads(REGISTRY_PATH.read_text())


def save_registry(registry: dict):
    """Save the sessions registry."""
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2))


def get_all_transcript_folders() -> set[Path]:
    """Get all transcript folders (excluding special ones)."""
    folders = set()
    if not TRANSCRIPTS_DIR.exists():
        return folders

    for item in TRANSCRIPTS_DIR.iterdir():
        if not item.is_dir():
            continue
        if item.name.startswith('.'):
            continue
        # Skip backend directories (they'll contain migrated sessions)
        if item.name in ("imessage", "signal", "test"):
            # Include subfolders from backend directories
            for subitem in item.iterdir():
                if subitem.is_dir() and not subitem.name.startswith('.'):
                    folders.add(subitem)
            continue
        # Skip master (unchanged per spec)
        if item.name == "master":
            continue
        folders.add(item)

    return folders


def migrate(dry_run: bool = True):
    """Run the migration."""
    print(f"=== Transcript Migration {'(DRY RUN)' if dry_run else ''} ===")
    print(f"Registry: {REGISTRY_PATH}")
    print(f"Transcripts: {TRANSCRIPTS_DIR}")
    print()

    registry = load_registry()

    # Track what's in registry for orphan detection
    registered_old_paths = set()
    registered_new_paths = set()

    # Stats
    migrated = 0
    already_migrated = 0
    errors = []

    print("=== Processing Registry Entries ===")
    print()

    # Process each registry entry
    for registry_key, entry in registry.items():
        chat_id = entry.get("chat_id", registry_key)
        source = entry.get("source", "imessage")
        old_session_name = entry.get("session_name", "")
        old_transcript_dir = Path(entry.get("transcript_dir", ""))

        new_session_name = get_new_session_name(chat_id, source)
        new_transcript_dir = get_new_transcript_dir(chat_id, source)

        registered_old_paths.add(old_transcript_dir)
        registered_new_paths.add(new_transcript_dir)

        # Check if already migrated
        if old_transcript_dir == new_transcript_dir:
            print(f"[SKIP] {chat_id}: Already migrated")
            already_migrated += 1
            continue

        # Check if session name already has new format
        if "/" in old_session_name and old_session_name.startswith(source + "/"):
            print(f"[SKIP] {chat_id}: Session name already migrated")
            already_migrated += 1
            continue

        print(f"[MIGRATE] {chat_id}")
        print(f"  Old: {old_transcript_dir}")
        print(f"  New: {new_transcript_dir}")
        print(f"  Session: {old_session_name} -> {new_session_name}")

        if dry_run:
            print()
            migrated += 1
            continue

        # Actually perform migration
        try:
            # Create backend directory if needed
            new_transcript_dir.parent.mkdir(parents=True, exist_ok=True)

            # Check if old path exists
            if not old_transcript_dir.exists():
                print(f"  WARNING: Old path does not exist, creating new directory")
                new_transcript_dir.mkdir(parents=True, exist_ok=True)
            elif new_transcript_dir.exists():
                print(f"  WARNING: New path already exists, merging...")
                # Move contents from old to new
                for item in old_transcript_dir.iterdir():
                    dest = new_transcript_dir / item.name
                    if dest.exists():
                        print(f"    Skip existing: {item.name}")
                    else:
                        shutil.move(str(item), str(dest))
                # Remove old directory if empty
                try:
                    old_transcript_dir.rmdir()
                except OSError:
                    print(f"  WARNING: Could not remove old directory (not empty)")
            else:
                # Simple move
                shutil.move(str(old_transcript_dir), str(new_transcript_dir))

            # Update registry entry
            entry["session_name"] = new_session_name
            entry["transcript_dir"] = str(new_transcript_dir)

            print(f"  OK")
            print()
            migrated += 1

        except Exception as e:
            error_msg = f"{chat_id}: {e}"
            errors.append(error_msg)
            print(f"  ERROR: {e}")
            print()

    # Save updated registry if not dry run
    if not dry_run and migrated > 0:
        save_registry(registry)
        print(f"Registry saved to {REGISTRY_PATH}")
        print()

    # Find orphan folders
    print("=== Orphan Detection ===")
    print()

    all_folders = get_all_transcript_folders()
    orphans = []

    for folder in sorted(all_folders):
        # Check if folder is in registered paths (old or new)
        if folder not in registered_old_paths and folder not in registered_new_paths:
            # Check if it matches any transcript_dir in registry
            is_registered = False
            for entry in registry.values():
                if Path(entry.get("transcript_dir", "")) == folder:
                    is_registered = True
                    break

            if not is_registered:
                orphans.append(folder)

    if orphans:
        print("Orphan folders (not in registry):")
        for orphan in orphans:
            print(f"  - {orphan}")
        print()
        print(f"Total orphans: {len(orphans)}")
        print("These folders exist but have no registry entry.")
        print("They may be from old sessions or test data.")
    else:
        print("No orphan folders detected.")

    # Summary
    print()
    print("=== Summary ===")
    print(f"Registry entries: {len(registry)}")
    print(f"Migrated: {migrated}")
    print(f"Already migrated: {already_migrated}")
    print(f"Errors: {len(errors)}")
    print(f"Orphan folders: {len(orphans)}")

    if errors:
        print()
        print("=== Errors ===")
        for error in errors:
            print(f"  - {error}")

    if dry_run:
        print()
        print("This was a dry run. No changes were made.")
        print("Run without --dry-run to execute the migration.")


def main():
    parser = argparse.ArgumentParser(
        description="Migrate transcript folders to backend-prefixed structure"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without making them"
    )

    args = parser.parse_args()
    migrate(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
