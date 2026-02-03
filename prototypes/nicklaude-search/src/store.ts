/**
 * Database operations for nicklaude-search.
 *
 * Uses SQLite with sqlite-vec extension for vector similarity search.
 */

import Database from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { getDbPath, ensureCacheDir } from "./config";

// =============================================================================
// Types
// =============================================================================

export interface Document {
  id: number;
  category: string;
  path: string;
  title: string;
  hash: string;
  mtime: number;
  created_at: string;
  modified_at: string;
  active: number;
}

export interface SearchResult {
  filepath: string;
  title: string;
  body: string;
  score: number;
  source: "fts" | "vec" | "hybrid" | "reranked";
  category: string;
}

export interface IndexStatus {
  total_docs: number;
  categories: Record<string, number>;
  needs_embedding: number;
  last_modified: string | null;
}

// =============================================================================
// Database Initialization
// =============================================================================

function initDatabase(db: Database): void {
  // Enable WAL mode for better concurrency
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Content-addressable storage
  db.exec(`
    CREATE TABLE IF NOT EXISTS content (
      hash TEXT PRIMARY KEY,
      doc TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Documents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      hash TEXT NOT NULL,
      mtime REAL NOT NULL,
      created_at TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (hash) REFERENCES content(hash) ON DELETE CASCADE,
      UNIQUE(category, path)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category, active)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(hash)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path, active)`);

  // Content vectors (embeddings metadata)
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_vectors (
      hash TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL,
      embedded_at TEXT NOT NULL,
      PRIMARY KEY (hash, seq)
    )
  `);

  // Vector storage using BLOB (simpler than sqlite-vec for now)
  db.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      hash_seq TEXT PRIMARY KEY,
      embedding BLOB NOT NULL
    )
  `);

  // FTS5 for keyword search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      filepath, title, body,
      tokenize='porter unicode61'
    )
  `);

  // Check if trigger exists before creating
  const triggerExists = db.query(`
    SELECT name FROM sqlite_master
    WHERE type='trigger' AND name='documents_ai'
  `).get();

  if (!triggerExists) {
    // Trigger to sync FTS on insert
    db.exec(`
      CREATE TRIGGER documents_ai AFTER INSERT ON documents
      WHEN new.active = 1
      BEGIN
        INSERT INTO documents_fts(rowid, filepath, title, body)
        SELECT
          new.id,
          new.category || '/' || new.path,
          new.title,
          (SELECT doc FROM content WHERE hash = new.hash);
      END
    `);

    // Trigger to sync FTS on delete
    db.exec(`
      CREATE TRIGGER documents_ad AFTER DELETE ON documents
      BEGIN
        DELETE FROM documents_fts WHERE rowid = old.id;
      END
    `);

    // Trigger to sync FTS on update
    db.exec(`
      CREATE TRIGGER documents_au AFTER UPDATE ON documents
      BEGIN
        DELETE FROM documents_fts WHERE rowid = old.id;
        INSERT INTO documents_fts(rowid, filepath, title, body)
        SELECT
          new.id,
          new.category || '/' || new.path,
          new.title,
          (SELECT doc FROM content WHERE hash = new.hash)
        WHERE new.active = 1;
      END
    `);
  }
}

// =============================================================================
// Store Class
// =============================================================================

export class Store {
  private db: Database;
  public readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || getDbPath();

    // Ensure parent directory exists
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    initDatabase(this.db);
  }

  close(): void {
    this.db.close();
  }

  // ===========================================================================
  // Content Operations
  // ===========================================================================

  insertContent(hash: string, content: string): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO content (hash, doc, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(hash, content, new Date().toISOString());
  }

  getContent(hash: string): string | null {
    const row = this.db.query(`SELECT doc FROM content WHERE hash = ?`).get(hash) as { doc: string } | null;
    return row?.doc || null;
  }

  // ===========================================================================
  // Document Operations
  // ===========================================================================

  findDocument(category: string, path: string): Document | null {
    const row = this.db.query(`
      SELECT * FROM documents
      WHERE category = ? AND path = ? AND active = 1
    `).get(category, path) as Document | null;
    return row;
  }

  insertDocument(
    category: string,
    path: string,
    title: string,
    hash: string,
    mtime: number
  ): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO documents (category, path, title, hash, mtime, created_at, modified_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const result = stmt.run(category, path, title, hash, mtime, now, now);
    return Number(result.lastInsertRowid);
  }

  updateDocument(id: number, title: string, hash: string, mtime: number): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE documents
      SET title = ?, hash = ?, mtime = ?, modified_at = ?
      WHERE id = ?
    `);
    stmt.run(title, hash, mtime, now, id);
  }

  deactivateDocument(category: string, path: string): void {
    const stmt = this.db.prepare(`
      UPDATE documents SET active = 0, modified_at = ?
      WHERE category = ? AND path = ?
    `);
    stmt.run(new Date().toISOString(), category, path);
  }

  getDocumentsByCategory(category: string): Document[] {
    return this.db.query(`
      SELECT * FROM documents WHERE category = ? AND active = 1
    `).all(category) as Document[];
  }

  getAllActivePaths(category: string): string[] {
    const rows = this.db.query(`
      SELECT path FROM documents WHERE category = ? AND active = 1
    `).all(category) as { path: string }[];
    return rows.map(r => r.path);
  }

  // ===========================================================================
  // Vector Operations
  // ===========================================================================

  insertEmbedding(hash: string, seq: number, embedding: Float32Array, model: string): void {
    const hashSeq = `${hash}:${seq}`;
    const now = new Date().toISOString();

    // Insert metadata
    const metaStmt = this.db.prepare(`
      INSERT OR REPLACE INTO content_vectors (hash, seq, model, embedded_at)
      VALUES (?, ?, ?, ?)
    `);
    metaStmt.run(hash, seq, model, now);

    // Insert vector
    const vecStmt = this.db.prepare(`
      INSERT OR REPLACE INTO vectors (hash_seq, embedding)
      VALUES (?, ?)
    `);
    vecStmt.run(hashSeq, Buffer.from(embedding.buffer));
  }

  getEmbedding(hash: string, seq: number): Float32Array | null {
    const hashSeq = `${hash}:${seq}`;
    const row = this.db.query(`SELECT embedding FROM vectors WHERE hash_seq = ?`).get(hashSeq) as { embedding: Buffer } | null;
    if (!row) return null;
    return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
  }

  hasEmbedding(hash: string): boolean {
    const row = this.db.query(`SELECT 1 FROM content_vectors WHERE hash = ? LIMIT 1`).get(hash);
    return !!row;
  }

  getHashesNeedingEmbedding(): string[] {
    const rows = this.db.query(`
      SELECT DISTINCT c.hash
      FROM content c
      JOIN documents d ON c.hash = d.hash AND d.active = 1
      LEFT JOIN content_vectors cv ON c.hash = cv.hash
      WHERE cv.hash IS NULL
    `).all() as { hash: string }[];
    return rows.map(r => r.hash);
  }

  getAllEmbeddings(): { hashSeq: string; embedding: Float32Array }[] {
    const rows = this.db.query(`SELECT hash_seq, embedding FROM vectors`).all() as { hash_seq: string; embedding: Buffer }[];
    return rows.map(r => ({
      hashSeq: r.hash_seq,
      embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.length / 4),
    }));
  }

  // ===========================================================================
  // Search Operations
  // ===========================================================================

  searchFTS(query: string, limit: number = 20, category?: string, after?: number, before?: number): SearchResult[] {
    let sql = `
      SELECT
        d.id,
        d.category,
        d.path,
        d.title,
        c.doc as body,
        bm25(documents_fts) as score
      FROM documents_fts f
      JOIN documents d ON f.rowid = d.id
      JOIN content c ON d.hash = c.hash
      WHERE documents_fts MATCH ?
        AND d.active = 1
    `;

    const params: (string | number)[] = [query];

    if (category) {
      sql += ` AND d.category = ?`;
      params.push(category);
    }

    if (after) {
      sql += ` AND d.mtime >= ?`;
      params.push(after);
    }

    if (before) {
      sql += ` AND d.mtime <= ?`;
      params.push(before);
    }

    sql += ` ORDER BY bm25(documents_fts) LIMIT ?`;
    params.push(limit);

    const rows = this.db.query(sql).all(...params) as {
      id: number;
      category: string;
      path: string;
      title: string;
      body: string;
      score: number;
    }[];

    return rows.map(r => ({
      filepath: `${r.category}/${r.path}`,
      title: r.title,
      body: r.body,
      score: Math.abs(r.score), // BM25 returns negative scores
      source: "fts" as const,
      category: r.category,
    }));
  }

  // ===========================================================================
  // Status Operations
  // ===========================================================================

  getStatus(): IndexStatus {
    const totalRow = this.db.query(`
      SELECT COUNT(*) as count FROM documents WHERE active = 1
    `).get() as { count: number };

    const categoryRows = this.db.query(`
      SELECT category, COUNT(*) as count
      FROM documents
      WHERE active = 1
      GROUP BY category
    `).all() as { category: string; count: number }[];

    const needsEmbeddingRow = this.db.query(`
      SELECT COUNT(DISTINCT c.hash) as count
      FROM content c
      JOIN documents d ON c.hash = d.hash AND d.active = 1
      LEFT JOIN content_vectors cv ON c.hash = cv.hash
      WHERE cv.hash IS NULL
    `).get() as { count: number };

    const lastModifiedRow = this.db.query(`
      SELECT MAX(modified_at) as last FROM documents WHERE active = 1
    `).get() as { last: string | null };

    const categories: Record<string, number> = {};
    for (const row of categoryRows) {
      categories[row.category] = row.count;
    }

    return {
      total_docs: totalRow.count,
      categories,
      needs_embedding: needsEmbeddingRow.count,
      last_modified: lastModifiedRow.last,
    };
  }

  // ===========================================================================
  // Cleanup Operations
  // ===========================================================================

  deleteInactiveDocuments(): number {
    const result = this.db.exec(`DELETE FROM documents WHERE active = 0`);
    return 0; // bun:sqlite doesn't return affected rows easily
  }

  cleanupOrphanedContent(): number {
    this.db.exec(`
      DELETE FROM content WHERE hash NOT IN (
        SELECT DISTINCT hash FROM documents
      )
    `);
    return 0;
  }

  cleanupOrphanedVectors(): number {
    this.db.exec(`
      DELETE FROM vectors WHERE hash_seq NOT IN (
        SELECT hash || ':' || seq FROM content_vectors
      )
    `);
    this.db.exec(`
      DELETE FROM content_vectors WHERE hash NOT IN (
        SELECT DISTINCT hash FROM documents WHERE active = 1
      )
    `);
    return 0;
  }

  vacuum(): void {
    this.db.exec("VACUUM");
  }
}

// =============================================================================
// Hash Utilities
// =============================================================================

export function hashContent(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

// =============================================================================
// Default Store Instance
// =============================================================================

let defaultStore: Store | null = null;

export function getStore(): Store {
  if (!defaultStore) {
    ensureCacheDir();
    defaultStore = new Store();
  }
  return defaultStore;
}

export function closeStore(): void {
  if (defaultStore) {
    defaultStore.close();
    defaultStore = null;
  }
}
