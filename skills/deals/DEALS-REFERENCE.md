# Deals Skill - Complete Reference

> Last updated: 2026-02-13
> Location: `~/.claude/skills/deals/`
> Database: `~/.claude/skills/deals/data/deals.db`

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [CLI Usage](#cli-usage)
3. [File Structure](#file-structure)
4. [Store Configuration](#store-configuration)
5. [3-Tier Search Architecture](#3-tier-search-architecture)
6. [Scoring System (v2)](#scoring-system-v2)
7. [Relevance Filtering](#relevance-filtering)
8. [Size Handling & Query Expansion](#size-handling--query-expansion)
9. [Spec Mismatch Penalties](#spec-mismatch-penalties)
10. [Strict vs Relaxed Classification](#strict-vs-relaxed-classification)
11. [Market Context Notes](#market-context-notes)
12. [Bot Detection & Anti-Scraping](#bot-detection--anti-scraping)
13. [Circuit Breaker System](#circuit-breaker-system)
14. [Cache System](#cache-system)
15. [Reddit Integration](#reddit-integration)
16. [Review Sources](#review-sources)
17. [Price Range Passthrough](#price-range-passthrough)
18. [Alerts & Watchlist](#alerts--watchlist)
19. [iMessage Output Rules](#imessage-output-rules)
20. [Known Issues & Limitations](#known-issues--limitations)
21. [Changelog / Memories](#changelog--memories)

---

## Architecture Overview

The deals skill is a Node.js CLI that searches 8+ retail stores in parallel, scores products on quality and value, filters by relevance, and outputs ranked results with emojis, reviews, and community sentiment.

```
Query -> Parse Intent -> Expand Query (if size) -> Cache Check
  -> Parallel 3-Tier Search (API + HTTP + Playwright)
  -> Merge + Dedup -> Score (Quality + Value) -> Spec Penalties
  -> Relevance Filter -> Strict/Relaxed Split -> Output
```

Key design decisions:
- **Parallel everything**: All store tiers, Reddit, and BB verification fire simultaneously
- **Post-search filtering**: Size terms are removed from store queries; filtering happens after results return
- **Dual-query search**: When size is expanded out, searches with BOTH original and expanded queries to avoid losing results
- **Multiplicative penalties**: Spec mismatches apply multiplicative scoring penalties (they stack)
- **Circuit breakers**: Stores that fail repeatedly get disabled for 6 hours

---

## CLI Usage

```bash
# Search for deals (ranked by deal score)
node ~/.claude/skills/deals/scripts/deals.cjs search "Canon EOS R8"

# Search specific store
node ~/.claude/skills/deals/scripts/deals.cjs search "55 inch TV" --store bestbuy

# Price range filter
node ~/.claude/skills/deals/scripts/deals.cjs search "4K TV" --min-price 500 --max-price 1500

# Limit results
node ~/.claude/skills/deals/scripts/deals.cjs search "gaming monitor" --top 3

# JSON output
node ~/.claude/skills/deals/scripts/deals.cjs search "RTX 4070" --json

# Watchlist
node ~/.claude/skills/deals/scripts/deals.cjs watch "Canon EOS R8" --target 1100
node ~/.claude/skills/deals/scripts/deals.cjs list
node ~/.claude/skills/deals/scripts/deals.cjs check
node ~/.claude/skills/deals/scripts/deals.cjs unwatch 3

# Other commands
node ~/.claude/skills/deals/scripts/deals.cjs history "Canon EOS R8"
node ~/.claude/skills/deals/scripts/deals.cjs analyze "Canon EOS R8"
node ~/.claude/skills/deals/scripts/deals.cjs health
node ~/.claude/skills/deals/scripts/deals.cjs cron
```

---

## File Structure

```
~/.claude/skills/deals/
  SKILL.md                    # Skill manifest and quick reference
  DEALS-REFERENCE.md          # This file
  PLAN-output-format-v2.md    # Output format design doc
  data/
    deals.db                  # SQLite database (products, watchlist, price_history, etc.)
  scripts/
    deals.cjs                 # Main CLI entry point and search orchestration
    lib/
      utils.cjs               # Price parsing, scoring, filtering, matching, spec extraction
      stores.cjs              # Store configs (API + Playwright selectors)
      scraper.cjs             # Playwright browser scraper (Target, B&H, eBay)
      http-scraper.cjs        # HTTP/Cheerio scraper (Amazon, Walmart, Newegg, Micro Center)
      cache.cjs               # SQLite search result cache (TTL varies by source)
      db.cjs                  # SQLite database layer, circuit breaker logic
      alerts.cjs              # Price alert system (target hit, price drop, big deal)
      reddit.cjs              # Reddit community sentiment (searches subreddits, scores sentiment)
      review-sources.cjs      # Professional review site links by category (19 categories)
```

---

## Store Configuration

| Store | Key | Method | Tier | Status | Notes |
|-------|-----|--------|------|--------|-------|
| Best Buy | `bestbuy` | API (BESTBUY_API_KEY) | T0 | Active | API returns verified prices. Playwright verification overlay. |
| Amazon | `amazon` | HTTP/Cheerio | T1 | Active | Review selectors expanded with multiple fallbacks. |
| Walmart | `walmart` | HTTP/Cheerio | T1 | Active | JSON-LD price extraction. |
| Newegg | `newegg` | HTTP/Cheerio | T1 | Active | Bot detection fix: page size threshold (>50KB = real page). |
| Micro Center | `microcenter` | HTTP/Cheerio | T1 | Active | No price range filter support. |
| Target | `target` | Playwright | T2 | Active | Uses data-test attributes. |
| B&H Photo | `bhphoto` | Playwright | T2 | Active | Selectors updated Feb 2026 (uppedDecimalPriceFirst, ratingContainer, etc). |
| eBay | `ebay` | Playwright | T2 | Active | Moved from HTTP to Playwright. Bot detection page-size threshold fix. |
| Home Depot | `homedepot` | DISABLED | -- | Blocked | Akamai Bot Manager blocks both GraphQL API and Playwright. |

### B&H Photo Selectors (Updated Feb 2026)

```javascript
container: '[data-selenium="miniProductPage"]'
name: '[data-selenium="miniProductPageProductName"]'
price: '[data-selenium="uppedDecimalPriceFirst"]'
originalPrice: '[data-selenium="miniProductPagePricingContainer"] del'
link: '[data-selenium="miniProductPageProductNameLink"]'
rating: '[data-selenium="ratingContainer"]'
reviewCount: '[data-selenium="miniProductPageProductReviews"]'
```

Note: B&H splits prices into dollars (`uppedDecimalPriceFirst`) and cents (`uppedDecimalPriceSecond` in a `<sup>`). The dollar part alone is sufficient for comparison.

### eBay Selectors (Playwright)

```javascript
container: 'li.s-card, .s-item:not(.s-item--ad)'
name: '.s-card__title, .s-item__title span'
price: '.s-card__price, .s-item__price'
originalPrice: '[class*="strikethrough"], .STRIKETHROUGH'
link: 'a[href*="ebay.com/itm"]'
```

---

## 3-Tier Search Architecture

All tiers fire simultaneously via `Promise.allSettled()`:

### Tier 0: Best Buy API
- Uses `BESTBUY_API_KEY` environment variable
- Returns structured JSON with verified prices
- BB price verification starts immediately after API returns, overlapping with other tiers

### Tier 1: HTTP/Cheerio Scraping
- Stores: Amazon, Walmart, Newegg, Micro Center
- Parallel fetch with 15-second timeout per store
- Cheerio HTML parsing with store-specific parsers
- Bot detection: checks for CAPTCHA pages, but only if HTML < 50KB (avoids false positives on large product pages)

### Tier 2: Playwright Browser Scraping
- Stores: Target, B&H Photo, eBay
- Headless Chrome with anti-detection (webdriver masking, AutomationControlled disabled)
- CSS selector extraction -> text fallback pipeline
- Bot detection: same page-size threshold (50KB) as HTTP tier

### Dual-Query Search

When the query contains size terms (e.g., "240Hz gaming monitor 42 inch"):
1. Size terms are removed for the store query: "240Hz gaming monitor"
2. Both the expanded AND original queries are sent to each store
3. Results are merged and deduplicated by URL
4. Size filtering happens post-search

This prevents stores from pre-filtering by exact size while also capturing results that only appear with size-specific queries.

---

## Scoring System (v2)

### Dual Score: Quality + Value

Each product gets two independent scores (0-100):

**Quality Score (Q)** - Price-blind product quality:
- Brand reputation: 30%
- Spec quality: 30% (category-specific templates)
- Customer reviews: 25% (star rating weighted by log-scaled volume)
- Review volume: 10%
- Store trust: 5%

**Value Score (V)** - Deal attractiveness:
- Discount depth: 35%
- Specs-per-dollar: 25%
- Reviews-per-dollar: 20%
- Store trust: 10%
- Review score: 10%

**Combined Sort**: `Q * 0.6 + V * 0.4` (quality-weighted)

### Tags
- **Premium**: Q >= 75
- **Deal**: V >= 65
- **Sweet Spot**: Q >= 75 AND V >= 65
- **Low Data**: < 50% data fields present

### Display Format
```
Product Name...
Store  $price (was $original, -XX%)  Q:81 V:58 [Premium]
```

### Review Confidence Discounting
Products with only 1-2 reviews blend toward neutral (50) instead of being treated as reliable signals.

### Refurbished Penalty
Refurbished products receive a 15% quality penalty with a `Refurb` tag.

### Category-Specific Spec Scoring

**Monitor/TV** (`scoreTVSpecs`):
- Resolution: 0-20 (4K=15, 8K=20)
- Panel type: 0-30 (OLED=28, QD-OLED=30, Mini LED=20, QLED=15)
- Refresh rate: 0-20 (240Hz=18, 120Hz=12)
- HDR: 0-15
- Smart platform: 0-10
- Size: 0-10

**Camera** (`scoreCameraSpecs`): sensor size, resolution, AF system, video capability

**Audio** (`scoreAudioSpecs`): driver size, frequency response, codec support

---

## Relevance Filtering

Products go through multi-phase filtering in `filterProduct()`:

### Phase A: Basic Relevance
- **Service/accessory detection**: Rejects installation services, warranties, gift cards, mounts, cables, stands
- **Token overlap**: Product name must share >= 50% tokens with query
- **Preposition filter**: Rejects accessories ("stand FOR monitor", "case FOR phone")

### Phase B: Spec Validation
- **Screen size**: Asymmetric tolerance (generous upward, strict downward)
  - Screens <= 27": +/-2"
  - Screens <= 34": +/-3"
  - Screens <= 49": +/-5" down, +/-10" up
  - Screens > 49": +/-8" down, +/-16" up
- **Unknown size rejection**: Display products (monitor/TV/projector) with no parseable size are rejected when the user specified a size constraint
- **Category mismatch**: Detected category must match query category
- **Product line mismatch**: If query names a specific product line, result must match

### Phase C: Price Validation
- Below min-price or above max-price = rejected
- Thin results warning fires when <= 2 results and > 5 filtered with price range

### Size Regex
Handles decimals (26.5", 31.5") and various markers:
```javascript
/(\d{2,3}(?:\.\d)?)\s*["\u201C\u201D\u2033\u02BA]?\s*(?:inch|in\b|class|-in)/i
```

---

## Size Handling & Query Expansion

### `expandSizeQuery(query)`
- Removes size terms (e.g., "42 inch", "55\"") from the query
- Only applies to display categories (TV, monitor, projector)
- Returns `{ searchQuery, originalQuery }`
- Store searches use the expanded query; filtering uses the original

### `getSizeTolerance(targetSize)`
```
<= 27": +/-2"
<= 34": +/-3"
<= 49": +/-5"
> 49":  +/-8"
```

### Asymmetric Filtering
- **Downward**: strict tolerance (42" query rejects 36" and below)
- **Upward**: 2x tolerance (42" query accepts up to 52")
- Rationale: users who specify "42 inch" usually want "at least 42 inches"

---

## Spec Mismatch Penalties

### `querySpecPenalty(productName, productSpecs, queryIntent)`

Returns a multiplicative penalty (0.0-1.0) applied to both Q and V scores:

**Refresh rate**:
- < 70% of requested: 0.5x (e.g., 144Hz on a 240Hz search)
- < 100% of requested: 0.8x (e.g., 200Hz on a 240Hz search)

**Screen size**:
- Way too small (> tolerance below): 0.4x
- Somewhat small (within tolerance but below): 0.7x

**Resolution**:
- Lower than requested: 0.6x

Penalties stack multiplicatively. A product with wrong refresh rate AND wrong size could get 0.5 * 0.4 = 0.2x total penalty.

---

## Strict vs Relaxed Classification

### `classifyMatch(productName, productSpecs, queryIntent)`

Returns `{ strict: boolean, deviations: string[] }`

**Strict match**: All detected specs meet or exceed query requirements
**Relaxed match**: One or more specs deviate (with specific deviation descriptions)

### Output Format
```
1. Samsung 49" Odyssey OLED G9...     # Strict match (shown first)
2. LG 45" UltraGear OLED...          # Strict match

--- Other options (partial spec match) ---

3. Acer Predator X39 39"...           # Relaxed match
   Warning: 39" vs 42"+ requested     # Deviation callout
```

---

## Market Context Notes

### `getMarketContext(queryIntent, strictMatchCount)`

When strict matches < 3, provides category-specific context notes:

**Monitor**: "240Hz+ monitors above 40\" are rare outside ultrawide formats (45\" 21:9 and 49\" 32:9). Consider 240Hz 27-32\" panels or 144Hz+ in larger flat sizes."

**TV**: Size-specific notes about refresh rates in large format TVs.

Displayed in output as: `Market context note appears in footer`

---

## Bot Detection & Anti-Scraping

### HTTP Scraper (http-scraper.cjs)
- Checks response HTML for CAPTCHA keywords: `captcha`, `verify you are human`, `robot`, `access denied`, `blocked`, `pardon our interruption`
- **Page size threshold**: Only triggers if HTML < 50KB. Real product pages are 800KB+; actual CAPTCHA pages are ~13KB
- Uses randomized User-Agent rotation

### Playwright Scraper (scraper.cjs)
- Same page-size threshold (50KB) as HTTP scraper
- Headless Chrome with anti-detection flags:
  - `--disable-blink-features=AutomationControlled`
  - `navigator.webdriver` masked as `undefined`
- Fixed User-Agent string (Chrome 131)

### Store-Specific Issues
- **Newegg**: Was triggering false bot detection because "verify" appeared in page footer/scripts. Fixed with page-size threshold.
- **eBay**: HTTP requests get "Pardon Our Interruption" CAPTCHA. Moved to Playwright. Playwright pages contain "captcha" text in scripts but products render fine (2.6MB pages). Fixed with page-size threshold.
- **Home Depot**: Akamai Bot Manager blocks everything. Requires solving JavaScript sensor challenges. Not bypassable with current Playwright setup. DISABLED.
- **Walmart**: Occasional bot detection on HTTP. Circuit breaker handles it.

---

## Circuit Breaker System

Located in `db.cjs`. Tracks store health via `store_health` table.

### Thresholds
- **Hard failure** (HTTP error, exception): 5 consecutive = disable for 6 hours
- **Soft failure** (0 results, no error): 8 consecutive = disable for 6 hours
- `db.storeSuccess(key)` resets failure counters
- `db.storeFailure(key)` increments hard failures
- `db.storeSoftFailure(key)` increments soft failures
- `db.isStoreDisabled(key)` checks if disabled and if cooldown has expired

### Resetting
```javascript
// Reset a specific store
db.storeSuccess('bhphoto'); // Clears consecutive_failures and disabled_until
```

---

## Cache System

Located in `cache.cjs`. Uses SQLite `search_cache` table.

### TTLs
- API results: 15 minutes
- HTTP results: 30 minutes
- GraphQL results: 30 minutes
- Playwright results: 60 minutes

### Behavior
- Cache key: normalized query + store key
- Results are cached per-store after each search
- When dual-query search is active, results are cached under ALL query variants
- `cache.clearExpired()` runs at end of each search
- `cache.clearAll()` clears entire cache (useful when testing)

---

## Reddit Integration

Located in `reddit.cjs`. Fires in parallel with store searches.

### How It Works
1. Determines product category from query
2. Searches 3-5 relevant subreddits (27 categories mapped)
3. Fetches top comments from highest-scoring posts (past 12 months)
4. Runs keyword-based sentiment analysis
5. Produces 0-100 community score with sentiment label

### Subreddit Mappings (27 Categories)
tv, camera, monitor, desktop, laptop, headphones, phone, appliance, gaming, audio, receiver, networking, storage, printer, smartHome, vacuum, coffee, microwave, powertools, outdoor, hvac, wearable, projector, tablet, gpu, peripherals, and more.

### Reddit Relevance Filtering
Checks if post titles match query size specs. Shows "no exact match" message instead of misleading links when posts don't match the specific query.

### Output
```
Reddit: 774 upvotes across r/buildapcsales, "great deal" in comments
  https://www.reddit.com/r/buildapcsales/comments/...
```

---

## Review Sources

Located in `review-sources.cjs`. 19 categories with professional review sites.

### Categories
monitor, tv, camera, audio, headphones, laptop, desktop, appliance, networking, storage, smartHome, phone, printer, gaming, gpu, peripherals, tablet, projector

### Monitor Category (8 sources)
Rtings, TFT Central, Hardware Unboxed, Toms Hardware, PC Monitors, Optimum Tech, Badseed Tech, DisplayNinja

### Output
3 review source links shown in footer: `getReviewLinks(category, 3)`

---

## Price Range Passthrough

Price filters are passed through to store APIs/URLs where supported:

| Store | Min Price | Max Price | Format |
|-------|-----------|-----------|--------|
| Amazon | `rh=p_36:min_cents-` | `-max_cents` | Cents (e.g., 50000 for $500) |
| Walmart | `min_price=` | `max_price=` | Dollars |
| Newegg | `PriceRange=min+max` | | Dollars |
| eBay | `_udlo=` | `_udhi=` | Dollars |
| Best Buy | `salePrice>=` | `salePrice<=` | Dollars |
| Micro Center | N/A | N/A | No filter support |

---

## Alerts & Watchlist

### Alert Types
- **target_hit**: Price <= watchlist target price
- **price_drop**: Price dropped $50+ from last check
- **big_deal**: 30%+ discount from original price

### Deduplication
Same item + price won't re-alert within 24 hours.

### Limits
Max 5 alerts per cron run to prevent spam.

### Delivery
Alerts sent via iMessage (`sendMessage.sh`).

---

## iMessage Output Rules

**These are hard requirements.**

1. **NEVER strip emojis** from CLI output. Send AS-IS via sendMessage.sh.
2. **Always show** review stars and review count for every product that has them.
3. **Always show** Q:XX V:XX scores with tags.
4. **Always show** review source links in footer (3 sources).
5. **Always show** Reddit community signal.
6. **Always show** soft failures/warnings.
7. **Send the CLI output directly** -- do not rewrite or summarize.

### Emojis Used
- `🔍` Search header
- `💎` Best pick (#1 result)
- `🔥` Hot deal (discount > 20%)
- `⭐` Star rating
- `💰` Lowest price
- `🗣️` Reddit signal
- `📖` Review sources
- `🏪` Store status line
- `⚠️` Warnings (partial match, bot detection, soft failures)
- `📋` Market context notes

---

## Known Issues & Limitations

### Active Issues
1. **Home Depot**: Akamai Bot Manager blocks all scraping. DISABLED until bypass found.
2. **eBay**: Occasionally still triggers bot detection despite Playwright. Works most of the time.
3. **B&H Photo price format**: Split dollars/cents (`uppedDecimalPriceFirst` + `uppedDecimalPriceSecond`). Currently only captures the dollar portion.
4. **Walmart**: Intermittent bot detection on HTTP tier.

### Design Limitations
- **No Google Shopping**: Not currently scraped.
- **No eBay used/refurbished filtering**: Used items can dilute results.
- **Cache invalidation**: No way to force-refresh a single store. Use `cache.clearAll()` for full reset.
- **Brand diversity cap**: MAX_PER_BRAND=2 can hide valid results in brand-heavy categories.
- **MAX_PER_STORE**: Set to 3, which limits results from any single retailer.

### Resolved Issues (Feb 2026)
- B&H selectors: 4 broken selectors fixed (price, originalPrice, rating, reviewCount)
- eBay HTTP scraping: Moved to Playwright
- Newegg false bot detection: Page-size threshold added
- BenQ 24.1" false positive: Unknown-size filter for display categories
- LG 45" regression from query expansion: Dual-query search
- Samsung 49" rejection: Asymmetric size tolerance + widened buckets
- Decimal screen sizes (26.5", 31.5"): Fixed regex to handle `\d{2,3}(?:\.\d)?`
- All circuit breakers reset

---

## Changelog / Memories

### Feb 13, 2026 - Major Upgrade (Score: 5.2/10 -> 7.2/10+)

**Round 1 fixes:**
- Fixed decimal size parsing in `extractSpecsFromName` regex
- Made size filtering asymmetric (generous upward, strict downward)
- Added `querySpecPenalty` for multiplicative spec mismatch scoring
- Implemented strict/relaxed result classification with output divider
- Added `expandSizeQuery` to remove size from store queries
- Added `getMarketContext` for thin product categories
- Fixed Newegg bot detection false positive (page size threshold)
- Moved eBay to Playwright
- Reset all circuit breakers

**Round 2 fixes:**
- Dual-query search: BOTH original and expanded queries, merge and dedup
- Unknown-size filter: reject display products with no parseable size when user specified one
- B&H Photo selectors: 4 selectors updated to match current site
- eBay Playwright bot detection: page-size threshold (same as HTTP)
- Home Depot: disabled (Akamai unbypassable)
- eBay removed from HTTP_STORES (Playwright only)

### Feb 12, 2026 - Dual Scoring System

- Implemented Quality/Value dual scoring (Q and V scores)
- Combined sort: 60% quality, 40% value
- Tags: Sweet Spot, Premium, Deal, Low Data
- Review confidence discounting (1-2 reviews blend to neutral)
- OLED panel boost in scoreTVSpecs
- Refurbished quality penalty (15%)
- Fixed specsPerDollar formula
- eBay bot detection improved

### Feb 12, 2026 - Review & Reddit Improvements

- Amazon review selectors: 3 additional fallback selectors
- Brand diversity cap: MAX_PER_BRAND=2
- Reddit relevance filtering (post title must match query specs)
- Store status line in footer
- Reddit subreddit mappings expanded to 27 categories
- Review sources expanded to 19 categories
- Price range passthrough to all supported stores
- Soft failure tracking and display
- Thin results warning with widened range suggestion
