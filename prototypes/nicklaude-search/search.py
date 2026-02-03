#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "sentence-transformers>=3.0.0",
#     "numpy>=1.26.0",
#     "rich>=13.0.0",
# ]
# ///
"""
nicklaude-search: Hybrid semantic search for the nicklaude assistant system.

Combines BM25 full-text search with vector semantic search using RRF fusion.
Inspired by qmd (https://github.com/tobi/qmd) but simplified for our needs.
"""

import argparse
import hashlib
import json
import os
import sqlite3
import struct
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np

# Lazy imports for performance
_model = None

def get_embedding_model():
    """Lazy-load the sentence transformer model."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        # all-MiniLM-L6-v2: 384 dimensions, ~80MB, fast inference
        _model = SentenceTransformer('all-MiniLM-L6-v2')
    return _model


# =============================================================================
# Configuration
# =============================================================================

DEFAULT_DB_PATH = Path.home() / ".cache" / "nicklaude-search" / "index.sqlite"
EMBEDDING_DIM = 384  # all-MiniLM-L6-v2 dimension
CHUNK_SIZE_CHARS = 2000  # Simpler char-based chunking
CHUNK_OVERLAP_CHARS = 200


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class SearchResult:
    """Result from a search operation."""
    filepath: str
    title: str
    body: str
    score: float
    source: str  # "fts", "vec", or "hybrid"
    collection: str = ""

@dataclass
class RankedResult:
    """Internal result for RRF fusion."""
    filepath: str
    title: str
    body: str
    score: float


# =============================================================================
# Vector Helpers (pack/unpack for SQLite BLOB storage)
# =============================================================================

def serialize_vector(vec: np.ndarray) -> bytes:
    """Serialize numpy array to bytes for SQLite storage."""
    return vec.astype(np.float32).tobytes()

def deserialize_vector(blob: bytes) -> np.ndarray:
    """Deserialize bytes back to numpy array."""
    return np.frombuffer(blob, dtype=np.float32)

def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


# =============================================================================
# Database Initialization
# =============================================================================

def init_database(db_path: Path) -> sqlite3.Connection:
    """Initialize the SQLite database with required tables."""
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Enable WAL mode for better concurrency
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")

    # Collections table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            path TEXT NOT NULL,
            glob_pattern TEXT NOT NULL DEFAULT '**/*.md',
            created_at TEXT NOT NULL
        )
    """)

    # Content table (content-addressable storage)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS content (
            hash TEXT PRIMARY KEY,
            doc TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    # Documents table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL,
            path TEXT NOT NULL,
            title TEXT NOT NULL,
            hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (collection_id) REFERENCES collections(id),
            FOREIGN KEY (hash) REFERENCES content(hash),
            UNIQUE(collection_id, path)
        )
    """)

    # FTS5 virtual table for full-text search
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
            filepath, title, body,
            tokenize='porter unicode61'
        )
    """)

    # Vector embeddings table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hash TEXT NOT NULL,
            chunk_seq INTEGER NOT NULL DEFAULT 0,
            chunk_pos INTEGER NOT NULL DEFAULT 0,
            embedding BLOB NOT NULL,
            embedded_at TEXT NOT NULL,
            UNIQUE(hash, chunk_seq)
        )
    """)

    conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection_id, active)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(hash)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_embeddings_hash ON embeddings(hash)")

    conn.commit()
    return conn


# =============================================================================
# Content Helpers
# =============================================================================

def hash_content(content: str) -> str:
    """Compute SHA256 hash of content."""
    return hashlib.sha256(content.encode()).hexdigest()

def extract_title(content: str, filename: str) -> str:
    """Extract title from markdown content."""
    import re
    # Try to find first heading
    match = re.search(r'^##?\s+(.+)$', content, re.MULTILINE)
    if match:
        return match.group(1).strip()
    # Fall back to filename
    return Path(filename).stem

def chunk_document(content: str, max_chars: int = CHUNK_SIZE_CHARS,
                   overlap_chars: int = CHUNK_OVERLAP_CHARS) -> list[tuple[str, int]]:
    """Split document into overlapping chunks. Returns (text, position) tuples."""
    if len(content) <= max_chars:
        return [(content, 0)]

    chunks = []
    pos = 0

    while pos < len(content):
        end_pos = min(pos + max_chars, len(content))

        # Try to find a good break point (paragraph, sentence, word)
        if end_pos < len(content):
            slice_text = content[pos:end_pos]
            search_start = int(len(slice_text) * 0.7)
            search_slice = slice_text[search_start:]

            # Look for break points
            for sep in ['\n\n', '. ', '.\n', '\n', ' ']:
                idx = search_slice.rfind(sep)
                if idx >= 0:
                    end_pos = pos + search_start + idx + len(sep)
                    break

        chunks.append((content[pos:end_pos], pos))

        if end_pos >= len(content):
            break
        pos = end_pos - overlap_chars
        if pos <= chunks[-1][1]:
            pos = end_pos

    return chunks


# =============================================================================
# Indexing
# =============================================================================

def add_collection(conn: sqlite3.Connection, name: str, path: str,
                   glob_pattern: str = "**/*.md") -> int:
    """Add a new collection to the index."""
    now = datetime.now().isoformat()
    path = str(Path(path).resolve())

    cursor = conn.execute("""
        INSERT OR REPLACE INTO collections (name, path, glob_pattern, created_at)
        VALUES (?, ?, ?, ?)
    """, (name, path, glob_pattern, now))
    conn.commit()
    return cursor.lastrowid

def index_collection(conn: sqlite3.Connection, collection_name: str,
                     verbose: bool = False) -> dict:
    """Index all documents in a collection."""
    from glob import glob

    # Get collection info
    row = conn.execute(
        "SELECT id, path, glob_pattern FROM collections WHERE name = ?",
        (collection_name,)
    ).fetchone()

    if not row:
        raise ValueError(f"Collection '{collection_name}' not found")

    collection_id = row['id']
    base_path = Path(row['path'])
    pattern = row['glob_pattern']

    now = datetime.now().isoformat()
    added = 0
    updated = 0
    unchanged = 0

    # Find all matching files
    for filepath in base_path.glob(pattern):
        if not filepath.is_file():
            continue

        rel_path = str(filepath.relative_to(base_path))

        try:
            content = filepath.read_text()
        except Exception as e:
            if verbose:
                print(f"  Skip {rel_path}: {e}", file=sys.stderr)
            continue

        content_hash = hash_content(content)
        title = extract_title(content, rel_path)

        # Store content FIRST (required by foreign key)
        conn.execute("""
            INSERT OR IGNORE INTO content (hash, doc, created_at)
            VALUES (?, ?, ?)
        """, (content_hash, content, now))

        # Check if document exists
        existing = conn.execute("""
            SELECT id, hash FROM documents
            WHERE collection_id = ? AND path = ? AND active = 1
        """, (collection_id, rel_path)).fetchone()

        if existing:
            if existing['hash'] == content_hash:
                unchanged += 1
                continue
            # Update existing document
            conn.execute("""
                UPDATE documents SET hash = ?, title = ?, modified_at = ?
                WHERE id = ?
            """, (content_hash, title, now, existing['id']))
            updated += 1
        else:
            # Insert new document
            conn.execute("""
                INSERT INTO documents (collection_id, path, title, hash, created_at, modified_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (collection_id, rel_path, title, content_hash, now, now))
            added += 1

        # Update FTS index
        conn.execute("""
            DELETE FROM documents_fts WHERE filepath = ?
        """, (f"{collection_name}/{rel_path}",))
        conn.execute("""
            INSERT INTO documents_fts (filepath, title, body)
            VALUES (?, ?, ?)
        """, (f"{collection_name}/{rel_path}", title, content))

        if verbose:
            print(f"  {'Updated' if existing else 'Added'}: {rel_path}")

    conn.commit()
    return {"added": added, "updated": updated, "unchanged": unchanged}


