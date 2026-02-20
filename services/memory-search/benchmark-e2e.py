#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "httpx",
# ]
# ///
"""
End-to-end search benchmark using live FTS index + reranking.

Uses Claude to auto-label relevance for each result.
Tests different FTS window sizes and reranking strategies.
"""

import json
import subprocess
import time
from pathlib import Path

import httpx

# Test queries - realistic search queries
TEST_QUERIES = [
    "how to control philips hue lights",
    "signal message daemon setup",
    "SDK session management",
    "chrome extension browser automation",
    "memory search indexing",
    "contact tier system",
    "smart home lutron",
    "git commit workflow",
    "airbnb booking automation",
    "transcript directory structure",
]


def get_fts_results(query: str, limit: int = 20) -> list[dict]:
    """Get FTS results from memory-search."""
    resp = httpx.post(
        "http://localhost:7890/search",
        json={"query": query, "limit": limit},
        timeout=30,
    )
    return resp.json().get("results", [])


def search_memory_search(query: str, limit: int = 20) -> list[dict]:
    """Search via memory-search daemon (FTS + native qwen3-reranker)."""
    try:
        resp = httpx.get(
            f"http://localhost:7890/search?q={query}&limit={limit}",
            timeout=60,
        )
        data = resp.json()
        return data.get("results", [])
    except Exception as e:
        print(f"    Search error: {e}")
        return []


def rerank_with_msmarco(query: str, docs: list[str]) -> list[tuple[int, float]]:
    """Rerank using ms-marco cross-encoder (DEPRECATED - embed-rerank)."""
    try:
        resp = httpx.post(
            "http://localhost:9000/rerank",
            json={"query": query, "texts": docs},
            timeout=60,
        )
        results = resp.json()
        if isinstance(results, list):
            return [(r["index"], r["score"]) for r in results]
        return []
    except Exception as e:
        print(f"    Rerank error: {e}")
        return []


def rerank_with_claude(query: str, docs: list[str]) -> list[tuple[int, float]]:
    """Rerank using Claude."""
    doc_list = "\n".join(f"[{i}] {doc[:300]}" for i, doc in enumerate(docs))

    prompt = f"""Rank these documents by relevance to the query. Return indices in order of relevance.

Query: {query}

Documents:
{doc_list}

Return ONLY a JSON array of document indices, most relevant first, like [3, 1, 7, ...]. No explanation."""

    result = subprocess.run(
        ["claude", "-p", prompt, "--output-format", "text"],
        capture_output=True,
        text=True,
        timeout=60,
    )

    try:
        text = result.stdout.strip()
        start = text.find("[")
        end = text.rfind("]") + 1
        if start >= 0 and end > start:
            indices = json.loads(text[start:end])
            return [(idx, 1.0 - i * 0.01) for i, idx in enumerate(indices)]
    except:
        pass
    return []


def label_relevance_with_claude(query: str, docs: list[str]) -> list[bool]:
    """Use Claude to label each doc as relevant or not."""
    doc_list = "\n".join(f"[{i}] {doc[:300]}" for i, doc in enumerate(docs))

    prompt = f"""For the search query below, label each document as relevant (1) or not relevant (0).

Query: {query}

Documents:
{doc_list}

Return ONLY a JSON array of 0s and 1s, one per document, like [1, 0, 1, 0, ...]. No explanation."""

    result = subprocess.run(
        ["claude", "-p", prompt, "--output-format", "text"],
        capture_output=True,
        text=True,
        timeout=60,
    )

    try:
        text = result.stdout.strip()
        start = text.find("[")
        end = text.rfind("]") + 1
        if start >= 0 and end > start:
            labels = json.loads(text[start:end])
            return [bool(l) for l in labels]
    except:
        pass
    return []


def calculate_metrics(ranked_indices: list[int], relevant_set: set[int], k: int = 10) -> dict:
    """Calculate precision@k, recall@k, and MRR."""
    top_k = ranked_indices[:k]
    hits = len(set(top_k) & relevant_set)

    mrr = 0.0
    for i, idx in enumerate(ranked_indices):
        if idx in relevant_set:
            mrr = 1.0 / (i + 1)
            break

    return {
        "precision": hits / k if k > 0 else 0,
        "recall": hits / len(relevant_set) if relevant_set else 0,
        "mrr": mrr,
        "hits": hits,
        "total_relevant": len(relevant_set),
    }


