#!/usr/bin/env -S uv run --script
"""
Memory Consolidation v2 - Uses Agent SDK with tool access for fact verification.

Instead of `claude -p` (no tools), this spawns an SDK session that can:
- Read messages via read-sms CLI to verify facts
- Search for evidence before including any fact
- Self-correct based on what it finds

Usage:
    consolidate_sdk.py <contact>           # Run for one contact
    consolidate_sdk.py --all               # Run for all contacts
    consolidate_sdk.py --dry-run <contact> # Show without writing
    consolidate_sdk.py --verbose <contact> # Show extraction details
"""
# /// script
# requires-python = ">=3.11"
# dependencies = ["anthropic"]
# ///

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Paths
HOME = Path.home()
DISPATCH_DIR = HOME / "dispatch"
LOGS_DIR = DISPATCH_DIR / "logs"
LOG_FILE = LOGS_DIR / "memory-consolidation.log"
MEMORIES_DIR = HOME / "memories"
CHECKPOINTS_FILE = MEMORIES_DIR / "checkpoints.json"
BACKUP_DIR = MEMORIES_DIR / "backups"
REPORTS_DIR = MEMORIES_DIR / "reports"
CONTACTS_CLI = HOME / ".claude/skills/contacts/scripts/contacts"
READ_SMS_CLI = HOME / ".claude/skills/sms-assistant/scripts/read-sms"
CHAT_DB = HOME / "Library/Messages/chat.db"

# Format markers
MANAGED_HEADER = "<!-- CLAUDE-MANAGED:v1 -->"
LAST_UPDATED_PATTERN = r"\*Last updated: (\d{4}-\d{2}-\d{2} \d{2}:\d{2})\*"