def embed_documents(conn: sqlite3.Connection, verbose: bool = False) -> dict:
    """Generate embeddings for all documents that need them."""
    model = get_embedding_model()
    now = datetime.now().isoformat()

    # Find documents without embeddings
    rows = conn.execute("""
        SELECT DISTINCT d.hash, c.doc
        FROM documents d
        JOIN content c ON d.hash = c.hash
        LEFT JOIN embeddings e ON d.hash = e.hash AND e.chunk_seq = 0
        WHERE d.active = 1 AND e.id IS NULL
    """).fetchall()

    if not rows:
        return {"embedded": 0}

    embedded = 0
    for row in rows:
        content_hash = row['hash']
        content = row['doc']
        title = extract_title(content, "")

        # Chunk and embed
        chunks = chunk_document(content)
        for seq, (chunk_text, chunk_pos) in enumerate(chunks):
            # Format for embedding (similar to qmd)
            embed_text = f"title: {title} | text: {chunk_text}"
            embedding = model.encode(embed_text, normalize_embeddings=True)

            conn.execute("""
                INSERT OR REPLACE INTO embeddings (hash, chunk_seq, chunk_pos, embedding, embedded_at)
                VALUES (?, ?, ?, ?, ?)
            """, (content_hash, seq, chunk_pos, serialize_vector(embedding), now))

        embedded += 1
        if verbose:
            print(f"  Embedded: {content_hash[:8]}... ({len(chunks)} chunks)")

    conn.commit()
    return {"embedded": embedded}


