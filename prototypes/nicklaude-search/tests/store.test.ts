/**
 * Tests for store.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { Store, hashContent } from "../src/store";

const TEST_DB_DIR = "/tmp/nicklaude-search-test";
const TEST_DB_PATH = join(TEST_DB_DIR, "test.sqlite");

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true });
    }
    mkdirSync(TEST_DB_DIR, { recursive: true });
    store = new Store(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true });
    }
  });

  describe("hashContent", () => {
    test("returns consistent hash for same content", () => {
      const content = "Hello, world!";
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);
      expect(hash1).toBe(hash2);
    });

    test("returns different hash for different content", () => {
      const hash1 = hashContent("Hello");
      const hash2 = hashContent("World");
      expect(hash1).not.toBe(hash2);
    });

    test("returns 64-char hex string (sha256)", () => {
      const hash = hashContent("test");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("content operations", () => {
    test("insertContent and getContent", () => {
      const content = "Test document content";
      const hash = hashContent(content);

      store.insertContent(hash, content);
      const retrieved = store.getContent(hash);

      expect(retrieved).toBe(content);
    });

    test("getContent returns null for non-existent hash", () => {
      const result = store.getContent("nonexistent");
      expect(result).toBeNull();
    });

    test("insertContent is idempotent", () => {
      const content = "Duplicate content";
      const hash = hashContent(content);

      store.insertContent(hash, content);
      store.insertContent(hash, content); // Should not throw

      const retrieved = store.getContent(hash);
      expect(retrieved).toBe(content);
    });
  });

  describe("document operations", () => {
    test("insertDocument and findDocument", () => {
      const content = "Document body";
      const hash = hashContent(content);
      store.insertContent(hash, content);

      const id = store.insertDocument("skills", "test/doc.md", "Test Doc", hash, Date.now());

      const doc = store.findDocument("skills", "test/doc.md");
      expect(doc).not.toBeNull();
      expect(doc!.id).toBe(id);
      expect(doc!.title).toBe("Test Doc");
      expect(doc!.hash).toBe(hash);
      expect(doc!.active).toBe(1);
    });

    test("findDocument returns null for non-existent document", () => {
      const result = store.findDocument("skills", "nonexistent.md");
      expect(result).toBeNull();
    });

    test("updateDocument changes title and hash", () => {
      const content1 = "Original content";
      const hash1 = hashContent(content1);
      store.insertContent(hash1, content1);

      const content2 = "Updated content";
      const hash2 = hashContent(content2);
      store.insertContent(hash2, content2);

      const id = store.insertDocument("docs", "file.md", "Original", hash1, 1000);

      store.updateDocument(id, "Updated", hash2, 2000);

      const doc = store.findDocument("docs", "file.md");
      expect(doc!.title).toBe("Updated");
      expect(doc!.hash).toBe(hash2);
      expect(doc!.mtime).toBe(2000);
    });

    test("deactivateDocument sets active to 0", () => {
      const content = "To be deactivated";
      const hash = hashContent(content);
      store.insertContent(hash, content);

      store.insertDocument("transcripts", "chat.jsonl", "Chat", hash, Date.now());

      store.deactivateDocument("transcripts", "chat.jsonl");

      const doc = store.findDocument("transcripts", "chat.jsonl");
      expect(doc).toBeNull(); // findDocument only returns active docs
    });

    test("getDocumentsByCategory returns only active documents", () => {
      const content = "Content";
      const hash = hashContent(content);
      store.insertContent(hash, content);

      store.insertDocument("skills", "doc1.md", "Doc 1", hash, Date.now());
      store.insertDocument("skills", "doc2.md", "Doc 2", hash, Date.now());
      store.insertDocument("other", "doc3.md", "Doc 3", hash, Date.now());

      store.deactivateDocument("skills", "doc2.md");

      const docs = store.getDocumentsByCategory("skills");
      expect(docs.length).toBe(1);
      expect(docs[0].path).toBe("doc1.md");
    });

    test("getAllActivePaths returns paths for category", () => {
      const content = "Content";
      const hash = hashContent(content);
      store.insertContent(hash, content);

      store.insertDocument("skills", "a.md", "A", hash, Date.now());
      store.insertDocument("skills", "b.md", "B", hash, Date.now());
      store.insertDocument("docs", "c.md", "C", hash, Date.now());

      const paths = store.getAllActivePaths("skills");
      expect(paths).toContain("a.md");
      expect(paths).toContain("b.md");
      expect(paths).not.toContain("c.md");
    });
  });

  describe("embedding operations", () => {
    test("insertEmbedding and getEmbedding", () => {
      const hash = "testhash";
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

      store.insertEmbedding(hash, 0, embedding, "test-model");

      const retrieved = store.getEmbedding(hash, 0);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.length).toBe(4);
      expect(retrieved![0]).toBeCloseTo(0.1);
      expect(retrieved![3]).toBeCloseTo(0.4);
    });

    test("hasEmbedding returns true when embedding exists", () => {
      const hash = "embedhash";
      const embedding = new Float32Array([1, 2, 3]);

      expect(store.hasEmbedding(hash)).toBe(false);

      store.insertEmbedding(hash, 0, embedding, "model");

      expect(store.hasEmbedding(hash)).toBe(true);
    });

    test("getHashesNeedingEmbedding returns hashes without embeddings", () => {
      const content1 = "Content with embedding";
      const hash1 = hashContent(content1);
      store.insertContent(hash1, content1);
      store.insertDocument("docs", "doc1.md", "Doc1", hash1, Date.now());
      store.insertEmbedding(hash1, 0, new Float32Array([1, 2]), "model");

      const content2 = "Content without embedding";
      const hash2 = hashContent(content2);
      store.insertContent(hash2, content2);
      store.insertDocument("docs", "doc2.md", "Doc2", hash2, Date.now());

      const needsEmbedding = store.getHashesNeedingEmbedding();
      expect(needsEmbedding).toContain(hash2);
      expect(needsEmbedding).not.toContain(hash1);
    });
  });

  describe("FTS search", () => {
    beforeEach(() => {
      // Add some test documents
      const content1 = "The quick brown fox jumps over the lazy dog";
      const hash1 = hashContent(content1);
      store.insertContent(hash1, content1);
      store.insertDocument("docs", "fox.md", "Fox Story", hash1, Date.now());

      const content2 = "Python is a programming language";
      const hash2 = hashContent(content2);
      store.insertContent(hash2, content2);
      store.insertDocument("docs", "python.md", "Python Guide", hash2, Date.now());

      const content3 = "JavaScript is also a programming language";
      const hash3 = hashContent(content3);
      store.insertContent(hash3, content3);
      store.insertDocument("skills", "js.md", "JS Guide", hash3, Date.now());
    });

    test("searchFTS finds matching documents", () => {
      const results = store.searchFTS("programming");
      expect(results.length).toBe(2);
      expect(results.some(r => r.title === "Python Guide")).toBe(true);
      expect(results.some(r => r.title === "JS Guide")).toBe(true);
    });

    test("searchFTS respects category filter", () => {
      const results = store.searchFTS("programming", 10, "docs");
      expect(results.length).toBe(1);
      expect(results[0].title).toBe("Python Guide");
    });

    test("searchFTS respects limit", () => {
      const results = store.searchFTS("programming", 1);
      expect(results.length).toBe(1);
    });

    test("searchFTS returns empty for no matches", () => {
      const results = store.searchFTS("nonexistent");
      expect(results.length).toBe(0);
    });
  });

  describe("status operations", () => {
    test("getStatus returns correct counts", () => {
      const content = "Content";
      const hash = hashContent(content);
      store.insertContent(hash, content);

      store.insertDocument("skills", "a.md", "A", hash, Date.now());
      store.insertDocument("skills", "b.md", "B", hash, Date.now());
      store.insertDocument("docs", "c.md", "C", hash, Date.now());

      // Add embedding to one
      store.insertEmbedding(hash, 0, new Float32Array([1, 2]), "model");

      const status = store.getStatus();
      expect(status.total_docs).toBe(3);
      expect(status.categories["skills"]).toBe(2);
      expect(status.categories["docs"]).toBe(1);
      // Note: needs_embedding might be 0 because all docs share same hash with embedding
    });
  });
});
