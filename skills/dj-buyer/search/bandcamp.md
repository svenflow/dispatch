# Search Bandcamp

```bash
cd ~/code/dj-buyer && uv run dj-buyer search-bandcamp "Artist" "Title" [--json]
```

## When to Use

Best platform for independent/underground artists, electronic music, and name-your-price tracks. Bandcamp has the widest selection of niche electronic music and DJ-friendly releases. Many tracks are free or pay-what-you-want.

## Matching Guidance

- Bandcamp artists often use different naming — "DJ X" vs just "X"
- Similarity >= 0.7 is a confident match
- For remixes, verify BOTH the remix artist AND original artist match
- Tags (genre field) are user-generated and very specific (e.g., "deep house, minimal, dub techno") — use these to validate genre
- Subhead format is "by Artist Name" — the scraper extracts this automatically

## Pricing

Returns `pricing_type` field:
- `fixed_price` — set price, no negotiation
- `minimum_price` — pay at least this much (common for $1+ tracks)
- `name_your_price` — free or whatever you want

Bandcamp is almost always the cheapest option. Check here first if price matters.

## Output Fields (--json)

```json
{
  "artist": "Artist Name",
  "title": "Track Title",
  "link": "https://artist.bandcamp.com/track/...",
  "price": 1.00,
  "currency": "USD",
  "pricing_type": "minimum_price",
  "similarity": 0.85,
  "genre": "house, deep house, minimal",
  "site": "bandcamp"
}
```

## How It Works

1. Searches `bandcamp.com/search?q=Artist+-+Title&item_type=t`
2. Parses search result HTML for track listings
3. For each result, fetches the track page to extract price from `data-tralbum` JSON
4. Calculates similarity score using SequenceMatcher on artist+title
