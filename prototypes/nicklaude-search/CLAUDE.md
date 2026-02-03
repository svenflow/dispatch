# nicklaude-search

Hybrid semantic search daemon for the nicklaude assistant system. Combines BM25 full-text search with vector embeddings and LLM reranking.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    claude-assistant daemon                       │
│                         (Python)                                 │
│                            │                                     │
│                   spawns as child process                        │
│                            ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              nicklaude-search daemon                     │    │
│  │                    (Bun/TypeScript)                      │    │
│  │                                                          │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │    │
│  │  │  Poller  │  │  HTTP    │  │   CLI Interface      │   │    │
│  │  │ (files)  │  │  Server  │  │   (search-daemon)    │   │    │
│  │  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘   │    │
│  │       │             │                   │               │    │
│  │       ▼             ▼                   ▼               │    │
│  │  ┌────────────────────────────────────────────────┐     │    │
│  │  │              Search Engine                      │     │    │
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │     │    │
│  │  │  │  FTS5   │  │ Vector  │  │   Reranker      │ │     │    │
│  │  │  │ (BM25)  │  │ Search  │  │ (qwen3-reranker)│ │     │    │
│  │  │  └─────────┘  └─────────┘  └─────────────────┘ │     │    │
│  │  └────────────────────────────────────────────────┘     │    │
│  │                        │                                │    │
│  │                        ▼                                │    │
│  │  ┌────────────────────────────────────────────────┐     │    │
│  │  │           SQLite + sqlite-vec                   │     │    │
│  │  │      ~/.cache/nicklaude-search/index.sqlite    │     │    │
│  │  └────────────────────────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Design Decisions

### Lifecycle
- Spawned as child process by claude-assistant daemon (manager.py)
- Health-checked in daemon's periodic loop
- Auto-restarted if dies
- Dies when parent daemon dies

### File Watching Strategy
- **Polling-based** (not fswatch/Bun.watch)
- Polls file mtimes every N seconds (configurable, default 5s)
- Reason: New transcript directories can appear, inotify/FSEvents don't catch this well

### Indexing Strategy
- **Incremental**: Update only changed files based on hash
- **Append-only sources** (transcripts, SMS): Only add new rows, never re-index unchanged
- **Mutable sources** (Documents, skills): Re-embed if content hash changes
- No full rebuild on startup - too slow

### Search Pipeline
Always uses full quality path:
1. **BM25 (FTS5)**: Fast keyword matching
2. **Vector Search**: Semantic similarity via embeddinggemma-300M
3. **RRF Fusion**: Reciprocal Rank Fusion combines both
4. **Reranking**: qwen3-reranker for final scoring (~40ms warm)

### API
- **HTTP**: `localhost:7890` - for programmatic access
- **CLI**: `search-daemon` command - for shell/scripts

## Configuration

Config file: `~/.config/nicklaude-search/config.yml`

```yaml
# Polling interval in seconds
poll_interval: 5

# Categories to index
categories:
  transcripts:
    path: ~/transcripts
    pattern: "**/*.jsonl"
    type: append_only

  sms:
    source: chat.db
    type: append_only

  skills:
    path: ~/.claude/skills
    pattern: "**/*.md"
    type: mutable

  contacts:
    source: contacts_notes
    type: mutable

  documents:
    path: ~/Documents
    pattern: "**/*.{md,txt,pdf}"
    type: mutable

# Search settings
search:
  rerank: true  # Always use reranker
  top_k: 20     # Results to return

# Server settings
server:
  port: 7890
  host: localhost
```

## Database Schema

SQLite with sqlite-vec extension at `~/.cache/nicklaude-search/index.sqlite`

```sql
-- Content-addressable storage (deduplication)
CREATE TABLE content (
  hash TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Documents table
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,      -- "transcripts", "sms", "skills", etc.
  path TEXT NOT NULL,          -- file path or unique identifier
  title TEXT NOT NULL,
  hash TEXT NOT NULL,
  mtime REAL NOT NULL,         -- file modification time
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (hash) REFERENCES content(hash),
  UNIQUE(category, path)
);

-- Content vectors (embeddings)
CREATE TABLE content_vectors (
  hash TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,  -- chunk sequence number
  model TEXT NOT NULL,
  embedded_at TEXT NOT NULL,
  PRIMARY KEY (hash, seq)
);

-- sqlite-vec virtual table for similarity search
CREATE VIRTUAL TABLE vectors_vec USING vec0(
  hash_seq TEXT PRIMARY KEY,
  embedding float[2048] distance_metric=cosine
);

-- FTS5 for keyword search
CREATE VIRTUAL TABLE documents_fts USING fts5(
  filepath, title, body,
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER documents_ai AFTER INSERT ON documents WHEN new.active = 1
BEGIN
  INSERT INTO documents_fts(rowid, filepath, title, body)
  SELECT new.id, new.category || '/' || new.path, new.title,
         (SELECT doc FROM content WHERE hash = new.hash);
END;
```

## API Reference

### HTTP Endpoints

```
GET /health
  Returns: { status: "ok", indexed: 1234, uptime: 3600 }

GET /search?q=<query>&limit=20&category=transcripts
  Returns: { results: [...], took_ms: 45 }

POST /index
  Body: { category: "...", path: "...", content: "...", title: "..." }
  Returns: { hash: "abc123", chunks: 3 }

GET /status
  Returns: { categories: {...}, total_docs: 1234, last_poll: "..." }
```