# =============================================================================
# Search Functions
# =============================================================================

def search_fts(conn: sqlite3.Connection, query: str, limit: int = 10,
               collection: Optional[str] = None) -> list[SearchResult]:
    """BM25 full-text search using SQLite FTS5."""
    sql = """
        SELECT filepath, title, body, bm25(documents_fts) as score
        FROM documents_fts
        WHERE documents_fts MATCH ?
    """
    params = [query]

    if collection:
        sql += " AND filepath LIKE ?"
        params.append(f"{collection}/%")

    sql += " ORDER BY score LIMIT ?"
    params.append(limit)

    results = []
    for row in conn.execute(sql, params):
        results.append(SearchResult(
            filepath=row['filepath'],
            title=row['title'],
            body=row['body'][:500],  # Truncate for display
            score=abs(row['score']),  # BM25 returns negative scores
            source="fts",
            collection=row['filepath'].split('/')[0] if '/' in row['filepath'] else ""
        ))
    return results


def search_vec(conn: sqlite3.Connection, query: str, limit: int = 10,
               collection: Optional[str] = None) -> list[SearchResult]:
    """Vector semantic search."""
    model = get_embedding_model()

    # Format query for embedding (similar to qmd)
    query_text = f"task: search result | query: {query}"
    query_vec = model.encode(query_text, normalize_embeddings=True)

    # Get all embeddings (we'll compute similarity in Python)
    # In production, use sqlite-vss or similar for efficient ANN search
    sql = """
        SELECT e.hash, e.chunk_seq, e.chunk_pos, e.embedding,
               d.path, d.title, c.doc, col.name as collection
        FROM embeddings e
        JOIN documents d ON e.hash = d.hash AND d.active = 1
        JOIN content c ON e.hash = c.hash
        JOIN collections col ON d.collection_id = col.id
    """
    params = []

    if collection:
        sql += " WHERE col.name = ?"
        params.append(collection)

    rows = conn.execute(sql, params).fetchall()

    # Compute similarities
    scored = []
    for row in rows:
        doc_vec = deserialize_vector(row['embedding'])
        similarity = cosine_similarity(query_vec, doc_vec)
        scored.append((row, similarity))

    # Sort by similarity and deduplicate by document
    scored.sort(key=lambda x: x[1], reverse=True)

    seen_docs = set()
    results = []
    for row, score in scored:
        filepath = f"{row['collection']}/{row['path']}"
        if filepath in seen_docs:
            continue
        seen_docs.add(filepath)

        # Get snippet around chunk position
        doc = row['doc']
        pos = row['chunk_pos']
        snippet = doc[max(0, pos):pos + 500]

        results.append(SearchResult(
            filepath=filepath,
            title=row['title'],
            body=snippet,
            score=score,
            source="vec",
            collection=row['collection']
        ))

        if len(results) >= limit:
            break

    return results


