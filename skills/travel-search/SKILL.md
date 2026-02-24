# Travel Search Skill v3.7

**Review-aware travel search** with direct booking links, emoji-rich output, and discount hunting.

**Trigger words:** travel search, find trip, plan trip, flights and airbnb, vacation search, trip to [destination]

## What's New in v3.7

### New Summary Format
The summary section now provides a curated recommendation:
1. **Recommended Flight** - Best value flight (cost/duration weighted)
2. **Top 5 Airbnbs** - Scored by reviews + cost + discount + location
3. **Flexible Date Deals** - 6 options total:
   - 3 "Much Cheaper" - Significantly below average price
   - 3 "Luxury on Discount" - Normally expensive listings now in budget

### Expanded Airbnb Results
- Now returns **10 Airbnbs** (up from 6)
- Each with per-night cost, cancel policy, booking ID

### Faster Airbnb Search (Experimental)
- **Parallel scraping** - Multiple browser tabs for concurrent searches
- **API fallback** - Direct Airbnb API when available
- **Cached neighborhood data** - Pre-loaded bounds reduce network calls
- **Lighter headless mode** - Disabled images/CSS for speed

## What's New in v3.6

### Improved Emojis
- **❄️** for AC (clearer than 🌡️)
- **✅/❌** for cancel policy (more visible than ✓/✗)
- **💪** for gym (more universal than 🏋️)
- **🏅** for Superhost
- **🐾** for pet-friendly
- **🆕** for new listings

### Review Source Weighting
Reviews are weighted by source credibility:
- **Reddit locals**: 1.5x weight (authentic local perspective)
- **TripAdvisor**: 1.0x weight (tourist-heavy but detailed)
- **Google Reviews**: 0.8x weight (often brief)
- **Blogs/Articles**: 1.2x weight (in-depth analysis)

### Recency Decay
Newer reviews matter more:
- Reviews from last 6 months: 100% weight
- 6-12 months: 80% weight
- 1-2 years: 50% weight
- 2+ years: 25% weight

### Fake Review Detection

Flag suspicious reviews before including in analysis:

```
Suspicious indicators (each adds 0.2 to spam score):
- Generic praise without specifics ("Great place!")
- First review from account
- Multiple reviews on same day
- Reviewer has only 5-star or 1-star reviews
- Copy-pasted text across reviews
- Excessive emoji usage
- Review much shorter than average

spam_score >= 0.6 → exclude from analysis
spam_score >= 0.4 → reduce weight by 50%
```

### Outlier Review Handling

Extreme reviews get dampened:
```
If review is 2+ std deviations from listing average:
  weight *= 0.3  # Reduce outlier impact

If 1-star review mentions unrelated issue (e.g., "flight was delayed"):
  exclude from analysis
```

### Confidence Scoring
Neighborhood scores now show confidence level:
- **High confidence**: 50+ reviews analyzed
- **Medium confidence**: 15-49 reviews
- **Low confidence**: <15 reviews

## What's New in v3.5

### Booking IDs
- **Flights**: F1, F2, F3... for easy reference when booking
- **Airbnbs**: A1, A2, A3... for easy reference when booking
- Say "book F2 + A3" to proceed with specific options

### Price Indicators (Simplified)
- **🟢🔻 -12%** = Green down arrow (good - below average price)
- **🔴🔺 +8%** = Red up arrow (bad - above average price)
- No strikethrough text, cleaner display

### Enhanced Flight Output
- **Top 5 flights** sorted by total cost (including taxes)
- Each shows: ✈️ Airline | 💰 Total w/taxes | ⏱️ Duration | 🔄 Connections
- **Price arrows**: 🟢🔻 below average (good) | 🔴🔺 above average (bad) with %
- **Speed emojis**: ⚡ fast (<8hrs) | 🐢 slow (>14hrs)
- **Direct link** to book that specific flight

