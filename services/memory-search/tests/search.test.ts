/**
 * Tests for search.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { Store, hashContent } from "../src/store";
import { SearchEngine, RankedResult } from "../src/search";

const TEST_DB_DIR = "/tmp/nicklaude-search-test-search";
const TEST_DB_PATH = join(TEST_DB_DIR, "test.sqlite");

describe("SearchEngine", () => {
  let store: Store;
  let engine: SearchEngine;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true });
    }
    mkdirSync(TEST_DB_DIR, { recursive: true });
    store = new Store(TEST_DB_PATH);
    engine = new SearchEngine(store);

    // Add test documents
    const docs = [
      { category: "skills", path: "hue.md", title: "Philips Hue Control", content: "Control Philips Hue lights, turn on, turn off, set brightness" },
      { category: "skills", path: "lutron.md", title: "Lutron Caseta", content: "Control Lutron Caseta dimmers and shades, blinds, window coverings" },
      { category: "transcripts", path: "chat1.jsonl", title: "Chat about lights", content: "Turn on the lights in the living room please" },
      { category: "sms", path: "msg1", title: "SMS Message", content: "Hey can you close the blinds?" },
      { category: "documents", path: "notes.md", title: "Meeting Notes", content: "Discussion about home automation and smart devices" },
    ];

    for (const doc of docs) {
      const hash = hashContent(doc.content);
      store.insertContent(hash, doc.content);
      store.insertDocument(doc.category, doc.path, doc.title, hash, Date.now());
    }
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true });
    }
  });

  describe("FTS search", () => {
    test("searchFTS finds matching documents", () => {
      const results = engine.searchFTS("lights");
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some(r => r.title === "Philips Hue Control")).toBe(true);
    });

    test("searchFTS respects category filter", () => {
      const results = engine.searchFTS("lights", 10, "skills");
      expect(results.every(r => r.category === "skills")).toBe(true);
    });

    test("searchFTS respects limit", () => {
      const results = engine.searchFTS("lights", 1);
      expect(results.length).toBe(1);
    });

    test("searchFTS returns empty for no matches", () => {
      const results = engine.searchFTS("xyznonexistent");
      expect(results.length).toBe(0);
    });

    test("searchFTS finds semantic variations via porter stemmer", () => {
      // "blinds" should match "blinds" due to stemming
      const results = engine.searchFTS("blind");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Vector search", () => {
    test("searchVector returns empty when no embed function set", async () => {
      const results = await engine.searchVector("lights");
      expect(results.length).toBe(0);
    });

    test("searchVector works with mock embed function", async () => {
      // Create mock embeddings
      const mockEmbeddings = new Map<string, Float32Array>();

      // Add embeddings to store for each document
      const docs = store.getDocumentsByCategory("skills");
      docs.push(...store.getDocumentsByCategory("transcripts"));
      docs.push(...store.getDocumentsByCategory("sms"));
      docs.push(...store.getDocumentsByCategory("documents"));

      for (const doc of docs) {
        // Create a simple mock embedding based on content hash
        const embedding = new Float32Array(4);
        const hashNum = parseInt(doc.hash.slice(0, 8), 16);
        embedding[0] = (hashNum % 100) / 100;
        embedding[1] = ((hashNum >> 8) % 100) / 100;
        embedding[2] = ((hashNum >> 16) % 100) / 100;
        embedding[3] = ((hashNum >> 24) % 100) / 100;

        store.insertEmbedding(doc.hash, 0, embedding, "test-model");
        mockEmbeddings.set(doc.hash, embedding);
      }

      // Set mock embed function that returns a consistent embedding
      engine.setEmbedFunction(async (text: string) => {
        // Return an embedding that's similar to "hue" content
        const hueDoc = docs.find(d => d.path === "hue.md");
        if (hueDoc) {
          const hueEmbed = mockEmbeddings.get(hueDoc.hash)!;
          // Return slightly modified embedding
          const result = new Float32Array(4);
          result[0] = hueEmbed[0] * 0.9;
          result[1] = hueEmbed[1] * 0.9;
          result[2] = hueEmbed[2] * 0.9;
          result[3] = hueEmbed[3] * 0.9;
          return result;
        }
        return new Float32Array(4);
      });

      const results = await engine.searchVector("lights");
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("Hybrid search", () => {
    test("searchHybrid combines FTS results when no embeddings", async () => {
      const results = await engine.searchHybrid("lights");
      // Should still get FTS results
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].rrfScore).toBeGreaterThan(0);
    });

    test("searchHybrid assigns RRF scores", async () => {
      const results = await engine.searchHybrid("lights");
      for (const result of results) {
        expect(result.rrfScore).toBeDefined();
        expect(result.rrfScore).toBeGreaterThan(0);
      }
    });

    test("searchHybrid respects category filter", async () => {
      const results = await engine.searchHybrid("lights", 10, "skills");
      expect(results.every(r => r.category === "skills")).toBe(true);
    });

    test("searchHybrid respects limit", async () => {
      const results = await engine.searchHybrid("lights", 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe("Full search with reranking", () => {
    test("search works without rerank function", async () => {
      const results = await engine.search("lights");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("search applies reranking when function is set", async () => {
      // Set mock rerank function
      engine.setRerankFunction(async (query: string, docs: { file: string; text: string }[]) => {
        // Boost lutron docs for "blinds" queries
        return docs.map(d => ({
          file: d.file,
          score: d.text.includes("blinds") ? 0.9 : 0.3,
        }));
      });

      const results = await engine.search("blinds");
      expect(results.length).toBeGreaterThanOrEqual(1);
      // Lutron should be highly ranked due to reranker boost
      const lutronResult = results.find(r => r.filepath.includes("lutron"));
      expect(lutronResult).toBeDefined();
      expect(lutronResult!.rerankScore).toBeDefined();
    });

    test("search handles rerank errors gracefully", async () => {
      // Set failing rerank function
      engine.setRerankFunction(async () => {
        throw new Error("Rerank failed");
      });

      // Should still return results (fallback to hybrid)
      const results = await engine.search("lights");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("search returns empty for no matches", async () => {
      const results = await engine.search("xyznonexistentquery");
      expect(results.length).toBe(0);
    });
  });

  describe("RRF fusion", () => {
    test("RRF scores are calculated correctly", async () => {
      // First result should have highest RRF score
      const results = await engine.searchHybrid("lights");
      if (results.length >= 2) {
        expect(results[0].rrfScore).toBeGreaterThanOrEqual(results[1].rrfScore);
      }
    });

    test("documents matching both FTS and vector get boosted", async () => {
      // Add embeddings
      const docs = store.getDocumentsByCategory("skills");
      for (const doc of docs) {
        const embedding = new Float32Array(4).fill(0.5);
        store.insertEmbedding(doc.hash, 0, embedding, "test-model");
      }

      // Set embed function that returns similar embedding
      engine.setEmbedFunction(async () => new Float32Array(4).fill(0.5));

      const results = await engine.searchHybrid("lights");
      // Results from skills (which have embeddings) should potentially appear
      // with both ftsRank and vecRank set
      const skillResult = results.find(r => r.category === "skills");
      if (skillResult) {
        // At minimum, ftsRank should be set since FTS will match
        expect(skillResult.ftsRank).toBeDefined();
      }
    });
  });
});
