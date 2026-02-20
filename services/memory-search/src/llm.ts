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
const MODEL_CACHE_DIR = join(HOME, ".cache", "jsmith-search", "models");

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
// Native Reranking Functions (via node-llama-cpp)
// =============================================================================

/**
 * Rerank documents using native node-llama-cpp with qwen3-reranker.
 * This is the primary reranking function - no external server needed.
 */
export async function rerankNative(
  query: string,
  documents: { file: string; text: string }[]
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];

  const context = await ensureRerankContext();

  // Score each document
  const results: RerankResult[] = [];
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    try {
      const score = await context.rank(query, doc.text);
      results.push({
        file: doc.file,
        score,
        index: i,
      });
    } catch (e) {
      // If ranking fails for a doc, log and give it lowest score
      console.error(`[rerank] Failed to rank doc ${doc.file}:`, e);
      results.push({
        file: doc.file,
        score: -Infinity,
        index: i,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Create a native rerank function for use with SearchEngine.
 * Uses node-llama-cpp with qwen3-reranker model.
 */
export function createNativeRerankFunction(): (
  query: string,
  docs: { file: string; text: string }[]
) => Promise<{ file: string; score: number }[]> {
  return async (query, docs) => {
    const results = await rerankNative(query, docs);
    return results.map((r) => ({ file: r.file, score: r.score }));
  };
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

// =============================================================================
// Model Warmup and Health
// =============================================================================

/**
 * Warm up native reranker model by running a dummy operation.
 * This loads the qwen3-reranker model into memory.
 */
export async function warmupModels(): Promise<void> {
  if (modelsWarmed) return;

  console.log("Warming up native reranker...");
  const start = Date.now();

  try {
    // Warm up native reranker with a test query
    const rerankStart = Date.now();
    await rerankNative("warmup query", [{ file: "test", text: "test document for warmup" }]);
    console.log(`  Native reranker ready (${Date.now() - rerankStart}ms)`);
    modelsWarmed = true;
    console.log(`Warmup completed in ${Date.now() - start}ms`);
  } catch (error) {
    console.error("Failed to warm up native reranker:", error);
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
