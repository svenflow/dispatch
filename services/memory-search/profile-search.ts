#!/usr/bin/env bun
/**
 * Profile search and single-row indexing performance.
 */

import { getStore, closeStore, hashContent } from "./src/store";
import { SearchEngine } from "./src/search";
import { ensureCacheDir } from "./src/config";

async function main() {
  console.log("=== nicklaude-search performance profile ===\n");

  ensureCacheDir();
  const store = getStore();
  const searchEngine = new SearchEngine(store);

  // --- Single row index time ---
  console.log("--- Single Row Index Time ---");
  const testContent = `This is a test message for profiling.
  It contains some text about lights, home automation, and scheduling.
  The quick brown fox jumps over the lazy dog.
  Testing search indexing performance at ${new Date().toISOString()}.`;
  const testTitle = "Profile Test Document";
  const testCategory = "test";
  const testPath = `test-${Date.now()}.txt`;

  const indexStart = performance.now();
  const hash = hashContent(testContent);
  store.insertContent(hash, testContent);
  store.insertDocument(testCategory, testPath, testTitle, hash, Date.now());
  const indexTime = performance.now() - indexStart;
  console.log(`Single row index: ${indexTime.toFixed(2)}ms`);

  // --- Search Performance ---
  console.log("\n--- Search Performance (cold start) ---");

  const queries = [
    "lights",
    "meeting notes",
    "how to control smart home",
  ];

  // FTS only
  console.log("\nFTS (BM25) only:");
  for (const query of queries) {
    const start = performance.now();
    const results = store.searchFTS(query, 10);
    const time = performance.now() - start;
    console.log(`  "${query}": ${time.toFixed(2)}ms (${results.length} results)`);
  }

  // Hybrid search (FTS + Vector, no reranker yet since embeddings may not exist)
  console.log("\nHybrid search (FTS + Vector):");
  for (const query of queries) {
    const start = performance.now();
    try {
      const results = await searchEngine.hybridSearch(query, { limit: 10 });
      const time = performance.now() - start;
      console.log(`  "${query}": ${time.toFixed(2)}ms (${results.length} results)`);
    } catch (e) {
      const time = performance.now() - start;
      console.log(`  "${query}": ${time.toFixed(2)}ms (error: ${e})`);
    }
  }

  // Full search with reranking
  console.log("\nFull search (Hybrid + Reranker) - COLD:");
  for (const query of queries) {
    const start = performance.now();
    try {
      const results = await searchEngine.search(query, { limit: 10 });
      const time = performance.now() - start;
      console.log(`  "${query}": ${time.toFixed(2)}ms (${results.length} results)`);
    } catch (e) {
      const time = performance.now() - start;
      console.log(`  "${query}": ${time.toFixed(2)}ms (error: ${e})`);
    }
  }

  // Warm search
  console.log("\nFull search (Hybrid + Reranker) - WARM:");
  for (const query of queries) {
    const start = performance.now();
    try {
      const results = await searchEngine.search(query, { limit: 10 });
      const time = performance.now() - start;
      console.log(`  "${query}": ${time.toFixed(2)}ms (${results.length} results)`);
    } catch (e) {
      const time = performance.now() - start;
      console.log(`  "${query}": ${time.toFixed(2)}ms (error: ${e})`);
    }
  }

  // Cleanup test document
  store.deactivateDocument(testCategory, testPath);

  closeStore();
  console.log("\n=== Profile complete ===");
}

main().catch(console.error);