### Enhanced Airbnb Output
- **10 listings** ranked by reviews + cost + location
- Each shows:
  - 📍 Neighborhood | ⭐ Rating (reviews)
  - 💰 Total + per-night cost (e.g., "$2,400 ($400/night)")
  - 🟢🔻 -15% discount indicator when below normal price
  - ✓ Free cancel or ✗ No free cancel
- **Amenity emojis**: 🏊 Pool | 🛁 Hot Tub | 🎱 Pool Table | 🎮 Game Room | 🏋️ Gym | 🅿️ Parking | 🌡️ AC | 📶 WiFi | 🍳 Kitchen | 🧺 Washer
- **Direct listing link**: `airbnb.com/rooms/[ID]`

### Enhanced Budget Summary
- **Cost per day** shown for each option
- **Aligned numbers** for easy comparison
- **Separator lines** between options (not above totals)
- No remaining budget or checkmarks

### Finding Discounted Listings
- **Prioritize listings showing "X% off"** or crossed-out prices
- **Value score**: quality_score / normalized_price
- **Flag luxury at budget prices**: Show 🟢🔻 -20% when normally expensive listing is discounted

## Output Format

### Flight Results (Top 5)
```
✈️ FLIGHTS (BOS → Paris, 4 pax) - Apr 17-23

F1. Air France Nonstop ⚡
    💰 $3,200 total | ⏱️ 7h 15m | 🔄 Nonstop
    7:05pm → 8:10am+1
    🔗 google.com/travel/flights/booking?...

F2. TAP Portugal 🟢🔻 -18%
    💰 $2,100 total | ⏱️ 11h 30m | 🔄 1 stop (LIS)
    10:40am → 7:05am+1
    🔗 google.com/travel/flights/booking?...

F3. United via Newark 🔴🔺 +12%
    💰 $3,600 total | ⏱️ 10h 20m | 🔄 1 stop (EWR)
    6:00am → 9:20pm
    🔗 google.com/travel/flights/booking?...
```

### Airbnb Results (Top 10)
```
🏠 AIRBNBS (Apr 17-23, 6 nights, 4 guests)

A1. Charming Marais Loft 🏅 ⭐4.92 (127) 🟢🔻 -25%
    📍 Le Marais | $2,400 ($400/night)
    🏊 ❄️ 📶 🍳 | ✅ Free cancel
    🔗 airbnb.com/rooms/12345678

A2. Saint-Germain Family Flat ⭐4.88 (89)
    📍 Saint-Germain (6th) | $2,650 ($442/night)
    🛁 🅿️ ❄️ 🍳 🧺 | ❌ No free cancel
    🔗 airbnb.com/rooms/23456789

A3. Opera Grands Boulevards 🏅 ⭐4.98 (43) 🟢🔻 -20%
    📍 Opera (2nd) | $3,282 ($547/night)
    ❄️ 📶 🍳 | ✅ Free cancel
    🔗 airbnb.com/rooms/34567890
```

### Transportation (5 cars + Turo)
```
🚗 RENTAL CARS (Apr 17-23)

R1. Enterprise - Peugeot 3008 🟢🔻 -10%
    💰 $380/week | 📍 CDG Airport | ⭐ 4.2
    🔗 enterprise.com/...

R2. Hertz - VW Golf
    💰 $420/week | 📍 CDG Airport | ⭐ 4.0
    🔗 hertz.com/...

🚙 TURO
T1. Tesla Model 3 - Pierre
    💰 $85/day ($510/week) | 📍 Paris 11th | ⭐ 4.9 (23 trips)
    🔗 turo.com/...
```

