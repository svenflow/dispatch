/**
 * Search engine combining FTS, vector search, and reranking.
 */

import { Store, SearchResult, hashContent } from "./store";

// =============================================================================
// Types
// =============================================================================

export interface RankedResult extends SearchResult {
  rrfScore: number;
  ftsRank?: number;
  vecRank?: number;
  rerankScore?: number;
  bestChunkIdx?: number;
}

// Reranking chunk size - smaller for faster reranking (500 chars = ~125 tokens)
// We use smaller chunks than embedding because reranker just needs relevance signal
const RERANK_CHUNK_SIZE = 500;
const RERANK_CHUNK_OVERLAP = 50;

// =============================================================================
// Vector Math
// =============================================================================

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dotProduct / denom : 0;
}

// =============================================================================
// Search Engine
// =============================================================================

export class SearchEngine {
  private store: Store;
  private embedFn?: (text: string) => Promise<Float32Array>;
  private rerankFn?: (query: string, docs: { file: string; text: string }[]) => Promise<{ file: string; score: number }[]>;

  constructor(store: Store) {
    this.store = store;
  }

  /**
   * Set the embedding function (injected from llm.ts)
   */
  setEmbedFunction(fn: (text: string) => Promise<Float32Array>): void {
    this.embedFn = fn;
  }

  /**
   * Set the reranking function (injected from llm.ts)
   */
  setRerankFunction(fn: (query: string, docs: { file: string; text: string }[]) => Promise<{ file: string; score: number }[]>): void {
    this.rerankFn = fn;
  }

  /**
   * Full-text search using FTS5/BM25
   */
  searchFTS(query: string, limit: number = 20, category?: string, after?: number, before?: number): SearchResult[] {
    return this.store.searchFTS(query, limit, category, after, before);
  }

  /**
   * Vector similarity search
   */
  async searchVector(query: string, limit: number = 20, category?: string, after?: number, before?: number): Promise<SearchResult[]> {
    if (!this.embedFn) {
      console.warn("No embedding function set, skipping vector search");
      return [];
    }

    // Embed the query
    const queryEmbedding = await this.embedFn(query);

    // Get all embeddings from store
    const allEmbeddings = this.store.getAllEmbeddings();

    // Calculate similarities
    const similarities: { hashSeq: string; score: number }[] = [];
    for (const { hashSeq, embedding } of allEmbeddings) {
      const score = cosineSimilarity(queryEmbedding, embedding);
      similarities.push({ hashSeq, score });
    }

    // Sort by score descending
    similarities.sort((a, b) => b.score - a.score);

    // Get top results
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    for (const { hashSeq, score } of similarities) {
      if (results.length >= limit) break;

      const hash = hashSeq.split(":")[0];
      if (seen.has(hash)) continue;
      seen.add(hash);

      // Look up document by hash
      const content = this.store.getContent(hash);
      if (!content) continue;

      // Find document metadata
      // This is inefficient but works for now
      const allDocs = category
        ? this.store.getDocumentsByCategory(category)
        : [
            ...this.store.getDocumentsByCategory("transcripts"),
            ...this.store.getDocumentsByCategory("sms"),
            ...this.store.getDocumentsByCategory("skills"),
            ...this.store.getDocumentsByCategory("contacts"),
            ...this.store.getDocumentsByCategory("documents"),
          ];

      const doc = allDocs.find(d => d.hash === hash);
      if (!doc) continue;

      if (category && doc.category !== category) continue;

      // Time range filtering
      if (after && doc.mtime < after) continue;
      if (before && doc.mtime > before) continue;

      results.push({
        filepath: `${doc.category}/${doc.path}`,
        title: doc.title,
        body: content,
        score: score,
        source: "vec",
        category: doc.category,
      });
    }

    return results;
  }

