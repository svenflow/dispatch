#!/usr/bin/env bun
/**
 * Evaluate the qwen3-reranker-0.6B cross-encoder on the real eval dataset.
 * Compare dedicated reranker vs batch LLM approach.
 */

import { rerank } from "./src/llm";
import { warmupModels, disposeLLM } from "./src/llm";
import * as fs from "fs";
import * as path from "path";

interface Doc {
  doc: string;
  relevant: boolean;
  topic: string;
}

interface QueryData {
  query: string;
  docs: Doc[];
}

interface EvalDataset {
  metadata: {
    num_queries: number;
    num_docs_total: number;
    topics: string[];
  };
  data: QueryData[];
}

interface QueryResult {
  query: string;
  numDocs: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  timeMs: number;
  topic: string;
}

async function evaluateQuery(query: string, docs: Doc[]): Promise<QueryResult> {
  const docTexts = docs.slice(0, 10).map((d, i) => ({
    file: `doc${i}`,
    text: d.doc,
  }));
  const relevance = docs.slice(0, 10).map((d) => d.relevant);

  const start = performance.now();
  const ranked = await rerank(query, docTexts);
  const timeMs = performance.now() - start;

  // Create score map
  const scoreMap = new Map<string, number>();
  ranked.forEach((r) => scoreMap.set(r.file, r.score));

  // Threshold: normalized score > 0.5 means predicted relevant
  // Cross-encoder scores are typically in [-10, 10] range, normalize
  const maxScore = Math.max(...ranked.map((r) => r.score));
  const minScore = Math.min(...ranked.map((r) => r.score));
  const range = maxScore - minScore || 1;

  const predicted = docTexts.map((d) => {
    const score = scoreMap.get(d.file) || 0;
    const normalized = (score - minScore) / range;
    return normalized > 0.5;
  });

  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0;
  for (let i = 0; i < predicted.length; i++) {
    if (predicted[i] && relevance[i]) tp++;
    else if (predicted[i] && !relevance[i]) fp++;
    else if (!predicted[i] && relevance[i]) fn++;
    else tn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    query,
    numDocs: docTexts.length,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    f1,
    timeMs,
    topic: docs[0]?.topic || "unknown",
  };
}

async function main() {
  console.log("=".repeat(60));
  console.log("Cross-Encoder Evaluation (qwen3-reranker-0.6B)");
  console.log("=".repeat(60));

  // Load dataset
  const evalFile = path.join(__dirname, "eval-dataset.json");
  const dataset: EvalDataset = JSON.parse(fs.readFileSync(evalFile, "utf-8"));

  console.log(`\nDataset: ${dataset.metadata.num_queries} queries, ${dataset.metadata.num_docs_total} doc pairs`);
  console.log(`Topics: ${dataset.metadata.topics.join(", ")}`);

  // Warmup
  console.log("\nWarming up models...");
  await warmupModels();
  console.log("Models warm\n");

  const results: QueryResult[] = [];
  const topicResults = new Map<string, QueryResult[]>();

  const maxQueries = 30;
  const queries = dataset.data.slice(0, maxQueries);

  for (let i = 0; i < queries.length; i++) {
    const item = queries[i];
    if (item.docs.length < 3) continue;

    const result = await evaluateQuery(item.query, item.docs);
    results.push(result);

    // Track by topic
    if (!topicResults.has(result.topic)) {
      topicResults.set(result.topic, []);
    }
    topicResults.get(result.topic)!.push(result);

    if ((i + 1) % 5 === 0) {
      console.log(`  Processed ${i + 1}/${queries.length} queries...`);
    }
  }

  // Aggregate metrics
  const totalTp = results.reduce((sum, r) => sum + r.tp, 0);
  const totalFp = results.reduce((sum, r) => sum + r.fp, 0);
  const totalFn = results.reduce((sum, r) => sum + r.fn, 0);

  const overallPrecision = totalTp + totalFp > 0 ? totalTp / (totalTp + totalFp) : 0;
  const overallRecall = totalTp + totalFn > 0 ? totalTp / (totalTp + totalFn) : 0;
  const overallF1 =
    overallPrecision + overallRecall > 0
      ? (2 * overallPrecision * overallRecall) / (overallPrecision + overallRecall)
      : 0;

  const avgTime = results.reduce((sum, r) => sum + r.timeMs, 0) / results.length;
  const totalDocs = results.reduce((sum, r) => sum + r.numDocs, 0);
  const perDocMs = (avgTime * results.length) / totalDocs;

  console.log("\n" + "=".repeat(60));
  console.log("RESULTS: qwen3-reranker-0.6B Cross-Encoder");
  console.log("=".repeat(60));
  console.log(`  Precision: ${overallPrecision.toFixed(2)}`);
  console.log(`  Recall: ${overallRecall.toFixed(2)}`);
  console.log(`  F1: ${overallF1.toFixed(2)}`);
  console.log(`  Avg time per query: ${avgTime.toFixed(0)}ms`);
  console.log(`  Per-doc latency: ${perDocMs.toFixed(1)}ms`);

  // Topic breakdown
  console.log("\nTopic breakdown:");
  for (const [topic, tres] of topicResults.entries()) {
    const ttp = tres.reduce((sum, r) => sum + r.tp, 0);
    const tfp = tres.reduce((sum, r) => sum + r.fp, 0);
    const tfn = tres.reduce((sum, r) => sum + r.fn, 0);
    const tPrecision = ttp + tfp > 0 ? ttp / (ttp + tfp) : 0;
    const tRecall = ttp + tfn > 0 ? ttp / (ttp + tfn) : 0;
    const tF1 = tPrecision + tRecall > 0 ? (2 * tPrecision * tRecall) / (tPrecision + tRecall) : 0;
    console.log(`  ${topic}: F1=${tF1.toFixed(2)}`);
  }

  // Compare to batch LLM results
  console.log("\n" + "=".repeat(60));
  console.log("COMPARISON: Cross-Encoder vs Batch LLM");
  console.log("=".repeat(60));
  console.log("Model                          F1     Time");
  console.log("-".repeat(60));
  console.log(`qwen3-reranker-0.6B (cross)    ${overallF1.toFixed(2)}   ${avgTime.toFixed(0)}ms`);
  console.log(`Qwen3-0.6B-MLX (batch)         0.09   303ms`);
  console.log(`Qwen3-1.7B-MLX (batch)         0.21   927ms`);
  console.log(`Qwen3-4B-MLX (batch)           0.37   1002ms`);

  await disposeLLM();
}

main().catch(console.error);
