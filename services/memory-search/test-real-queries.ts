#!/usr/bin/env bun
/**
 * Test real-world queries on the indexed transcript data.
 */

import { getStore, closeStore } from "./src/store";
import { SearchEngine } from "./src/search";
import { createEmbedFunction, createRerankFunction, warmupModels, disposeLLM } from "./src/llm";
import { ensureCacheDir } from "./src/config";

// Diverse test queries - mix of direct and semantic
const TEST_QUERIES = [
  // Direct keyword queries
  "lights",
  "signal daemon",
  "SDK session",

  // Semantic queries (no direct keyword match expected)
  "home illumination control",
  "messaging backend architecture",
  "person-to-person communication",
  "troubleshooting application failures",

  // Real use case queries
  "how to send a text message",
  "what's wrong with the daemon",
  "hue bridge configuration",
];

async function main() {
  console.log("=".repeat(60));
  console.log("Real-World Search Test");
  console.log("=".repeat(60));

  ensureCacheDir();
  const store = getStore();

  // Get index stats
  const cacheStats = store.getCacheStats();
  console.log(`\nCache entries: ${cacheStats.count}`);

  const searchEngine = new SearchEngine(store);

  // Warmup
  console.log("\nWarming up models...");
  await warmupModels();
  console.log("Models warm\n");

  searchEngine.setEmbedFunction(createEmbedFunction());
  searchEngine.setRerankFunction(createRerankFunction());

  const results: { query: string; time: number; count: number; topResult: string }[] = [];

  for (const query of TEST_QUERIES) {
    console.log("-".repeat(60));
    console.log(`Query: "${query}"`);

    const start = performance.now();
    const searchResults = await searchEngine.search(query, 3);
    const elapsed = performance.now() - start;

    console.log(`  Time: ${elapsed.toFixed(0)}ms | Results: ${searchResults.length}`);

    if (searchResults.length > 0) {
      const top = searchResults[0];
      const preview = top.body?.slice(0, 100).replace(/\n/g, " ") || "(no body)";
      console.log(`  Top: ${top.filepath.split("/").pop()}`);
      console.log(`       ${preview}...`);

      results.push({
        query,
        time: elapsed,
        count: searchResults.length,
        topResult: top.filepath.split("/").pop() || "",
      });
    } else {
      console.log("  No results");
      results.push({ query, time: elapsed, count: 0, topResult: "" });
    }
  }

  closeStore();
  await disposeLLM();

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const avgTime = results.reduce((sum, r) => sum + r.time, 0) / results.length;
  const successRate = results.filter((r) => r.count > 0).length / results.length;

  console.log(`Average search time: ${avgTime.toFixed(0)}ms`);
  console.log(`Success rate: ${(successRate * 100).toFixed(0)}%`);
  console.log("\nPer-query breakdown:");
  results.forEach((r) => {
    const status = r.count > 0 ? "✓" : "✗";
    console.log(`  ${status} ${r.query.padEnd(35)} ${r.time.toFixed(0).padStart(5)}ms  ${r.count} results`);
  });
}

main().catch(console.error);
