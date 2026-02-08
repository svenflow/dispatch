#!/usr/bin/env bun
/**
 * Quick profile - just one search with fewer docs.
 */

import { getStore, closeStore } from "./src/store";
import { SearchEngine } from "./src/search";
import { createEmbedFunction, createRerankFunction, warmupModels, disposeLLM } from "./src/llm";
import { ensureCacheDir } from "./src/config";

async function main() {
  console.log("=== Quick profile (5 docs only) ===\n");

  ensureCacheDir();
  const store = getStore();
  store.clearCache();

  const searchEngine = new SearchEngine(store);

  // Warmup
  console.log("Warming up models...");
  await warmupModels();
  console.log("Models warm\n");

  searchEngine.setEmbedFunction(createEmbedFunction());
  searchEngine.setRerankFunction(createRerankFunction());

  // FTS only
  console.log("--- FTS only ---");
  let start = performance.now();
  const ftsResults = searchEngine.searchFTS("lights", 5);
  console.log(`FTS: ${(performance.now() - start).toFixed(2)}ms (${ftsResults.length} results)`);

  // Full search - limit to 5
  console.log("\n--- Full search COLD (5 docs, smart chunks) ---");
  start = performance.now();
  const results = await searchEngine.search("lights", 5);
  const coldTime = performance.now() - start;
  console.log(`Cold: ${coldTime.toFixed(2)}ms (${results.length} results)`);

  // Show which chunks were selected
  console.log("\nResults with chunk indices:");
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. chunk ${r.bestChunkIdx ?? 0} - ${r.filepath.slice(0, 60)}...`);
  });

  // Warm
  console.log("\n--- Full search WARM ---");
  start = performance.now();
  const warmResults = await searchEngine.search("lights", 5);
  const warmTime = performance.now() - start;
  console.log(`Warm: ${warmTime.toFixed(2)}ms`);

  closeStore();
  await disposeLLM();

  console.log(`\n=== Summary ===`);
  console.log(`Cold (5 docs): ${coldTime.toFixed(0)}ms`);
  console.log(`Warm: ${warmTime.toFixed(0)}ms`);
}

main().catch(console.error);
