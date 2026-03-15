# Search Amazon Music

```bash
cd ~/code/dj-buyer && uv run dj-buyer search-amazon "Artist" "Title" [--json] [--no-cookies]
```

## When to Use

Best for major label releases, pop/mainstream tracks that aren't on Beatport or Bandcamp. Amazon has the widest overall catalog but the noisiest results for electronic music.

Search Amazon last — only if Beatport and Bandcamp don't have the track.

## Matching Guidance

- Amazon results are noisy — albums, compilations, and unrelated results mixed in
- **Only trust results with similarity >= 0.8** (higher threshold than other platforms)
- Artist names may include "feat." collaborators not in your search
- Price filtering is critical: valid digital track prices are $0.49-$3.99
- Anything outside that range is likely an album or physical product
- Amazon sometimes returns "All Departments" results when no digital music matches — the scraper detects and filters this

## Pricing

- Single tracks: $0.99-$1.29 (most common)
- Some tracks: $0.49 (older catalog)
- Albums mistakenly matched: $5.99-$14.99 (filter these out)

## Cookies

By default loads Chrome cookies for better Amazon session continuity. Use `--no-cookies` if Chrome isn't running or available.

## Output Fields (--json)

```json
{
  "artist": "Artist Name",
  "title": "Track Title",
  "link": "https://www.amazon.com/dp/B0XXXXX",
  "price": 1.29,
  "currency": "USD",
  "similarity": 0.88,
  "genre": "Electronic",
  "site": "amazon"
}
```

## How It Works

1. Visits Amazon homepage to establish session
2. Searches `amazon.com/s?k=Artist+Title&i=digital-music`
3. Parses search result HTML for product cards
4. Extracts artist (from "by" text), title, price, ASIN
5. Filters unrealistic prices ($0.49-$50 range)
6. Calculates similarity score using SequenceMatcher on artist+title
