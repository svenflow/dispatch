#!/usr/bin/env -S uv run --script
"""
Memory CLI - Store and retrieve persistent memories about contacts.

Usage:
    memory.py save <contact> <text> [--type TYPE] [--importance N] [--transcript FILE] [--ref REF]
    memory.py load <contact> [--type TYPE] [--limit N]
    memory.py search <query> [--contact CONTACT]
    memory.py query <sql>
    memory.py sync <contact>
    memory.py types [--contact CONTACT]
    memory.py init
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("ERROR|DuckDB not installed. Run: uv pip install duckdb")
    sys.exit(1)

# Paths
DB_PATH = Path.home() / ".claude" / "memory.duckdb"
TRANSCRIPTS_DIR = Path.home() / "transcripts"
LOG_PATH = Path.home() / ".claude" / "logs" / "memory.log"

def log_operation(operation: str, contact: str, details: str):
    """Log memory operations to file for auditing."""
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_PATH, "a") as f:
        f.write(f"{timestamp} | {operation} | {contact} | {details}\n")

def normalize_contact(identifier: str) -> str:
    """Normalize contact identifier to session-name format.

    Accepts:
    - Phone number (+1234567890) -> looks up contact, returns session name
    - Contact name (Jane Doe) -> converts to session name (jane-doe)
    - Session name (jane-doe) -> returns as-is
    """
    identifier = identifier.strip()

    # If it looks like a phone number, do a contact lookup
    if identifier.startswith("+") or identifier.replace("-", "").replace(" ", "").isdigit():
        import subprocess
        result = subprocess.run(
            [str(Path.home() / "code/contacts-cli/contacts"), "lookup", identifier],
            capture_output=True, text=True
        )
        if result.returncode == 0 and result.stdout.strip():
            # Parse the contact lookup output to get the name
            # Format: "Name | tier | phone"
            parts = result.stdout.strip().split("|")
            if parts:
                name = parts[0].strip()
                return name.lower().replace(" ", "-")
        # If lookup fails, return as-is (will likely find no memories)
        return identifier

    # Already looks like a session name (lowercase with hyphens)
    if identifier == identifier.lower() and "-" in identifier:
        return identifier

    # Convert display name to session name
    return identifier.lower().replace(" ", "-")

def get_connection():
    """Get DuckDB connection, creating database if needed."""
    return duckdb.connect(str(DB_PATH))

def init_database():
    """Initialize the database schema."""
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY,
            contact TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            type TEXT,
            memory_text TEXT NOT NULL,
            transcript_file TEXT,
            transcript_ref TEXT,
            importance INTEGER DEFAULT 3
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_memories_contact ON memories(contact)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)
    """)
    conn.close()
    print(f"INIT|Database initialized at {DB_PATH}")