### Budget Summary (New v3.7 Format)
```
📊 RECOMMENDATIONS (Budget: $6,000)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✈️ RECOMMENDED FLIGHT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
F2. TAP Portugal 🟢🔻 -18%
    $2,100 total | 11h 30m | 1 stop (LIS)
    Best combo of price + duration
    🔗 google.com/travel/flights/...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏠 TOP 5 AIRBNBS (by score)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A1. Marais Loft 🏅 ⭐4.92 (127) 🟢🔻 -25%
    $2,400 ($400/night) | ✅ Free cancel
    📍 Le Marais | Score: 9.7

A2. Opera Apt 🏅 ⭐4.98 (43) 🟢🔻 -20%
    $3,282 ($547/night) | ✅ Free cancel
    📍 Opera | Score: 8.4

A3. Saint-Germain Flat ⭐4.88 (89)
    $2,650 ($442/night) | ❌ No free cancel
    📍 Saint-Germain | Score: 8.2

A4. Bastille Modern ⭐4.85 (156)
    $2,200 ($367/night) | ✅ Free cancel
    📍 Bastille | Score: 7.9

A5. Latin Quarter Studio ⭐4.91 (67)
    $2,100 ($350/night) | ✅ Free cancel
    📍 Latin Quarter | Score: 7.6

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 FLEXIBLE DATE DEALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MUCH CHEAPER (vs normal prices):
📅 Apr 14-20: F+A total $3,800 🟢🔻 -22%
📅 Apr 21-27: F+A total $4,100 🟢🔻 -18%
📅 May 1-7:   F+A total $3,600 🟢🔻 -28%

LUXURY → BUDGET (normally $8k+, now in range):
🏆 Apr 14-20: Penthouse Marais $4,800 (was $7,200)
🏆 Apr 21-27: Eiffel View Apt $5,400 (was $8,100)
🏆 May 5-11:  Champs Suite $5,100 (was $7,800)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 BEST COMBO: F2 + A1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✈️ TAP Portugal:      $2,100
🏠 Marais Loft:       $2,400
🚇 Metro passes:        $120
───────────────────────────────
💰 TOTAL:             $4,620  ($770/day)
```

## Emoji Reference

### Price Indicators
- 🟢🔻 **Below Average** - Green = good deal (e.g., 🟢🔻 -15%)
- 🔴🔺 **Above Average** - Red = bad/expensive (e.g., 🔴🔺 +8%)
- No indicator = average/normal price

### Speed (Flights)
- ⚡ **Fast** - Under 8 hours
- 🐢 **Slow** - Over 14 hours

### Cancellation
- ✅ Free cancel (was ✓ - more visible)
- ❌ No free cancel (was ✗ - more visible)

### Amenities (Airbnb)

**Essential** (always shown):
| Emoji | Amenity |
|-------|---------|
| ❄️ | AC (was 🌡️ - clearer) |
| 📶 | WiFi |
| 🍳 | Kitchen |
| 🧺 | Washer/Dryer |

**Luxury** (highlighted when present):
| Emoji | Amenity |
|-------|---------|
| 🏊 | Pool |
| 🛁 | Hot Tub |
| 🎱 | Pool Table |
| 🎮 | Game Room |
| 💪 | Gym (was 🏋️ - better support) |
| 🏖️ | Beach Access |
| ⛷️ | Ski-in/out |
| 🔥 | Fireplace |

**Convenience**:
| Emoji | Amenity |
|-------|---------|
| 🅿️ | Free Parking |
| 🌳 | Garden/Patio |
| 🐾 | Pet-friendly |
| ♿ | Accessible |

**Host Badges**:
| Emoji | Meaning |
|-------|---------|
| 🏅 | Superhost |
| 🆕 | New listing (<6 months) |
| ⚡ | Instant book |

## Quick Start

```bash
# Basic search (uses saved defaults)
python3 search.py "Paris" -d "Apr 17-26" -n 6

# Full search
python3 search.py "Tokyo" -d "May 1-15" -n 5 -g 2 -b 5000 -t romantic

# Analyze reviews (pipe from WebSearch results)
echo "review text here" | python3 search.py "Paris" --analyze-reviews -t family

# Rank Airbnb listings by review quality
echo '{"listings": [...]}' | python3 search.py --rank-airbnbs --json

# Structured output for LLM consumption
python3 search.py "Rome" -d "Jun 1-10" -n 7 --structured
```

## Commands

