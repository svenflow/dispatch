#!/usr/bin/env bun
/**
 * Profile smart chunk selection timing and accuracy.
 */

import { getStore, closeStore } from "./src/store";
import { SearchEngine } from "./src/search";
import { createEmbedFunction, createRerankFunction, warmupModels, disposeLLM, rerank } from "./src/llm";
import { ensureCacheDir } from "./src/config";

async function main() {
  console.log("=== Smart chunk selection profiling ===\n");

  ensureCacheDir();
  const store = getStore();

  // Clear cache to test cold
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

  // Test 1: FTS only
  console.log("--- FTS only ---");
  let start = performance.now();
  const ftsResults = searchEngine.searchFTS(query, 10);
  console.log(`FTS: ${(performance.now() - start).toFixed(2)}ms (${ftsResults.length} results)`);

  // Test 2: Full search with smart chunks - COLD
  console.log("\n--- Full search COLD (smart chunk selection) ---");
  start = performance.now();
  const coldResults = await searchEngine.search(query, 10);
  const coldTime = performance.now() - start;
  console.log(`Cold: ${coldTime.toFixed(2)}ms (${coldResults.length} results)`);

  // Show chunk indices
  console.log("\nBest chunk indices selected:");
  coldResults.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.filepath.slice(0, 50)}... chunk ${r.bestChunkIdx ?? "N/A"}`);
  });

  // Test 3: Full search - WARM
  console.log("\n--- Full search WARM (cached) ---");
  start = performance.now();
  const warmResults = await searchEngine.search(query, 10);
  const warmTime = performance.now() - start;
  console.log(`Warm: ${warmTime.toFixed(2)}ms (${warmResults.length} results)`);

  // Test 4: Different query COLD
  console.log("\n--- Different query COLD ---");
  start = performance.now();
  const newResults = await searchEngine.search("how to control home", 10);
  console.log(`New query cold: ${(performance.now() - start).toFixed(2)}ms (${newResults.length} results)`);

  // Cache stats
  console.log("\n--- Cache stats ---");
  const stats = store.getCacheStats();
  console.log(`Cache entries: ${stats.count}`);

  closeStore();
  await disposeLLM();

  console.log("\n=== Summary ===");
  console.log(`Cold search: ${coldTime.toFixed(0)}ms`);
  console.log(`Warm search: ${warmTime.toFixed(0)}ms`);
}

main().catch(console.error);
