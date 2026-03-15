# Purchase from Bandcamp

```bash
cd ~/code/dj-buyer && uv run dj-buyer purchase-bandcamp <url> [--price 1.00] [--email you@example.com] [--dry-run]
```

## How It Works

1. Scrapes the track page with scrapling
2. Extracts `data-tralbum` JSON (contains item_id, band_id, pricing)
3. POSTs to `{artist}.bandcamp.com/cart/add` with item_id + price
4. Returns checkout URL for payment completion

## When to Use

- After searching all 3 platforms and Bandcamp has the best price
- For name-your-price tracks (can pay $0)
- For minimum-price tracks (auto-uses the minimum)

## Options

- `--price`: Set the amount to pay. Required for name-your-price tracks. For minimum-price tracks, defaults to the minimum. Ignored for fixed-price tracks.
- `--email`: Email for Bandcamp receipt/download link
- `--dry-run`: Show pricing info without purchasing

## Always Dry-Run First

```bash
cd ~/code/dj-buyer && uv run dj-buyer purchase-bandcamp "https://artist.bandcamp.com/track/name" --dry-run
```

This shows the pricing type and amount before committing.

## Pricing Types

| Type | Behavior |
|------|----------|
| `name_your_price` | Pay anything (even $0). Use `--price 0` for free. |
| `minimum_price` | Must pay at least the minimum. Auto-set if no `--price`. |
| `fixed_price` | Set price, cannot change. `--price` ignored. |
