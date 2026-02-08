#!/usr/bin/env bun
/**
 * Profile chunk selection timing.
 */

import { getStore, closeStore } from "./src/store";
import { chunkDocument } from "./src/indexer";
import { ensureCacheDir } from "./src/config";

async function main() {
  console.log("=== Chunk selection profiling ===\n");

  ensureCacheDir();
  const store = getStore();

  const query = "lights";
  const ftsResults = store.searchFTS(query, 10);

  console.log(`Query: "${query}"`);
  console.log(`Results: ${ftsResults.length}\n`);

  // Profile chunking
  console.log("--- Chunking timing ---");
  let totalChunkTime = 0;
  let totalChunks = 0;

  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i];
    const start = performance.now();
    const chunks = chunkDocument(r.body);
    const elapsed = performance.now() - start;
    totalChunkTime += elapsed;
    totalChunks += chunks.length;
    console.log(`Doc ${i + 1}: ${r.body.length} chars -> ${chunks.length} chunks (${elapsed.toFixed(2)}ms)`);
  }

  console.log(`\nTotal: ${totalChunks} chunks in ${totalChunkTime.toFixed(2)}ms`);
  console.log(`Avg chunk size: ${Math.round(ftsResults.reduce((s, r) => s + r.body.length, 0) / totalChunks)} chars`);

  // Profile chunk selection (with keyword matching)
  console.log("\n--- Best chunk selection ---");
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  for (let i = 0; i < Math.min(3, ftsResults.length); i++) {
    const r = ftsResults[i];
    const chunks = chunkDocument(r.body);

    let bestIdx = 0;
    let bestScore = -1;

    for (let j = 0; j < chunks.length; j++) {
      const chunkLower = chunks[j].toLowerCase();
      const score = queryTerms.reduce((acc, term) => acc + (chunkLower.includes(term) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    console.log(`Doc ${i + 1}: best chunk ${bestIdx + 1}/${chunks.length} (score: ${bestScore})`);
    console.log(`  Chunk preview: ${chunks[bestIdx].slice(0, 100)}...`);
  }

  // Compare: 500-char truncate vs best chunk selection
  console.log("\n--- Comparison: truncate vs best chunk ---");
  const r = ftsResults[0];
  const truncated = r.body.slice(0, 500);
  const chunks = chunkDocument(r.body);

  let bestIdx = 0;
  let bestScore = -1;
  for (let j = 0; j < chunks.length; j++) {
    const score = queryTerms.reduce((acc, term) => acc + (chunks[j].toLowerCase().includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = j;
    }
  }

  const truncHasKeyword = queryTerms.some(t => truncated.toLowerCase().includes(t));
  const chunkHasKeyword = queryTerms.some(t => chunks[bestIdx].toLowerCase().includes(t));

  console.log(`Truncated (500 chars) has "${query}": ${truncHasKeyword}`);
  console.log(`Best chunk (${chunks[bestIdx].length} chars) has "${query}": ${chunkHasKeyword}`);

  closeStore();
}

main().catch(console.error);
