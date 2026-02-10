#!/usr/bin/env bun
/**
 * Full profile: single row index + hybrid search with reranking.
 */

import { getStore, closeStore, hashContent } from "./src/store";
import { SearchEngine } from "./src/search";
import { createEmbedFunction, createRerankFunction, warmupModels, disposeLLM } from "./src/llm";
import { ensureCacheDir } from "./src/config";

async function main() {
  console.log("=== jsmith-search FULL performance profile ===\n");

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
  console.log(`Single row index: ${indexTime.toFixed(2)}ms\n`);

  // --- LLM Model Loading ---
  console.log("--- LLM Model Loading (cold) ---");
  const warmStart = performance.now();
  await warmupModels();
  const warmTime = performance.now() - warmStart;
  console.log(`Model warmup: ${warmTime.toFixed(2)}ms\n`);

  // Set LLM functions on search engine
  searchEngine.setEmbedFunction(createEmbedFunction());
  searchEngine.setRerankFunction(createRerankFunction());

  // --- Search Performance ---
  const queries = [
    "lights",
    "what did we talk about last week",
    "how to control smart home",
  ];

  // FTS only
  console.log("--- FTS (BM25) only ---");
  for (const query of queries) {
    const start = performance.now();
    const results = searchEngine.searchFTS(query, 10);
    const time = performance.now() - start;
    console.log(`"${query}": ${time.toFixed(2)}ms (${results.length} results)`);
  }

  // Full search with reranking - COLD
  console.log("\n--- Full Search (Hybrid + Reranker) - FIRST RUN ---");
  for (const query of queries) {
    const start = performance.now();
    try {
      const results = await searchEngine.search(query, 10);
      const time = performance.now() - start;
      console.log(`"${query}": ${time.toFixed(2)}ms (${results.length} results)`);
    } catch (e: any) {
      const time = performance.now() - start;
      console.log(`"${query}": ${time.toFixed(2)}ms (error: ${e.message || e})`);
    }
  }

  // Full search - WARM
  console.log("\n--- Full Search (Hybrid + Reranker) - WARM ---");
  for (const query of queries) {
    const start = performance.now();
    try {
      const results = await searchEngine.search(query, 10);
      const time = performance.now() - start;
      console.log(`"${query}": ${time.toFixed(2)}ms (${results.length} results)`);
    } catch (e: any) {
      const time = performance.now() - start;
      console.log(`"${query}": ${time.toFixed(2)}ms (error: ${e.message || e})`);
    }
  }

  // Cleanup
  store.deactivateDocument(testCategory, testPath);
  closeStore();
  await disposeLLM();

  console.log("\n=== Profile complete ===");
}

main().catch(console.error);
