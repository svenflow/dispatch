---
name: webfetch
description: Fetch web pages with requests + playwright fallback. Use as alternative to WebFetch for better success on blocked sites. Trigger words - fetch, web, scrape.
---

# WebFetch CLI

A CLI that fetches web pages using requests with Chrome UA, falling back to playwright headless for blocked sites.

## Usage

```bash
# Basic fetch (returns markdown)
~/.claude/skills/webfetch/scripts/webfetch "https://reddit.com/r/programming"

# Force playwright (skip requests)
~/.claude/skills/webfetch/scripts/webfetch "https://amazon.com" --force-playwright

# Raw HTML output
~/.claude/skills/webfetch/scripts/webfetch "https://example.com" --raw

# Custom timeout
~/.claude/skills/webfetch/scripts/webfetch "https://slow-site.com" --timeout 60
```

## How It Works

1. **First try**: `requests` with Chrome User-Agent
   - Fast (~1-2s)
   - Works for most sites

2. **Fallback**: `playwright` headless browser
   - Triggered on 403/503/429 errors
   - Triggered if page looks like antibot challenge
   - Slower (~3-5s) but handles JS-rendered content

## Output

- Converts HTML to clean markdown
- Removes nav, footer, scripts, styles
- Tries to find main content area
- Includes source URL

## First Run

Playwright needs browser binaries installed:

```bash
uv run playwright install chromium
```

## When to Use

Use this instead of WebFetch when:
- Site returns 403/503 (antibot blocking)
- Site requires JavaScript rendering
- Site blocks non-browser User-Agents

## Automatic Fallback Hook

A `PostToolUseFailure` hook is installed that automatically retries failed WebFetch calls using the webfetch CLI. When WebFetch fails (403, 503, antibot, etc), the hook:

1. Extracts the URL from the failed call
2. Runs webfetch CLI with Chrome cookies + playwright fallback
3. Returns the content as additionalContext for Claude

This is transparent to all sessions - no manual intervention needed.

## Limitations

- Won't work on sites with heavy Cloudflare protection (use chrome-control for text extraction)
- Won't work on sites requiring login (use chrome-control with existing session)
- Slower than raw WebFetch for simple sites

## Tier 3: Chrome Control Fallback

If webfetch still fails (Cloudflare captcha, login required), use chrome-control:

```bash
# Open page in Chrome (uses real browser session with cookies)
chrome open "https://example.com"
# Output: Opened tab 123456

# Get page text (works on CSP-protected sites like Discord)
chrome text 123456

# Get page HTML
chrome html 123456

# Clean up
chrome close 123456
```
