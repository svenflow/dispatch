#!/usr/bin/env bun
/**
 * Analyze reranker input size.
 */

import { getStore, closeStore } from "./src/store";
import { ensureCacheDir } from "./src/config";

async function main() {
  console.log("=== Reranker input analysis ===\n");

  ensureCacheDir();
  const store = getStore();

  const query = "lights";
  const ftsResults = store.searchFTS(query, 10);

  console.log(`Query: "${query}" (${query.length} chars)`);
  console.log(`\n--- Document sizes ---`);

  let totalChars = 0;
  let total500Chars = 0;

  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i];
    const fullLen = r.body.length;
    const snippet500 = r.body.slice(0, 500).length;
    totalChars += fullLen;
    total500Chars += snippet500;
    console.log(`Doc ${i+1}: ${fullLen} chars full, ${snippet500} chars @500`);
  }

  console.log(`\n--- Totals ---`);
  console.log(`Full docs: ${totalChars} chars (${(totalChars/1000).toFixed(1)}k)`);
  console.log(`500-char snippets: ${total500Chars} chars (${(total500Chars/1000).toFixed(1)}k)`);

  // Estimate tokens (~4 chars per token)
  console.log(`\n--- Token estimates (4 chars/token) ---`);
  console.log(`Full docs: ~${Math.round(totalChars/4)} tokens`);
  console.log(`500-char snippets: ~${Math.round(total500Chars/4)} tokens`);

  // What qwen3-reranker sees per doc
  console.log(`\n--- Per-doc reranker input ---`);
  const doc = ftsResults[0];
  const snippet = doc.body.slice(0, 500);
  console.log(`Query: ${query.length} chars`);
  console.log(`Doc snippet: ${snippet.length} chars`);
  console.log(`Combined per doc: ~${query.length + snippet.length + 50} chars (with template)`);

  // Show actual snippet
  console.log(`\n--- Sample snippet (doc 1) ---`);
  console.log(snippet.slice(0, 200) + "...");

  closeStore();
}

main().catch(console.error);