### Search Commands
```bash
python3 search.py <destination> -d <dates> -n <nights> [options]

Options:
  -g, --guests INT      Number of travelers (default: saved or required)
  -b, --budget INT      Total trip budget
  -t, --type TYPE       family|romantic|adventure|budget|luxury|general
  -o, --origin CITY     Departure city (default: Boston)
  --no-car              Skip rental car search
  --json                Output as JSON
  --structured          Output LLM-optimized JSON with execution steps
```

### Review Analysis Commands
```bash
# Analyze neighborhood reviews from stdin
echo "review text" | python3 search.py <destination> --analyze-reviews -t <trip_type>

# Rank Airbnbs by review quality score
echo '{"listings": [...]}' | python3 search.py --rank-airbnbs
```

### Preferences & History
```bash
# View/manage history
python3 search.py --history           # Show last 3 searches
python3 search.py --clear-history

# View/manage defaults
python3 search.py --show-defaults
python3 search.py --set-defaults -g 4 -b 6000 -t family -o Boston
python3 search.py --clear-defaults

# Airline preferences
python3 search.py --set-prefs --airlines "United,Delta" --alliances "Star Alliance"
python3 search.py --show-prefs
```

## How Review Scoring Works

### Neighborhood Scoring

1. **Base sentiment** (-1 to +1): Keyword-based analysis of positive/negative language
2. **Aspect scores**: Each aspect (safety, walkability, etc.) scored independently
3. **Trip-type weighting**: Different weights per trip type

```
Family trip weights:
- safety: 1.5x
- walkability: 1.3x
- family_friendly: 1.5x
- nightlife: 0.2x (low priority)

Romantic trip weights:
- food_scene: 1.4x
- walkability: 1.3x
- authenticity: 1.3x
- family_friendly: 0.3x (low priority)
```

4. **Final score**: 30% base sentiment + 70% weighted aspects

### Airbnb Quality Score

```
quality_score = rating * log10(review_count + 1) * host_modifier

host_modifier:
- Superhost: 1.15x
- Regular host with >90% response rate: 1.0x
- <90% response rate or <1hr response time: 0.9x

Examples:
- 5.0 rating, 1 review, regular: 5.0 * log10(2) * 1.0 = 1.5
- 4.9 rating, 50 reviews, Superhost: 4.9 * log10(51) * 1.15 = 9.7
- 4.5 rating, 200 reviews, regular: 4.5 * log10(201) * 1.0 = 10.4
```

Higher scores = more trustworthy. A 4.9 with 50 reviews beats a 5.0 with 3 reviews.

### New Listing Handling (🆕)

Listings with <6 months history or <5 reviews get special treatment:

```
If review_count < 5:
  # Can't trust rating, use proxy signals
  quality_score = (host_rating * 0.4) + (response_rate * 0.3) + (profile_completeness * 0.3)

  # Apply new listing penalty (uncertainty discount)
  quality_score *= 0.7

  # But boost if Superhost's new property
  if host_is_superhost:
    quality_score *= 1.3
```

Display: Show 🆕 badge + "New listing - limited reviews"

### Value Score (Price Normalized)

```
value_score = quality_score / normalized_price

normalized_price = listing_price / neighborhood_avg_price

Examples:
- $400/night listing in neighborhood avg $500/night: normalized = 0.8
- value_score = 9.7 / 0.8 = 12.1 (great value!)

- $600/night listing in neighborhood avg $400/night: normalized = 1.5
- value_score = 9.7 / 1.5 = 6.5 (overpriced for quality)
```

### Discount Detection

```
discount_pct = (original_price - current_price) / original_price * 100

Thresholds:
- 🟢🔻 -10% to -19%: Good deal
- 🟢🔻🔥 -20%+: Great deal (show fire emoji)
```

## Output Format

### Neighborhood Rankings
```
📍 NEIGHBORHOOD RANKINGS (for family trip):

1. Le Marais (score: 82/100)
   • 92% positive sentiment (15 mentions)
   • Pros: walkable, safe, great food scene
   • Cons: expensive
   • Best for: romantic, foodie

2. Saint-Germain (score: 78/100)
   • 88% positive sentiment (12 mentions)
   • Pros: family-friendly, safe
   • Best for: family, luxury
```

