#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mlx-lm>=0.30"]
# ///
"""
Test MLX-based batch reranking with Qwen3-0.6B.
Instead of running 10 separate cross-encoder passes, we prompt the LLM once
to score all documents in a single forward pass.
"""

import time
import json
from mlx_lm import load, generate

# Test documents (simulating search results)
TEST_DOCS = [
    "The Philips Hue lights can be controlled via the Hue Bridge using the API.",
    "Yesterday we discussed the project timeline and budget allocation.",
    "To turn on the living room lights, use the command: hue lights on --room living",
    "The meeting notes from last week covered quarterly planning.",
    "Smart home automation includes controlling lights, thermostats, and security.",
    "Python is a popular programming language for data science.",
    "The kitchen lights are connected to the Lutron Caseta dimmer switch.",
    "Machine learning models can be trained on various datasets.",
    "LED lights consume less energy than traditional incandescent bulbs.",
    "The weather forecast shows rain expected tomorrow afternoon.",
]

def create_rerank_prompt(query: str, docs: list[str]) -> str:
    """Create a prompt that asks the LLM to score all documents at once."""
    doc_list = "\n".join([f"Doc{i+1}: {doc[:100]}" for i, doc in enumerate(docs)])

    # Very direct, no placeholders
    return f"""Query: "{query}"
Rate relevance 0-10 for each doc. Output only numbers.

{doc_list}

Scores (10 integers):"""


def main():
    print("=== MLX Batch Reranking Test ===\n")

    # Load model - try 1.7B as sweet spot
    print("Loading Qwen3-1.7B-MLX...")
    start = time.time()
    model, tokenizer = load("Qwen/Qwen3-1.7B-MLX-4bit")
    load_time = time.time() - start
    print(f"Model loaded in {load_time:.2f}s\n")

    # Test semantic search - no exact keyword match
    query = "home illumination control"

    # Create batch prompt
    prompt = create_rerank_prompt(query, TEST_DOCS)
    print(f"Prompt length: {len(prompt)} chars")
    print(f"Prompt tokens: ~{len(prompt)//4}")

    # Generate scores
    print("\n--- Generating scores ---")
    start = time.time()

    # Use chat template with thinking DISABLED
    messages = [{"role": "user", "content": prompt}]
    formatted = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False  # Disable thinking for speed!
    )

    # Generate scores
    response = generate(
        model,
        tokenizer,
        prompt=formatted,
        max_tokens=100,  # Need room for 10 numbers
        verbose=False,
    )

    # Strip thinking tags if present
    if "<think>" in response:
        # Find the end of thinking
        think_end = response.find("</think>")
        if think_end >= 0:
            response = response[think_end + 8:].strip()

    gen_time = time.time() - start
    print(f"Generation time: {gen_time*1000:.2f}ms")
    print(f"Response: {response}")

    # Parse scores - expect comma-separated integers
    try:
        import re
        # Extract all integers from response
        numbers = re.findall(r'\d+', response)
        scores = [int(n) for n in numbers[:10]]  # Take first 10

        if len(scores) >= 10:
            print("\n--- Results ---")
            ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
            for idx, score in ranked:
                print(f"  Score {score}: {TEST_DOCS[idx][:60]}...")
        else:
            print(f"Not enough scores found: {scores}")
            print(f"Raw: {response}")
    except Exception as e:
        print(f"Failed to parse scores: {e}")
        print(f"Raw response: {response}")

    print(f"\n=== Summary ===")
    print(f"Model load: {load_time:.2f}s")
    print(f"Batch rerank (10 docs): {gen_time*1000:.2f}ms")
    print(f"Per-doc average: {gen_time*1000/10:.2f}ms")


if __name__ == "__main__":
    main()
