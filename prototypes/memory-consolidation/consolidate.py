#!/usr/bin/env -S uv run --script
"""
Memory Consolidation ("Sleeping") - Nightly extraction of personal facts to Contacts.app notes.

See PLAN.md for full design.

Usage:
    consolidate.py <contact>           # Run for one contact
    consolidate.py --all               # Run for all contacts
    consolidate.py --dry-run <contact> # Show without writing
    consolidate.py --verbose <contact> # Show extraction details
"""
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

# Paths (per PLAN.md)
HOME = Path.home()
DISPATCH_DIR = HOME / "dispatch"
LOGS_DIR = DISPATCH_DIR / "logs"
LOG_FILE = LOGS_DIR / "memory-consolidation.log"
# Memory state in ~/memories (not ~/.claude or ~/dispatch)
MEMORIES_DIR = HOME / "memories"
CHECKPOINTS_FILE = MEMORIES_DIR / "checkpoints.json"
BACKUP_DIR = MEMORIES_DIR / "backups"
REPORTS_DIR = MEMORIES_DIR / "reports"
CONTACTS_CLI = HOME / ".claude/skills/contacts/scripts/contacts"
READ_SMS_CLI = HOME / ".claude/skills/sms-assistant/scripts/read-sms"
CHAT_DB = HOME / "Library/Messages/chat.db"

# Format markers (per PLAN.md)
MANAGED_HEADER = "<!-- CLAUDE-MANAGED:v1 -->"
LAST_UPDATED_PATTERN = r"\*Last updated: (\d{4}-\d{2}-\d{2} \d{2}:\d{2})\*"

# Base extraction prompt - STRICT first-person only
EXTRACTION_PROMPT_BASE = """You are extracting personal facts about {contact_name} from their messages.

## CRITICAL RULES - READ CAREFULLY

Extract ONLY facts that {contact_name} explicitly states about THEMSELVES.

### ✅ EXTRACT - Self-references (explicit or contextually clear):
- "I have a dog" → Has a dog
- "My birthday is March 5" → Birthday: March 5
- "I love sushi" → Loves sushi
- "My wife Sarah" → Wife named Sarah
- "Just landed in Boston!" → Currently in Boston (contextually clear self-reference)
- "Working from home today" → Works from home (implicit first-person)
- "This Boston winter is killing me" → Lives in Boston area

### ❌ DO NOT EXTRACT - Requests or questions (not personal facts):
- "Find dog-friendly places" → NOT evidence they have a dog
- "Book something with a hot tub" → Request, not preference
- "What's the weather?" → Transactional
- "Can you help my mom with X?" → About mom, not them

### ❌ DO NOT EXTRACT - Inferred or contextual:
- They asked about ski trips → Does NOT mean they ski
- They're in a group chat about X → Does NOT mean they like X
- Someone else mentioned them → NOT valid source

### ❌ DO NOT EXTRACT - System metadata:
- Phone number, tier, group memberships (stored elsewhere)

### ⚠️ HANDLE CAREFULLY - Negations and corrections:
- "I don't have a dog" → Do NOT extract "has a dog"
- "Actually I moved to NYC" → Supersedes previous "lives in Boston"
- "I'm not really into sushi" → Could note "doesn't like sushi" if relevant

### ⚠️ HANDLE CAREFULLY - Temporal context:
- Present tense "I live in Boston" → Current fact
- Past tense "I lived in Boston" → Note as "Previously lived in Boston" or skip
- Future "I'm planning to move" → Note as "Planning to move to X"

{tier_emphasis}

## Existing memories:
{existing_memories}

## Messages FROM {contact_name}:
{messages}

## Output format:
- Output ONLY bullet points starting with "- "
- If NO explicit facts found, output "(no facts)"
- If a new fact contradicts existing memory, use the newer information
- Max 15 items, most important first
- When in doubt, DO NOT extract - false positives are worse than missing facts"""