### Transportation Analysis
```
🚗 TRANSPORTATION ANALYSIS:

   ➡️  NO CAR NEEDED (confidence: 95%)
   • Public transit quality: excellent
   • Tips:
      - Metro is the fastest way around
      - Buy a week pass for €22

   💰 Est. weekly costs: Car ~$350 | Transit ~$50
```

### Airbnb Rankings
```
🏠 AIRBNB RANKINGS (by review quality):

1. Charming Flat in Marais 🏆
   ⭐ 4.91 (127 reviews) | Quality Score: 10.3
   💰 $2,450 total
   📍 Le Marais
   🔗 https://airbnb.com/rooms/12345678
```

## Structured Output

With `--structured`, outputs JSON optimized for Claude:

```json
{
  "version": "3.0",
  "execution_plan": [
    {
      "step": 1,
      "action": "web_search",
      "description": "Research neighborhood recommendations",
      "queries": ["best neighborhood Paris family reddit", ...],
      "expected_output": "neighborhood_reviews_text"
    },
    {
      "step": 2,
      "action": "analyze_reviews",
      "command": "python3 search.py --analyze-reviews ...",
      "input": "neighborhood_reviews_text from step 1"
    },
    ...
  ]
}
```

## Caching

Review data is cached at `~/.config/travel-search/review_cache/` with 30-day TTL.

```bash
# Clear cache for fresh results
rm -rf ~/.config/travel-search/review_cache/
```

## Supported Cities with Neighborhood Boundaries

Neighborhood recognition with lat/lng bounding boxes for accurate location tagging:

### Paris
| Neighborhood | Bounds (SW → NE) | Aliases |
|--------------|------------------|---------|
| Le Marais | 48.8520,2.3520 → 48.8620,2.3680 | 3rd/4th arr, Marais |
| Saint-Germain | 48.8480,2.3280 → 48.8560,2.3450 | 6th arr, St-Germain |
| Montmartre | 48.8820,2.3300 → 48.8920,2.3500 | 18th arr |
| Opera | 48.8680,2.3280 → 48.8780,2.3450 | 9th arr, Grands Boulevards |
| Latin Quarter | 48.8450,2.3400 → 48.8530,2.3580 | 5th arr, Quartier Latin |
| Bastille | 48.8480,2.3650 → 48.8580,2.3850 | 11th/12th arr |

### Tokyo
| Neighborhood | Bounds | Aliases |
|--------------|--------|---------|
| Shibuya | 35.6550,139.6950 → 35.6680,139.7100 | 渋谷 |
| Shinjuku | 35.6850,139.6900 → 35.7050,139.7150 | 新宿 |
| Asakusa | 35.7080,139.7900 → 35.7200,139.8050 | 浅草 |
| Ginza | 35.6650,139.7550 → 35.6780,139.7700 | 銀座 |

### London
| Neighborhood | Bounds | Aliases |
|--------------|--------|---------|
| Soho | 51.5100,−0.1400 → 51.5180,−0.1280 | W1 |
| Covent Garden | 51.5080,−0.1280 → 51.5150,−0.1180 | WC2 |
| Shoreditch | 51.5220,−0.0850 → 51.5320,−0.0700 | E1/E2 |
| South Bank | 51.4980,−0.1200 → 51.5080,−0.0900 | SE1 |

*(Full coordinates for all 60+ neighborhoods in config file)*

### Neighborhood Adjacency

For "walking distance" and "close to" queries:

