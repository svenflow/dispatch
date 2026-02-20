#!/usr/bin/env -S uv run --script
"""Poll for due reminders from macOS Reminders.app SQLite database."""

import sqlite3
import json
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
import sys
import re

# Core Data epoch: 2001-01-01 00:00:00 UTC
CORE_DATA_EPOCH = 978307200

# Prefix for contact-specific lists
CONTACT_LIST_PREFIX = "Claude: "


def find_all_reminders_dbs():
    """Find all Reminders databases."""
    base_path = Path.home() / "Library/Group Containers/group.com.apple.reminders/Container_v1/Stores"
    dbs = list(base_path.glob("Data-*.sqlite"))
    # Exclude Data-local.sqlite as it's for local sync state, not actual reminders
    return [db for db in dbs if "local" not in db.name.lower()]


def find_reminders_db():
    """Find the most recently modified Reminders database (legacy, for backwards compat)."""
    dbs = find_all_reminders_dbs()
    if not dbs:
        return None

    # Sort by modification time of the -wal file (most active)
    def get_wal_mtime(db_path):
        wal_path = db_path.with_suffix(".sqlite-wal")
        if wal_path.exists():
            return wal_path.stat().st_mtime
        return db_path.stat().st_mtime

    dbs.sort(key=get_wal_mtime, reverse=True)
    return dbs[0] if dbs else None


def extract_contact_from_list(list_name):
    """Extract contact name from a 'Claude: <contact>' list name."""
    if list_name and list_name.startswith(CONTACT_LIST_PREFIX):
        return list_name[len(CONTACT_LIST_PREFIX):]
    return None


def extract_target_from_notes(notes):
    """Extract target session type from notes. Returns (target, cleaned_notes)."""
    if not notes:
        return "fg", None

    match = re.match(r'^\[target:(fg|bg|both)\]\s*(.*)$', notes, re.DOTALL)
    if match:
        return match.group(1), match.group(2).strip() or None
    return "fg", notes


def extract_cron_from_notes(notes):
    """Extract cron pattern from notes. Returns (cron_pattern, cleaned_notes)."""
    if not notes:
        return None, None

    match = re.search(r'\[cron:([^\]]+)\]', notes)
    if match:
        cron_pattern = match.group(1).strip()
        cleaned = re.sub(r'\[cron:[^\]]+\]\s*', '', notes).strip() or None
        return cron_pattern, cleaned
    return None, notes


def parse_tags_from_notes(notes):
    """Parse all tags from notes. Returns dict with target, cron, and cleaned notes."""
    result = {"target": "fg", "cron": None, "notes": None}
    if not notes:
        return result

    remaining = notes

    # Extract target
    target_match = re.search(r'\[target:(fg|bg|both)\]', remaining)
    if target_match:
        result["target"] = target_match.group(1)
        remaining = re.sub(r'\[target:[^\]]+\]\s*', '', remaining)

    # Extract cron
    cron_match = re.search(r'\[cron:([^\]]+)\]', remaining)
    if cron_match:
        result["cron"] = cron_match.group(1).strip()
        remaining = re.sub(r'\[cron:[^\]]+\]\s*', '', remaining)

    result["notes"] = remaining.strip() or None
    return result


def get_due_reminders(db_path, include_all=False, contact=None):
    """
    Get reminders that are due and not completed.

    Args:
        db_path: Path to the SQLite database
        include_all: If True, return all incomplete reminders regardless of due date
        contact: If specified, only return reminders for this contact's list

    Returns:
        List of reminder dicts with id, title, due_date, notes, list_name, contact
    """
    # Use URI mode with read-only to properly access WAL journal data
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Current time as Core Data timestamp
    now_core_data = datetime.now().timestamp() - CORE_DATA_EPOCH

    # Build the query
    base_query = """
        SELECT
            r.Z_PK as id,
            r.ZTITLE as title,
            r.ZDUEDATE as due_date_raw,
            r.ZNOTES as notes,
            r.ZCOMPLETED as completed,
            r.ZPRIORITY as priority,
            l.ZNAME as list_name
        FROM ZREMCDREMINDER r
        LEFT JOIN ZREMCDBASELIST l ON r.ZLIST = l.Z_PK
        WHERE r.ZCOMPLETED = 0
          AND r.ZMARKEDFORDELETION = 0
          AND r.ZDUEDATE IS NOT NULL
    """

    conditions = []
    params = []

    if not include_all:
        conditions.append("r.ZDUEDATE <= ?")
        params.append(now_core_data)

    if contact:
        conditions.append("l.ZNAME = ?")
        params.append(f"{CONTACT_LIST_PREFIX}{contact}")

    if conditions:
        base_query += " AND " + " AND ".join(conditions)

    base_query += " ORDER BY r.ZDUEDATE ASC"

    cursor.execute(base_query, params)

    reminders = []
    for row in cursor.fetchall():
        due_ts = row["due_date_raw"] + CORE_DATA_EPOCH if row["due_date_raw"] else None
        due_dt = datetime.fromtimestamp(due_ts) if due_ts else None
        list_name = row["list_name"] or "Reminders"

        # Parse all tags from notes
        tags = parse_tags_from_notes(row["notes"])

        reminders.append({
            "id": row["id"],
            "title": row["title"],
            "due_date": due_dt.isoformat() if due_dt else None,
            "due_timestamp": due_ts,
            "notes": tags["notes"],
            "priority": row["priority"],
            "list": list_name,
            "contact": extract_contact_from_list(list_name),
            "target": tags["target"],
            "cron": tags["cron"]
        })

    conn.close()
    return reminders


