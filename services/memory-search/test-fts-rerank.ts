#!/usr/bin/env bun
/**
 * Test FTS + Rerank (no vector search) - this is what we actually need
 */

import { getStore, closeStore } from "./src/store";
import { SearchEngine } from "./src/search";
import { createEmbedFunction, createRerankFunction, warmupModels, disposeLLM } from "./src/llm";
import { ensureCacheDir } from "./src/config";
import { execSync } from "child_process";

const TEST_QUERIES = [
  "lights",
  "signal daemon",
  "SDK session",
  "home illumination control",
  "messaging backend architecture",
  "troubleshooting application failures",
  "how to send a text message",
  "hue bridge configuration",
];

function getProcessMemoryMB(): number {
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
  console.log("FTS + Rerank Speed Test (No Vector Search)");
  console.log("=".repeat(60));

  const ram0 = getProcessMemoryMB();
  console.log(`\nInitial: ${ram0} MB`);

  ensureCacheDir();
  const store = getStore();
  const searchEngine = new SearchEngine(store);

  // Warmup models
  console.log("\nWarming up models...");
  await warmupModels();
  const ramWarm = getProcessMemoryMB();
  console.log(`After warmup: ${ramWarm} MB (+${ramWarm - ram0} MB)`);

  // Only set rerank function (no embed = no vector search)
  searchEngine.setRerankFunction(createRerankFunction());

  console.log("\n" + "-".repeat(60));
  console.log("Running FTS + Rerank queries...\n");

  const results: { query: string; ftsTime: number; rerankTime: number; count: number }[] = [];

  for (const query of TEST_QUERIES) {
    // Step 1: FTS search
    const ftsStart = performance.now();
    const ftsResults = searchEngine.searchFTS(query, 10);
    const ftsTime = performance.now() - ftsStart;

    if (ftsResults.length === 0) {
      console.log(`"${query}" - No FTS results`);
      results.push({ query, ftsTime, rerankTime: 0, count: 0 });
      continue;
    }

    // Step 2: Prepare docs for reranking
    const docsToRerank = ftsResults.slice(0, 10).map(r => ({
      file: r.filepath,
      text: r.body.slice(0, 500), // Use first 500 chars
    }));

    // Step 3: Rerank
    const rerankStart = performance.now();
    const reranked = await searchEngine["cachedRerank"](query, docsToRerank);
    const rerankTime = performance.now() - rerankStart;

    console.log(`"${query}"`);
    console.log(`  FTS: ${ftsTime.toFixed(0)}ms (${ftsResults.length} results)`);
    console.log(`  Rerank: ${rerankTime.toFixed(0)}ms (${docsToRerank.length} docs)`);
    console.log(`  Total: ${(ftsTime + rerankTime).toFixed(0)}ms`);

    results.push({ query, ftsTime, rerankTime, count: ftsResults.length });
  }

  const ramEnd = getProcessMemoryMB();

  // Cleanup
  closeStore();
  await disposeLLM();

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const avgFTS = results.reduce((sum, r) => sum + r.ftsTime, 0) / results.length;
  const avgRerank = results.reduce((sum, r) => sum + r.rerankTime, 0) / results.length;

  console.log(`\nRAM: ${ramEnd} MB (total)`);
  console.log(`Average FTS: ${avgFTS.toFixed(0)}ms`);
  console.log(`Average Rerank: ${avgRerank.toFixed(0)}ms`);
  console.log(`Average Total: ${(avgFTS + avgRerank).toFixed(0)}ms`);
}

main().catch(console.error);