def reciprocal_rank_fusion(result_lists: list[list[SearchResult]],
                           weights: Optional[list[float]] = None,
                           k: int = 60) -> list[SearchResult]:
    """
    Combine multiple ranked lists using Reciprocal Rank Fusion.

    RRF formula: score = Σ(weight / (k + rank + 1))

    This is the key algorithm from qmd that makes hybrid search work well.
    """
    if weights is None:
        weights = [1.0] * len(result_lists)

    scores: dict[str, dict] = {}

    for list_idx, results in enumerate(result_lists):
        weight = weights[list_idx] if list_idx < len(weights) else 1.0

        for rank, result in enumerate(results):
            rrf_contribution = weight / (k + rank + 1)

            if result.filepath in scores:
                scores[result.filepath]['score'] += rrf_contribution
                scores[result.filepath]['best_rank'] = min(
                    scores[result.filepath]['best_rank'], rank
                )
            else:
                scores[result.filepath] = {
                    'result': result,
                    'score': rrf_contribution,
                    'best_rank': rank
                }

    # Add top-rank bonus (from qmd)
    for data in scores.values():
        if data['best_rank'] == 0:
            data['score'] += 0.05  # Ranked #1 somewhere
        elif data['best_rank'] <= 2:
            data['score'] += 0.02  # Ranked top-3 somewhere

    # Sort by score and return
    sorted_results = sorted(scores.values(), key=lambda x: x['score'], reverse=True)

    return [
        SearchResult(
            filepath=data['result'].filepath,
            title=data['result'].title,
            body=data['result'].body,
            score=data['score'],
            source="hybrid",
            collection=data['result'].collection
        )
        for data in sorted_results
    ]


