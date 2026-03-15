---
name: dj-buyer
description: Search and purchase DJ tracks from Bandcamp, Beatport, and Amazon Music using scrapling. Trigger words - dj, track, buy track, search track, bandcamp, beatport, amazon music, purchase music, dj buyer, find track.
---

# DJ Buyer

Search for and purchase DJ tracks across Bandcamp, Beatport, and Amazon Music. All scraping uses `scrapling.Fetcher` with TLS fingerprinting for anti-bot bypass.

**Project**: `~/code/dj-buyer/`
**Run all commands with**: `cd ~/code/dj-buyer && uv run dj-buyer <command>`

## Search Workflow

**Always search ALL 3 platforms, then rerank by price and similarity to find the best deal.**

```bash
cd ~/code/dj-buyer && uv run dj-buyer search-bandcamp "Artist" "Title" --json
cd ~/code/dj-buyer && uv run dj-buyer search-beatport "Artist" "Title" --json
cd ~/code/dj-buyer && uv run dj-buyer search-amazon "Artist" "Title" --json
```

Or search all at once: `cd ~/code/dj-buyer && uv run dj-buyer search "Artist" "Title"`

### How to Rerank Results

After collecting results from all 3 platforms:

1. **Filter**: Drop anything with similarity < 0.7
2. **Verify**: For similarity 0.7-0.9, manually check artist+title match
3. **Platform preference**: Always prefer Bandcamp or Beatport over Amazon. Only use Amazon if the track doesn't exist on either Bandcamp or Beatport.
4. **Price rank** (within preferred platforms): Bandcamp name-your-price ($0) > Bandcamp minimum ($1) > Beatport MP3 ($1.49) > Beatport WAV ($2.49)
5. **DJ quality tiebreak**: If prices are close, prefer Beatport (best metadata + artwork)
6. **Amazon fallback**: Only purchase from Amazon ($1.29) when the track is unavailable on both Bandcamp and Beatport

See `search/bandcamp.md`, `search/beatport.md`, `search/amazon.md` for platform-specific matching guidance.

## Purchase Workflow

**Purchase from ONE platform** — whichever had the best match at the best price.

```bash
cd ~/code/dj-buyer && uv run dj-buyer purchase-bandcamp <url> [--price 1.00] [--dry-run]
cd ~/code/dj-buyer && uv run dj-buyer purchase-beatport <url> [--format mp3|wav] [--dry-run]
cd ~/code/dj-buyer && uv run dj-buyer purchase-amazon <url> [--dry-run]
```

**Always `--dry-run` first** to verify pricing before committing.

See `purchase/bandcamp.md`, `purchase/beatport.md`, `purchase/amazon.md` for platform-specific purchase details.

## Spotify Integration

The daemon watches a Spotify playlist for new tracks and auto-searches all platforms.

```bash
cd ~/code/dj-buyer && uv run dj-buyer list-tracks <playlist_id>
cd ~/code/dj-buyer && uv run dj-buyer poll
cd ~/code/dj-buyer && uv run dj-buyer auth   # Re-auth if token expired
```

Current playlist: `162TAg29u887r6VksnVf5d` (configured in `config.toml`)

## Scrapling Gotcha

**CRITICAL: Use `response.html_content` not `response.text`.** Scrapling's `Fetcher` returns empty string for `.text` but the actual HTML is in `.html_content` (decoded from `.body` bytes). This applies everywhere you read response content.

## Config

`~/code/dj-buyer/config.toml`:
- `search.max_price = 15.00` — skip anything over this
- `search.min_similarity = 0.7` — minimum fuzzy match score
- `search.platforms = ["beatport", "bandcamp", "amazon"]`
- `search.preferred_format = "mp3"`