def run_benchmark():
    """Run end-to-end benchmark."""

    # Test configurations
    fts_limits = [20, 50, 100]

    results = {}

    print(f"Running E2E benchmark on {len(TEST_QUERIES)} queries")
    print("=" * 70)

    for query in TEST_QUERIES:
        print(f"\nQuery: {query}")

        # Get max results for labeling
        fts_results = get_fts_results(query, limit=100)
        if not fts_results:
            print("  No FTS results, skipping")
            continue

        docs = [r.get("body", "")[:500] for r in fts_results]
        print(f"  FTS returned {len(docs)} docs")

        # Label all docs with Claude
        print("  Labeling with Claude...", end=" ", flush=True)
        start = time.time()
        labels = label_relevance_with_claude(query, docs)
        label_time = time.time() - start

        if not labels or len(labels) != len(docs):
            print(f"FAILED (got {len(labels)} labels)")
            continue

        relevant_set = {i for i, l in enumerate(labels) if l}
        print(f"done ({label_time:.1f}s) - {len(relevant_set)} relevant")

        if not relevant_set:
            print("  No relevant docs found, skipping")
            continue

        # Test each FTS limit
        for limit in fts_limits:
            subset_docs = docs[:limit]
            subset_relevant = {i for i in relevant_set if i < limit}

            # FTS-only (original order)
            fts_indices = list(range(len(subset_docs)))
            fts_metrics = calculate_metrics(fts_indices, subset_relevant)

            # Reranked
            start = time.time()
            reranked = rerank_with_msmarco(query, subset_docs)
            rerank_time = time.time() - start

            if reranked:
                rerank_indices = [r[0] for r in reranked]
                rerank_metrics = calculate_metrics(rerank_indices, subset_relevant)
            else:
                rerank_metrics = fts_metrics

            # Claude rerank (only for limit=20 to save time)
            if limit == 20:
                start = time.time()
                claude_reranked = rerank_with_claude(query, subset_docs)
                claude_time = time.time() - start

                if claude_reranked:
                    claude_indices = [r[0] for r in claude_reranked]
                    claude_metrics = calculate_metrics(claude_indices, subset_relevant)
                else:
                    claude_metrics = fts_metrics
                    claude_time = 0
            else:
                claude_metrics = None
                claude_time = 0

            key = f"limit_{limit}"
            if key not in results:
                results[key] = {"fts": [], "rerank": [], "rerank_latency": [], "claude": [], "claude_latency": []}

            results[key]["fts"].append(fts_metrics)
            results[key]["rerank"].append(rerank_metrics)
            results[key]["rerank_latency"].append(rerank_time)
            if claude_metrics:
                results[key]["claude"].append(claude_metrics)
                results[key]["claude_latency"].append(claude_time)

            if claude_metrics:
                print(f"  limit={limit}: FTS P@10={fts_metrics['precision']:.2f} → ms-marco={rerank_metrics['precision']:.2f} → claude={claude_metrics['precision']:.2f} ({claude_time:.1f}s)")
            else:
                print(f"  limit={limit}: FTS P@10={fts_metrics['precision']:.2f} → Rerank P@10={rerank_metrics['precision']:.2f} ({rerank_time*1000:.0f}ms)")

    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)

    for limit in fts_limits:
        key = f"limit_{limit}"
        if key not in results:
            continue

        n = len(results[key]["fts"])

        fts_p = sum(m["precision"] for m in results[key]["fts"]) / n
        fts_r = sum(m["recall"] for m in results[key]["fts"]) / n
        fts_mrr = sum(m["mrr"] for m in results[key]["fts"]) / n

        rr_p = sum(m["precision"] for m in results[key]["rerank"]) / n
        rr_r = sum(m["recall"] for m in results[key]["rerank"]) / n
        rr_mrr = sum(m["mrr"] for m in results[key]["rerank"]) / n
        rr_lat = sum(results[key]["rerank_latency"]) / n * 1000

        print(f"\nFTS limit={limit} ({n} queries):")
        print(f"  FTS only:    P@10={fts_p:.3f}  R@10={fts_r:.3f}  MRR={fts_mrr:.3f}")
        print(f"  + ms-marco:  P@10={rr_p:.3f}  R@10={rr_r:.3f}  MRR={rr_mrr:.3f}  ({rr_lat:.0f}ms)")

        if results[key]["claude"]:
            nc = len(results[key]["claude"])
            cl_p = sum(m["precision"] for m in results[key]["claude"]) / nc
            cl_r = sum(m["recall"] for m in results[key]["claude"]) / nc
            cl_mrr = sum(m["mrr"] for m in results[key]["claude"]) / nc
            cl_lat = sum(results[key]["claude_latency"]) / nc
            print(f"  + claude:    P@10={cl_p:.3f}  R@10={cl_r:.3f}  MRR={cl_mrr:.3f}  ({cl_lat:.1f}s)")
            print(f"  Δ vs FTS:    ms-marco {(rr_p - fts_p)*100:+.1f}%  claude {(cl_p - fts_p)*100:+.1f}%")
        else:
            print(f"  Δ precision: {(rr_p - fts_p)*100:+.1f}%")


if __name__ == "__main__":
    run_benchmark()