# Tier-specific emphasis (added to extraction prompt based on relationship)
TIER_EMPHASIS = {
    "wife": """ESPECIALLY IMPORTANT for this person (spouse/partner):
- Birthday and anniversary dates - ALWAYS capture these
- Favorite restaurants, foods, drinks
- Gift preferences and wishlist items
- Health info (allergies, conditions, medications)
- Relationship milestones
- Emotional preferences (how they like to be comforted, love language)""",

    "family": """ESPECIALLY IMPORTANT for family members:
- Birthday dates
- Kids' names and ages
- Where they live
- Health updates and concerns
- Major life events (graduations, moves, job changes)""",

    "favorite": """For close friends, focus on:
- How you know each other
- Shared interests and activities
- Major life events
- Their family situation (partner, kids)""",

    "bots": """For AI/bot contacts, note:
- What system/project they're part of
- Their capabilities and purpose
- Who created/manages them""",
}

def get_extraction_prompt(contact_name: str, tier: str, existing_memories: str, messages: str) -> str:
    """Build tier-aware extraction prompt."""
    tier_emphasis = TIER_EMPHASIS.get(tier, "")
    return EXTRACTION_PROMPT_BASE.format(
        contact_name=contact_name,
        tier_emphasis=tier_emphasis,
        existing_memories=existing_memories,
        messages=messages
    )

# Review prompt - verifies facts are from explicit self-references
REVIEW_PROMPT = """Review the proposed memory extraction for {contact_name}.

## Proposed facts:
{proposed}

## Messages from {contact_name} (source):
{messages}

## For EACH proposed fact, verify:
1. Is there a self-referential statement from {contact_name} supporting it?
   - Explicit: "I have a dog", "My birthday is..."
   - Contextual: "Just landed in Boston!" (clearly about them)
2. Is it about {contact_name} themselves (not someone else)?
3. Is it NOT system metadata (phone, tier, group membership)?
4. If it's a negation, is it correctly captured? ("don't have" ≠ "has")

## Output ONE of:
- APPROVED (all facts verified)
- PARTIAL: [list only the verified facts as bullet points]
- REJECTED: <reason - e.g., "no verifiable self-references found">

If some facts are good but others aren't, use PARTIAL and list only the good ones."""


def log(message: str):
    """Log to consolidation log file."""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a") as f:
        f.write(f"{timestamp} | {message}\n")


def load_checkpoints() -> dict:
    """Load consolidation checkpoints (last processed time per contact)."""
    if CHECKPOINTS_FILE.exists():
        return json.loads(CHECKPOINTS_FILE.read_text())
    return {}


def save_checkpoints(checkpoints: dict):
    """Save consolidation checkpoints."""
    CHECKPOINTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CHECKPOINTS_FILE.write_text(json.dumps(checkpoints, indent=2, default=str))


def save_daily_report(results: list[dict]):
    """Save daily consolidation report to ~/memories/reports/."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now().strftime("%Y-%m-%d")
    report_file = REPORTS_DIR / f"{date_str}.json"

    report = {
        "date": date_str,
        "timestamp": datetime.now().isoformat(),
        "total_contacts": len(results),
        "summary": {},
        "contacts": results,
    }

    # Build summary by status
    for r in results:
        status = r["status"]
        report["summary"][status] = report["summary"].get(status, 0) + 1

    report_file.write_text(json.dumps(report, indent=2, default=str))
    log(f"Daily report saved to {report_file}")


def get_contact_notes(name: str) -> Optional[str]:
    """Get notes for a contact via CLI."""
    result = subprocess.run(
        [str(CONTACTS_CLI), "notes", name],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return None


def set_contact_notes(name: str, content: str) -> bool:
    """Set notes for a contact via CLI."""
    result = subprocess.run(
        [str(CONTACTS_CLI), "notes", name, content],
        capture_output=True, text=True
    )
    return result.returncode == 0


def backup_notes(identifier: str, content: str):
    """Backup existing notes before overwriting (per PLAN.md Safety section)."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    # Sanitize identifier for filename (phone if available, else slugified name)
    safe_id = re.sub(r'[^\w\-]', '_', identifier)
    backup_path = BACKUP_DIR / f"{safe_id}.txt"
    backup_path.write_text(content or "")
    log(f"Backed up notes for {identifier} to {backup_path}")


def parse_last_updated(notes: str) -> Optional[datetime]:
    """Parse last updated timestamp from notes."""
    if not notes:
        return None
    match = re.search(LAST_UPDATED_PATTERN, notes)
    if match:
        try:
            return datetime.strptime(match.group(1), "%Y-%m-%d %H:%M")
        except ValueError:
            return None
    return None


