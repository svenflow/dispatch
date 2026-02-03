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
}

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
   * Full quality search with reranking
   */
  async search(query: string, limit: number = 20, category?: string, after?: number, before?: number): Promise<RankedResult[]> {
    // Get hybrid results first
    const hybridResults = await this.searchHybrid(query, limit * 2, category, after, before);

    if (hybridResults.length === 0) {
      return [];
    }

    // Rerank if function is available
    if (this.rerankFn && hybridResults.length > 0) {
      const docsToRerank = hybridResults.map(r => ({
        file: r.filepath,
        text: r.body.slice(0, 4000), // Truncate for reranker context
      }));

      try {
        const reranked = await this.rerankFn(query, docsToRerank);

        // Create a map of rerank scores
        const rerankScores = new Map<string, number>();
        reranked.forEach((r, idx) => {
          rerankScores.set(r.file, r.score);
        });

        // Blend RRF and rerank scores (position-aware)
        for (let i = 0; i < hybridResults.length; i++) {
          const result = hybridResults[i];
          const rerankScore = rerankScores.get(result.filepath) ?? 0;
          result.rerankScore = rerankScore;

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
