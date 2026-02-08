#!/usr/bin/env bun
/**
 * CLI interface for search daemon.
 */

import { parseArgs } from "util";
import { getStore, closeStore, hashContent } from "./store";
import { SearchEngine } from "./search";
import { Poller } from "./poller";
import { Server } from "./server";
import { loadConfig, ensureCacheDir } from "./config";
import { createEmbedFunction, createRerankFunction, warmupModels, disposeLLM } from "./llm";

// =============================================================================
// CLI Commands
// =============================================================================

async function cmdServe(): Promise<void> {
  console.log("Starting nicklaude-search daemon...");

  ensureCacheDir();
  const config = loadConfig();
  const store = getStore();
  const searchEngine = new SearchEngine(store);
  const poller = new Poller(store, config);
  const server = new Server(store, searchEngine, poller, config);

  // Set up poll callback for logging
  poller.onPoll((result) => {
    const { category, result: r, duration_ms } = result;
    const changes = [];
    if (r.added > 0) changes.push(`+${r.added}`);
    if (r.updated > 0) changes.push(`~${r.updated}`);
    if (r.removed > 0) changes.push(`-${r.removed}`);
    if (r.errors.length > 0) changes.push(`!${r.errors.length}`);

    if (changes.length > 0) {
      console.log(`[${category}] ${changes.join(" ")} (${duration_ms}ms)`);
    }
  });

  // Start server and poller
  server.start();
  poller.start();

  // Initial index
  console.log("Running initial index...");
  await poller.poll();
  console.log("Initial index complete.");

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    poller.stop();
    server.stop();
    closeStore();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nShutting down...");
    poller.stop();
    server.stop();
    closeStore();
    process.exit(0);
  });

  // Keep process alive
  console.log("Daemon running. Press Ctrl+C to stop.");
}

/**
 * Parse date string or timestamp to milliseconds
 */
function parseTimeArg(value: string): number {
  // If numeric, treat as timestamp (could be seconds or ms)
  const num = parseInt(value, 10);
  if (!isNaN(num) && value.match(/^\d+$/)) {
    // If < year 2000 in ms, assume seconds
    return num < 946684800000 ? num * 1000 : num;
  }
  // Otherwise parse as date string
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date.getTime();
}

const DAEMON_URL = "http://localhost:7890";

async function isDaemonRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${DAEMON_URL}/health`, { signal: AbortSignal.timeout(1000) });
    return resp.ok;
  } catch {
    return false;
  }
}

async function cmdSearch(query: string, options: { category?: string; limit?: number; after?: string; before?: string }): Promise<void> {
  const limit = options.limit || 20;
  const category = options.category;
  const after = options.after ? parseTimeArg(options.after) : undefined;
  const before = options.before ? parseTimeArg(options.before) : undefined;

  let filterDesc = "";
  if (category) filterDesc += ` in ${category}`;
  if (after) filterDesc += ` after ${new Date(after).toISOString().split("T")[0]}`;
  if (before) filterDesc += ` before ${new Date(before).toISOString().split("T")[0]}`;

  // Check if daemon is running
  const daemonRunning = await isDaemonRunning();
  if (!daemonRunning) {
    console.error("Error: Search daemon is not running.");
    console.error("Start it with: bun run src/daemon.ts");
    console.error("Or start the main dispatch daemon which spawns it automatically.");
    process.exit(1);
  }

  console.log(`Searching for: "${query}"${filterDesc}...\n`);

  const startTime = Date.now();

  // Build query params
  const params = new URLSearchParams({ q: query, limit: limit.toString() });
  if (category) params.set("category", category);
  if (after) params.set("after", after.toString());
  if (before) params.set("before", before.toString());

  // Call daemon
  const resp = await fetch(`${DAEMON_URL}/search?${params}`);
  if (!resp.ok) {
    const error = await resp.text();
    console.error(`Search failed: ${error}`);
    process.exit(1);
  }

  const data = await resp.json() as {
    results: Array<{
      filepath: string;
      title: string;
      body: string;
      score: number;
      category: string;
      rerankScore?: number;
    }>;
    took_ms: number;
  };

  const duration = Date.now() - startTime;

  if (data.results.length === 0) {
    console.log("No results found.");
  } else {
    for (let i = 0; i < data.results.length; i++) {
      const r = data.results[i];
      console.log(`${i + 1}. [${r.category}] ${r.title}`);
      console.log(`   ${r.filepath}`);
      console.log(`   Score: ${r.score.toFixed(3)}${r.rerankScore !== undefined ? ` (rerank: ${r.rerankScore.toFixed(3)})` : ""}`);

      // Show snippet
      const snippet = r.body.slice(0, 200).replace(/\n/g, " ").trim();
      console.log(`   ${snippet}${r.body.length > 200 ? "..." : ""}`);
      console.log();
    }
  }

  console.log(`Found ${data.results.length} results in ${duration}ms (daemon: ${data.took_ms}ms)`);
}

async function cmdIndex(options: { category: string; path: string }): Promise<void> {
  const { existsSync, readFileSync } = await import("fs");

  if (!existsSync(options.path)) {
    console.error(`File not found: ${options.path}`);
    process.exit(1);
  }

  ensureCacheDir();
  const store = getStore();

  const content = readFileSync(options.path, "utf-8");
  const hash = hashContent(content);

  // Extract title from first heading
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : options.path.split("/").pop() || options.path;

  store.insertContent(hash, content);

  const existing = store.findDocument(options.category, options.path);
  if (existing) {
    store.updateDocument(existing.id, title, hash, Date.now());
    console.log(`Updated: ${options.path}`);
  } else {
    store.insertDocument(options.category, options.path, title, hash, Date.now());
    console.log(`Indexed: ${options.path}`);
  }

  closeStore();
}

async function cmdReindex(options: { category?: string }): Promise<void> {
  ensureCacheDir();
  const config = loadConfig();
  const store = getStore();
  const poller = new Poller(store, config);

  if (options.category) {
    console.log(`Reindexing category: ${options.category}...`);
    const result = await poller.pollCategory(options.category);
    if (result) {
      console.log(`Added: ${result.added}, Updated: ${result.updated}, Removed: ${result.removed}`);
      if (result.errors.length > 0) {
        console.log("Errors:", result.errors);
      }
    } else {
      console.log("Category not found or has no source configured");
    }
  } else {
    console.log("Reindexing all categories...");
    await poller.poll();
    console.log("Done.");
  }

  closeStore();
}

async function cmdStatus(): Promise<void> {
  ensureCacheDir();
  const store = getStore();
  const status = store.getStatus();

  console.log("nicklaude-search Status\n");
  console.log(`Total documents: ${status.total_docs}`);
  console.log(`Needs embedding: ${status.needs_embedding}`);
  console.log(`Last modified: ${status.last_modified || "never"}`);
  console.log("\nCategories:");

  for (const [category, count] of Object.entries(status.categories)) {
    console.log(`  ${category}: ${count}`);
  }

  closeStore();
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    console.log(`
nicklaude-search - Hybrid semantic search daemon

