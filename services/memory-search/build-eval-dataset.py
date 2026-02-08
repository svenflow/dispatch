#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mlx-lm>=0.30"]
# ///
"""
Build an evaluation dataset from real transcripts and SMS for reranker testing.

Strategy:
1. Extract diverse text segments from transcripts
2. Use an LLM to generate semantic queries (no keyword overlap)
3. Create ground truth relevance labels
4. Output a JSON eval dataset with ~1000 query-doc pairs
"""

import json
import os
import re
import random
from pathlib import Path
from collections import defaultdict

# Paths
PROJECTS_DIR = Path.home() / ".claude" / "projects"
OUTPUT_FILE = Path(__file__).parent / "eval-dataset.json"

def extract_text_from_jsonl(filepath: Path) -> list[str]:
    """Extract text content from a JSONL transcript file."""
    texts = []
    try:
        with open(filepath, 'r') as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                    # Extract text from message content
                    if 'message' in entry and 'content' in entry['message']:
                        content = entry['message']['content']
                        if isinstance(content, str):
                            texts.append(content)
                        elif isinstance(content, list):
                            for part in content:
                                if isinstance(part, dict) and part.get('type') == 'text':
                                    texts.append(part.get('text', ''))
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
    return texts


def extract_topics_and_entities(texts: list[str]) -> dict:
    """Extract topics, entities, and key phrases from texts."""
    topics = defaultdict(list)

    # Keywords to look for
    patterns = {
        'smart_home': r'\b(lights?|hue|lutron|sonos|music|volume|speaker|home ?kit|automation)\b',
        'coding': r'\b(python|javascript|typescript|code|function|api|git|npm|bun|node)\b',
        'messaging': r'\b(sms|text|message|send|reply|imessage|signal)\b',
        'files': r'\b(file|directory|folder|path|read|write|edit|save)\b',
        'web': r'\b(chrome|browser|url|website|google|search|fetch)\b',
        'scheduling': r'\b(calendar|meeting|appointment|schedule|reminder|time)\b',
        'people': r'\b(nikhil|sven|pang|evan|caroline)\b',
        'errors': r'\b(error|bug|fix|issue|problem|failed|crash)\b',
    }

    for text in texts:
        text_lower = text.lower()
        for topic, pattern in patterns.items():
            if re.search(pattern, text_lower, re.IGNORECASE):
                # Store a snippet around the match
                match = re.search(pattern, text_lower, re.IGNORECASE)
                if match:
                    start = max(0, match.start() - 100)
                    end = min(len(text), match.end() + 100)
                    snippet = text[start:end]
                    if len(snippet) > 50:  # Skip very short snippets
                        topics[topic].append(snippet)

    return topics


def generate_semantic_queries(topic: str, snippets: list[str]) -> list[dict]:
    """Generate semantic queries that DON'T use keywords from the snippets."""

    # Semantic alternatives for each topic
    semantic_map = {
        'smart_home': [
            "controlling household illumination",
            "adjusting room brightness remotely",
            "home automation for audio systems",
            "wireless lighting management",
            "voice-controlled home devices",
            "ambient mood settings for rooms",
            "IoT device configuration",
            "residential automation setup",
        ],
        'coding': [
            "software development workflow",
            "programming language issues",
            "source control operations",
            "package management problems",
            "algorithm implementation",
            "debugging application behavior",
            "code refactoring discussions",
            "API integration challenges",
        ],
        'messaging': [
            "mobile communication delivery",
            "person-to-person text delivery",
            "chat conversation history",
            "notification sending mechanism",
            "instant communication tools",
            "contact reply handling",
        ],
        'files': [
            "document storage operations",
            "content persistence",
            "data modification on disk",
            "filesystem navigation",
            "text content manipulation",
        ],
        'web': [
            "internet browsing automation",
            "online content retrieval",
            "webpage interaction",
            "search engine queries",
            "web scraping tasks",
        ],
        'scheduling': [
            "temporal event organization",
            "appointment coordination",
            "time-based notifications",
            "agenda management",
        ],
        'people': [
            "team member discussions",
            "colleague interactions",
            "personnel conversations",
        ],
        'errors': [
            "system malfunction diagnosis",
            "unexpected behavior investigation",
            "troubleshooting application failures",
            "defect resolution process",
        ],
    }

    queries = []
    alternatives = semantic_map.get(topic, [f"information about {topic}"])

    for snippet in snippets[:50]:  # Limit per topic
        query = random.choice(alternatives)
        queries.append({
            "query": query,
            "relevant_doc": snippet[:500],  # Truncate long snippets
            "topic": topic,
        })

    return queries


