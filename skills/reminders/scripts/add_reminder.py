#!/usr/bin/env -S uv run --script
"""Add a reminder to macOS Reminders.app with per-contact list support."""

import subprocess
import argparse
import sys
from datetime import datetime, timedelta
import re


def parse_time_spec(spec):
    """
    Parse a time specification into a datetime.

    Formats:
    - "5m" or "5 minutes" -> 5 minutes from now
    - "2h" or "2 hours" -> 2 hours from now
    - "1d" or "1 day" -> 1 day from now
    - "tomorrow 9am" -> tomorrow at 9am
    - "2026-01-24 14:30" -> specific datetime
    """
    spec = spec.strip().lower()
    now = datetime.now()

    # Relative time: 5m, 2h, 1d
    match = re.match(r'^(\d+)\s*(m|min|minutes?|h|hr|hours?|d|days?)$', spec)
    if match:
        amount = int(match.group(1))
        unit = match.group(2)[0]
        if unit == 'm':
            return now + timedelta(minutes=amount)
        elif unit == 'h':
            return now + timedelta(hours=amount)
        elif unit == 'd':
            return now + timedelta(days=amount)

    # "tomorrow" or "tomorrow 9am"
    if spec.startswith('tomorrow'):
        tomorrow = now + timedelta(days=1)
        time_part = spec.replace('tomorrow', '').strip()
        if time_part:
            # Parse time like "9am", "2pm", "14:30"
            time_match = re.match(r'^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$', time_part)
            if time_match:
                hour = int(time_match.group(1))
                minute = int(time_match.group(2) or 0)
                ampm = time_match.group(3)
                if ampm == 'pm' and hour < 12:
                    hour += 12
                elif ampm == 'am' and hour == 12:
                    hour = 0
                return tomorrow.replace(hour=hour, minute=minute, second=0, microsecond=0)
        return tomorrow.replace(hour=9, minute=0, second=0, microsecond=0)

    # ISO format: 2026-01-24 14:30
    try:
        return datetime.fromisoformat(spec)
    except ValueError:
        pass

    # Try parsing various formats
    for fmt in ['%Y-%m-%d %H:%M', '%Y-%m-%d', '%m/%d/%Y %H:%M', '%m/%d/%Y']:
        try:
            return datetime.strptime(spec, fmt)
        except ValueError:
            continue

    raise ValueError(f"Could not parse time spec: {spec}")


def ensure_list_exists(list_name):
    """Create a reminder list if it doesn't exist."""
    script = f'''
    tell application "Reminders"
        set listNames to name of every list
        if "{list_name}" is not in listNames then
            make new list with properties {{name:"{list_name}"}}
            return "Created list: {list_name}"
        else
            return "List exists: {list_name}"
        end if
    end tell
    '''
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    return result.stdout.strip()


def add_reminder(title, due_time=None, notes=None, list_name=None, contact=None, target="fg"):
    """Add a reminder using osascript.

    Args:
        target: Where to inject when due - "fg" (foreground), "bg" (background), or "both"
    """

    # If contact specified, use/create a list for them
    if contact:
        list_name = f"Claude: {contact}"
        ensure_list_exists(list_name)

    # Prepend target tag to notes
    target_tag = f"[target:{target}]"
    if notes:
        notes = f"{target_tag} {notes}"
    else:
        notes = target_tag

    # Build the properties
    props = [f'name:"{title}"']

    if due_time:
        # AppleScript date format
        as_date = due_time.strftime('%B %d, %Y at %I:%M:%S %p')
        props.append(f'due date:date "{as_date}"')
        props.append(f'remind me date:date "{as_date}"')

    if notes:
        # Escape quotes in notes
        notes_escaped = notes.replace('"', '\\"')
        props.append(f'body:"{notes_escaped}"')

    props_str = ', '.join(props)

    # Use specified list or first list
    if list_name:
        list_selector = f'list "{list_name}"'
    else:
        list_selector = 'first list'

    script = f'''
    tell application "Reminders"
        set targetList to {list_selector}
        set newReminder to make new reminder in targetList with properties {{{props_str}}}
        return "Created: " & name of newReminder
    end tell
    '''

    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}", file=sys.stderr)
        sys.exit(1)

    return result.stdout.strip(), list_name


def main():
    parser = argparse.ArgumentParser(description="Add a reminder to Reminders.app")
    parser.add_argument("title", help="Reminder title")
    parser.add_argument("--due", "-d", help="Due time (e.g., '5m', '2h', '1d', 'tomorrow 9am', '2026-01-24 14:30')")
    parser.add_argument("--notes", "-n", help="Notes/body text")
    parser.add_argument("--list", "-l", help="List name (default: first list)")
    parser.add_argument("--contact", "-c", required=True,
                        help="Contact name (REQUIRED - creates 'Claude: <contact>' list)")
    parser.add_argument("--target", "-t", default="fg", choices=["fg", "bg", "both"],
                        help="Target session: fg (foreground), bg (background), or both (default: fg)")
    args = parser.parse_args()

    # Contact is required - reminders without contact are silently skipped by daemon
    if not args.contact:
        print("Error: --contact is required. Reminders without a contact are silently skipped by the daemon.", file=sys.stderr)
        sys.exit(1)

    due_time = None
    if args.due:
        try:
            due_time = parse_time_spec(args.due)
        except ValueError as e:
            print(f"Error parsing due time: {e}", file=sys.stderr)
            sys.exit(1)

    result, list_name = add_reminder(args.title, due_time, args.notes, args.list, args.contact, args.target)
    print(result)
    if list_name:
        print(f"List: {list_name}")
    if due_time:
        print(f"Due: {due_time.strftime('%Y-%m-%d %H:%M')}")


if __name__ == "__main__":
    main()