def save_memory(contact: str, text: str, type_: str = None, importance: int = 3,
                transcript_file: str = None, transcript_ref: str = None):
    """Save a memory to the database."""
    contact = normalize_contact(contact)
    conn = get_connection()

    # Auto-generate ID
    result = conn.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM memories").fetchone()
    new_id = result[0]

    conn.execute("""
        INSERT INTO memories (id, contact, type, memory_text, importance, transcript_file, transcript_ref)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, [new_id, contact, type_, text, importance, transcript_file, transcript_ref])

    conn.close()
    log_operation("SAVE", contact, f"id={new_id} type={type_ or 'untyped'} text={text[:100]}")
    print(f"SAVED|{contact}|{type_ or 'untyped'}|{text}")

def edit_memory(memory_id: int, new_text: str = None, new_type: str = None, new_importance: int = None):
    """Edit an existing memory."""
    conn = get_connection()

    # Get current memory to log what's changing
    current = conn.execute("SELECT contact, memory_text, type FROM memories WHERE id = ?", [memory_id]).fetchone()
    if not current:
        conn.close()
        print(f"ERROR|Memory {memory_id} not found")
        return

    contact, old_text, old_type = current

    # Build update query
    updates = []
    params = []
    if new_text is not None:
        updates.append("memory_text = ?")
        params.append(new_text)
    if new_type is not None:
        updates.append("type = ?")
        params.append(new_type)
    if new_importance is not None:
        updates.append("importance = ?")
        params.append(new_importance)

    if not updates:
        print(f"ERROR|No changes specified")
        conn.close()
        return

    params.append(memory_id)
    conn.execute(f"UPDATE memories SET {', '.join(updates)} WHERE id = ?", params)
    conn.close()

    changes = []
    if new_text is not None:
        changes.append(f"text: '{old_text[:50]}...' -> '{new_text[:50]}...'")
    if new_type is not None:
        changes.append(f"type: {old_type} -> {new_type}")
    if new_importance is not None:
        changes.append(f"importance: {new_importance}")

    log_operation("EDIT", contact, f"id={memory_id} {'; '.join(changes)}")
    print(f"EDITED|{memory_id}|{'; '.join(changes)}")


def delete_memory(memory_id: int):
    """Delete a memory by ID."""
    conn = get_connection()

    # Get memory info for logging
    current = conn.execute("SELECT contact, memory_text, type FROM memories WHERE id = ?", [memory_id]).fetchone()
    if not current:
        conn.close()
        print(f"ERROR|Memory {memory_id} not found")
        return

    contact, text, type_ = current

    conn.execute("DELETE FROM memories WHERE id = ?", [memory_id])
    conn.close()

    log_operation("DELETE", contact, f"id={memory_id} type={type_ or 'untyped'} text={text[:100]}")
    print(f"DELETED|{memory_id}|{contact}|{text[:50]}...")


def load_memories(contact: str, type_: str = None, limit: int = 20):
    """Load memories for a contact."""
    contact = normalize_contact(contact)
    conn = get_connection()

    query = "SELECT id, timestamp, type, memory_text, importance FROM memories WHERE contact = ?"
    params = [contact]

    if type_:
        query += " AND type = ?"
        params.append(type_)

    query += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)

    results = conn.execute(query, params).fetchall()
    conn.close()

    if not results:
        print(f"EMPTY|{contact}|No memories found")
        return

    print(f"MEMORIES|{contact}|{len(results)} found")
    for row in results:
        id_, ts, type_, text, importance = row
        ts_str = ts.strftime("%Y-%m-%d") if ts else "unknown"
        print(f"  [{id_}] {ts_str} ({type_ or 'untyped'}, imp={importance}): {text}")

def search_memories(query: str, contact: str = None):
    """Search memories by text."""
    conn = get_connection()

    sql = "SELECT contact, timestamp, type, memory_text FROM memories WHERE memory_text ILIKE ?"
    params = [f"%{query}%"]

    if contact:
        contact = normalize_contact(contact)
        sql += " AND contact = ?"
        params.append(contact)

    sql += " ORDER BY timestamp DESC LIMIT 50"

    results = conn.execute(sql, params).fetchall()
    conn.close()

    if not results:
        print(f"SEARCH|{query}|No results")
        return

    print(f"SEARCH|{query}|{len(results)} results")
    for row in results:
        contact_, ts, type_, text = row
        ts_str = ts.strftime("%Y-%m-%d") if ts else "unknown"
        print(f"  [{contact_}] {ts_str} ({type_ or 'untyped'}): {text}")

def run_query(sql: str):
    """Run arbitrary SQL query."""
    conn = get_connection()
    try:
        results = conn.execute(sql).fetchall()
        description = conn.description
        conn.close()

        if not results:
            print("QUERY|No results")
            return

        # Print column headers
        headers = [d[0] for d in description]
        print("QUERY|" + "|".join(headers))

        # Print rows
        for row in results:
            print("|".join(str(v) for v in row))
    except Exception as e:
        conn.close()
        print(f"ERROR|{e}")

def get_types(contact: str = None):
    """Get distinct memory types."""
    conn = get_connection()

    if contact:
        contact = normalize_contact(contact)
        sql = "SELECT type, COUNT(*) as count FROM memories WHERE contact = ? GROUP BY type ORDER BY count DESC"
        results = conn.execute(sql, [contact]).fetchall()
    else:
        sql = "SELECT type, COUNT(*) as count FROM memories GROUP BY type ORDER BY count DESC"
        results = conn.execute(sql).fetchall()

    conn.close()

    print(f"TYPES|{len(results)} types found")
    for type_, count in results:
        print(f"  {type_ or 'untyped'}: {count}")

def ask_memories(contact: str, prompt: str):
    """Query memories based on a natural language prompt."""
    contact = normalize_contact(contact)
    conn = get_connection()

    # Parse prompt for keywords and types
    prompt_lower = prompt.lower()

    # Determine which types might be relevant
    type_keywords = {
        "preference": ["prefer", "like", "want", "style", "favorite"],
        "fact": ["fact", "info", "know", "detail", "about"],
        "project": ["project", "built", "work", "made", "created"],
        "lesson": ["lesson", "learn", "figured", "discovered", "solved"],
        "relationship": ["relationship", "family", "friend", "wife", "husband", "partner"],
    }

    relevant_types = []
    for type_name, keywords in type_keywords.items():
        if any(kw in prompt_lower for kw in keywords):
            relevant_types.append(type_name)

    # Build query
    if relevant_types:
        placeholders = ",".join(["?" for _ in relevant_types])
        sql = f"""
            SELECT type, memory_text, timestamp
            FROM memories
            WHERE contact = ? AND type IN ({placeholders})
            ORDER BY importance DESC, timestamp DESC
            LIMIT 20
        """
        params = [contact] + relevant_types
    else:
        # Search by text if no type matches
        words = [w for w in prompt_lower.split() if len(w) > 3]
        if words:
            conditions = " OR ".join(["memory_text ILIKE ?" for _ in words])
            sql = f"""
                SELECT type, memory_text, timestamp
                FROM memories
                WHERE contact = ? AND ({conditions})
                ORDER BY importance DESC, timestamp DESC
                LIMIT 20
            """
            params = [contact] + [f"%{w}%" for w in words]
        else:
            sql = """
                SELECT type, memory_text, timestamp
                FROM memories
                WHERE contact = ?
                ORDER BY importance DESC, timestamp DESC
                LIMIT 20
            """
            params = [contact]

    results = conn.execute(sql, params).fetchall()
    conn.close()

    if not results:
        print(f"ASK|{contact}|No relevant memories found for: {prompt}")
        return

    # Format for Claude to interpret
    print(f"ASK|{contact}|{len(results)} relevant memories")
    print(f"Question: {prompt}")
    print("---")
    for type_, text, ts in results:
        ts_str = ts.strftime("%Y-%m-%d") if ts else "?"
        print(f"[{type_ or 'note'}] {text}")
    print("---")
    print("(Use these memories to answer the question)")


def summary_for_session(contact: str):
    """Generate a human-like summary for session injection."""
    contact = normalize_contact(contact)
    conn = get_connection()

    # Get all memories for this contact
    results = conn.execute("""
        SELECT memory_text
        FROM memories
        WHERE contact = ?
        ORDER BY importance DESC, timestamp DESC
        LIMIT 15
    """, [contact]).fetchall()
    conn.close()

    if not results:
        print(f"SUMMARY|{contact}|No memories")
        return

    # Collect all memories as context
    memories = [r[0] for r in results]
    name = contact.replace('-', ' ').title()

    # Output as prose-ready context (Claude will naturally synthesize)
    print(f"## About {name}")
    print("")
    print("What I know about them:")
    for mem in memories:
        print(f"- {mem}")
    print("")
    print("(Write and speak about them as a friend would, not as a database.)")


def consolidate_memories(contact: str):
    """Review today's transcript and output content for memory extraction."""
    contact = normalize_contact(contact)
    from datetime import date

    # Find transcript files for this contact
    projects_dir = Path.home() / ".claude" / "projects"
    username = Path.home().name
    contact_project = projects_dir / f"-Users-{username}-transcripts-{contact}"

    if not contact_project.exists():
        print(f"CONSOLIDATE|{contact}|No transcript folder found")
        return

    # Get today's date
    today = date.today().isoformat()

    # Find JSONL files modified today
    jsonl_files = list(contact_project.glob("*.jsonl"))
    if not jsonl_files:
        print(f"CONSOLIDATE|{contact}|No transcript files found")
        return

    # Sort by modification time, get most recent
    jsonl_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)

    # Read messages from recent transcripts
    messages = []
    for jsonl_file in jsonl_files[:3]:  # Check last 3 transcript files
        try:
            with open(jsonl_file, 'r') as f:
                for line in f:
                    try:
                        entry = json.loads(line)
                        # Get timestamp
                        ts = entry.get("timestamp", "")
                        if not ts.startswith(today):
                            continue  # Skip messages not from today

                        # Extract user messages (SMS content)
                        if entry.get("type") == "user":
                            msg = entry.get("message", {})
                            content = msg.get("content", "")
                            if isinstance(content, str) and "---SMS FROM" in content:
                                # Extract the SMS text
                                messages.append({
                                    "timestamp": ts,
                                    "content": content,
                                    "file": jsonl_file.name
                                })
                            elif isinstance(content, list):
                                for item in content:
                                    if isinstance(item, dict) and item.get("type") == "text":
                                        text = item.get("text", "")
                                        if "---SMS FROM" in text:
                                            messages.append({
                                                "timestamp": ts,
                                                "content": text,
                                                "file": jsonl_file.name
                                            })
                    except json.JSONDecodeError:
                        continue
        except Exception as e:
            continue

    if not messages:
        print(f"CONSOLIDATE|{contact}|No messages from today to consolidate")
        return

    # Output for Claude to review
    print(f"CONSOLIDATE|{contact}|{len(messages)} messages from today")
    print("=" * 60)
    print("REMEMBER LIKE A FRIEND, NOT A DATABASE")
    print("")
    print("Ask yourself: What would I tell someone about this person?")
    print("")
    print("Good memories sound like:")
    print('  - "He loves building systems and seeing them come to life"')
    print('  - "We designed the podcast system together over text"')
    print('  - "She thinks through problems out loud"')
    print("")
    print("Bad memories sound like:")
    print('  - "prefers concise text responses" (too mechanical)')
    print('  - "uses X email for Spotify" (config, not memory)')
    print('  - "admin tier - full access" (system data, not personal)')
    print("")
    print("Vibe check: Would you say this out loud to a mutual friend?")
    print("")
    print(f"Save with: memory save '{contact}' 'memory text'")
    print("(Types are optional - natural language is better)")
    print("=" * 60)
    print("")

    for msg in messages[:20]:  # Limit to 20 messages
        print(f"[{msg['timestamp'][:16]}]")
        # Clean up the content for display
        content = msg['content']
        # Remove the SMS wrapper if present
        if "---SMS FROM" in content:
            lines = content.split('\n')
            for line in lines:
                if line.strip() and not line.startswith('---'):
                    print(f"  {line}")
        else:
            print(f"  {content}")
        print("")

    print("=" * 60)
    print(f"After reviewing, run: memory sync {contact}")
    print("=" * 60)