USAGE:
  search-daemon <command> [options]

COMMANDS:
  serve                    Start the daemon
  search <query>           Search the index
    --category <name>      Filter by category
    --limit <n>            Max results (default: 20)
    --after <date>         Filter after date (e.g., "2024-01-01" or timestamp)
    --before <date>        Filter before date (e.g., "2024-12-31" or timestamp)
  index --category <name> --path <file>
                           Index a single file
  reindex [--category <name>]
                           Reindex (optionally specific category)
  status                   Show index status

EXAMPLES:
  search-daemon serve
  search-daemon search "how to deploy"
  search-daemon search "API" --category skills --limit 10
  search-daemon search "meeting" --after "2024-06-01" --before "2024-12-31"
  search-daemon reindex --category documents
  search-daemon status
`);
    return;
  }

  const command = args[0];

  switch (command) {
    case "serve":
      await cmdServe();
      break;

    case "search":
      if (!args[1]) {
        console.error("Error: search requires a query");
        process.exit(1);
      }
      const searchOpts = {
        category: undefined as string | undefined,
        limit: undefined as number | undefined,
        after: undefined as string | undefined,
        before: undefined as string | undefined,
      };
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--category" && args[i + 1]) {
          searchOpts.category = args[++i];
        } else if (args[i] === "--limit" && args[i + 1]) {
          searchOpts.limit = parseInt(args[++i], 10);
        } else if (args[i] === "--after" && args[i + 1]) {
          searchOpts.after = args[++i];
        } else if (args[i] === "--before" && args[i + 1]) {
          searchOpts.before = args[++i];
        }
      }
      await cmdSearch(args[1], searchOpts);
      break;

    case "index":
      const indexOpts = { category: "", path: "" };
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--category" && args[i + 1]) {
          indexOpts.category = args[++i];
        } else if (args[i] === "--path" && args[i + 1]) {
          indexOpts.path = args[++i];
        }
      }
      if (!indexOpts.category || !indexOpts.path) {
        console.error("Error: index requires --category and --path");
        process.exit(1);
      }
      await cmdIndex(indexOpts);
      break;

    case "reindex":
      const reindexOpts = { category: undefined as string | undefined };
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--category" && args[i + 1]) {
          reindexOpts.category = args[++i];
        }
      }
      await cmdReindex(reindexOpts);
      break;

    case "status":
      await cmdStatus();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