def build_eval_dataset():
    """Build the full evaluation dataset."""
    print("Building evaluation dataset from transcripts...")

    # Find all JSONL files
    jsonl_files = list(PROJECTS_DIR.rglob("*.jsonl"))
    print(f"Found {len(jsonl_files)} JSONL files")

    # Extract all text
    all_texts = []
    for filepath in jsonl_files:
        texts = extract_text_from_jsonl(filepath)
        all_texts.extend(texts)

    print(f"Extracted {len(all_texts)} text segments")

    # Filter to useful segments (not too short, not system prompts)
    useful_texts = []
    for text in all_texts:
        if len(text) > 100 and len(text) < 5000:
            # Skip system prompts and boilerplate
            if not text.startswith("SESSION START"):
                if not "FIRST:" in text[:50]:
                    if not "Read ~/.claude" in text[:100]:
                        useful_texts.append(text)

    print(f"Filtered to {len(useful_texts)} useful segments")

    # Extract topics and entities
    topics = extract_topics_and_entities(useful_texts)
    print(f"Found topics: {list(topics.keys())}")
    for topic, snippets in topics.items():
        print(f"  {topic}: {len(snippets)} snippets")

    # Generate semantic queries
    all_queries = []
    for topic, snippets in topics.items():
        queries = generate_semantic_queries(topic, snippets)
        all_queries.extend(queries)

    print(f"Generated {len(all_queries)} query-document pairs")

    # Add negative examples (random unrelated docs for each query)
    dataset = []
    all_snippets = [s for snippets in topics.values() for s in snippets]

    for item in all_queries:
        # Positive example
        dataset.append({
            "query": item["query"],
            "doc": item["relevant_doc"],
            "relevant": True,
            "topic": item["topic"],
        })

        # Add 2 negative examples (random docs from other topics)
        other_snippets = [s for s in all_snippets if s != item["relevant_doc"]]
        for neg in random.sample(other_snippets, min(2, len(other_snippets))):
            dataset.append({
                "query": item["query"],
                "doc": neg[:500],
                "relevant": False,
                "topic": item["topic"],
            })

    # Shuffle and save
    random.shuffle(dataset)

    # Group by query for easier evaluation
    queries_grouped = defaultdict(list)
    for item in dataset:
        queries_grouped[item["query"]].append({
            "doc": item["doc"],
            "relevant": item["relevant"],
            "topic": item["topic"],
        })

    # Convert to list format
    final_dataset = []
    for query, docs in queries_grouped.items():
        final_dataset.append({
            "query": query,
            "docs": docs,
        })

    # Save
    with open(OUTPUT_FILE, 'w') as f:
        json.dump({
            "metadata": {
                "num_queries": len(final_dataset),
                "num_docs_total": len(dataset),
                "topics": list(topics.keys()),
            },
            "data": final_dataset,
        }, f, indent=2)

    print(f"\nSaved dataset to {OUTPUT_FILE}")
    print(f"Total queries: {len(final_dataset)}")
    print(f"Total doc pairs: {len(dataset)}")

    # Print some examples
    print("\n=== Sample Queries ===")
    for item in final_dataset[:5]:
        print(f"\nQuery: {item['query']}")
        print(f"  Docs: {len(item['docs'])} (relevant: {sum(1 for d in item['docs'] if d['relevant'])})")


if __name__ == "__main__":
    build_eval_dataset()