def sync_claude_md(contact: str):
    """Regenerate CLAUDE.md for a contact as a human-readable note."""
    contact = normalize_contact(contact)
    conn = get_connection()

    # Get all memories for contact
    results = conn.execute("""
        SELECT memory_text
        FROM memories
        WHERE contact = ?
        ORDER BY importance DESC, timestamp DESC
    """, [contact]).fetchall()
    conn.close()

    if not results:
        print(f"SYNC|{contact}|No memories to sync")
        return

    memories = [r[0] for r in results]
    name = contact.replace('-', ' ').title()

    # Generate CLAUDE.md as a natural note
    lines = [
        f"# {name}",
        "",
        "What I know about them:",
        "",
    ]

    for mem in memories[:15]:  # Limit to keep it scannable
        lines.append(f"- {mem}")

    lines.extend([
        "",
        "---",
        f"*{len(results)} memories · Last synced: {datetime.now().strftime('%Y-%m-%d %H:%M')}*",
    ])

    # Write to transcript folder
    claude_md_path = TRANSCRIPTS_DIR / contact / "CLAUDE.md"

    if not claude_md_path.parent.exists():
        print(f"ERROR|Transcript folder not found: {claude_md_path.parent}")
        return

    claude_md_path.write_text("\n".join(lines))
    log_operation("SYNC", contact, f"path={claude_md_path} memories={len(results)}")
    print(f"SYNCED|{contact}|{claude_md_path}|{len(results)} memories")

