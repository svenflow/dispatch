#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb>=1.0.0"]
# ///
"""
Export memories from DuckDB to markdown files for indexing.
Each contact gets their own markdown file with all their memories.
"""

import argparse
from datetime import datetime
from pathlib import Path

import duckdb


MEMORY_DB = Path.home() / "code/memory-cli/memory.duckdb"


def export_memories(db_path: Path, output_dir: Path):
    """Export memories to markdown files grouped by contact."""
    output_dir.mkdir(parents=True, exist_ok=True)

    conn = duckdb.connect(str(db_path), read_only=True)

    # Get all memories grouped by contact
    query = """
        SELECT contact, memory_text, type, timestamp, importance
        FROM memories
        ORDER BY contact, timestamp
    """

    memories_by_contact: dict[str, list[dict]] = {}

    try:
        for row in conn.execute(query).fetchall():
            contact = row[0]
            memory = {
                'text': row[1],
                'type': row[2],
                'timestamp': row[3],
                'importance': row[4],
            }

            if contact not in memories_by_contact:
                memories_by_contact[contact] = []
            memories_by_contact[contact].append(memory)
    except Exception as e:
        print(f"Error reading memories: {e}")
        return

    conn.close()

    # Export each contact's memories
    for contact, memories in memories_by_contact.items():
        safe_name = contact.lower().replace(' ', '-').replace("'", "")
        filename = output_dir / f"{safe_name}-memories.md"

        with open(filename, 'w') as f:
            f.write(f"# Memories: {contact}\n\n")

            # Group by type
            by_type: dict[str, list] = {}
            for m in memories:
                t = m['type'] or 'general'
                if t not in by_type:
                    by_type[t] = []
                by_type[t].append(m)

            for mem_type, type_memories in by_type.items():
                f.write(f"## {mem_type.title()}\n\n")
                for m in type_memories:
                    ts = m['timestamp']
                    if isinstance(ts, datetime):
                        ts_str = ts.strftime('%Y-%m-%d')
                    elif ts:
                        ts_str = str(ts)[:10]
                    else:
                        ts_str = None
                    f.write(f"- {m['text']}")
                    if ts_str:
                        f.write(f" *(added {ts_str})*")
                    f.write("\n")
                f.write("\n")

        print(f"Exported: {filename.name} ({len(memories)} memories)")


def main():
    parser = argparse.ArgumentParser(description="Export memories to markdown")
    parser.add_argument("--output", "-o", default="~/.cache/jsmith-search/memories-export",
                        help="Output directory")
    parser.add_argument("--db", "-d", default=str(MEMORY_DB),
                        help="Path to memory.duckdb")
    args = parser.parse_args()

    db_path = Path(args.db).expanduser()
    output_dir = Path(args.output).expanduser()

    if not db_path.exists():
        print(f"Memory database not found: {db_path}")
        return

    print(f"Exporting memories from: {db_path}")
    export_memories(db_path, output_dir)
    print(f"\nExported to: {output_dir}")


if __name__ == "__main__":
    main()
