#!/usr/bin/env bun
/**
 * Profile indexing performance for SMS and transcripts.
 */

import { getStore, closeStore } from "./src/store";
import { SMSIndexer, TranscriptIndexer } from "./src/indexer";
import { ensureCacheDir, loadConfig } from "./src/config";
import { homedir } from "os";
import { join } from "path";

async function main() {
  console.log("=== jsmith-search indexing profile ===\n");

  ensureCacheDir();
  const config = loadConfig();
  const store = getStore();

  // Profile SMS indexing
  console.log("--- SMS Indexing ---");
  const smsIndexer = new SMSIndexer(store);
  const smsStart = performance.now();
  const smsResult = await smsIndexer.indexSMS();
  const smsTime = performance.now() - smsStart;

  console.log(`Time: ${smsTime.toFixed(2)}ms`);
  console.log(`Added: ${smsResult.added}`);
  console.log(`Updated: ${smsResult.updated}`);
  console.log(`Errors: ${smsResult.errors.length}`);
  if (smsResult.errors.length > 0) {
    console.log("Errors:", smsResult.errors.slice(0, 5));
  }

  // Profile Transcript indexing
  console.log("\n--- Transcript Indexing ---");
  const transcriptIndexer = new TranscriptIndexer(store);
  const transcriptPath = config.categories.transcripts?.path || join(homedir(), ".claude", "projects");
  console.log(`Path: ${transcriptPath}`);

  const txStart = performance.now();
  const txResult = await transcriptIndexer.indexTranscripts(transcriptPath);
  const txTime = performance.now() - txStart;

  console.log(`Time: ${txTime.toFixed(2)}ms`);
  console.log(`Added: ${txResult.added}`);
  console.log(`Updated: ${txResult.updated}`);
  console.log(`Errors: ${txResult.errors.length}`);
  if (txResult.errors.length > 0) {
    console.log("Errors:", txResult.errors.slice(0, 5));
  }

  // Get status
  console.log("\n--- Index Status ---");
  const status = store.getStatus();
  console.log(`Total documents: ${status.total_documents}`);
  console.log(`Categories:`, status.categories);

  closeStore();

  console.log("\n=== Profile complete ===");
}

main().catch(console.error);