```python
ADJACENCY = {
  "paris": {
    "Le Marais": ["Bastille", "Opera", "Latin Quarter", "Louvre"],
    "Saint-Germain": ["Latin Quarter", "Louvre", "Montparnasse"],
    "Montmartre": ["Pigalle", "Opera", "Batignolles"],
  },
  "tokyo": {
    "Shibuya": ["Harajuku", "Ebisu", "Daikanyama"],
    "Shinjuku": ["Kabukicho", "Yoyogi", "Nakano"],
  }
}

def get_nearby(city, neighborhood, max_distance=1):
  """Returns neighborhoods within N hops"""
  if max_distance == 0:
    return [neighborhood]
  adjacent = ADJACENCY.get(city, {}).get(neighborhood, [])
  return [neighborhood] + adjacent
```

When searching for "near Le Marais", also include results from Bastille and Opera.

### Fallback Pattern Matching
For unsupported cities, extract neighborhood from:
1. Listing title ("Apt in Trastevere" → "Trastevere")
2. Address field (parse after comma)
3. Host description (NLP extraction)

Confidence: ~70% accuracy for unlisted cities.

## Browser Automation Implementation

### Chrome Control Integration
Uses the `chrome-control` skill for reliable browser automation.

### Step 1: Extract Flights from Google Flights

```bash
# Open Google Flights
chrome open "https://www.google.com/travel/flights?q=BOS+to+Paris+4+pax+Apr+17-23"

# Wait for dynamic content (flights load via JS)
sleep 5

# Take screenshot for visual verification
chrome screenshot $TAB_ID

# Extract flight data via JS
chrome js $TAB_ID "
  Array.from(document.querySelectorAll('[data-ved]'))
    .filter(el => el.textContent.includes('$'))
    .slice(0, 5)
    .map(el => ({
      airline: el.querySelector('[data-airline]')?.textContent || '',
      price: el.querySelector('span[aria-label*=\"$\"]')?.textContent || '',
      duration: el.querySelector('[aria-label*=\"hr\"]')?.textContent || '',
      stops: el.textContent.includes('Nonstop') ? 'Nonstop' : '1+ stops'
    }))
"

# Clean up
chrome close $TAB_ID
```

### Step 2: Extract Airbnbs

```bash
# Open Airbnb with filters
chrome open "https://www.airbnb.com/s/Paris--France/homes?adults=4&checkin=2026-04-17&checkout=2026-04-23&min_bedrooms=2"

sleep 5

# Extract listing IDs from page HTML (more reliable than JS)
chrome html $TAB_ID | grep -oE '/rooms/[0-9]+' | sort -u | head -10

# For each listing ID, get details:
# - Rating and review count from data attributes
# - Price from [data-testid="price"]
# - Amenities from listing page if needed

chrome close $TAB_ID
```

### Selectors Reference (with Fallbacks)

Sites change selectors frequently. Use fallback chains:

**Google Flights:**
```javascript
// Flight rows - try in order:
selectors.flightRow = [
  '[data-ved]',                    // Primary (2024)
  '.gws-flights-results__result',  // Fallback
  '[jsname="IWWDBc"]'              // Legacy
].find(s => document.querySelector(s));

// Price - try in order:
selectors.price = [
  'span[aria-label*="$"]',
  '[data-price]',
  '.gws-flights-results__price'
];

// Duration
selectors.duration = [
  '[aria-label*="hr"]',
  '.gws-flights-results__duration'
];
```

**Airbnb:**
```javascript
// Listing cards
selectors.cards = [
  '[itemprop="itemListElement"]',  // Primary
  '[data-testid="card-container"]', // Fallback
  '.c1l1h97y'                       // Legacy class
];

// Room IDs - always reliable
selectors.roomId = 'a[href*="/rooms/"]';

// Price
selectors.price = [
  '[data-testid="price"]',
  '._1y74zjx',                     // Class-based fallback
  'span:contains("$")'             // Last resort
];

// Strikethrough (discount)
selectors.originalPrice = [
  '[style*="line-through"]',
  '.c1pk68c3',
  'del'
];
```

**Selector Validation:**
Before scraping, verify selectors work:
```javascript
// Quick health check
const validate = () => {
  const tests = [
    { name: 'listings', sel: selectors.cards[0], min: 3 },
    { name: 'prices', sel: selectors.price[0], min: 3 }
  ];
  return tests.every(t =>
    document.querySelectorAll(t.sel).length >= t.min
  );
};
```