def main():
    parser = argparse.ArgumentParser(description="Memory CLI")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # init
    subparsers.add_parser("init", help="Initialize database")

    # save
    save_parser = subparsers.add_parser("save", help="Save a memory")
    save_parser.add_argument("contact", help="Contact name (e.g., jane-doe)")
    save_parser.add_argument("text", help="Memory text")
    save_parser.add_argument("--type", "-t", dest="type_", help="Memory type")
    save_parser.add_argument("--importance", "-i", type=int, default=3, help="Importance 1-5")
    save_parser.add_argument("--transcript", help="Source transcript file")
    save_parser.add_argument("--ref", help="Reference in transcript")

    # load
    load_parser = subparsers.add_parser("load", help="Load memories for contact")
    load_parser.add_argument("contact", help="Contact name")
    load_parser.add_argument("--type", "-t", dest="type_", help="Filter by type")
    load_parser.add_argument("--limit", "-n", type=int, default=20, help="Max results")

    # edit
    edit_parser = subparsers.add_parser("edit", help="Edit a memory")
    edit_parser.add_argument("id", type=int, help="Memory ID to edit")
    edit_parser.add_argument("--text", help="New memory text")
    edit_parser.add_argument("--type", "-t", dest="type_", help="New type")
    edit_parser.add_argument("--importance", "-i", type=int, help="New importance")

    # delete
    delete_parser = subparsers.add_parser("delete", help="Delete a memory")
    delete_parser.add_argument("id", type=int, help="Memory ID to delete")

    # search
    search_parser = subparsers.add_parser("search", help="Search memories")
    search_parser.add_argument("query", help="Search text")
    search_parser.add_argument("--contact", "-c", help="Filter by contact")

    # query
    query_parser = subparsers.add_parser("query", help="Run SQL query")
    query_parser.add_argument("sql", help="SQL query")

    # types
    types_parser = subparsers.add_parser("types", help="List memory types")
    types_parser.add_argument("--contact", "-c", help="Filter by contact")

    # sync
    sync_parser = subparsers.add_parser("sync", help="Sync CLAUDE.md for contact")
    sync_parser.add_argument("contact", help="Contact name")

    # ask
    ask_parser = subparsers.add_parser("ask", help="Query memories with natural language")
    ask_parser.add_argument("contact", help="Contact name")
    ask_parser.add_argument("prompt", help="Question or topic to explore")

    # summary
    summary_parser = subparsers.add_parser("summary", help="Generate compact summary for session")
    summary_parser.add_argument("contact", help="Contact name")

    # consolidate
    consolidate_parser = subparsers.add_parser("consolidate", help="Review today's transcript for memory extraction")
    consolidate_parser.add_argument("contact", help="Contact name")

    args = parser.parse_args()

    # Ensure database exists
    if args.command != "init" and not DB_PATH.exists():
        init_database()

    if args.command == "init":
        init_database()
    elif args.command == "save":
        save_memory(args.contact, args.text, args.type_, args.importance,
                   args.transcript, args.ref)
    elif args.command == "load":
        load_memories(args.contact, args.type_, args.limit)
    elif args.command == "edit":
        edit_memory(args.id, args.text, args.type_, args.importance)
    elif args.command == "delete":
        delete_memory(args.id)
    elif args.command == "search":
        search_memories(args.query, args.contact)
    elif args.command == "query":
        run_query(args.sql)
    elif args.command == "types":
        get_types(args.contact)
    elif args.command == "sync":
        sync_claude_md(args.contact)
    elif args.command == "ask":
        ask_memories(args.contact, args.prompt)
    elif args.command == "summary":
        summary_for_session(args.contact)
    elif args.command == "consolidate":
        consolidate_memories(args.contact)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
