---
name: spotify-likes-organizer
description: Auto-organize Spotify liked songs into ⚡ genre playlists. Genres come ONLY from authoritative sources (Beatport, Last.fm) — never invented by LLM. Trigger words - spotify likes, organize likes, auto playlist, genre playlists, lightning playlists.
---

# Spotify Likes Organizer

Auto-organize Spotify liked songs into ⚡ genre playlists using **authoritative sources only**.

## Architecture (v3)

**Haiku is a match picker + search agent + taxonomy mapper, NOT a genre classifier.** Genres are NEVER invented.

1. For each track, search 2 authoritative sources:
   - **Beatport** — top 5 search results shown to Haiku, which picks the best match (no programmatic similarity). Genre from API result + `__NEXT_DATA__` fallback.
   - **Last.fm** — `track.getTopTags` API → user-generated song-specific tags
2. If no source finds the track: Haiku suggests **alternate search queries**
3. Retry with alternate queries on both sources
4. Once source data is found: Haiku ONLY **maps** source labels → our taxonomy
5. If no source has the track → `⚡ Unsorted`

**Why no Discogs?** Discogs genres are album-level (not track-level) and search matching is unreliable — often returns wrong releases. Beatport + Last.fm provide better track-level accuracy.

## Commands

```bash
cd ~/code/dj-buyer

uv run python scripts/spotify_likes_classify.py classify             # Last 100
uv run python scripts/spotify_likes_classify.py classify --limit 50  # Last 50
uv run python scripts/spotify_likes_classify.py classify --reclassify # Redo all
uv run python scripts/spotify_likes_classify.py classify --reclassify-empty # Redo unsorted only
uv run python scripts/spotify_likes_classify.py classify --dry-run   # Preview
uv run python scripts/spotify_likes_classify.py status               # Stats
uv run python scripts/spotify_likes_classify.py playlists            # Create ⚡ playlists
uv run python scripts/spotify_likes_classify.py playlists --dry-run  # Preview playlists
```

## API Keys

- **Last.fm API key** stored in macOS Keychain as `lastfm-api-key` (account: `lastfm`)
- **Last.fm shared secret** stored as `lastfm-shared-secret` (account: `lastfm`)
- Last.fm account: `svenflow` (nicklaudethorat@gmail.com)
- Spotify auth tokens in `~/code/dj-buyer/state.db`

## Database

`~/code/dj-buyer/spotify_likes.db`:
- `liked_tracks` — metadata + genres_json + genre_source
- `track_genres` — junction table for multi-genre
- `playlists` — genre → Spotify playlist ID

## Genre Taxonomy

See `~/code/dj-buyer/GENRES.md` for the full hierarchical taxonomy (union of Beatport + Last.fm).

### Breadcrumb Convention

**Breadcrumbs go from general → specific**, using `>` as separator:
- `⚡ House > UK Garage / Bassline` (House is general, UK Garage/Bassline is specific)
- `⚡ Bass / Club > Jersey Club` (Bass/Club is general, Jersey Club is specific)
- `⚡ Hip-Hop > Jazz Rap` (Hip-Hop is general, Jazz Rap is specific)
- `⚡ Rock` (no sub-genre, just the parent)

This means playlists sort alphabetically by parent genre in Spotify — all House variants group together, all Hip-Hop variants group together, etc.

Tracks go in the **most specific** playlist only. Never both parent and child (e.g. never both "House" AND "House > Tech House").

## Rules

- NEVER use Spotify artist genres (artist-level, not song-level)
- NEVER use Discogs (album-level, unreliable matching)
- NEVER let Haiku invent genres — only map source data to taxonomy
- Song-by-song classification only
- Max 1-2 genres per track
- Unsorted: tracks with no authoritative source → ⚡ Unsorted