# Tier-specific emphasis
TIER_EMPHASIS = {
    "wife": """ESPECIALLY IMPORTANT for this person (spouse/partner):
- Birthday and anniversary dates - ALWAYS capture these
- Favorite restaurants, foods, drinks
- Gift preferences and wishlist items
- Health info (allergies, conditions)
- Relationship milestones""",

    "family": """ESPECIALLY IMPORTANT for family members:
- Birthday dates
- Kids' names and ages
- Where they live
- Health updates and concerns
- Major life events""",

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


def get_system_prompt(contact_name: str, phone: str, tier: str, existing_memories: str) -> str:
    """Build the system prompt for the SDK agent."""
    tier_emphasis = TIER_EMPHASIS.get(tier, "")

    return f"""You are extracting personal facts about {contact_name} from their messages.

## YOUR TOOLS

You have access to the Bash tool. Use it to:
1. Search for evidence: `~/.claude/skills/sms-assistant/scripts/read-sms --chat "{phone}" --grep "birthday"`
2. Read recent messages: `~/.claude/skills/sms-assistant/scripts/read-sms --chat "{phone}" --limit 50`
3. Verify claims against actual messages

## CRITICAL RULES

Extract ONLY facts that {contact_name} explicitly states about THEMSELVES.

### ✅ EXTRACT - Self-references (explicit or contextually clear):
- "I have a dog" → Has a dog
- "My birthday is March 5" → Birthday: March 5
- "Just landed in Boston!" → Currently in Boston (contextually clear)
- "Working from home today" → Works from home (implicit first-person)

### ❌ DO NOT EXTRACT - Requests or questions:
- "Find dog-friendly places" → NOT evidence they have a dog
- "Book something with a hot tub" → Request, not preference
- "Can you help my mom with X?" → About someone else

### ❌ DO NOT EXTRACT - Inferred from context:
- Someone asked about ski trips → Does NOT mean they ski
- In a group chat about X → Does NOT mean they like X
- Someone ELSE mentioned them → NOT valid source

### ❌ DO NOT EXTRACT - System metadata:
- Phone number, tier, group memberships (stored elsewhere in Contacts.app)
- When they were added as a contact

### ⚠️ HANDLE CAREFULLY - Negations and corrections:
- "I don't have a dog" → Do NOT extract "has a dog"
- "Actually I moved to NYC" → Supersedes previous "lives in Boston"

### ⚠️ HANDLE CAREFULLY - Temporal context:
- Present tense "I live in Boston" → Current fact
- Past tense "I lived in Boston" → Note as "Previously lived in Boston" or skip
- Future "I'm planning to move" → Note as "Planning to move to X"

{tier_emphasis}

## EXISTING MEMORIES (for context/dedup):
{existing_memories}

## YOUR TASK

1. Use read-sms to look at messages FROM {contact_name}
2. For EACH potential fact, search for the actual quote that supports it
3. Only include facts where you found explicit self-referential evidence

## OUTPUT FORMAT - CRITICAL

Your FINAL output must be ONLY a clean list of bullet points:
- Fact one
- Fact two
- Fact three

NO explanations, NO analysis, NO quotes, NO headers. JUST bullet points.
If NO explicit facts found, output ONLY: (no facts)

Max 15 items, most important first.

When in doubt, DO NOT extract - false positives are worse than missing facts.

Start by reading recent messages, then search for key topics. Your final output should contain ONLY the bullet points."""


def log(message: str):
    """Log to consolidation log file."""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a") as f:
        f.write(f"{timestamp} | {message}\n")


def load_checkpoints() -> dict:
    """Load consolidation checkpoints."""
    if CHECKPOINTS_FILE.exists():
        return json.loads(CHECKPOINTS_FILE.read_text())
    return {}


def save_checkpoints(checkpoints: dict):
    """Save consolidation checkpoints."""
    CHECKPOINTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CHECKPOINTS_FILE.write_text(json.dumps(checkpoints, indent=2, default=str))


def save_daily_report(results: list[dict]):
    """Save daily consolidation report."""
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
    """Backup existing notes before overwriting."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
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
    """Extract existing memories from notes."""
    if not notes:
        return "(none)"

    lines = notes.split('\n')
    memories = []
    for line in lines:
        if line.strip().startswith('- '):
            memories.append(line.strip())

    return '\n'.join(memories) if memories else "(none)"


def count_messages(phone: str) -> int:
    """Count total messages from this contact."""
    result = subprocess.run(
        [str(READ_SMS_CLI), "--chat", phone, "--limit", "1000"],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        # Count IN messages (from contact, not from me)
        lines = result.stdout.split('\n')
        return sum(1 for line in lines if '| IN |' in line)
    return 0


def format_notes(contact_name: str, memories: str, preserve_user_notes: str = "") -> str:
    """Format the final notes content."""
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


def call_sdk_agent(system_prompt: str, user_prompt: str, verbose: bool = False) -> str:
    """Call Claude via claude CLI with -p mode AND Bash tool access.

    Uses --tools Bash to give Claude access to read-sms for verification.
    Uses --allowed-tools to permit specific Bash commands.
    """
    import tempfile

    # Write prompts to temp file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        f.write(user_prompt)
        prompt_file = f.name

    # Clear CLAUDECODE to allow spawning from SDK session
    clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

    # Build command with tools enabled
    # --tools Bash,Read gives it ability to run commands and read files
    # --allowed-tools permits the specific read-sms CLI
    # --system-prompt sets our extraction rules
    cmd = [
        "claude",
        "-p",  # Print mode (non-interactive)
        "--tools", "Bash,Read",  # Enable Bash and Read tools
        "--allowed-tools", 'Bash(*/.claude/skills/sms-assistant/scripts/read-sms*)',  # Allow read-sms
        "--system-prompt", system_prompt,
        "--model", "opus",
    ]

    if verbose:
        print(f"  [Command]: {' '.join(cmd[:5])}...")

    try:
        result = subprocess.run(
            cmd,
            input=user_prompt,
            capture_output=True,
            text=True,
            timeout=180,  # 3 minutes for agentic loop
            env=clean_env
        )

        if result.returncode != 0:
            log(f"Claude CLI failed (code {result.returncode}): {result.stderr[:500]}")
            raise RuntimeError(f"Claude CLI failed: {result.stderr[:200]}")

        output = result.stdout.strip()
        if not output:
            raise RuntimeError("Claude CLI returned empty output")

        if verbose:
            print(f"  [Claude output preview]: {output[:300]}...")

        return output

    finally:
        Path(prompt_file).unlink(missing_ok=True)


def consolidate_contact(contact_name: str, phone: str, tier: str = "unknown", dry_run: bool = False, verbose: bool = False) -> dict:
    """Run consolidation for a single contact."""
    result = {
        "contact": contact_name,
        "phone": phone,
        "tier": tier,
        "status": "unknown",
        "facts_before": 0,
        "facts_after": 0,
        "error": None,
    }

    log(f"Starting SDK consolidation for {contact_name} ({phone}, tier={tier})")

    # Check message count first
    msg_count = count_messages(phone)
    if msg_count == 0:
        result["status"] = "skipped"
        result["error"] = "No messages from this contact"
        log(f"Skipped {contact_name}: 0 messages")
        return result

    if verbose:
        print(f"  Messages from contact: {msg_count}")

    # Get existing notes
    existing_notes = get_contact_notes(contact_name)
    existing_memories = parse_existing_memories(existing_notes)
    result["facts_before"] = len([l for l in existing_memories.split('\n') if l.strip().startswith('- ')])

    if verbose:
        print(f"  Existing facts: {result['facts_before']}")

    # === PASS 1: EXTRACTION ===
    if verbose:
        print("  [Pass 1] Extracting memories...")

    system_prompt = get_system_prompt(contact_name, phone, tier, existing_memories)
    user_prompt = f"Extract personal facts about {contact_name}. Start by reading their messages, then compile verified facts."

    try:
        extraction = call_sdk_agent(system_prompt, user_prompt, verbose=verbose)
    except Exception as e:
        result["status"] = "error"
        result["error"] = f"Pass 1 error: {e}"
        log(f"SDK error (pass 1) for {contact_name}: {e}")
        return result

    # Parse extraction
    if "(no facts)" in extraction.lower():
        result["status"] = "skipped"
        result["error"] = "No verifiable facts found"
        log(f"Skipped {contact_name}: no facts extracted")
        return result

    # Extract just the bullet points from pass 1
    proposed_facts = '\n'.join([l for l in extraction.split('\n') if l.strip().startswith('- ')])
    proposed_count = len([l for l in proposed_facts.split('\n') if l.strip().startswith('- ')])

    if verbose:
        print(f"  [Pass 1] Proposed: {proposed_count} facts")
        for line in proposed_facts.split('\n')[:5]:
            if line.strip():
                print(f"    {line}")

    if proposed_count == 0:
        result["status"] = "skipped"
        result["error"] = "No bullet points in extraction"
        return result

    # === PASS 2: FACT-CHECK ===
    if verbose:
        print("  [Pass 2] Fact-checking...")

    review_system_prompt = f"""You are a fact-checker reviewing proposed memories about {contact_name}.

## YOUR TOOLS

You have access to the Bash tool. Use it to search for evidence:
~/.claude/skills/sms-assistant/scripts/read-sms --chat "{phone}" --grep "SEARCH_TERM"

## YOUR TASK

For each proposed fact:
1. Search the messages for supporting evidence
2. If you find explicit self-referential evidence, mark as VERIFIED
3. If you find only 1 data point, mark as NEEDS_MORE_EVIDENCE
4. If you can't find evidence, mark as REJECTED

## OUTPUT FORMAT

Output each fact with its status:
- VERIFIED: [fact text] (evidence: "quote from messages")
- NEEDS_MORE_EVIDENCE: [fact text] (single signal: "quote")
- REJECTED: [fact text] (reason: no supporting evidence found)

Then provide a summary line:
SUMMARY: X verified, Y needs more evidence, Z rejected"""

    review_user_prompt = f"""Review these proposed facts about {contact_name}:

{proposed_facts}

Search for evidence to verify each one. Be thorough but skeptical."""

    try:
        review_result = call_sdk_agent(review_system_prompt, review_user_prompt, verbose=verbose)
    except Exception as e:
        result["status"] = "error"
        result["error"] = f"Pass 2 error: {e}"
        log(f"SDK error (pass 2) for {contact_name}: {e}")
        return result

    # Parse review results - handle various output formats
    verified_facts = []
    needs_evidence = []
    rejected_facts = []

    for line in review_result.split('\n'):
        line_clean = line.strip()

        # Handle various formats: "- VERIFIED:", "**VERIFIED:", "VERIFIED:", etc.
        line_upper = line_clean.upper()

        if 'VERIFIED:' in line_upper and 'NEEDS' not in line_upper:
            # Find the fact text after VERIFIED:
            idx = line_upper.find('VERIFIED:')
            fact_part = line_clean[idx + len('VERIFIED:'):].strip()
            # Remove trailing evidence citations
            for marker in ['(evidence:', '(quote:', '—']:
                if marker in fact_part.lower():
                    fact_part = fact_part[:fact_part.lower().find(marker)].strip()
            # Clean up asterisks and leading dashes/bullets
            fact_part = fact_part.strip('*').strip('-').strip()
            if fact_part:
                verified_facts.append(f"- {fact_part}")

        elif 'NEEDS_MORE_EVIDENCE:' in line_upper or 'NEEDS MORE EVIDENCE:' in line_upper:
            # Handle both underscore and space versions
            for marker in ['NEEDS_MORE_EVIDENCE:', 'NEEDS MORE EVIDENCE:']:
                if marker in line_upper:
                    idx = line_upper.find(marker)
                    fact_part = line_clean[idx + len(marker):].strip()
                    break
            # Remove trailing citations
            for marker in ['(single signal:', '(quote:', '—']:
                if marker in fact_part.lower():
                    fact_part = fact_part[:fact_part.lower().find(marker)].strip()
            fact_part = fact_part.strip('*').strip('-').strip()
            if fact_part:
                needs_evidence.append(f"- {fact_part} (1 signal)")

        elif 'REJECTED:' in line_upper:
            idx = line_upper.find('REJECTED:')
            fact_part = line_clean[idx + len('REJECTED:'):].strip()
            fact_part = fact_part.strip('*').strip('-').strip()
            if fact_part:
                rejected_facts.append(fact_part)

    if verbose:
        print(f"  [Pass 2] Results: {len(verified_facts)} verified, {len(needs_evidence)} need evidence, {len(rejected_facts)} rejected")

    # Combine verified + needs_evidence
    facts = '\n'.join(verified_facts + needs_evidence)
    result["facts_after"] = len(verified_facts) + len(needs_evidence)

    if result["facts_after"] == 0:
        result["status"] = "skipped"
        result["error"] = "No bullet points in extraction"
        return result

    # Preserve user notes
    user_notes = ""
    if existing_notes and "## User Notes" in existing_notes:
        user_section = existing_notes.split("## User Notes")[1]
        if "---" in user_section:
            user_notes = user_section.split("---")[0].strip()

    final_notes = format_notes(contact_name, facts, user_notes)

    if dry_run:
        print(f"\n{'='*60}")
        print(f"DRY RUN - Would write to {contact_name}:")
        print(f"{'='*60}")
        print(final_notes)
        print(f"{'='*60}\n")
        result["status"] = "dry_run"
        return result

    # Backup and write
    backup_notes(phone or contact_name, existing_notes or "")

    if set_contact_notes(contact_name, final_notes):
        result["status"] = "updated"
        log(f"Updated {contact_name}: {result['facts_before']} -> {result['facts_after']} facts")

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
    """Get all contacts with phone numbers and tiers."""
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
            if phone and phone != "(no phone)":
                contacts.append({
                    "name": name,
                    "phone": phone,
                    "tier": tier,
                })

    return contacts


def main():
    parser = argparse.ArgumentParser(
        description="Memory consolidation v2 - SDK with tool access"
    )
    parser.add_argument("contact", nargs="?", help="Contact name to consolidate")
    parser.add_argument("--all", action="store_true", help="Run for all contacts")
    parser.add_argument("--dry-run", action="store_true", help="Show without writing")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")

    args = parser.parse_args()

    if args.all:
        contacts = get_all_contacts()
        print(f"Consolidating {len(contacts)} contacts (SDK mode)...")
        log(f"Starting SDK batch consolidation for {len(contacts)} contacts")

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

            if not args.dry_run and i < len(contacts) - 1:
                import time
                time.sleep(2)  # Brief delay between contacts

        print(f"\n{'='*60}")
        print("SUMMARY")
        print(f"{'='*60}")
        by_status = {}
        for r in results:
            status = r["status"]
            by_status[status] = by_status.get(status, 0) + 1
        for status, count in by_status.items():
            print(f"  {status}: {count}")

        log(f"SDK batch complete: {by_status}")

        if not args.dry_run:
            save_daily_report(results)

    elif args.contact:
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

        print(f"Consolidating: {contact_info['name']} ({contact_info['tier']}) [SDK mode]")
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