def hybrid_search(conn: sqlite3.Connection, query: str, limit: int = 10,
                  collection: Optional[str] = None) -> list[SearchResult]:
    """
    Hybrid search combining BM25 and vector search with RRF fusion.

    This is the core value proposition - combining keyword matching with
    semantic understanding.
    """
    # Get results from both methods
    fts_results = search_fts(conn, query, limit=20, collection=collection)
    vec_results = search_vec(conn, query, limit=20, collection=collection)

    result_lists = []
    weights = []

    if fts_results:
        result_lists.append(fts_results)
        weights.append(1.0)

    if vec_results:
        result_lists.append(vec_results)
        weights.append(1.0)

    if not result_lists:
        return []

    # Apply RRF fusion
    fused = reciprocal_rank_fusion(result_lists, weights)

    return fused[:limit]


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="nicklaude-search: Hybrid semantic search"
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # collection add
    add_parser = subparsers.add_parser("add", help="Add a collection")
    add_parser.add_argument("path", help="Path to index")
    add_parser.add_argument("--name", "-n", required=True, help="Collection name")
    add_parser.add_argument("--pattern", "-p", default="**/*.md", help="Glob pattern")

    # index
    index_parser = subparsers.add_parser("index", help="Index a collection")
    index_parser.add_argument("collection", help="Collection name")
    index_parser.add_argument("--verbose", "-v", action="store_true")

    # embed
    embed_parser = subparsers.add_parser("embed", help="Generate embeddings")
    embed_parser.add_argument("--verbose", "-v", action="store_true")

    # search (FTS only)
    search_parser = subparsers.add_parser("search", help="BM25 keyword search")
    search_parser.add_argument("query", help="Search query")
    search_parser.add_argument("--collection", "-c", help="Filter by collection")
    search_parser.add_argument("--limit", "-n", type=int, default=5)
    search_parser.add_argument("--json", action="store_true")

    # vsearch (vector only)
    vsearch_parser = subparsers.add_parser("vsearch", help="Vector semantic search")
    vsearch_parser.add_argument("query", help="Search query")
    vsearch_parser.add_argument("--collection", "-c", help="Filter by collection")
    vsearch_parser.add_argument("--limit", "-n", type=int, default=5)
    vsearch_parser.add_argument("--json", action="store_true")

    # query (hybrid)
    query_parser = subparsers.add_parser("query", help="Hybrid search (best quality)")
    query_parser.add_argument("query", help="Search query")
    query_parser.add_argument("--collection", "-c", help="Filter by collection")
    query_parser.add_argument("--limit", "-n", type=int, default=5)
    query_parser.add_argument("--json", action="store_true")

    # status
    subparsers.add_parser("status", help="Show index status")

    # list
    subparsers.add_parser("list", help="List collections")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    conn = init_database(DEFAULT_DB_PATH)

    try:
        from rich.console import Console
        from rich.table import Table
        console = Console()
        use_rich = True
    except ImportError:
        console = None
        use_rich = False

    if args.command == "add":
        coll_id = add_collection(conn, args.name, args.path, args.pattern)
        print(f"Added collection '{args.name}' (id={coll_id})")

    elif args.command == "index":
        print(f"Indexing collection '{args.collection}'...")
        stats = index_collection(conn, args.collection, verbose=args.verbose)
        print(f"Done: {stats['added']} added, {stats['updated']} updated, {stats['unchanged']} unchanged")

    elif args.command == "embed":
        print("Generating embeddings...")
        stats = embed_documents(conn, verbose=args.verbose)
        print(f"Done: {stats['embedded']} documents embedded")

    elif args.command in ("search", "vsearch", "query"):
        if args.command == "search":
            results = search_fts(conn, args.query, args.limit, args.collection)
        elif args.command == "vsearch":
            results = search_vec(conn, args.query, args.limit, args.collection)
        else:
            results = hybrid_search(conn, args.query, args.limit, args.collection)

        if args.json:
            output = [
                {
                    "filepath": r.filepath,
                    "title": r.title,
                    "score": round(r.score, 4),
                    "source": r.source,
                    "snippet": r.body[:200]
                }
                for r in results
            ]
            print(json.dumps(output, indent=2))
        elif use_rich and results:
            for r in results:
                score_pct = int(r.score * 100) if r.score <= 1 else r.score
                console.print(f"\n[bold cyan]{r.filepath}[/bold cyan] [dim]({r.source})[/dim]")
                console.print(f"[green]Title:[/green] {r.title}")
                console.print(f"[yellow]Score:[/yellow] {score_pct}%")
                console.print(f"[dim]{r.body[:300]}...[/dim]")
        elif results:
            for r in results:
                print(f"\n{r.filepath} ({r.source})")
                print(f"  Title: {r.title}")
                print(f"  Score: {r.score:.4f}")
                print(f"  {r.body[:200]}...")
        else:
            print("No results found.")

    elif args.command == "status":
        # Count documents
        doc_count = conn.execute(
            "SELECT COUNT(*) as c FROM documents WHERE active = 1"
        ).fetchone()['c']

        # Count embeddings
        embed_count = conn.execute(
            "SELECT COUNT(DISTINCT hash) as c FROM embeddings"
        ).fetchone()['c']

        # Count collections
        coll_count = conn.execute(
            "SELECT COUNT(*) as c FROM collections"
        ).fetchone()['c']

        print(f"Database: {DEFAULT_DB_PATH}")
        print(f"Collections: {coll_count}")
        print(f"Documents: {doc_count}")
        print(f"Embedded: {embed_count}")

    elif args.command == "list":
        rows = conn.execute("""
            SELECT c.name, c.path, c.glob_pattern, COUNT(d.id) as doc_count
            FROM collections c
            LEFT JOIN documents d ON c.id = d.collection_id AND d.active = 1
            GROUP BY c.id
        """).fetchall()

        if use_rich:
            table = Table(title="Collections")
            table.add_column("Name")
            table.add_column("Path")
            table.add_column("Pattern")
            table.add_column("Documents", justify="right")

            for row in rows:
                table.add_row(row['name'], row['path'], row['glob_pattern'], str(row['doc_count']))

            console.print(table)
        else:
            for row in rows:
                print(f"{row['name']}: {row['path']} ({row['doc_count']} docs)")

    conn.close()


if __name__ == "__main__":
    main()