def parse_existing_memories(notes: str) -> str:
    """Extract existing memories from notes (bullet points only)."""
    if not notes:
        return "(none)"

    lines = notes.split('\n')
    memories = []

    for line in lines:
        # Only extract bullet points
        if line.strip().startswith('- '):
            memories.append(line.strip())

    return '\n'.join(memories) if memories else "(none)"


def get_messages_since(phone: str, since: Optional[datetime], limit: int = 500) -> str:
    """Get messages for a contact since a given timestamp."""
    cmd = [str(READ_SMS_CLI), "--chat", phone, "--limit", str(limit)]
    if since:
        cmd.extend(["--since", since.strftime("%Y-%m-%d %H:%M:%S")])

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        return result.stdout
    return ""


def filter_messages_by_sender(messages: str, sender_phone: str) -> str:
    """Filter group chat messages to only include messages FROM a specific sender.

    Message format: 'YYYY-MM-DD HH:MM:SS | +phone | IN/OUT | message'
    We want to keep only lines where the sender matches sender_phone.
    """
    if not messages:
        return ""

    filtered_lines = []
    for line in messages.split('\n'):
        # Skip header lines (start with #) and empty lines
        if line.startswith('#') or not line.strip():
            filtered_lines.append(line)
            continue

        # Parse message format: timestamp | sender | direction | content
        parts = line.split(' | ', 3)
        if len(parts) >= 3:
            sender = parts[1].strip()
            # Keep if sender matches the contact's phone (normalize both)
            sender_normalized = sender.replace('-', '').replace(' ', '').replace('(', '').replace(')', '')
            phone_normalized = sender_phone.replace('-', '').replace(' ', '').replace('(', '').replace(')', '')
            if sender_normalized == phone_normalized:
                filtered_lines.append(line)
        else:
            # Keep non-message lines (headers, etc)
            filtered_lines.append(line)

    return '\n'.join(filtered_lines)


def get_group_chats_for_contact(phone: str) -> list[str]:
    """Get all group chat IDs where this contact participates (per PLAN.md SQL query)."""
    try:
        conn = sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True)
        cursor = conn.execute("""
            SELECT DISTINCT c.chat_identifier
            FROM chat c
            JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
            JOIN handle h ON chj.handle_id = h.ROWID
            WHERE h.id = ? AND c.style = 43
        """, (phone,))
        groups = [row[0] for row in cursor.fetchall()]
        conn.close()
        return groups
    except Exception:
        return []


def call_claude(prompt: str) -> str:
    """Call Claude via CLI (per PLAN.md - uses claude -p to inherit environment)."""
    # Write prompt to temp file to avoid shell escaping issues
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        f.write(prompt)
        prompt_file = f.name

    # Clear CLAUDECODE to allow spawning claude from SDK sessions
    clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

    try:
        result = subprocess.run(
            f"cat '{prompt_file}' | claude -p - --model opus",
            shell=True,
            capture_output=True,
            text=True,
            timeout=120,
            env=clean_env
        )
        if result.returncode != 0:
            log(f"Claude CLI failed (code {result.returncode}): {result.stderr[:500]}")
            raise RuntimeError(f"Claude CLI failed: {result.stderr[:200]}")
        if not result.stdout.strip():
            log(f"Claude CLI returned empty output")
            raise RuntimeError("Claude CLI returned empty output")
        return result.stdout.strip()
    finally:
        Path(prompt_file).unlink(missing_ok=True)


