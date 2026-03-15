#!/usr/bin/env -S uv run --script
"""
Set up nightly ephemeral tasks via the reminder/scheduler system.

Creates two cron reminders that fire task.requested events at 2am:
1. Memory consolidation (script mode) - runs consolidate_3pass + consolidate_chat
2. Skillify analysis (agent mode) - runs /skillify --nightly

These replace the hardcoded 2am consolidation in manager.py.

Usage:
    setup-nightly-tasks.py           # Add both reminders
    setup-nightly-tasks.py --list    # Show existing nightly task reminders
    setup-nightly-tasks.py --remove  # Remove existing nightly task reminders
"""
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

import sys
from pathlib import Path

# Add dispatch to path
sys.path.insert(0, str(Path.home() / "dispatch"))

from assistant import config
from assistant.reminders import (
    create_reminder, load_reminders, save_reminders, reminders_lock,
)


def _get_admin_phone() -> str:
    """Look up admin phone from config (never hardcode)."""
    return config.require("owner.phone")


# Task IDs are stable so we can detect duplicates
CONSOLIDATION_TASK_ID = "nightly-consolidation"
SKILLIFY_TASK_ID = "nightly-skillify"

NIGHTLY_TASK_IDS = {CONSOLIDATION_TASK_ID, SKILLIFY_TASK_ID}

# Skillify prompt (single source of truth, used in both instructions and execution.prompt)
SKILLIFY_PROMPT = (
    "Run /skillify --nightly to analyze today's conversations for "
    "new skill opportunities and improvements to existing skills. "
    "This runs the full discovery→refinement pipeline. "
    "When done, send a concise summary of findings to the admin via SMS."
)


def _build_consolidation_reminder(admin_phone: str) -> dict:
    """Build the consolidation reminder config."""
    return {
        "title": "Nightly memory consolidation",
        "schedule_type": "cron",
        "schedule_value": "0 2 * * *",  # 2am daily
        "tz_name": "America/New_York",
        "event": {
            "topic": "tasks",
            "type": "task.requested",
            "key": admin_phone,
            "payload": {
                "task_id": CONSOLIDATION_TASK_ID,
                "title": "Nightly memory consolidation",
                "requested_by": admin_phone,
                "instructions": "Run the nightly memory consolidation scripts",
                "notify": True,
                "timeout_minutes": 30,
                "execution": {
                    "mode": "script",
                    # Store $HOME-relative path; bash expands $HOME at runtime
                    "command": [
                        "bash", "-c",
                        "$HOME/dispatch/scripts/nightly-consolidation.sh",
                    ],
                },
            },
        },
    }


def _build_skillify_reminder(admin_phone: str) -> dict:
    """Build the skillify reminder config."""
    return {
        "title": "Nightly skillify analysis",
        "schedule_type": "cron",
        "schedule_value": "30 2 * * *",  # 2:30am daily (after consolidation's 30min timeout)
        "tz_name": "America/New_York",
        "event": {
            "topic": "tasks",
            "type": "task.requested",
            "key": admin_phone,
            "payload": {
                "task_id": SKILLIFY_TASK_ID,
                "title": "Nightly skillify analysis",
                "requested_by": admin_phone,
                "instructions": SKILLIFY_PROMPT,
                "notify": True,
                "timeout_minutes": 45,
                "execution": {
                    "mode": "agent",
                    "prompt": SKILLIFY_PROMPT,
                },
            },
        },
    }


def find_existing(reminders: list) -> list:
    """Find existing nightly task reminders by task_id in event payload."""
    found = []
    for r in reminders:
        event = r.get("event", {})
        payload = event.get("payload", {})
        if payload.get("task_id") in NIGHTLY_TASK_IDS:
            found.append(r)
    return found


def cmd_list():
    with reminders_lock():
        data = load_reminders()
    existing = find_existing(data["reminders"])
    if not existing:
        print("No nightly task reminders found.")
        return
    for r in existing:
        task_id = r.get("event", {}).get("payload", {}).get("task_id", "?")
        cron = r.get("schedule", {}).get("value", "?")
        print(f"  [{r['id']}] {r['title']} (cron: {cron}, task: {task_id})")


def cmd_remove():
    with reminders_lock():
        data = load_reminders()
        existing = find_existing(data["reminders"])
        if not existing:
            print("No nightly task reminders to remove.")
            return
        ids_to_remove = {r["id"] for r in existing}
        data["reminders"] = [r for r in data["reminders"] if r["id"] not in ids_to_remove]
        save_reminders(data)
    for r in existing:
        print(f"  Removed: {r['title']} ({r['id']})")


def cmd_add():
    admin_phone = _get_admin_phone()

    with reminders_lock():
        data = load_reminders()

        # Check for existing
        existing = find_existing(data["reminders"])
        if existing:
            print("Nightly task reminders already exist:")
            for r in existing:
                print(f"  [{r['id']}] {r['title']}")
            print("\nUse --remove first to replace them.")
            return

        # Create consolidation reminder
        r1 = create_reminder(**_build_consolidation_reminder(admin_phone))
        data["reminders"].append(r1)
        print(f"  Added: {r1['title']} (id={r1['id']}, cron=0 2 * * *, mode=script)")

        # Create skillify reminder
        r2 = create_reminder(**_build_skillify_reminder(admin_phone))
        data["reminders"].append(r2)
        print(f"  Added: {r2['title']} (id={r2['id']}, cron=30 2 * * *, mode=agent)")

        save_reminders(data)

    print("\n✅ Both nightly tasks scheduled. They'll fire at 2:00am and 2:30am ET.")
    print("Consolidation has 30min timeout; skillify starts after that window.")


def main():
    if "--list" in sys.argv:
        cmd_list()
    elif "--remove" in sys.argv:
        cmd_remove()
    else:
        cmd_add()


if __name__ == "__main__":
    main()
