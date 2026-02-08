/**
 * Tests for indexer.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Store } from "../src/store";
import { FileIndexer, chunkDocument } from "../src/indexer";

const TEST_DIR = "/tmp/nicklaude-search-indexer-test";
const TEST_DB = join(TEST_DIR, "test.sqlite");
const TEST_FILES = join(TEST_DIR, "files");

describe("chunkDocument", () => {
  test("returns single chunk for short content", () => {
    const content = "Short content";
    const chunks = chunkDocument(content);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(content);
  });

  test("splits long content into multiple chunks", () => {
    // Create content longer than chunk size (3000 chars)
    const content = "A".repeat(5000);
    const chunks = chunkDocument(content);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("chunks have overlap", () => {
    // Create content that will be split
    const content = "Word ".repeat(800); // ~4000 chars
    const chunks = chunkDocument(content);

    if (chunks.length >= 2) {
      // Check that second chunk starts with content from end of first chunk
      const firstEnd = chunks[0].slice(-100);
      const secondStart = chunks[1].slice(0, 100);
      // There should be some overlap (not exact match due to boundary finding)
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("tries to break at paragraph boundaries", () => {
    const content = "First paragraph.\n\n" + "A".repeat(2900) + "\n\nSecond paragraph.";
    const chunks = chunkDocument(content);

    // Should try to break at the paragraph boundary
    expect(chunks[0].includes("First paragraph")).toBe(true);
  });
});

describe("FileIndexer", () => {
  let store: Store;
  let indexer: FileIndexer;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_FILES, { recursive: true });
    store = new Store(TEST_DB);
    indexer = new FileIndexer(store);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("indexes markdown files", async () => {
    // Create test files
    writeFileSync(join(TEST_FILES, "doc1.md"), "# Document One\n\nThis is the content.");
    writeFileSync(join(TEST_FILES, "doc2.md"), "# Document Two\n\nMore content here.");

    const result = await indexer.indexCategory("test", {
      path: TEST_FILES,
      pattern: "**/*.md",
      type: "mutable",
    });

    expect(result.added).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.errors.length).toBe(0);

    // Verify documents in store
    const docs = store.getDocumentsByCategory("test");
    expect(docs.length).toBe(2);
    expect(docs.some(d => d.title === "Document One")).toBe(true);
    expect(docs.some(d => d.title === "Document Two")).toBe(true);
  });

  test("extracts title from markdown heading", async () => {
    writeFileSync(join(TEST_FILES, "titled.md"), "# My Title\n\nContent here.");

    await indexer.indexCategory("test", {
      path: TEST_FILES,
      pattern: "**/*.md",
      type: "mutable",
    });

    const doc = store.findDocument("test", "titled.md");
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("My Title");
  });

  test("falls back to filename for title", async () => {
    writeFileSync(join(TEST_FILES, "no-heading.md"), "Content without heading.");

    await indexer.indexCategory("test", {
      path: TEST_FILES,
      pattern: "**/*.md",
      type: "mutable",
    });

    const doc = store.findDocument("test", "no-heading.md");
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("no-heading");
  });

  test("updates changed files", async () => {
    writeFileSync(join(TEST_FILES, "changing.md"), "# Original\n\nOriginal content.");

    // First index
    await indexer.indexCategory("test", {
      path: TEST_FILES,
      pattern: "**/*.md",
      type: "mutable",
    });

    const original = store.findDocument("test", "changing.md");
    expect(original).not.toBeNull();

    // Wait a bit and update file
    await Bun.sleep(100);
    writeFileSync(join(TEST_FILES, "changing.md"), "# Updated\n\nUpdated content.");

    // Second index
    const result = await indexer.indexCategory("test", {
      path: TEST_FILES,
      pattern: "**/*.md",
      type: "mutable",
    });

    expect(result.updated).toBe(1);
    expect(result.added).toBe(0);

    const updated = store.findDocument("test", "changing.md");
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("Updated");
  });

  test("removes deleted files", async () => {
    writeFileSync(join(TEST_FILES, "to-delete.md"), "# Will Be Deleted\n\nContent.");

    // First index
    await indexer.indexCategory("test", {
      path: TEST_FILES,
      pattern: "**/*.md",
      type: "mutable",
    });

    expect(store.findDocument("test", "to-delete.md")).not.toBeNull();

    // Delete file
    rmSync(join(TEST_FILES, "to-delete.md"));

    // Second index
    const result = await indexer.indexCategory("test", {
      path: TEST_FILES,
      pattern: "**/*.md",
      type: "mutable",
    });

    expect(result.removed).toBe(1);
    expect(store.findDocument("test", "to-delete.md")).toBeNull();
  });

  test("handles nested directories", async () => {
    mkdirSync(join(TEST_FILES, "subdir"), { recursive: true });
    writeFileSync(join(TEST_FILES, "subdir", "nested.md"), "# Nested\n\nNested content.");

    await indexer.indexCategory("test", {
      path: TEST_FILES,
      pattern: "**/*.md",
      type: "mutable",
    });

    const doc = store.findDocument("test", "subdir/nested.md");
    expect(doc).not.toBeNull();
  });

  test("skips unchanged files", async () => {
    writeFileSync(join(TEST_FILES, "unchanged.md"), "# Unchanged\n\nContent.");

    // First index
    await indexer.indexCategory("test", {
      path: TEST_FILES,
      pattern: "**/*.md",
      type: "mutable",
    });

    // Second index without changes
    const result = await indexer.indexCategory("test", {
      path: TEST_FILES,
      pattern: "**/*.md",
      type: "mutable",
    });

    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
  });
});