def get_cron_reminders(db_path, contact=None):
    """
    Get all incomplete reminders that have a cron pattern in notes.

    Args:
        db_path: Path to the SQLite database
        contact: If specified, only return reminders for this contact's list

    Returns:
        List of reminder dicts with cron patterns (includes due_date as "until" date)
    """
    # Use URI mode with read-only to properly access WAL journal data
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get all incomplete reminders with cron patterns (due_date is optional "until" date)
    base_query = """
        SELECT
            r.Z_PK as id,
            r.ZTITLE as title,
            r.ZDUEDATE as due_date_raw,
            r.ZNOTES as notes,
            r.ZPRIORITY as priority,
            l.ZNAME as list_name
        FROM ZREMCDREMINDER r
        LEFT JOIN ZREMCDBASELIST l ON r.ZLIST = l.Z_PK
        WHERE r.ZCOMPLETED = 0
          AND r.ZMARKEDFORDELETION = 0
          AND r.ZNOTES LIKE '%[cron:%'
    """

    params = []
    if contact:
        base_query += " AND l.ZNAME = ?"
        params.append(f"{CONTACT_LIST_PREFIX}{contact}")

    cursor.execute(base_query, params)

    reminders = []
    for row in cursor.fetchall():
        list_name = row["list_name"] or "Reminders"
        tags = parse_tags_from_notes(row["notes"])

        # Parse until_date from due_date (cron fires until this date, then auto-completes)
        until_ts = row["due_date_raw"] + CORE_DATA_EPOCH if row["due_date_raw"] else None
        until_dt = datetime.fromtimestamp(until_ts) if until_ts else None

        # Only include if it has a cron pattern
        if tags["cron"]:
            reminders.append({
                "id": row["id"],
                "title": row["title"],
                "notes": tags["notes"],
                "priority": row["priority"],
                "list": list_name,
                "contact": extract_contact_from_list(list_name),
                "target": tags["target"],
                "cron": tags["cron"],
                "until_date": until_dt.isoformat() if until_dt else None,
                "until_timestamp": until_ts
            })

    conn.close()
    return reminders


def complete_reminder(title, list_name="Reminders"):
    """Mark a reminder as complete using osascript (safer than direct DB modification)."""
    # Escape quotes in title and list_name
    title_escaped = title.replace('"', '\\"')
    list_escaped = list_name.replace('"', '\\"')

    script = f'''
    tell application "Reminders"
        set targetList to list "{list_escaped}"
        set matchingReminders to (reminders of targetList whose name is "{title_escaped}" and completed is false)
        if (count of matchingReminders) > 0 then
            set completed of item 1 of matchingReminders to true
            return "Completed: " & "{title_escaped}"
        else
            return "Not found: " & "{title_escaped}"
        end if
    end tell
    '''
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if result.returncode != 0:
        return f"Error: {result.stderr}"
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description="Poll for due reminders")
    parser.add_argument("--all", action="store_true", help="Show all incomplete reminders, not just due ones")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--contact", "-c", help="Filter by contact name (looks for 'Claude: <contact>' list)")
    parser.add_argument("--complete", metavar="TITLE", help="Mark a reminder as complete by title")
    parser.add_argument("--list", default="Reminders", help="List name for --complete (default: Reminders)")
    args = parser.parse_args()

    if args.complete:
        # If contact specified, use the contact's list
        list_name = args.list
        if args.contact:
            list_name = f"{CONTACT_LIST_PREFIX}{args.contact}"
        result = complete_reminder(args.complete, list_name)
        print(result)
        return

    db_paths = find_all_reminders_dbs()
    if not db_paths:
        print("Error: Could not find Reminders database", file=sys.stderr)
        sys.exit(1)

    # Aggregate reminders from all databases
    reminders = []
    for db_path in db_paths:
        try:
            reminders.extend(get_due_reminders(db_path, include_all=args.all, contact=args.contact))
        except Exception:
            # Skip databases that can't be read
            pass

    if args.json:
        print(json.dumps(reminders, indent=2))
    else:
        if not reminders:
            print("No due reminders.")
        else:
            for r in reminders:
                due_str = r["due_date"] if r["due_date"] else "No due date"
                print(f"[{r['id']}] {r['title']}")
                print(f"    Due: {due_str}")
                print(f"    List: {r['list']}")
                if r["contact"]:
                    print(f"    Contact: {r['contact']}")
                if r["notes"]:
                    print(f"    Notes: {r['notes']}")
                print()


if __name__ == "__main__":
    main()