### CLI Commands

```bash
# Start daemon (usually called by claude-assistant)
search-daemon serve

# Search
search-daemon search "query here"
search-daemon search "query" --category transcripts --limit 10

# Index a single document
search-daemon index --category skills --path ~/.claude/skills/hue/SKILL.md

# Force re-index category
search-daemon reindex --category documents

# Status
search-daemon status
```

## Models

Using same GGUF models as qmd:
- **embeddinggemma-300M** (~328MB) - Embedding generation
- **qwen3-reranker-0.6B** (~639MB) - Cross-encoder reranking

Models cached in `~/.cache/nicklaude-search/models/`

## File Structure

```
~/code/nicklaude-search/
├── CLAUDE.md              # This file
├── package.json           # Bun project config
├── tsconfig.json          # TypeScript config
├── src/
│   ├── index.ts           # Entry point
│   ├── daemon.ts          # Main daemon loop
│   ├── server.ts          # HTTP server
│   ├── cli.ts             # CLI interface
│   ├── store.ts           # Database operations
│   ├── search.ts          # Search engine
│   ├── indexer.ts         # File indexing
│   ├── poller.ts          # File change detection
│   ├── llm.ts             # Model loading & inference
│   └── config.ts          # Configuration loading
├── tests/
│   ├── store.test.ts
│   ├── search.test.ts
│   ├── indexer.test.ts
│   └── integration.test.ts
└── bin/
    └── search-daemon      # CLI entry point
```

## Testing

Run tests with:
```bash
~/.bun/bin/bun test                    # All tests
~/.bun/bin/bun test tests/store.test.ts  # Specific file
~/.bun/bin/bun test --watch            # Watch mode
```

### Test Coverage (69 tests, 142 assertions)

**store.test.ts (31 tests)**
- hashContent consistency and format
- Content CRUD operations
- Document CRUD operations
- Embedding operations
- FTS search functionality
- Status operations

**search.test.ts (17 tests)**
- FTS search with filtering and limits
- Vector search with mocked embeddings
- Hybrid search with RRF fusion
- Full search with reranking
- Error handling for failed reranking

**indexer.test.ts (3 tests)**
- Document chunking
- Title extraction
- File indexing

**integration.test.ts (18 tests)**
- Store + SearchEngine integration
- Poller file detection (new, update, delete)
- HTTP server endpoints (/health, /search, /status, /index)
- CLI command logic

## Development

```bash
# Install dependencies
bun install

# Run daemon in dev mode
bun run src/daemon.ts

# Build for production
bun build src/index.ts --outdir dist --target bun

# Type check
bun run typecheck
```

## Integration with claude-assistant

The daemon is spawned by `manager.py`:

```python
class Manager:
    def __init__(self):
        ...
        self.search_daemon = self._spawn_search_daemon()

    def _spawn_search_daemon(self):
        search_log = open(LOGS_DIR / "search-daemon.log", "a")
        bun_path = str(HOME / ".bun/bin/bun")
        return subprocess.Popen(
            [bun_path, "run",
             str(HOME / "code/nicklaude-search/src/daemon.ts")],
            stdout=search_log,
            stderr=search_log,
            env=get_clean_env()
        )

    def run(self):
        # In health check loop:
        if self.search_daemon.poll() is not None:
            log.warn("Search daemon died, restarting...")
            self.search_daemon = self._spawn_search_daemon()
```

## Performance Targets

- **Cold start**: < 5 seconds (models pre-warmed on first query)
- **Search latency**: < 50ms (with reranking, warm)
- **Index latency**: < 50ms per document
- **Polling overhead**: Negligible (mtime checks only)

## Current Status

### Completed
- [x] Store layer with SQLite + FTS5
- [x] SearchEngine with FTS, hybrid search, and reranking support
- [x] FileIndexer for markdown/text files
- [x] TranscriptIndexer for JSONL transcripts
- [x] SMSIndexer for chat.db
- [x] ContactsIndexer for Contacts.app notes
- [x] Poller for file change detection
- [x] HTTP server with all endpoints
- [x] CLI interface with all commands
- [x] Daemon entry point
- [x] Comprehensive test suite (69 tests)

### Completed (cont.)
- [x] LLM integration via node-llama-cpp (embeddinggemma-300M + qwen3-reranker)
- [x] Port auto-retry (handles EADDRINUSE)
- [x] chat.db WAL file handling (copies all 3 files to avoid locks)
- [x] Time range filtering (--after/--before flags)
- [x] Category filtering

### Remaining
- [ ] Integration with claude-assistant manager.py
- [ ] LaunchAgent configuration
- [ ] Config file at ~/.config/nicklaude-search/config.yml

### How to Test Now

```bash
# Manual daemon test
cd ~/code/nicklaude-search
~/.bun/bin/bun run src/daemon.ts

# In another terminal:
curl http://localhost:7890/health
curl "http://localhost:7890/search?q=lights"

# Or use CLI:
~/code/nicklaude-search/bin/search-daemon status
~/code/nicklaude-search/bin/search-daemon search "control lights"
```
