#!/usr/bin/env bun
/**
 * Test search queries serially and measure RAM usage.
 */

import { getStore, closeStore } from "./src/store";
import { SearchEngine } from "./src/search";
import { createEmbedFunction, createRerankFunction, warmupModels, disposeLLM } from "./src/llm";
import { ensureCacheDir } from "./src/config";
import { execSync } from "child_process";

// Test queries
const TEST_QUERIES = [
  "lights",
  "signal daemon",
  "SDK session",
  "home illumination control",
  "messaging backend architecture",
  "person-to-person communication",
  "troubleshooting application failures",
  "how to send a text message",
  "what's wrong with the daemon",
  "hue bridge configuration",
];

function getProcessMemoryMB(): number {
  // Get RSS (Resident Set Size) for this bun process
  const pid = process.pid;
  try {
    const output = execSync(`ps -o rss= -p ${pid}`, { encoding: "utf-8" });
    const rssKB = parseInt(output.trim(), 10);
    return Math.round(rssKB / 1024);
  } catch {
    return -1;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("RAM Usage During Search Queries");
  console.log("=".repeat(60));

  const initialRAM = getProcessMemoryMB();
  console.log(`\nInitial process RAM: ${initialRAM} MB`);

  ensureCacheDir();
  const store = getStore();

  const postStoreRAM = getProcessMemoryMB();
  console.log(`After store init: ${postStoreRAM} MB (+${postStoreRAM - initialRAM} MB)`);

  const searchEngine = new SearchEngine(store);

  // Warmup models
  console.log("\nWarming up models...");
  const warmupStart = Date.now();
  await warmupModels();
  const warmupTime = Date.now() - warmupStart;

  const postWarmupRAM = getProcessMemoryMB();
  console.log(`After model warmup: ${postWarmupRAM} MB (+${postWarmupRAM - postStoreRAM} MB models)`);
  console.log(`Warmup took ${warmupTime}ms\n`);

  searchEngine.setEmbedFunction(createEmbedFunction());
  searchEngine.setRerankFunction(createRerankFunction());

  console.log("-".repeat(60));
  console.log("Running queries serially...\n");

  const results: { query: string; time: number; count: number; ram: number }[] = [];

  for (let i = 0; i < TEST_QUERIES.length; i++) {
    const query = TEST_QUERIES[i];

    const start = performance.now();
    const searchResults = await searchEngine.search(query, 5);
    const elapsed = performance.now() - start;
    const currentRAM = getProcessMemoryMB();

    console.log(`[${i + 1}/${TEST_QUERIES.length}] "${query}"`);
    console.log(`    Time: ${elapsed.toFixed(0)}ms | Results: ${searchResults.length} | RAM: ${currentRAM} MB`);

    results.push({
      query,
      time: elapsed,
      count: searchResults.length,
      ram: currentRAM,
    });
  }

  const finalRAM = getProcessMemoryMB();

  // Cleanup
  closeStore();
  await disposeLLM();

  const cleanupRAM = getProcessMemoryMB();

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const avgTime = results.reduce((sum, r) => sum + r.time, 0) / results.length;
  const maxRAM = Math.max(...results.map(r => r.ram));
  const minRAM = Math.min(...results.map(r => r.ram));

  console.log(`\nRAM Usage:`);
  console.log(`  Initial:      ${initialRAM} MB`);
  console.log(`  + Store:      +${postStoreRAM - initialRAM} MB`);
  console.log(`  + Models:     +${postWarmupRAM - postStoreRAM} MB`);
  console.log(`  Peak during:  ${maxRAM} MB`);
  console.log(`  Final:        ${finalRAM} MB`);
  console.log(`  After cleanup: ${cleanupRAM} MB`);

  console.log(`\nQuery Performance:`);
  console.log(`  Average time: ${avgTime.toFixed(0)}ms`);
  console.log(`  Total queries: ${results.length}`);
  console.log(`  Success rate: ${(results.filter(r => r.count > 0).length / results.length * 100).toFixed(0)}%`);
}

main().catch(console.error);