### Error Handling

```
Retry logic:
1. If page doesn't load in 10s, retry once
2. If CAPTCHA detected (look for "verify you're human"),
   wait 30s and try with different user agent
3. If rate limited (429), exponential backoff: 5s, 15s, 45s
4. If partial data, cache what succeeded and note gaps

Fallback:
- If Airbnb blocks, show search URL instead of listings
- If Google Flights blocks, suggest checking directly
- Cache successful results for 4 hours (flights) / 24 hours (Airbnbs)
```

### Step 3: Extract Rental Cars

```bash
# Kayak
chrome open "https://www.kayak.com/cars/Paris,France/2026-04-17/2026-04-23"
sleep 5
chrome screenshot $TAB_ID
# Extract via similar pattern
chrome close $TAB_ID

# Turo
chrome open "https://turo.com/us/en/search?country=FR&location=Paris"
# Note: Turo requires interaction to set dates
```

### Step 4: Display Results
1. Apply emoji coding based on price/speed
2. Calculate budget totals for combinations
3. Highlight discounts and best value options
4. Format per output specification above

## Limitations

1. **Browser automation required**: Direct links require scraping actual results
2. **Sites may block**: CAPTCHAs, rate limits, bot detection
3. **Prices change constantly**: Results are point-in-time snapshots
4. **No booking**: Manual action required to complete purchase
5. **Discount data varies**: Not all listings show original vs sale price

## Changelog

### v3.6 (Current)
- **Selector fallback chains** - Multiple selectors per element with validation
- **Fake review detection** - Spam scoring system, outlier dampening
- **New listing handling** - Special scoring for <5 review listings with 🆕 badge
- **Neighborhood adjacency** - "Near X" queries include adjacent neighborhoods
- **Browser automation implementation** - Concrete selectors, retry logic, error handling
- **Review source weighting** - Reddit 1.5x, TripAdvisor 1.0x, Google 0.8x
- **Recency decay** - Recent reviews weighted higher (6mo: 100%, 2yr: 25%)
- **Confidence scoring** - High/Medium/Low based on review count
- **Superhost modifier** - 1.15x quality multiplier for Superhost
- **Value score formula** - quality_score / normalized_price (vs neighborhood avg)
- **Neighborhood boundaries** - Lat/lng bounding boxes for Paris, Tokyo, London
- **Better emojis** - ❄️ AC, 💪 Gym, ✅/❌ cancel, 🏅 Superhost, 🐾 pets
- **Host badges** - 🏅 Superhost, 🆕 New listing, ⚡ Instant book

### v3.5
- **Booking IDs** - F1, F2, A1, A2, R1, T1 for easy reference
- **Simplified price indicators** - 🔻 -15% (below avg) or 🔺 +8% (above avg)
- **Per-night pricing** on Airbnbs ($2,400 ($400/night))
- **Cancellation policy** shown on every listing (✓ Free cancel / ✗ No free cancel)
- **Cost per day** in budget summary
- **Aligned numbers** for easy comparison
- **Separator lines** between options, not above totals
- Removed: strikethrough text, remaining budget, checkmarks

### v3.4
- **Direct booking links** - Each flight, Airbnb, rental car links to specific listing
- **Top 5 flights** sorted by cost with airline, duration, stops, price/speed emojis
- **Top 10 Airbnbs** with direct room links, amenity emojis, discount hunting
- **5 rental cars** from major companies + Turo rideshare
- **Enhanced emoji system** for prices, speed, and amenities
- **Discount display** - strikethrough pricing when discounted

### v3.3
- Neighborhood detection (60+ neighborhoods, 10 cities)

### v3.1
- Head-to-head neighborhood comparison
- Lat/lng bounds for neighborhood Airbnb URLs
- 20+ cities transport cost estimates

### v3.0
- Review sentiment analysis
- Airbnb review quality scoring
- Structured JSON output
