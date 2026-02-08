#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mlx-lm>=0.30"]
# ///
"""
Benchmark reranker models on the real transcript-based eval dataset.
"""

import json
import time
import re
from pathlib import Path
from collections import defaultdict
from mlx_lm import load, generate

EVAL_FILE = Path(__file__).parent / "eval-dataset.json"

# Models to test
MODELS = [
    "mlx-community/gemma-3-1b-it-4bit",
    "mlx-community/gemma-3-4b-it-4bit",
]

def create_rerank_prompt(query: str, docs: list[str]) -> str:
    """Create a prompt that asks the LLM to score all documents at once."""
    doc_list = "\n".join([f"Doc{i+1}: {doc[:150]}" for i, doc in enumerate(docs)])
    return f"""Query: "{query}"
Rate relevance 0-10 for each doc. Output only numbers separated by commas.

{doc_list}

Scores:"""


def parse_scores(response: str, num_docs: int) -> list[int]:
    """Parse scores from response."""
    # Strip thinking tags if present
    if "<think>" in response:
        think_end = response.find("</think>")
        if think_end >= 0:
            response = response[think_end + 8:].strip()

    # Extract all integers from response
    numbers = re.findall(r'\d+', response)
    scores = [int(n) for n in numbers[:num_docs]]

    # Pad with zeros if not enough
    while len(scores) < num_docs:
        scores.append(0)

    return scores


def evaluate_query(model, tokenizer, query: str, docs: list[dict]) -> dict:
    """Evaluate a single query against its documents."""
    doc_texts = [d["doc"] for d in docs]
    relevance = [d["relevant"] for d in docs]

    prompt = create_rerank_prompt(query, doc_texts)

    # Format with chat template
    messages = [{"role": "user", "content": prompt}]
    formatted = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False
    )

    start = time.time()
    response = generate(
        model,
        tokenizer,
        prompt=formatted,
        max_tokens=100,
        verbose=False,
    )
    gen_time = time.time() - start

    scores = parse_scores(response, len(docs))

    # Calculate metrics
    # Threshold: score >= 5 means predicted relevant
    predicted = [s >= 5 for s in scores]

    tp = sum(1 for p, r in zip(predicted, relevance) if p and r)
    fp = sum(1 for p, r in zip(predicted, relevance) if p and not r)
    fn = sum(1 for p, r in zip(predicted, relevance) if not p and r)
    tn = sum(1 for p, r in zip(predicted, relevance) if not p and not r)

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    return {
        "query": query,
        "num_docs": len(docs),
        "scores": scores,
        "predicted": predicted,
        "actual": relevance,
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "gen_time_ms": gen_time * 1000,
    }


def run_benchmark(model_name: str, data: list[dict], max_queries: int = 20) -> dict:
    """Run benchmark for a single model."""
    print(f"\n{'='*60}")
    print(f"Testing: {model_name}")
    print(f"{'='*60}")

    load_start = time.time()
    model, tokenizer = load(model_name)
    load_time = time.time() - load_start
    print(f"Model loaded in {load_time:.2f}s")

    results = []
    topic_results = defaultdict(list)

    queries_to_test = data[:max_queries]

    for i, item in enumerate(queries_to_test):
        query = item["query"]
        docs = item["docs"]

        # Skip if too few docs
        if len(docs) < 3:
            continue

        result = evaluate_query(model, tokenizer, query, docs[:10])  # Max 10 docs per query
        results.append(result)

        # Track by topic
        topic = docs[0]["topic"] if docs else "unknown"
        topic_results[topic].append(result)

        if (i + 1) % 5 == 0:
            print(f"  Processed {i+1}/{len(queries_to_test)} queries...")

    # Aggregate metrics
    total_tp = sum(r["tp"] for r in results)
    total_fp = sum(r["fp"] for r in results)
    total_fn = sum(r["fn"] for r in results)

    overall_precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0
    overall_recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0
    overall_f1 = 2 * overall_precision * overall_recall / (overall_precision + overall_recall) if (overall_precision + overall_recall) > 0 else 0

    avg_gen_time = sum(r["gen_time_ms"] for r in results) / len(results) if results else 0
    total_docs = sum(r["num_docs"] for r in results)

    # Topic breakdown
    topic_f1 = {}
    for topic, tres in topic_results.items():
        ttp = sum(r["tp"] for r in tres)
        tfp = sum(r["fp"] for r in tres)
        tfn = sum(r["fn"] for r in tres)
        tprecision = ttp / (ttp + tfp) if (ttp + tfp) > 0 else 0
        trecall = ttp / (ttp + tfn) if (ttp + tfn) > 0 else 0
        topic_f1[topic] = 2 * tprecision * trecall / (tprecision + trecall) if (tprecision + trecall) > 0 else 0

    return {
        "model": model_name,
        "load_time_s": load_time,
        "num_queries": len(results),
        "total_docs": total_docs,
        "avg_gen_time_ms": avg_gen_time,
        "per_doc_ms": avg_gen_time * len(results) / total_docs if total_docs > 0 else 0,
        "precision": overall_precision,
        "recall": overall_recall,
        "f1": overall_f1,
        "topic_f1": topic_f1,
    }


def main():
    print("=" * 60)
    print("Reranker Evaluation on Real Transcript Dataset")
    print("=" * 60)

    # Load dataset
    with open(EVAL_FILE) as f:
        dataset = json.load(f)

    print(f"\nDataset: {dataset['metadata']['num_queries']} queries, {dataset['metadata']['num_docs_total']} doc pairs")
    print(f"Topics: {', '.join(dataset['metadata']['topics'])}")

    data = dataset["data"]

    # Run benchmarks
    all_results = []
    for model_name in MODELS:
        try:
            result = run_benchmark(model_name, data, max_queries=30)
            all_results.append(result)

            print(f"\nResults for {model_name.split('/')[-1]}:")
            print(f"  Precision: {result['precision']:.2f}")
            print(f"  Recall: {result['recall']:.2f}")
            print(f"  F1: {result['f1']:.2f}")
            print(f"  Avg gen time: {result['avg_gen_time_ms']:.0f}ms")
            print(f"  Per-doc latency: {result['per_doc_ms']:.1f}ms")

            # Clear model from memory
            del model_name
        except Exception as e:
            print(f"Error testing {model_name}: {e}")

    # Summary table
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"{'Model':<25} {'F1':>6} {'Prec':>6} {'Recall':>6} {'Time':>8}")
    print("-" * 60)
    for r in all_results:
        name = r["model"].split("/")[-1]
        print(f"{name:<25} {r['f1']:>6.2f} {r['precision']:>6.2f} {r['recall']:>6.2f} {r['avg_gen_time_ms']:>7.0f}ms")

    # Topic breakdown for best model
    if all_results:
        best = max(all_results, key=lambda x: x["f1"])
        print(f"\nTopic breakdown for {best['model'].split('/')[-1]}:")
        for topic, f1 in sorted(best["topic_f1"].items(), key=lambda x: -x[1]):
            print(f"  {topic}: F1={f1:.2f}")

    # Save results
    output_file = Path(__file__).parent / "eval-results.json"
    with open(output_file, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nResults saved to {output_file}")


if __name__ == "__main__":
    main()
