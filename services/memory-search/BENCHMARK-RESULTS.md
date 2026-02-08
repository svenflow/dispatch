# Reranker Benchmark Results

Last updated: 2026-02-07

## Summary

**Winner: qwen3-reranker-0.6B (cross-encoder)**

The dedicated cross-encoder approach outperforms batch LLM scoring on both speed AND quality for semantic search over transcript data.

## Test Setup

- **Machine**: M4 Pro, 64GB RAM
- **Dataset**: 43 queries, 1101 document pairs extracted from real SMS transcripts
- **Query types**: Semantic (no direct keyword match) across 8 topic categories
- **Metric**: F1 score (harmonic mean of precision and recall)

## Full Results

| Model | Type | F1 Score | Avg Time (ms) | Per-Doc (ms) |
|-------|------|----------|---------------|--------------|
| qwen3-reranker-0.6B | cross-encoder | **0.44** | **388** | ~35 |
| gemma-3-1b-it-4bit | batch LLM | 0.38 | 720 | 73 |
| Qwen3-4B | batch LLM | 0.37 | 1002 | 101 |
| gemma-3-4b-it-4bit | batch LLM | 0.32 | 1086 | 110 |
| Qwen3-1.7B | batch LLM | 0.21 | 927 | 94 |
| Qwen3-0.6B | batch LLM | 0.09 | 303 | 31 |

## Key Findings

### 1. Cross-encoder > Batch LLM

Despite the batch approach processing all documents in one prompt (theoretically faster), the cross-encoder is both:
- **Faster**: 388ms vs 720ms+ for comparable quality
- **More accurate**: F1=0.44 vs best LLM F1=0.38

The cross-encoder model (qwen3-reranker-0.6B) is specifically trained for semantic similarity, while general LLMs must be prompted to score relevance.

### 2. Bigger ≠ Better for batch LLM

Gemma 1B outperformed Gemma 4B (F1=0.38 vs F1=0.32). The 4B model had higher precision but much lower recall - it was too conservative in what it considered relevant.

### 3. Quality threshold at 4B for semantic understanding

In initial synthetic tests, Qwen3-4B showed "perfect" semantic understanding (mapping "illumination" → lights). However, on real diverse data, this advantage didn't hold. The simpler cross-encoder achieved better generalization.

## Topic-by-Topic F1 (Gemma 1B)

| Topic | F1 Score |
|-------|----------|
| scheduling | 0.56 |
| errors | 0.47 |
| files | 0.40 |
| smart_home | 0.39 |
| coding | 0.35 |
| messaging | 0.34 |
| people | 0.32 |
| web | 0.29 |

Scheduling and error-related queries performed best. Web and people queries were hardest.

## Recommendation

**Use the existing cross-encoder (qwen3-reranker via node-llama-cpp)**

It's already integrated in nicklaude-search and is the optimal choice for:
- Speed: Sub-400ms for 10 documents
- Quality: Best F1 on real data
- Simplicity: Single model call per document pair

## Eval Dataset

The evaluation dataset (`eval-dataset.json`) contains:
- 43 semantic queries across 8 topic categories
- ~1100 query-document pairs with binary relevance labels
- Generated from real SMS transcripts via `build-eval-dataset.py`

To run the benchmark:
```bash
uv run eval-benchmark.py --model "mlx-community/gemma-3-1b-it-4bit"
```
