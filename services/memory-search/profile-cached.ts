#!/usr/bin/env bun
/**
 * Profile with caching and different configurations.
 */

import { getStore, closeStore, hashContent } from "./src/store";
import { SearchEngine } from "./src/search";
import { createEmbedFunction, createRerankFunction, warmupModels, disposeLLM, rerank } from "./src/llm";
import { ensureCacheDir } from "./src/config";

async function main() {
  console.log("=== Cached search + config variants ===\n");

  ensureCacheDir();
  const store = getStore();

  // Clear cache to start fresh
  store.clearCache();
  console.log("Cache cleared\n");

  const searchEngine = new SearchEngine(store);

  // Warmup
  console.log("Warming up models...");
  await warmupModels();
  console.log("Models warm\n");

  searchEngine.setEmbedFunction(createEmbedFunction());
  searchEngine.setRerankFunction(createRerankFunction());

  const query = "lights";

  // === Test 1: FTS only (no reranker) ===
  console.log("--- FTS only (no reranker) ---");
  let start = performance.now();
  const ftsResults = searchEngine.searchFTS(query, 10);
  console.log(`FTS: ${(performance.now() - start).toFixed(2)}ms (${ftsResults.length} results)`);

  // === Test 2: Full search - COLD (no cache) ===
  console.log("\n--- Full search COLD (500 char snippets, 10 docs) ---");
  start = performance.now();
  const coldResults = await searchEngine.search(query, 10);
  const coldTime = performance.now() - start;
  console.log(`Cold: ${coldTime.toFixed(2)}ms (${coldResults.length} results)`);

  // === Test 3: Full search - WARM (cached) ===
  console.log("\n--- Full search WARM (same query, cached) ---");
  start = performance.now();
  const warmResults = await searchEngine.search(query, 10);
  const warmTime = performance.now() - start;
  console.log(`Warm: ${warmTime.toFixed(2)}ms (${warmResults.length} results)`);

  // === Test 4: Different query - COLD ===
  console.log("\n--- Different query COLD ---");
  start = performance.now();
  const newResults = await searchEngine.search("how to control home", 10);
  console.log(`New query cold: ${(performance.now() - start).toFixed(2)}ms (${newResults.length} results)`);

  // === Test 5: Manual rerank with fewer docs ===
  console.log("\n--- Manual rerank timing (3 docs vs 10 docs) ---");
  const docs = ftsResults.slice(0, 10).map(r => ({
    file: r.filepath,
    text: r.body.slice(0, 500),
  }));

  start = performance.now();
  await rerank("test query for 3 docs", docs.slice(0, 3));
  console.log(`Rerank 3 docs: ${(performance.now() - start).toFixed(2)}ms`);

  start = performance.now();
  await rerank("test query for 5 docs", docs.slice(0, 5));
  console.log(`Rerank 5 docs: ${(performance.now() - start).toFixed(2)}ms`);

  start = performance.now();
  await rerank("test query for 10 docs", docs.slice(0, 10));
  console.log(`Rerank 10 docs: ${(performance.now() - start).toFixed(2)}ms`);

  // === Cache stats ===
  console.log("\n--- Cache stats ---");
  const stats = store.getCacheStats();
  console.log(`Cache entries: ${stats.count}`);
  console.log(`Oldest entry: ${stats.oldestEntry}`);

  closeStore();
  await disposeLLM();

  console.log("\n=== Summary ===");
  console.log(`FTS only: ~2ms`);
  console.log(`Cold search (with rerank): ${coldTime.toFixed(0)}ms`);
  console.log(`Warm search (cached): ${warmTime.toFixed(0)}ms`);
}

main().catch(console.error);
