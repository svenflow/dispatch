#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "httpx",
# ]
# ///
"""
Benchmark different reranking approaches on the eval dataset.

Uses eval dataset docs directly (with known relevance labels) to measure quality.
"""

import json
import subprocess
import time
from pathlib import Path

import httpx

# Load eval dataset
EVAL_PATH = Path(__file__).parent / "eval-dataset.json"
with open(EVAL_PATH) as f:
    EVAL_DATA = json.load(f)

# Use first 15 queries for benchmark
QUERIES = EVAL_DATA["data"][:15]


def rerank_with_embed_rerank(query: str, docs: list[str], port: int = 9000) -> list[tuple[int, float]]:
    """Rerank using embed-rerank server (TEI-compatible endpoint)."""
    try:
        resp = httpx.post(
            f"http://localhost:{port}/rerank",
            json={"query": query, "texts": docs},
            timeout=60,
        )
        # TEI endpoint returns array directly (sorted by score descending)
        results = resp.json()
        if isinstance(results, list):
            return [(r["index"], r["score"]) for r in results]
        return []
    except Exception as e:
        print(f"    Error: {e}")
        return []


def rerank_with_claude(query: str, docs: list[str], top_k: int = 10) -> list[tuple[int, float]]:
    """Rerank using Claude via Agent SDK."""
    # Format docs with indices
    doc_list = "\n".join(f"[{i}] {doc[:400]}" for i, doc in enumerate(docs))

    prompt = f"""You are a relevance judge. Given a query and a list of documents, return the indices of the {top_k} most relevant documents in order of relevance.

Query: {query}

Documents:
{doc_list}

Return ONLY a JSON array of document indices in order of relevance, like [3, 1, 7, ...]. No explanation."""

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
            return [(idx, 1.0 - i * 0.05) for i, idx in enumerate(indices)]
    except:
        pass
    return []


def calculate_metrics(ranked_indices: list[int], relevant_set: set[int], k: int = 10) -> dict:
    """Calculate precision@k, recall@k, and MRR."""
    top_k = ranked_indices[:k]
    hits = len(set(top_k) & relevant_set)

    # MRR: reciprocal rank of first relevant result
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
    }


def run_benchmark(test_claude: bool = False, num_claude_queries: int = 5):
    """Run the benchmark."""
    metrics = {
        "random": {"precision": [], "recall": [], "mrr": []},
        "embed_similarity": {"precision": [], "recall": [], "mrr": []},
        "claude": {"precision": [], "recall": [], "mrr": []},
    }
    latencies = {
        "embed_similarity": [],
        "claude": [],
    }

    print(f"Running benchmark on {len(QUERIES)} queries...")
    print(f"Using eval dataset docs with known relevance labels")
    print("-" * 60)

    for i, item in enumerate(QUERIES):
        query = item["query"]
        docs = [d["doc"] for d in item["docs"]]
        relevant_set = {j for j, d in enumerate(item["docs"]) if d["relevant"]}

        print(f"\n[{i+1}/{len(QUERIES)}] Query: {query}")
        print(f"  Docs: {len(docs)}, Relevant: {len(relevant_set)}")

        # Random baseline (original order)
        random_indices = list(range(len(docs)))
        m = calculate_metrics(random_indices, relevant_set)
        metrics["random"]["precision"].append(m["precision"])
        metrics["random"]["recall"].append(m["recall"])
        metrics["random"]["mrr"].append(m["mrr"])

        # Embed similarity rerank
        start = time.time()
        embed_ranks = rerank_with_embed_rerank(query, docs)
        latency = time.time() - start
        latencies["embed_similarity"].append(latency)

        if embed_ranks:
            embed_indices = [r[0] for r in embed_ranks]
            m = calculate_metrics(embed_indices, relevant_set)
            metrics["embed_similarity"]["precision"].append(m["precision"])
            metrics["embed_similarity"]["recall"].append(m["recall"])
            metrics["embed_similarity"]["mrr"].append(m["mrr"])
            print(f"  Embed: P@10={m['precision']:.2f} R@10={m['recall']:.2f} MRR={m['mrr']:.2f} ({latency*1000:.0f}ms)")
        else:
            print(f"  Embed: FAILED")

        # Claude rerank (limited queries due to cost)
        if test_claude and i < num_claude_queries:
            start = time.time()
            claude_ranks = rerank_with_claude(query, docs, top_k=len(docs))
            latency = time.time() - start
            latencies["claude"].append(latency)

            if claude_ranks:
                claude_indices = [r[0] for r in claude_ranks]
                m = calculate_metrics(claude_indices, relevant_set)
                metrics["claude"]["precision"].append(m["precision"])
                metrics["claude"]["recall"].append(m["recall"])
                metrics["claude"]["mrr"].append(m["mrr"])
                print(f"  Claude: P@10={m['precision']:.2f} R@10={m['recall']:.2f} MRR={m['mrr']:.2f} ({latency*1000:.0f}ms)")
            else:
                print(f"  Claude: FAILED")

    # Summary
    print("\n" + "=" * 60)
    print("BENCHMARK RESULTS")
    print("=" * 60)

    for method in ["random", "embed_similarity", "claude"]:
        if metrics[method]["precision"]:
            n = len(metrics[method]["precision"])
            avg_p = sum(metrics[method]["precision"]) / n
            avg_r = sum(metrics[method]["recall"]) / n
            avg_mrr = sum(metrics[method]["mrr"]) / n

            print(f"\n{method.upper()}:")
            print(f"  Queries: {n}")
            print(f"  Avg P@10: {avg_p:.3f}")
            print(f"  Avg R@10: {avg_r:.3f}")
            print(f"  Avg MRR:  {avg_mrr:.3f}")

            if method in latencies and latencies[method]:
                avg_lat = sum(latencies[method]) / len(latencies[method]) * 1000
                print(f"  Avg Latency: {avg_lat:.0f}ms")


if __name__ == "__main__":
    import sys
    test_claude = "--claude" in sys.argv
    run_benchmark(test_claude=test_claude)
