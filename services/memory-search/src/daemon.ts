#!/usr/bin/env bun
/**
 * Main daemon entry point.
 *
 * This file is spawned by claude-assistant daemon as a child process.
 * It runs the HTTP server and file poller.
 */

import { getStore, closeStore } from "./store";
import { SearchEngine } from "./search";
import { Poller } from "./poller";
import { Server } from "./server";
import { loadConfig, ensureCacheDir, getDbPath } from "./config";
import { createEmbedFunction, createRerankFunction, warmupModels, checkModelsAvailable } from "./llm";

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("jsmith-search daemon starting...");
  console.log("=".repeat(60));

  // Ensure cache directory exists
  ensureCacheDir();

  // Load configuration
  const config = loadConfig();
  console.log(`Config loaded. Poll interval: ${config.poll_interval}s`);
  console.log(`Server: ${config.server.host}:${config.server.port}`);

  // Initialize store
  const store = getStore();
  console.log(`Database: ${getDbPath()}`);

  // Initialize search engine
  const searchEngine = new SearchEngine(store);

  // Check for rerank server and set up reranking if available
  const { isRerankServerAvailable, createRerankFunction } = await import("./llm");
  const rerankAvailable = await isRerankServerAvailable();
  if (rerankAvailable) {
    searchEngine.setRerankFunction(createRerankFunction());
    console.log("Reranking enabled (using embed-rerank server on port 9000)");
  } else {
    console.log("Using FTS-only search (start embed-rerank server for reranking)");
  }

  // Initialize poller
  const poller = new Poller(store, config);

  // Set up poll callback for logging
  poller.onPoll((result) => {
    const { category, result: r, duration_ms } = result;
    const changes = [];
    if (r.added > 0) changes.push(`+${r.added} added`);
    if (r.updated > 0) changes.push(`~${r.updated} updated`);
    if (r.removed > 0) changes.push(`-${r.removed} removed`);

    if (changes.length > 0) {
      console.log(`[${new Date().toISOString()}] ${category}: ${changes.join(", ")} (${duration_ms}ms)`);
    }

    if (r.errors.length > 0) {
      for (const error of r.errors) {
        console.error(`[${category}] Error: ${error}`);
      }
    }
  });

  // Initialize server
  const server = new Server(store, searchEngine, poller, config);

  // Start server
  server.start();

  // Run initial index
  console.log("\nRunning initial index...");
  const initialStart = Date.now();
  await poller.poll();
  console.log(`Initial index complete in ${Date.now() - initialStart}ms`);

  // Show status
  const status = store.getStatus();
  console.log(`\nIndex status:`);
  console.log(`  Total documents: ${status.total_docs}`);
  console.log(`  Needs embedding: ${status.needs_embedding}`);
  console.log(`  Categories:`);
  for (const [cat, count] of Object.entries(status.categories)) {
    console.log(`    ${cat}: ${count}`);
  }

  // Start polling
  console.log(`\nStarting file poller (interval: ${config.poll_interval}s)...`);
  poller.start();

  console.log("\n" + "=".repeat(60));
  console.log("Daemon running. Press Ctrl+C to stop.");
  console.log("=".repeat(60) + "\n");

  // Handle shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    poller.stop();
    server.stop();
    closeStore();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
