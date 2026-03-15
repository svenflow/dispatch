# Purchase from Beatport

```bash
cd ~/code/dj-buyer && uv run dj-buyer purchase-beatport <url> [--format mp3|wav] [--dry-run]
```

## How It Works

1. Scrapes the track page with scrapling
2. Extracts track ID from URL (`/track/slug/12345`)
3. Extracts access token from `__NEXT_DATA__` script
4. POSTs to `api.beatport.com/v4/cart/items/` with track_id + format
5. Returns cart/checkout URL

## When to Use

- After searching all 3 platforms and Beatport has the track you want
- When you need a specific format (MP3 320 or WAV)
- For DJ-quality tracks with proper metadata and artwork

## Options

- `--format`: `mp3` (default, $1.49-$2.49) or `wav` (lossless, $2.49-$3.49)
- `--dry-run`: Show pricing info without purchasing

## Format Choice

- **MP3 320**: Fine for most DJ setups, smaller files
- **WAV**: Lossless quality, preferred for professional use, costs ~$1 more

## Always Dry-Run First

```bash
cd ~/code/dj-buyer && uv run dj-buyer purchase-beatport "https://www.beatport.com/track/name/12345" --dry-run
```
