# Purchase from Amazon Music

```bash
cd ~/code/dj-buyer && uv run dj-buyer purchase-amazon <url> [--dry-run]
```

## How It Works

1. Scrapes the product page with scrapling
2. Extracts the ASIN from the URL (or from page HTML)
3. Hits Amazon's add-to-cart endpoint via scrapling
4. Returns checkout URL (or direct buy link if cart-add fails)

## When to Use

- After searching all 3 platforms and Amazon is the only one with the track
- For major label releases not on Bandcamp/Beatport
- When the track is only available as an Amazon digital purchase

## Limitations

- Amazon's anti-bot is the most aggressive of the 3 platforms
- Requires an active Amazon login session (cookies)
- If programmatic add-to-cart fails, outputs a direct link for manual purchase
- Digital music purchases use your default Amazon payment method

## Always Dry-Run First

```bash
cd ~/code/dj-buyer && uv run dj-buyer purchase-amazon "https://www.amazon.com/dp/B0XXXXX" --dry-run
```