  /**
   * Hybrid search combining FTS and vector with RRF fusion
   */
  async searchHybrid(query: string, limit: number = 20, category?: string, after?: number, before?: number): Promise<RankedResult[]> {
    // Get results from both methods
    const ftsResults = this.searchFTS(query, limit * 2, category, after, before);
    const vecResults = await this.searchVector(query, limit * 2, category, after, before);

    // RRF fusion
    const k = 60; // RRF constant
    const scores = new Map<string, RankedResult>();

    // Add FTS results
    ftsResults.forEach((result, rank) => {
      const key = result.filepath;
      const rrfScore = 1 / (k + rank + 1);

      if (!scores.has(key)) {
        scores.set(key, {
          ...result,
          rrfScore,
          ftsRank: rank,
          source: "hybrid",
        });
      } else {
        const existing = scores.get(key)!;
        existing.rrfScore += rrfScore;
        existing.ftsRank = rank;
      }
    });

    // Add vector results
    vecResults.forEach((result, rank) => {
      const key = result.filepath;
      const rrfScore = 1 / (k + rank + 1);

      if (!scores.has(key)) {
        scores.set(key, {
          ...result,
          rrfScore,
          vecRank: rank,
          source: "hybrid",
        });
      } else {
        const existing = scores.get(key)!;
        existing.rrfScore += rrfScore;
        existing.vecRank = rank;
      }
    });

    // Sort by RRF score
    const ranked = Array.from(scores.values()).sort((a, b) => b.rrfScore - a.rrfScore);

    // Update score to be the RRF score
    for (const result of ranked) {
      result.score = result.rrfScore;
    }

    return ranked.slice(0, limit);
  }

  /**
   * Get cache key for reranking.
   * Uses hash of the actual text content to automatically invalidate when content changes.
   */
  private getRerankCacheKey(query: string, text: string): string {
    return `rerank:${hashContent(query)}:${hashContent(text)}`;
  }

  /**
   * Simple chunking for reranking (smaller than embedding chunks).
   */
  private chunkForRerank(content: string): string[] {
    if (content.length <= RERANK_CHUNK_SIZE) {
      return [content];
    }

    const chunks: string[] = [];
    let start = 0;
    const maxChunks = 100; // Safety limit

    while (start < content.length && chunks.length < maxChunks) {
      let end = Math.min(start + RERANK_CHUNK_SIZE, content.length);

      // Try to break at sentence/paragraph (but don't go backwards)
      if (end < content.length) {
        const sentenceBreak = content.lastIndexOf(". ", end);
        if (sentenceBreak > start + RERANK_CHUNK_SIZE / 2) {
          end = sentenceBreak + 2;
        }
      }

      chunks.push(content.slice(start, end).trim());

      // Advance start, ensuring we always make progress
      const nextStart = end - RERANK_CHUNK_OVERLAP;
      start = Math.max(nextStart, start + 1);
      if (start >= content.length - 1) break;
    }

    return chunks.filter(c => c.length > 0);
  }

