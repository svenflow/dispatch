#!/usr/bin/env bun
/**
 * Test model RAM usage with LIMITED context size
 */

import { getLlama, resolveModelFile, LlamaLogLevel } from "node-llama-cpp";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";

const MODEL_CACHE_DIR = join(homedir(), ".cache", "jsmith-search", "models");
const EMBED_MODEL_URI = "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
const RERANK_MODEL_URI = "hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf";

// Try different context sizes
const CONTEXT_SIZES = [512, 1024, 2048, 4096, 8192];

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
  console.log("Testing rerank context RAM with different context sizes\n");

  const ram0 = getProcessMemoryMB();
  console.log(`Initial: ${ram0} MB\n`);

  const llama = await getLlama({ logLevel: LlamaLogLevel.error });
  const rerankModelPath = await resolveModelFile(RERANK_MODEL_URI, MODEL_CACHE_DIR);
  const rerankModel = await llama.loadModel({ modelPath: rerankModelPath });

  const ramAfterModel = getProcessMemoryMB();
  console.log(`After model load: ${ramAfterModel} MB (+${ramAfterModel - ram0} MB for model)\n`);

  for (const ctxSize of CONTEXT_SIZES) {
    console.log(`\nTesting contextSize=${ctxSize}...`);
    const ramBefore = getProcessMemoryMB();

    try {
      // @ts-ignore - contextSize might not be in types but should work
      const ctx = await rerankModel.createRankingContext({ contextSize: ctxSize });
      const ramAfter = getProcessMemoryMB();
      console.log(`  Context created: +${ramAfter - ramBefore} MB`);

      // Quick test
      const ranked = await ctx.rankAndSort("test query", ["doc 1", "doc 2"]);
      console.log(`  Ranked ${ranked.length} docs`);

      await ctx.dispose();
      const ramAfterDispose = getProcessMemoryMB();
      console.log(`  After dispose: ${ramAfterDispose} MB`);
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
    }
  }

  // Also test "auto" for comparison
  console.log(`\nTesting contextSize="auto" (default)...`);
  const ramBeforeAuto = getProcessMemoryMB();
  try {
    const ctx = await rerankModel.createRankingContext();
    const ramAfterAuto = getProcessMemoryMB();
    console.log(`  Context created: +${ramAfterAuto - ramBeforeAuto} MB`);
    console.log(`  Actual contextSize: ${ctx.contextSize}`);
    await ctx.dispose();
  } catch (err: any) {
    console.log(`  ERROR: ${err.message}`);
  }

  // Cleanup
  await rerankModel.dispose();
  await llama.dispose();

  console.log("\nDone!");
}

main().catch(console.error);
