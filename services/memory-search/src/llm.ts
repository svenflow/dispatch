/**
 * LLM integration for embeddings and reranking using node-llama-cpp.
 *
 * Uses the same models as qmd:
 * - embeddinggemma-300M for embeddings
 * - qwen3-reranker-0.6B for reranking
 */

import {
  getLlama,
  resolveModelFile,
  LlamaLogLevel,
  type Llama,
  type LlamaModel,
  type LlamaEmbeddingContext,
} from "node-llama-cpp";
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

// =============================================================================
// Configuration
// =============================================================================

const HOME = homedir();
const MODEL_CACHE_DIR = join(HOME, ".cache", "nicklaude-search", "models");

// HuggingFace model URIs (same as qmd)
const EMBED_MODEL_URI = "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
const RERANK_MODEL_URI = "hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf";

// =============================================================================
// Types
// =============================================================================

export interface EmbeddingResult {
  embedding: number[];
  model: string;
}

export interface RerankResult {
  file: string;
  score: number;
  index: number;
}

// =============================================================================
// LLM Singleton
// =============================================================================

let llama: Llama | null = null;
let embedModel: LlamaModel | null = null;
let embedContext: LlamaEmbeddingContext | null = null;
let rerankModel: LlamaModel | null = null;
let rerankContext: Awaited<ReturnType<LlamaModel["createRankingContext"]>> | null = null;

// Track initialization state
let embedModelLoading: Promise<LlamaModel> | null = null;
let rerankModelLoading: Promise<LlamaModel> | null = null;
let modelsWarmed = false;

/**
 * Ensure model cache directory exists
 */
function ensureModelCacheDir(): void {
  if (!existsSync(MODEL_CACHE_DIR)) {
    mkdirSync(MODEL_CACHE_DIR, { recursive: true });
  }
}

/**
 * Initialize llama instance (lazy)
 */
async function ensureLlama(): Promise<Llama> {
  if (!llama) {
    llama = await getLlama({ logLevel: LlamaLogLevel.error });
  }
  return llama;
}

/**
 * Resolve model URI to local path, downloading if needed
 */
async function resolveModel(modelUri: string): Promise<string> {
  ensureModelCacheDir();
  return await resolveModelFile(modelUri, MODEL_CACHE_DIR);
}

/**
 * Load embedding model (lazy, with deduplication)
 */
async function ensureEmbedModel(): Promise<LlamaModel> {
  if (embedModel) return embedModel;

  if (embedModelLoading) {
    return await embedModelLoading;
  }

  embedModelLoading = (async () => {
    const l = await ensureLlama();
    const modelPath = await resolveModel(EMBED_MODEL_URI);
    const model = await l.loadModel({ modelPath });
    embedModel = model;
    return model;
  })();

  try {
    return await embedModelLoading;
  } finally {
    embedModelLoading = null;
  }
}

/**
 * Load embedding context (lazy)
 */
async function ensureEmbedContext(): Promise<LlamaEmbeddingContext> {
  if (!embedContext) {
    const model = await ensureEmbedModel();
    embedContext = await model.createEmbeddingContext();
  }
  return embedContext;
}

/**
 * Load rerank model (lazy, with deduplication)
 */
async function ensureRerankModel(): Promise<LlamaModel> {
  if (rerankModel) return rerankModel;

  if (rerankModelLoading) {
    return await rerankModelLoading;
  }

  rerankModelLoading = (async () => {
    const l = await ensureLlama();
    const modelPath = await resolveModel(RERANK_MODEL_URI);
    // Force CPU-only mode with minimal GPU layers to avoid massive RAM allocation
    // Also limit context size during model loading
    const model = await l.loadModel({
      modelPath,
      gpuLayers: 0, // CPU only - avoids GPU memory estimation issues
    });
    rerankModel = model;
    return model;
  })();

  try {
    return await rerankModelLoading;
  } finally {
    rerankModelLoading = null;
  }
}

/**
 * Load rerank context (lazy)
 * Note: We use a very small contextSize to limit RAM usage.
 * Default "auto" allocates ~4.5GB. We use 512 tokens (~100MB) for short chunks.
 */
async function ensureRerankContext(): Promise<Awaited<ReturnType<LlamaModel["createRankingContext"]>>> {
  if (!rerankContext) {
    const model = await ensureRerankModel();
    // Use minimal contextSize and batchSize to limit RAM usage
    // Default "auto" allocates all available RAM
    rerankContext = await model.createRankingContext({
      contextSize: 256,  // Minimal context for short chunks
      batchSize: 64,     // Minimal batch size
    });
  }
  return rerankContext;
}

// =============================================================================
// Embedding Functions
// =============================================================================

/**
 * Format text for embedding using nomic-style format
 */
function formatForEmbedding(text: string, isQuery: boolean, title?: string): string {
  if (isQuery) {
    return `task: search result | query: ${text}`;
  }
  return `title: ${title || "none"} | text: ${text}`;
}

/**
 * Generate embedding for a single text.
 */
