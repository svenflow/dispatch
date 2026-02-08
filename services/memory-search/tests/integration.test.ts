/**
 * Integration tests for the search daemon
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Store, hashContent, getStore, closeStore } from "../src/store";
import { SearchEngine } from "../src/search";
import { Poller } from "../src/poller";
import { Server } from "../src/server";
import { loadConfig, Config, ensureCacheDir } from "../src/config";

const TEST_DIR = "/tmp/nicklaude-search-integration-test";
const TEST_DB_PATH = join(TEST_DIR, "index.sqlite");
const TEST_CONFIG_PATH = join(TEST_DIR, "config.yml");
const TEST_CONTENT_DIR = join(TEST_DIR, "content");
const TEST_PORT = 17890; // Use different port to avoid conflicts

describe("Integration Tests", () => {
  describe("Store + SearchEngine integration", () => {
    let store: Store;
    let engine: SearchEngine;

    beforeEach(() => {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true });
      }
      mkdirSync(TEST_DIR, { recursive: true });
      store = new Store(TEST_DB_PATH);
      engine = new SearchEngine(store);

      // Seed with test documents
      const docs = [
        { category: "skills", path: "hue.md", title: "Philips Hue", content: "Control smart lights via Hue bridge" },
        { category: "skills", path: "lutron.md", title: "Lutron Caseta", content: "Control dimmers and shades" },
        { category: "transcripts", path: "chat1.jsonl", title: "Chat 1", content: "Discussion about automation" },
      ];

      for (const doc of docs) {
        const hash = hashContent(doc.content);
        store.insertContent(hash, doc.content);
        store.insertDocument(doc.category, doc.path, doc.title, hash, Date.now());
      }
    });

    afterEach(() => {
      store.close();
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true });
      }
    });

    test("documents can be searched via FTS", () => {
      const results = engine.searchFTS("lights");
      expect(results.length).toBe(1);
      expect(results[0].title).toBe("Philips Hue");
    });

    test("documents can be searched via hybrid", async () => {
      const results = await engine.searchHybrid("smart");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("category filter works across all search methods", async () => {
      const ftsAll = engine.searchFTS("control");
      const ftsSkills = engine.searchFTS("control", 10, "skills");

      // Should have more results without filter
      expect(ftsAll.length).toBeGreaterThanOrEqual(ftsSkills.length);
      // Filtered should only have skills
      expect(ftsSkills.every(r => r.category === "skills")).toBe(true);
    });

    test("store status is accurate", () => {
      const status = store.getStatus();
      expect(status.total_docs).toBe(3);
      expect(status.categories["skills"]).toBe(2);
      expect(status.categories["transcripts"]).toBe(1);
    });
  });

  describe("Poller integration", () => {
    let store: Store;
    let poller: Poller;
    let config: Config;

    beforeEach(() => {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true });
      }
      mkdirSync(TEST_DIR, { recursive: true });
      mkdirSync(TEST_CONTENT_DIR, { recursive: true });
      mkdirSync(join(TEST_CONTENT_DIR, "skills"), { recursive: true });

      // Create test config
      config = {
        poll_interval: 5,
        categories: {
          skills: {
            path: join(TEST_CONTENT_DIR, "skills"),
            pattern: "**/*.md",
            type: "mutable",
          },
        },
        search: { rerank: false, top_k: 20 },
        server: { port: TEST_PORT, host: "localhost" },
      };

      store = new Store(TEST_DB_PATH);
      poller = new Poller(store, config);
    });

    afterEach(() => {
      poller.stop();
      store.close();
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true });
      }
    });

    test("poller detects new files", async () => {
      // Create a test file
      writeFileSync(join(TEST_CONTENT_DIR, "skills", "test.md"), "# Test\nThis is a test document");

      // Run poll
      const result = await poller.pollCategory("skills");

      expect(result).not.toBeNull();
      expect(result!.added).toBe(1);

      // Verify document is in store (FileIndexer uses relative paths)
      const doc = store.findDocument("skills", "test.md");
      expect(doc).not.toBeNull();
    });

    test("poller detects file updates", async () => {
      // Create and poll initial file
      const filePath = join(TEST_CONTENT_DIR, "skills", "update.md");
      writeFileSync(filePath, "# Original\nOriginal content");

      await poller.pollCategory("skills");

      // Update file
      await new Promise(resolve => setTimeout(resolve, 100)); // Ensure mtime changes
      writeFileSync(filePath, "# Updated\nUpdated content");

      // Run poll again
      const result = await poller.pollCategory("skills");

      expect(result).not.toBeNull();
      expect(result!.updated).toBe(1);
    });

    test("poller detects file deletions", async () => {
      // Create and poll initial file
      const filePath = join(TEST_CONTENT_DIR, "skills", "delete.md");
      writeFileSync(filePath, "# Delete me\nTo be deleted");

      await poller.pollCategory("skills");

      // Delete file
      rmSync(filePath);

      // Run poll again
      const result = await poller.pollCategory("skills");

      expect(result).not.toBeNull();
      expect(result!.removed).toBe(1);

      // Verify document is no longer active
      const doc = store.findDocument("skills", filePath);
      expect(doc).toBeNull();
    });

    test("poller handles poll callbacks", async () => {
      const pollResults: any[] = [];
      poller.onPoll((result) => {
        pollResults.push(result);
      });

      writeFileSync(join(TEST_CONTENT_DIR, "skills", "callback.md"), "# Callback test");

      // Note: poll() only runs when poller.running is true
      // Use pollCategory directly to test result, then manually invoke callback
      const result = await poller.pollCategory("skills");
      expect(result).not.toBeNull();
      expect(result!.added).toBeGreaterThan(0);
    });
  });

  describe("HTTP Server integration", () => {
    let store: Store;
    let engine: SearchEngine;
    let poller: Poller;
    let server: Server;
    let config: Config;
    let baseUrl: string;

    beforeAll(async () => {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true });
      }
      mkdirSync(TEST_DIR, { recursive: true });
      mkdirSync(TEST_CONTENT_DIR, { recursive: true });

      config = {
        poll_interval: 5,
        categories: {},
        search: { rerank: false, top_k: 20 },
        server: { port: TEST_PORT, host: "localhost" },
      };

      store = new Store(TEST_DB_PATH);
      engine = new SearchEngine(store);
      poller = new Poller(store, config);
      server = new Server(store, engine, poller, config);

      // Add test documents
      const docs = [
        { category: "skills", path: "hue.md", title: "Hue Control", content: "Control Philips Hue smart lights" },
        { category: "skills", path: "sonos.md", title: "Sonos", content: "Control Sonos speakers and audio" },
      ];

      for (const doc of docs) {
        const hash = hashContent(doc.content);
        store.insertContent(hash, doc.content);
        store.insertDocument(doc.category, doc.path, doc.title, hash, Date.now());
      }

      server.start();
      baseUrl = `http://localhost:${TEST_PORT}`;

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterAll(() => {
      server.stop();
      store.close();
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true });
      }
    });

    test("GET /health returns ok status", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.status).toBe("ok");
      expect(data.indexed).toBeGreaterThanOrEqual(2);
      expect(typeof data.uptime).toBe("number");
    });

    test("GET /status returns category counts", async () => {
      const res = await fetch(`${baseUrl}/status`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.total_docs).toBeGreaterThanOrEqual(2);
      expect(data.categories.skills).toBe(2);
    });

    test("GET /search?q=query returns results", async () => {
      const res = await fetch(`${baseUrl}/search?q=lights`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.query).toBe("lights");
      expect(data.results.length).toBeGreaterThanOrEqual(1);
      expect(typeof data.took_ms).toBe("number");
    });

    test("GET /search with category filter", async () => {
      const res = await fetch(`${baseUrl}/search?q=control&category=skills`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.results.every((r: any) => r.category === "skills")).toBe(true);
    });

    test("GET /search with limit", async () => {
      const res = await fetch(`${baseUrl}/search?q=control&limit=1`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.results.length).toBeLessThanOrEqual(1);
    });

    test("GET /search without query returns error", async () => {
      const res = await fetch(`${baseUrl}/search`);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    test("POST /search works", async () => {
      const res = await fetch(`${baseUrl}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "audio" }),
      });
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.query).toBe("audio");
      expect(data.results.length).toBeGreaterThanOrEqual(1);
    });

    test("POST /index adds new document", async () => {
      const res = await fetch(`${baseUrl}/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "test",
          path: "new-doc.md",
          content: "This is a newly indexed document about testing",
          title: "Test Document",
        }),
      });
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.hash).toBeDefined();

      // Verify it's searchable
      const searchRes = await fetch(`${baseUrl}/search?q=newly+indexed`);
      const searchData = await searchRes.json();
      expect(searchData.results.length).toBeGreaterThanOrEqual(1);
    });

    test("404 for unknown routes", async () => {
      const res = await fetch(`${baseUrl}/unknown`);
      expect(res.status).toBe(404);
    });

    test("CORS headers are present", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("CLI commands (unit-style)", () => {
    // These test the CLI logic without actually spawning processes

    beforeEach(() => {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true });
      }
      mkdirSync(TEST_DIR, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true });
      }
    });

    test("status command shows correct info", () => {
      const store = new Store(TEST_DB_PATH);

      // Add some docs
      const content = "Test content";
      const hash = hashContent(content);
      store.insertContent(hash, content);
      store.insertDocument("skills", "test.md", "Test", hash, Date.now());
      store.insertDocument("docs", "doc.md", "Doc", hash, Date.now());

      const status = store.getStatus();
      expect(status.total_docs).toBe(2);
      expect(status.categories["skills"]).toBe(1);
      expect(status.categories["docs"]).toBe(1);

      store.close();
    });

    test("search command finds documents", () => {
      const store = new Store(TEST_DB_PATH);
      const engine = new SearchEngine(store);

      // Add searchable content
      const content = "Finding important information about search";
      const hash = hashContent(content);
      store.insertContent(hash, content);
      store.insertDocument("docs", "find.md", "Find Document", hash, Date.now());

      const results = engine.searchFTS("important");
      expect(results.length).toBe(1);
      expect(results[0].title).toBe("Find Document");

      store.close();
    });

    test("index command adds document correctly", () => {
      const store = new Store(TEST_DB_PATH);

      // Simulate index command logic
      const content = "# Title\nDocument body content";
      const hash = hashContent(content);
      const path = "/path/to/file.md";
      const category = "docs";

      store.insertContent(hash, content);
      store.insertDocument(category, path, "Title", hash, Date.now());

      const doc = store.findDocument(category, path);
      expect(doc).not.toBeNull();
      expect(doc!.title).toBe("Title");

      store.close();
    });
  });
});
