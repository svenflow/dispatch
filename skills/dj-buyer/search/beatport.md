# Search Beatport

```bash
cd ~/code/dj-buyer && uv run dj-buyer search-beatport "Artist" "Title" [--json]
```

## When to Use

Primary store for professional DJs. Best for mainstream electronic/dance music with proper tagging. Tracks are categorized by curated genre (Tech House, Melodic Techno, etc.) and include mix names (Original Mix, Extended Mix, etc.).

Search Beatport first when looking for electronic/dance tracks — it has the most reliable metadata.

## Matching Guidance

- Titles often include "(Original Mix)" or "(Extended Mix)" — the scorer handles this
- Prefer "Original Mix" or "Extended Mix" over radio edits for DJ use
- Beatport has the most reliable artist/title metadata of the 3 platforms
- Genre field is curated (not user-tags) so it's authoritative
- If a track exists on Beatport, it's almost certainly the correct version
- API returns both `genre` and `sub_genre` — combined as "Genre / Sub Genre"

## Pricing

- MP3: typically $1.49-$2.49 per track
- WAV: typically $2.49-$3.49 per track
- Currency may vary (USD, EUR, GBP)
- Format options may be included in results

## Output Fields (--json)

```json
{
  "artist": "Artist Name",
  "title": "Track Title (Original Mix)",
  "link": "https://www.beatport.com/track/slug/12345",
  "price": 1.49,
  "currency": "USD",
  "similarity": 0.92,
  "genre": "Tech House / Minimal Tech House",
  "site": "beatport"
}
```

## How It Works

1. Fetches the search page to extract an access token from `__NEXT_DATA__`
2. Calls Beatport API: `api.beatport.com/search/v1/all/?q=...`
3. Parses track data including artist, title, price, genre, artwork
4. Falls back to HTML parsing if API fails
5. Calculates similarity score using SequenceMatcher on artist+title