export async function embedText(
  text: string,
  isQuery: boolean = false,
  title: string = "none"
): Promise<Float32Array> {
  const context = await ensureEmbedContext();
  const formatted = formatForEmbedding(text, isQuery, title);
  const result = await context.getEmbeddingFor(formatted);
  return new Float32Array(result.vector);
}

/**
 * Generate embeddings for multiple texts.
 */
export async function embedBatch(
  texts: string[],
  titles?: string[]
): Promise<Float32Array[]> {
  const context = await ensureEmbedContext();
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i++) {
    const formatted = formatForEmbedding(texts[i], false, titles?.[i]);
    const result = await context.getEmbeddingFor(formatted);
    results.push(new Float32Array(result.vector));
  }

  return results;
}

// =============================================================================
// Reranking Functions (via embed-rerank Python server)
// =============================================================================

// embed-rerank server URL (Python MLX-based reranker)
const EMBED_RERANK_URL = "http://localhost:9000/api/v1/rerank/";

/**
 * Check if embed-rerank server is available
 */
export async function isRerankServerAvailable(): Promise<boolean> {
  try {
    const resp = await fetch("http://localhost:9000/health/", {
      signal: AbortSignal.timeout(1000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Rerank documents by relevance to query.
 * Uses embed-rerank Python server (MLX-accelerated on Apple Silicon).
 */
export async function rerank(
  query: string,
  documents: { file: string; text: string }[]
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];

  // Build map from text to original info
  const textToDoc = new Map<string, { file: string; index: number }>();
  documents.forEach((doc, index) => {
    textToDoc.set(doc.text, { file: doc.file, index });
  });

  // Call embed-rerank API
  const passages = documents.map((doc) => doc.text);

  const response = await fetch(EMBED_RERANK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, passages }),
    signal: AbortSignal.timeout(30000), // 30s timeout for large batches
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Rerank API failed: ${response.status} - ${error}`);
  }

  const data = await response.json() as { results: Array<{ text: string; index: number; score: number }> };

  // Map back to our result format
  const allResults: RerankResult[] = [];
  for (const item of data.results) {
    const docInfo = textToDoc.get(item.text);
    if (docInfo) {
      allResults.push({
        file: docInfo.file,
        score: item.score,
        index: docInfo.index,
      });
    }
  }

  // Sort all results by score (API should return sorted, but ensure it)
  allResults.sort((a, b) => b.score - a.score);
  return allResults;
}

// =============================================================================
// Factory Functions for SearchEngine
// =============================================================================

/**
 * Create an embed function for use with SearchEngine.
 */
export function createEmbedFunction(): (text: string) => Promise<Float32Array> {
  return async (text: string) => {
    return embedText(text, true); // Queries use isQuery=true
  };
}

/**
 * Create a rerank function for use with SearchEngine.
 */
export function createRerankFunction(): (
  query: string,
  docs: { file: string; text: string }[]
) => Promise<{ file: string; score: number }[]> {
  return async (query, docs) => {
    const results = await rerank(query, docs);
    return results.map((r) => ({ file: r.file, score: r.score }));
  };
}

// =============================================================================
// Model Warmup and Health
// =============================================================================

/**
 * Warm up models by running a dummy operation.
 * Checks if embed-rerank server is available.
 */
export async function warmupModels(): Promise<void> {
  if (modelsWarmed) return;

  console.log("Checking rerank server...");
  const start = Date.now();

  try {
    // Check if embed-rerank server is running
    const available = await isRerankServerAvailable();
    if (available) {
      // Warm up with a test query
      const rerankStart = Date.now();
      await rerank("warmup", [{ file: "test", text: "test document" }]);
      console.log(`  Rerank server ready (${Date.now() - rerankStart}ms)`);
      modelsWarmed = true;
    } else {
      console.log("  Rerank server not available - running FTS-only mode");
      console.log("  Start with: uv run embed-rerank --port 9000");
    }
    console.log(`Warmup completed in ${Date.now() - start}ms`);
  } catch (error) {
    console.error("Failed to warm up rerank:", error);
    // Don't throw - allow daemon to continue without reranking
  }
}

/**
 * Check if models are available by trying to load llama.
 */
export async function checkModelsAvailable(): Promise<boolean> {
  try {
    await ensureLlama();
    return true;
  } catch (error) {
    console.error("LLM health check failed:", error);
    return false;
  }
}

/**
 * Dispose all LLM resources.
 */
export async function disposeLLM(): Promise<void> {
  if (embedContext) {
    await embedContext.dispose();
    embedContext = null;
  }
  if (rerankContext) {
    await rerankContext.dispose();
    rerankContext = null;
  }
  if (embedModel) {
    await embedModel.dispose();
    embedModel = null;
  }
  if (rerankModel) {
    await rerankModel.dispose();
    rerankModel = null;
  }
  if (llama) {
    // llama.dispose() can hang, so use timeout
    const disposePromise = llama.dispose();
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 1000));
    await Promise.race([disposePromise, timeoutPromise]);
    llama = null;
  }
  modelsWarmed = false;
}
