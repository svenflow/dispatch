#!/usr/bin/env bun
/**
 * Detailed timing breakdown of search.
 */

import { getStore, closeStore, hashContent } from "./src/store";
import { SearchEngine } from "./src/search";
import { createEmbedFunction, createRerankFunction, warmupModels, disposeLLM, embedText, rerank } from "./src/llm";
import { ensureCacheDir } from "./src/config";

async function main() {
  console.log("=== Detailed timing breakdown ===\n");

  ensureCacheDir();
  const store = getStore();
  const searchEngine = new SearchEngine(store);

  // Warmup first
  console.log("Warming up models...");
  await warmupModels();
  console.log("Models warm\n");

  // Set LLM functions
  searchEngine.setEmbedFunction(createEmbedFunction());
  searchEngine.setRerankFunction(createRerankFunction());

  const query = "lights";

  // FTS timing
  console.log("--- FTS ---");
  let start = performance.now();
  const ftsResults = store.searchFTS(query, 20);
  console.log(`FTS: ${(performance.now() - start).toFixed(2)}ms (${ftsResults.length} results)`);

  // Query embedding timing
  console.log("\n--- Query Embedding ---");
  start = performance.now();
  const queryEmbed = await embedText(query, true);
  console.log(`Query embed: ${(performance.now() - start).toFixed(2)}ms`);

  // Vector search would go here but we need embeddings in store first

  // Rerank timing with different batch sizes
  console.log("\n--- Reranking timing (different batch sizes) ---");
  const docs = ftsResults.slice(0, 10).map(r => ({
    file: r.filepath,
    text: r.body.slice(0, 500), // shorter context
  }));

  // 1 doc
  start = performance.now();
  await rerank(query, docs.slice(0, 1));
  console.log(`Rerank 1 doc (500 chars): ${(performance.now() - start).toFixed(2)}ms`);

  // 3 docs
  start = performance.now();
  await rerank(query, docs.slice(0, 3));
  console.log(`Rerank 3 docs (500 chars): ${(performance.now() - start).toFixed(2)}ms`);

  // 5 docs
  start = performance.now();
  await rerank(query, docs.slice(0, 5));
  console.log(`Rerank 5 docs (500 chars): ${(performance.now() - start).toFixed(2)}ms`);

  // 10 docs
  start = performance.now();
  await rerank(query, docs.slice(0, 10));
  console.log(`Rerank 10 docs (500 chars): ${(performance.now() - start).toFixed(2)}ms`);

  // Longer context
  console.log("\n--- Reranking with longer context ---");
  const longDocs = ftsResults.slice(0, 5).map(r => ({
    file: r.filepath,
    text: r.body.slice(0, 2000),
  }));

  start = performance.now();
  await rerank(query, longDocs);
  console.log(`Rerank 5 docs (2000 chars): ${(performance.now() - start).toFixed(2)}ms`);

  const veryLongDocs = ftsResults.slice(0, 5).map(r => ({
    file: r.filepath,
    text: r.body.slice(0, 4000),
  }));

  start = performance.now();
  await rerank(query, veryLongDocs);
  console.log(`Rerank 5 docs (4000 chars): ${(performance.now() - start).toFixed(2)}ms`);

  closeStore();
  await disposeLLM();

  console.log("\n=== Done ===");
}

main().catch(console.error);
