#!/usr/bin/env bun
/**
 * Minimal test to measure model RAM usage
 */

import { getLlama, resolveModelFile, LlamaLogLevel } from "node-llama-cpp";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";

const MODEL_CACHE_DIR = join(homedir(), ".cache", "jsmith-search", "models");
const EMBED_MODEL_URI = "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
const RERANK_MODEL_URI = "hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf";

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
  console.log("Testing model RAM usage step by step\n");

  const ram0 = getProcessMemoryMB();
  console.log(`[0] Initial: ${ram0} MB`);

  // Step 1: Get llama instance
  console.log("\n[1] Creating llama instance...");
  const llama = await getLlama({ logLevel: LlamaLogLevel.error });
  const ram1 = getProcessMemoryMB();
  console.log(`    RAM: ${ram1} MB (+${ram1 - ram0} MB)`);

  // Step 2: Resolve embed model path
  console.log("\n[2] Resolving embed model path...");
  const embedModelPath = await resolveModelFile(EMBED_MODEL_URI, MODEL_CACHE_DIR);
  console.log(`    Path: ${embedModelPath}`);
  const ram2 = getProcessMemoryMB();
  console.log(`    RAM: ${ram2} MB (+${ram2 - ram1} MB)`);

  // Step 3: Load embed model
  console.log("\n[3] Loading embed model...");
  const embedModel = await llama.loadModel({ modelPath: embedModelPath });
  const ram3 = getProcessMemoryMB();
  console.log(`    RAM: ${ram3} MB (+${ram3 - ram2} MB)`);

  // Step 4: Create embed context
  console.log("\n[4] Creating embed context...");
  const embedContext = await embedModel.createEmbeddingContext();
  const ram4 = getProcessMemoryMB();
  console.log(`    RAM: ${ram4} MB (+${ram4 - ram3} MB)`);

  // Step 5: Test embedding
  console.log("\n[5] Running test embedding...");
  const testEmbed = await embedContext.getEmbeddingFor("test query");
  console.log(`    Embedding dim: ${testEmbed.vector.length}`);
  const ram5 = getProcessMemoryMB();
  console.log(`    RAM: ${ram5} MB (+${ram5 - ram4} MB)`);

  // Step 6: Resolve rerank model path
  console.log("\n[6] Resolving rerank model path...");
  const rerankModelPath = await resolveModelFile(RERANK_MODEL_URI, MODEL_CACHE_DIR);
  console.log(`    Path: ${rerankModelPath}`);
  const ram6 = getProcessMemoryMB();
  console.log(`    RAM: ${ram6} MB (+${ram6 - ram5} MB)`);

  // Step 7: Load rerank model
  console.log("\n[7] Loading rerank model...");
  const rerankModel = await llama.loadModel({ modelPath: rerankModelPath });
  const ram7 = getProcessMemoryMB();
  console.log(`    RAM: ${ram7} MB (+${ram7 - ram6} MB)`);

  // Step 8: Create rerank context
  console.log("\n[8] Creating rerank context...");
  const rerankContext = await rerankModel.createRankingContext();
  const ram8 = getProcessMemoryMB();
  console.log(`    RAM: ${ram8} MB (+${ram8 - ram7} MB)`);

  // Step 9: Test reranking
  console.log("\n[9] Running test rerank...");
  const testRerank = await rerankContext.rankAndSort("test query", ["doc 1", "doc 2"]);
  console.log(`    Reranked ${testRerank.length} docs`);
  const ram9 = getProcessMemoryMB();
  console.log(`    RAM: ${ram9} MB (+${ram9 - ram8} MB)`);

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));
  console.log(`Initial: ${ram0} MB`);
  console.log(`Llama instance: +${ram1 - ram0} MB`);
  console.log(`Embed model: +${ram3 - ram2} MB`);
  console.log(`Embed context: +${ram4 - ram3} MB`);
  console.log(`Rerank model: +${ram7 - ram6} MB`);
  console.log(`Rerank context: +${ram8 - ram7} MB`);
  console.log(`\nTotal: ${ram9} MB`);

  // Cleanup
  console.log("\nCleaning up...");
  await embedContext.dispose();
  await rerankContext.dispose();
  await embedModel.dispose();
  await rerankModel.dispose();

  const ramFinal = getProcessMemoryMB();
  console.log(`After cleanup: ${ramFinal} MB`);
}

main().catch(console.error);
