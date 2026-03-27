---
name: webfetch
description: Web scraping with anti-bot bypass using scrapling. Fallback to chrome-control for auth. Trigger words - scrape, fetch, web, crawl, extract, blocked site.
---

# Web Scraping Guide

## Decision Tree

```
Need to scrape a website?
         │
         ▼
┌────────────────────────┐
│ 1. Try scrapling first │  ← Fastest (0.3-1s), handles 80% of sites
│    webfetch <url>      │     TLS fingerprint spoofing, no browser
└────────────────────────┘
         │
         ▼ (blocked by Cloudflare?)
┌────────────────────────┐
│ 2. scrapling Stealthy  │  ← Camoufox Firefox (1-4s)
│    webfetch <url>      │     Automatic fallback in CLI
│    (tier 2)            │
└────────────────────────┘
         │
         ▼ (output nearly empty? just "*Source: domain*" with no body?)
┌──────────────────────────────┐
│ 3. Use chrome fetch          │  ← JS-rendered page
│    chrome fetch <url>        │     (Shopify, React/Next.js SPA)
└──────────────────────────────┘
         │
         ▼ (need login / still blocked?)
┌────────────────────────┐
│ 4. Use chrome-control  │  ← Uses real Chrome with your session
│    chrome fetch <url>  │     See /chrome-control skill
└────────────────────────┘
```

## Silent Failure: Empty Output on JS-Rendered Pages

**IMPORTANT:** webfetch can exit with code 0 (success) but return nearly empty markdown — just `"*Source: domain*"` with no body content. This happens with JavaScript-rendered pages (Shopify stores, React/Next.js SPAs, Vue apps) where content is injected by JavaScript after page load. The HTML fetched is valid but has no pre-rendered text.

**How to detect it:** If webfetch output is only 1-2 lines or contains just the source header with no real text, the page requires JS rendering.

**Fix immediately — use `chrome fetch`:**
```bash
~/.claude/skills/chrome-control/scripts/chrome fetch "https://example.com"
```

`chrome fetch` uses your real Chrome browser which fully executes JavaScript, so product data, prices, descriptions, and other dynamic content are all present.

**Known JS-rendered site patterns:**
- Shopify stores (shop.hak5.org, any `myshopify.com` or custom Shopify domain)
- Next.js / React SPA product and listing pages
- Any site where webfetch returns under ~100 chars of actual content after the source header

Do NOT use `chrome open` + `sleep` + `chrome text` + `chrome close` — just use `chrome fetch <url>` directly.

## Quick Start

```bash
# Basic fetch (tries both tiers automatically)
~/.claude/skills/webfetch/scripts/webfetch "https://example.com"

# Force specific tier
~/.claude/skills/webfetch/scripts/webfetch "https://example.com" --tier 1  # scrapling HTTP only
~/.claude/skills/webfetch/scripts/webfetch "https://example.com" --tier 2  # scrapling Stealthy

# Raw HTML output
~/.claude/skills/webfetch/scripts/webfetch "https://example.com" --raw
```

## The Two Tiers

### Tier 1: Scrapling HTTP (Default)
**Best for:** Most public websites, news, blogs, product pages

- Uses `curl_cffi` with TLS fingerprint spoofing
- Impersonates real browser TLS handshakes
- No actual browser needed - pure HTTP
- **Speed:** 0.3-1 second
- **Success rate:** ~80% of sites

```python
from scrapling import Fetcher
fetcher = Fetcher()
page = fetcher.get("https://reddit.com/r/programming")
print(page.html_content)
```

### Tier 2: Scrapling Stealthy (Camoufox)
**Best for:** Cloudflare Turnstile, DataDome, aggressive anti-bot

- Uses Camoufox (Firefox fork with anti-detection)
- Full browser automation with stealth patches
- Bypasses most JavaScript challenges
- **Speed:** 1-4 seconds
- **Success rate:** ~95% of sites

```python
from scrapling import StealthyFetcher
fetcher = StealthyFetcher()
page = fetcher.fetch("https://ticketmaster.com", headless=True)
print(page.html_content)
```

### Fallback: Chrome Extension
**Best for:** JS-rendered pages (Shopify/SPA), sites requiring login, when scrapling fails

If tiers 1-2 fail or return empty output, use the Chrome extension which controls your actual browser:

```bash
~/.claude/skills/chrome-control/scripts/chrome fetch "https://example.com"
```

See `/chrome-control` skill for full docs.

## Screenshots

Use chrome-control for screenshots:
```bash
~/.claude/skills/chrome-control/scripts/chrome screenshot
```

## When to Use Each Approach

| Scenario | Recommended Approach |
|----------|---------------------|
| Public website, no login | Tier 1 (scrapling HTTP) |
| Cloudflare protection | Tier 2 (scrapling Stealthy) |
| webfetch returns empty/minimal output | chrome fetch (JS-rendered page) |
| Shopify / React SPA / Next.js store | chrome fetch directly (skip webfetch) |
| Need logged-in content | Chrome extension |
| Need to click/interact | Chrome extension |
| Need screenshot | Chrome extension |

## Common Sites and What Works

| Site | Tier 1 | Tier 2 | Chrome Ext | Notes |
|------|--------|--------|------------|-------|
| Reddit | ✅ | ✅ | ✅ | All work |
| Amazon | ✅ | ✅ | ✅ | All work |
| Zillow | ✅ | ✅ | ✅ | Rate limits on rapid requests |
| Ticketmaster | ✅ | ✅ | ✅ | All work |
| LinkedIn | ✅ | ✅ | ✅ | Login required for full profiles |
| Twitter/X | ❌ | ❌ | ✅ | Requires login |
| Instagram | ❌ | ❌ | ✅ | Requires login |
| Gmail | ❌ | ❌ | ✅ | Requires login |
| Shopify stores (e.g. shop.hak5.org) | ❌ empty | ❌ empty | ✅ | JS-rendered, use chrome fetch |

## Performance Comparison

| Tier | Speed | Memory | Success Rate |
|------|-------|--------|--------------|
| 1 (scrapling HTTP) | 0.3-1s | ~50MB | 80% |
| 2 (scrapling Stealthy) | 1-4s | ~400MB | 95% |
| Chrome extension | 3-8s | (uses Chrome) | 100%* |

\* If you can see it in Chrome

## Token Efficiency

**ALWAYS use webfetch over raw `curl` or `wget`.** Scrapling returns extracted markdown content, not raw HTML. This dramatically reduces token usage:

- **Raw HTML** (curl/wget): ~700K tokens for a single page
- **Extracted markdown** (webfetch): ~2.6K tokens for the same page

That's a **~270x reduction** in token consumption. Using raw HTML wastes quota and context window on boilerplate markup, scripts, and styling that contain zero useful information.

## Dependencies

Installed automatically via uv script header:
- `scrapling[all]>=0.4` - HTTP fetcher + Camoufox
- `markdownify>=0.11` - HTML to markdown
- `beautifulsoup4>=4.12` - HTML parsing

First run will install camoufox browser (~300MB).
