#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mlx-lm>=0.30"]
# ///
"""
Comprehensive benchmark of 2026 OSS models for reranking on Apple Silicon.
Tests both speed and semantic quality.
"""

import time
import re
from mlx_lm import load, generate

# Test documents with clear relevance signals
TEST_DOCS = [
    "The Philips Hue lights can be controlled via the Hue Bridge using the API.",  # lights - high
    "Yesterday we discussed the project timeline and budget allocation.",  # unrelated
    "To turn on the living room lights, use the command: hue lights on --room living",  # lights - high
    "The meeting notes from last week covered quarterly planning.",  # unrelated
    "Smart home automation includes controlling lights, thermostats, and security.",  # lights - medium
    "Python is a popular programming language for data science.",  # unrelated
    "The kitchen lights are connected to the Lutron Caseta dimmer switch.",  # lights - high
    "Machine learning models can be trained on various datasets.",  # unrelated
    "LED lights consume less energy than traditional incandescent bulbs.",  # lights - medium
    "The weather forecast shows rain expected tomorrow afternoon.",  # unrelated
]

# Expected: docs 0,2,4,6,8 should score high, docs 1,3,5,7,9 should score low
EXPECTED_HIGH = {0, 2, 4, 6, 8}  # Light-related docs

# Models to test (2026 OSS with MLX support)
MODELS = [
    # Qwen3 family
    ("Qwen/Qwen3-0.6B-MLX-4bit", "Qwen3-0.6B"),
    ("Qwen/Qwen3-1.7B-MLX-4bit", "Qwen3-1.7B"),
    ("Qwen/Qwen3-4B-MLX-4bit", "Qwen3-4B"),
    # Gemma 3 family
    ("mlx-community/gemma-3-1b-it-4bit", "Gemma3-1B"),
    ("mlx-community/gemma-3-4b-it-4bit", "Gemma3-4B"),
]

def create_prompt(query: str, docs: list[str]) -> str:
    """Create scoring prompt."""
    doc_list = "\n".join([f"[{i+1}] {doc[:100]}" for i, doc in enumerate(docs)])
    return f"""Query: "{query}"
Rate relevance 0-10 for each doc. Output only 10 space-separated integers.

{doc_list}

Scores:"""


def parse_scores(response: str) -> list[int]:
    """Extract scores from response."""
    numbers = re.findall(r'\d+', response)
    return [int(n) for n in numbers[:10]]


def evaluate_quality(scores: list[int]) -> dict:
    """Evaluate if model correctly ranked light-related docs higher."""
    if len(scores) < 10:
        return {"valid": False, "precision": 0, "recall": 0}

    # Get top 5 by score
    ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
    top5_indices = set(idx for idx, _ in ranked[:5])

    # Calculate precision/recall
    true_positives = len(top5_indices & EXPECTED_HIGH)
    precision = true_positives / 5 if top5_indices else 0
    recall = true_positives / len(EXPECTED_HIGH)

    return {
        "valid": True,
        "precision": precision,
        "recall": recall,
        "f1": 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0,
        "scores": scores,
    }


def benchmark_model(model_path: str, model_name: str, query: str) -> dict:
    """Benchmark a single model."""
    print(f"\n{'='*60}")
    print(f"Testing: {model_name}")
    print(f"{'='*60}")

    # Load model
    print("Loading model...")
    load_start = time.time()
    try:
        model, tokenizer = load(model_path)
    except Exception as e:
        print(f"  FAILED to load: {e}")
        return {"model": model_name, "error": str(e)}
    load_time = time.time() - load_start
    print(f"  Loaded in {load_time:.2f}s")

    # Create prompt
    prompt = create_prompt(query, TEST_DOCS)

    # Apply chat template
    messages = [{"role": "user", "content": prompt}]
    try:
        formatted = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False
        )
    except TypeError:
        # Some models don't support enable_thinking
        formatted = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True
        )

    # Generate (warm up)
    print("  Warm-up run...")
    _ = generate(model, tokenizer, prompt=formatted, max_tokens=50, verbose=False)

    # Timed run
    print("  Timed run...")
    gen_start = time.time()
    response = generate(model, tokenizer, prompt=formatted, max_tokens=100, verbose=False)
    gen_time = time.time() - gen_start

    # Strip thinking tags if present
    if "</think>" in response:
        response = response.split("</think>")[-1].strip()

    print(f"  Response: {response[:100]}...")
    print(f"  Generation time: {gen_time*1000:.0f}ms")

    # Parse and evaluate
    scores = parse_scores(response)
    quality = evaluate_quality(scores)

    result = {
        "model": model_name,
        "load_time_s": load_time,
        "gen_time_ms": gen_time * 1000,
        "per_doc_ms": gen_time * 1000 / 10,
        "response": response[:200],
        **quality
    }

    if quality["valid"]:
        print(f"  Precision: {quality['precision']:.0%}")
        print(f"  Recall: {quality['recall']:.0%}")
        print(f"  F1: {quality['f1']:.2f}")
    else:
        print(f"  Invalid output (got {len(scores)} scores)")

    # Cleanup
    del model, tokenizer

    return result


def main():
    print("=" * 60)
    print("MLX RERANKER BENCHMARK - 2026 OSS Models")
    print("=" * 60)
    print(f"Machine: Apple M4 Pro, 64GB RAM")
    print(f"Test: 10 documents, semantic query")
    print(f"Query: 'home illumination control' (no 'lights' keyword)")
    print()

    query = "home illumination control"
    results = []

    for model_path, model_name in MODELS:
        try:
            result = benchmark_model(model_path, model_name, query)
            results.append(result)
        except Exception as e:
            print(f"Error testing {model_name}: {e}")
            results.append({"model": model_name, "error": str(e)})

    # Summary report
    print("\n" + "=" * 60)
    print("BENCHMARK RESULTS SUMMARY")
    print("=" * 60)
    print(f"\n{'Model':<20} {'Gen(ms)':<10} {'Per-doc':<10} {'F1':<8} {'Notes'}")
    print("-" * 60)

    for r in results:
        if "error" in r:
            print(f"{r['model']:<20} {'ERROR':<10} {'-':<10} {'-':<8} {r['error'][:30]}")
        elif not r.get("valid", False):
            print(f"{r['model']:<20} {r['gen_time_ms']:<10.0f} {r['per_doc_ms']:<10.1f} {'INVALID':<8}")
        else:
            print(f"{r['model']:<20} {r['gen_time_ms']:<10.0f} {r['per_doc_ms']:<10.1f} {r['f1']:<8.2f}")

    print("\n" + "=" * 60)
    print("RECOMMENDATIONS")
    print("=" * 60)

    # Find best by speed and quality
    valid = [r for r in results if r.get("valid", False)]
    if valid:
        fastest = min(valid, key=lambda x: x["gen_time_ms"])
        best_quality = max(valid, key=lambda x: x["f1"])
        print(f"Fastest: {fastest['model']} ({fastest['per_doc_ms']:.1f}ms/doc)")
        print(f"Best quality: {best_quality['model']} (F1={best_quality['f1']:.2f})")


if __name__ == "__main__":
    main()
