#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb"]
# ///
"""
Migrate memories from DuckDB to memory-search SQLite.

Run this once after starting memory-search daemon.
"""

import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

DUCKDB_PATH = Path.home() / ".claude" / "memory.duckdb"
SEARCH_API = "http://localhost:7890"


def migrate():
    if not DUCKDB_PATH.exists():
        print("No DuckDB file found at", DUCKDB_PATH)
        return

    # Check if daemon is running
    try:
        req = urllib.request.Request(f"{SEARCH_API}/health")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            if data.get("status") != "ok":
                print("ERROR: Search daemon not healthy")
                sys.exit(1)
    except urllib.error.URLError as e:
        print(f"ERROR: Cannot connect to search daemon at {SEARCH_API}")
        print("Start it first: cd ~/dispatch/services/memory-search && bun run src/daemon.ts")
        sys.exit(1)

    # Read from DuckDB
    import duckdb
    conn = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    # Get all memories
    rows = conn.execute("""
        SELECT contact, type, memory_text, importance, timestamp
        FROM memories
        ORDER BY timestamp ASC
    """).fetchall()
    conn.close()

    print(f"Found {len(rows)} memories in DuckDB")

    # Migrate each memory
    migrated = 0
    errors = 0

    for contact, type_, text, importance, timestamp in rows:
        try:
            data = {
                "contact": contact,
                "memory_text": text,
                "type": type_ or "fact",
                "importance": importance or 3,
                "tags": [],
            }

            req = urllib.request.Request(
                f"{SEARCH_API}/memory/save",
                data=json.dumps(data).encode("utf-8"),
                method="POST"
            )
            req.add_header("Content-Type", "application/json")

            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read())
                if result.get("success"):
                    migrated += 1
                else:
                    errors += 1
                    print(f"ERROR migrating: {result.get('error')}")

        except Exception as e:
            errors += 1
            print(f"ERROR migrating memory for {contact}: {e}")

    print(f"\nMigration complete:")
    print(f"  Migrated: {migrated}")
    print(f"  Errors: {errors}")

    if errors == 0 and migrated > 0:
        print(f"\nYou can now delete the old DuckDB file:")
        print(f"  rm {DUCKDB_PATH}")


if __name__ == "__main__":
    migrate()