def format_notes(contact_name: str, memories: str, preserve_user_notes: str = "") -> str:
    """Format the final notes content (per PLAN.md format)."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    lines = [
        MANAGED_HEADER,
        f"## About {contact_name}",
        memories,
        "",
    ]

    if preserve_user_notes:
        lines.extend([
            "## User Notes",
            preserve_user_notes,
            "",
        ])

    lines.extend([
        "---",
        f"*Last updated: {timestamp}*",
    ])

    return '\n'.join(lines)


def consolidate_contact(contact_name: str, phone: str, tier: str = "unknown", dry_run: bool = False, verbose: bool = False) -> dict:
    """Run consolidation for a single contact (per PLAN.md 2-Pass Flow)."""
    result = {
        "contact": contact_name,
        "phone": phone,
        "tier": tier,
        "status": "unknown",
        "facts_before": 0,
        "facts_after": 0,
        "error": None,
    }

    log(f"Starting consolidation for {contact_name} ({phone}, tier={tier})")

    # Get existing notes
    existing_notes = get_contact_notes(contact_name)
    existing_memories = parse_existing_memories(existing_notes)
    result["facts_before"] = len([l for l in existing_memories.split('\n') if l.strip().startswith('- ')])

    # Get last updated timestamp (per PLAN.md First-Run Backfill)
    last_updated = parse_last_updated(existing_notes)
    if verbose:
        print(f"  Last updated: {last_updated or 'never (first run)'}")

    # Get messages since last update (per PLAN.md Data Sources)
    messages = get_messages_since(phone, last_updated)

    # Also get messages from group chats (per PLAN.md Data Sources)
    # IMPORTANT: Only include messages FROM this contact, not all group messages
    group_chats = get_group_chats_for_contact(phone)
    for group_id in group_chats:
        group_msgs = get_messages_since(group_id, last_updated, limit=100)
        if group_msgs:
            # Filter to only messages sent by this contact
            filtered_msgs = filter_messages_by_sender(group_msgs, phone)
            if filtered_msgs.strip():
                messages += f"\n\n--- Group chat {group_id} (messages from {contact_name}) ---\n{filtered_msgs}"

    if not messages.strip() or "No messages found" in messages:
        result["status"] = "skipped"
        result["error"] = "No new messages since last update"
        log(f"Skipped {contact_name}: no new messages")
        return result

    # Cap at 500 messages (per PLAN.md First-Run Backfill)
    msg_lines = messages.split('\n')
    if len(msg_lines) > 500:
        messages = '\n'.join(msg_lines[:500])
        if verbose:
            print(f"  Truncated to 500 messages")

    if verbose:
        print(f"  Messages to process: {len(msg_lines)} lines")

    # PASS 1: Extract memories (per PLAN.md) with tier-aware prompt
    extraction_prompt = get_extraction_prompt(
        contact_name=contact_name,
        tier=tier,
        existing_memories=existing_memories,
        messages=messages
    )

    proposed = call_claude(extraction_prompt)
    result["facts_after"] = len([l for l in proposed.split('\n') if l.strip().startswith('- ')])

    if verbose:
        print(f"  Proposed memories ({result['facts_after']} facts):")
        for line in proposed.split('\n')[:10]:
            if line.strip():
                print(f"    {line}")
        if result["facts_after"] > 10:
            print(f"    ... and {result['facts_after'] - 10} more")

    # PASS 2: Review (per PLAN.md) - now includes conversation context for verification
    # Truncate messages for review to avoid context overflow (keep first 200 lines)
    review_messages = '\n'.join(messages.split('\n')[:200])
    review_prompt = REVIEW_PROMPT.format(
        contact_name=contact_name,
        existing=existing_memories,
        proposed=proposed,
        messages=review_messages
    )

    review_result = call_claude(review_prompt)

    if verbose:
        print(f"  Review: {review_result.split(chr(10))[0]}")

    # Handle PARTIAL approval - use the filtered facts from review
    if "PARTIAL:" in review_result:
        # Extract the approved facts from the PARTIAL response
        partial_facts = '\n'.join([l for l in review_result.split('\n') if l.strip().startswith('- ')])
        if partial_facts:
            proposed = partial_facts
            result["facts_after"] = len([l for l in proposed.split('\n') if l.strip().startswith('- ')])
            if verbose:
                print(f"  Partial approval: {result['facts_after']} facts kept")
        else:
            result["status"] = "rejected"
            result["error"] = "PARTIAL with no valid facts"
            log(f"Rejected {contact_name}: partial review had no valid facts")
            return result
    elif "REJECTED" in review_result:
        result["status"] = "rejected"
        result["error"] = review_result
        log(f"Rejected {contact_name}: {review_result}")
        return result

    # Format final notes (per PLAN.md format)
    # Preserve any user notes (per PLAN.md Safety section)
    user_notes = ""
    if existing_notes and "## User Notes" in existing_notes:
        user_section = existing_notes.split("## User Notes")[1]
        if "---" in user_section:
            user_notes = user_section.split("---")[0].strip()

    final_notes = format_notes(contact_name, proposed, user_notes)

    if dry_run:
        print(f"\n{'='*60}")
        print(f"DRY RUN - Would write to {contact_name}:")
        print(f"{'='*60}")
        print(final_notes)
        print(f"{'='*60}\n")
        result["status"] = "dry_run"
        return result

    # Backup existing notes (per PLAN.md Safety section)
    backup_notes(phone or contact_name, existing_notes or "")

    # Write new notes
    if set_contact_notes(contact_name, final_notes):
        result["status"] = "updated"
        log(f"Updated {contact_name}: {result['facts_before']} -> {result['facts_after']} facts")

        # Update checkpoint (per PLAN.md First-Run Backfill)
        checkpoints = load_checkpoints()
        checkpoints[phone] = {
            "last_processed_ts": datetime.now().isoformat(),
            "contact_name": contact_name,
        }
        save_checkpoints(checkpoints)
    else:
        result["status"] = "error"
        result["error"] = "Failed to write notes to Contacts.app"
        log(f"Error writing notes for {contact_name}")

    return result


def get_all_contacts() -> list[dict]:
    """Get all contacts with phone numbers and tiers (per PLAN.md Who to Process)."""
    result = subprocess.run(
        [str(CONTACTS_CLI), "list"],
        capture_output=True, text=True
    )

    contacts = []
    for line in result.stdout.strip().split('\n'):
        if '|' not in line:
            continue
        parts = [p.strip() for p in line.split('|')]
        if len(parts) >= 3:
            name, phone, tier = parts[0], parts[1], parts[2]
            # Only contacts with phone numbers (per PLAN.md)
            if phone and phone != "(no phone)":
                contacts.append({
                    "name": name,
                    "phone": phone,
                    "tier": tier,
                })

    return contacts


def main():
    parser = argparse.ArgumentParser(
        description="Memory consolidation for Contacts.app (see PLAN.md)"
    )
    parser.add_argument("contact", nargs="?", help="Contact name to consolidate")
    parser.add_argument("--all", action="store_true", help="Run for all contacts")
    parser.add_argument("--dry-run", action="store_true", help="Show without writing")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")

    args = parser.parse_args()

    if args.all:
        # Run for all contacts (per PLAN.md Schedule - 5 second stagger)
        contacts = get_all_contacts()
        print(f"Consolidating {len(contacts)} contacts...")
        log(f"Starting batch consolidation for {len(contacts)} contacts")

        results = []
        for i, contact in enumerate(contacts):
            print(f"\n[{i+1}/{len(contacts)}] {contact['name']} ({contact['tier']})")
            result = consolidate_contact(
                contact["name"],
                contact["phone"],
                tier=contact["tier"],
                dry_run=args.dry_run,
                verbose=args.verbose
            )
            results.append(result)
            print(f"  Status: {result['status']}")

            # Rate limit - 5 second delay between contacts (per PLAN.md Schedule)
            if not args.dry_run and i < len(contacts) - 1:
                import time
                time.sleep(5)

        # Summary (per PLAN.md Logging & Metrics)
        print(f"\n{'='*60}")
        print("SUMMARY")
        print(f"{'='*60}")
        by_status = {}
        for r in results:
            status = r["status"]
            by_status[status] = by_status.get(status, 0) + 1
        for status, count in by_status.items():
            print(f"  {status}: {count}")

        log(f"Batch complete: {by_status}")

        # Save daily report to ~/memories/reports/
        if not args.dry_run:
            save_daily_report(results)

    elif args.contact:
        # Look up contact
        result = subprocess.run(
            [str(CONTACTS_CLI), "list"],
            capture_output=True, text=True
        )

        contact_info = None
        for line in result.stdout.strip().split('\n'):
            if args.contact.lower() in line.lower():
                parts = [p.strip() for p in line.split('|')]
                if len(parts) >= 3:
                    contact_info = {
                        "name": parts[0],
                        "phone": parts[1],
                        "tier": parts[2],
                    }
                    break

        if not contact_info:
            print(f"Contact not found: {args.contact}")
            sys.exit(1)

        if contact_info["phone"] == "(no phone)":
            print(f"Contact has no phone number: {contact_info['name']}")
            sys.exit(1)

        print(f"Consolidating: {contact_info['name']} ({contact_info['tier']})")
        result = consolidate_contact(
            contact_info["name"],
            contact_info["phone"],
            tier=contact_info["tier"],
            dry_run=args.dry_run,
            verbose=args.verbose
        )
        print(f"Status: {result['status']}")
        if result["error"]:
            print(f"Error: {result['error']}")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