  /**
   * Select the best chunk from a document based on query keyword overlap.
   * This is smarter than just truncating - we pick the chunk most likely to be relevant.
   */
  private selectBestChunk(body: string, query: string): { text: string; idx: number } {
    const chunks = this.chunkForRerank(body);

    if (chunks.length === 0) {
      return { text: body.slice(0, RERANK_CHUNK_SIZE), idx: 0 };
    }

    if (chunks.length === 1) {
      return { text: chunks[0], idx: 0 };
    }

    // Score each chunk by query term overlap
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    let bestIdx = 0;
    let bestScore = -1;

    for (let i = 0; i < chunks.length; i++) {
      const chunkLower = chunks[i].toLowerCase();
      const score = queryTerms.reduce((acc, term) => acc + (chunkLower.includes(term) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    return { text: chunks[bestIdx], idx: bestIdx };
  }

  /**
   * Cached reranking - checks cache first, only calls LLM for uncached docs
   */
  private async cachedRerank(
    query: string,
    docs: { file: string; text: string }[]
  ): Promise<{ file: string; score: number }[]> {
    if (!this.rerankFn) return [];

    const cachedScores = new Map<string, number>();
    const uncachedDocs: { file: string; text: string }[] = [];

    // Check cache for each doc (use text hash to auto-invalidate on content change)
    const textMap = new Map<string, string>(); // file -> text for cache key lookup
    for (const doc of docs) {
      textMap.set(doc.file, doc.text);
      const cacheKey = this.getRerankCacheKey(query, doc.text);
      const cached = this.store.getCached(cacheKey);
      if (cached !== null) {
        cachedScores.set(doc.file, parseFloat(cached));
      } else {
        uncachedDocs.push(doc);
      }
    }

    // Rerank uncached docs
    if (uncachedDocs.length > 0) {
      const reranked = await this.rerankFn(query, uncachedDocs);

      // Cache the results (key by text hash, not file path)
      for (const result of reranked) {
        const text = textMap.get(result.file) || "";
        const cacheKey = this.getRerankCacheKey(query, text);
        this.store.setCached(cacheKey, result.score.toString());
        cachedScores.set(result.file, result.score);
      }
    }

    // Return all results sorted by score
    return docs
      .map(doc => ({ file: doc.file, score: cachedScores.get(doc.file) || 0 }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Full quality search with reranking
   */
  async search(query: string, limit: number = 20, category?: string, after?: number, before?: number): Promise<RankedResult[]> {
    // Get FTS results first (skip vector search to save RAM - no embeddings anyway)
    // Limit to 2x requested to give reranker some flexibility
    const ftsResults = this.searchFTS(query, Math.min(limit * 2, 30), category, after, before);

    // Convert to hybrid result format
    const hybridResults: RankedResult[] = ftsResults.map((r, idx) => ({
      ...r,
      rrfScore: 1 / (60 + idx + 1), // RRF-style score based on position
      ftsRank: idx,
      source: "hybrid" as const,
    }));

    if (hybridResults.length === 0) {
      return [];
    }

    // Rerank if function is available
    if (this.rerankFn && hybridResults.length > 0) {
      // Select best chunk per document (smarter than dumb truncation)
      const chunkMap = new Map<string, { text: string; idx: number }>();
      const docsToRerank = hybridResults.map(r => {
        const { text, idx } = this.selectBestChunk(r.body, query);
        chunkMap.set(r.filepath, { text, idx });
        return {
          file: r.filepath,
          text,
        };
      });

      try {
        const reranked = await this.cachedRerank(query, docsToRerank);

        // Create a map of rerank scores
        const rerankScores = new Map<string, number>();
        reranked.forEach((r) => {
          rerankScores.set(r.file, r.score);
        });

        // Blend RRF and rerank scores (position-aware)
        for (let i = 0; i < hybridResults.length; i++) {
          const result = hybridResults[i];
          const rerankScore = rerankScores.get(result.filepath) ?? 0;
          result.rerankScore = rerankScore;
          result.bestChunkIdx = chunkMap.get(result.filepath)?.idx ?? 0;

          // Position-aware blending
          let rrfWeight: number;
          if (i < 3) {
            rrfWeight = 0.75; // Top 3: trust retrieval more
          } else if (i < 10) {
            rrfWeight = 0.6; // 4-10: balanced
          } else {
            rrfWeight = 0.4; // 11+: trust reranker more
          }

          // Normalize RRF score to 0-1 range
          const maxRRF = hybridResults[0].rrfScore;
          const normalizedRRF = result.rrfScore / maxRRF;

          // Blend scores
          result.score = rrfWeight * normalizedRRF + (1 - rrfWeight) * rerankScore;
          result.source = "reranked";
        }

        // Re-sort by blended score
        hybridResults.sort((a, b) => b.score - a.score);
      } catch (error) {
        console.error("Reranking failed:", error);
        // Fall back to hybrid results without reranking
      }
    }

    return hybridResults.slice(0, limit);
  }
}
