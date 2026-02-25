# Travel Search Skill v4.5

**Review-aware travel search** with direct booking links, clean conditional output, discount hunting, frequent flyer miles, price drop alerts, and mistake fare sniping.

## IMPORTANT: Airbnb Authentication

**DO NOT use wishlist features** - The Airbnb account has a verification popup that blocks all navigation when logged in. Instead:

1. **Browse logged-out** - Search works fine without login
2. **Return direct URLs** - Users can bookmark/save manually
3. **Login only at checkout** - Verification happens then anyway

The verification popup is tied to the logged-in session and cannot be bypassed without completing ID verification.

**Trigger words:** travel search, find trip, plan trip, flights and airbnb, vacation search, trip to [destination]

---

## Fast Puppeteer Scraper (NEW in v4.4)

The new Puppeteer-based scraper is **10-20x faster** than the chrome-control approach, completing full travel searches in 15-30 seconds.

### Setup

```bash
cd ~/.claude/skills/travel-search
npm install
```

### Quick Start

```bash
node scrape.js --dest "Paris" --checkin "2026-04-17" --checkout "2026-04-23" --guests 4 --origin "BOS" --budget 6000
```

### CLI Options

| Option | Short | Required | Default | Description |
|--------|-------|----------|---------|-------------|
| --dest | -d | Yes | - | Destination city |
| --checkin | - | Yes | - | Check-in date (YYYY-MM-DD) |
| --checkout | - | Yes | - | Check-out date (YYYY-MM-DD) |
| --guests | -g | No | 4 | Number of travelers |
| --origin | -o | No | BOS | Origin airport code |
| --budget | -b | No | - | Total budget in USD |
| --format | -f | No | json | Output: `json` or `message` |
| --flex-days | --flex | No | 0 | Search N additional date windows for cheapest |
| --no-cache | - | No | false | Skip price caching (don't store/compare prices) |

### Output Formats

**JSON Output (default)** - Full structured data:
```json
{
  "success": true,
  "params": { "destination": "Paris", "nights": 6, ... },
  "flights": [
    { "id": "F1", "airline": "JetBlue", "price": 1796, "duration": "7h 5m", "stops": "Nonstop" }
  ],
  "airbnbs": [
    { "id": "A1", "name": "Marais Loft", "priceTotal": 1560, "rating": 4.92, "url": "..." }
  ],
  "recommendations": { "bestCombinationTotal": 3356, "withinBudget": true }
}
```

**Message Output** (`--format message`) - Ready for iMessage:
```
TRAVEL: Paris
2026-04-17 to 2026-04-23 (6n)
4 guests from BOS
Budget: $6,000

FLIGHTS (5 options)
F1. JetBlue
   $1,796 | 7h 5m | Nonstop
F2. TAP
   $1,612 | 10h 30m | 1 stop

AIRBNBS (10 listings)
A1. Marais Loft
   4.92 (127)
   $1,560 ($260/n)
   Free cancel
   airbnb.com/rooms/21303487
...
```

### Flexible Date Search (NEW in v4.5)

Find the cheapest date window within a range:

```bash
# Search Apr 17-23 plus 3 more windows (18-24, 19-25, 20-26)
node scrape.js -d "Paris" --checkin "2026-04-17" --checkout "2026-04-23" --flex-days 3 -f message
```

**Output:**
```
FLEXIBLE DATES: Paris
Base: 2026-04-17 + 3 days
4 guests from BOS

CHEAPEST WINDOW
Apr 19 (6n): $3,150
  Flight: $1,590
  Airbnb: $1,560
  SAVE $206 (-6%) vs original dates

ALL OPTIONS (4 windows)
1. Apr 19: $3,150 *BEST*
2. Apr 18: $3,200
3. Apr 17: $3,356 (original)
4. Apr 20: $3,420
```

How it works:
- Generates N+1 date windows (base date + N shifted windows)
- Each window maintains the same number of nights
- Searches each window sequentially (to avoid rate limiting)
- Ranks by total cost (cheapest flight + cheapest Airbnb)
- Shows savings vs original dates

### Price Caching with SQLite (NEW in v4.5)

Track price history and get "vs 7-day avg" comparisons:

**Automatic Features:**
- All search results stored in `~/.claude/skills/travel-search/data/price_cache.db`
- When historical data exists, output includes price comparisons
- Example: `vs 7d avg $3,500: -5% GOOD DEAL`

**Price Cache CLI:**
```bash
# Initialize database
node price_cache.js init

# View stats for a destination
node price_cache.js stats paris

# Check price alerts
node price_cache.js alerts

# Clean up old data (default: 90 days)
node price_cache.js cleanup 60
```

**Price Comparison Labels:**
| Condition | Label |
|-----------|-------|
| 25%+ below avg | EXCEPTIONAL |
| 10-24% below avg | GOOD DEAL |
| 10%+ above avg | ABOVE AVG |
| Within 10% | (no label) |

**JSON Output with Price Comparison:**
```json
{
  "success": true,
  "priceComparison": {
    "currentPrice": 3356,
    "avgPrice": 3620,
    "minPrice": 3200,
    "maxPrice": 4100,
    "sampleCount": 8,
    "pctDiff": -7,
    "isBelowAvg": true,
    "isGoodDeal": false,
    "description": "vs 7d avg $3,620: -7%"
  },
  ...
}
```

**Database Schema:**
```sql
price_history(
  id, destination, checkin, checkout, guests,
  price_type, price, listing_id, listing_name, airline, timestamp
)
```

**Dependencies:**
```bash
npm install better-sqlite3
```

### Speed Improvements

| Feature | Chrome-Control | Puppeteer Scraper |
|---------|----------------|-------------------|
| Execution time | 2-5 minutes | 15-30 seconds |
| Parallelism | Sequential | Flights + Airbnb parallel |
| DOM wait | Fixed sleep (4s) | Dynamic polling |
| Modal dismiss | Manual | Auto-injected JS |
| Network capture | None | API response interception |
| Data extraction | Multiple round-trips | Single batch evaluate |

### Key Features

1. **Headless Chrome** - No visible browser window
2. **Parallel Scraping** - Flights and Airbnb scraped simultaneously
3. **Auto-dismiss Modals** - Cookie banners, login prompts, price alerts
4. **Network Interception** - Captures API responses for better data
5. **Batch Extraction** - Single JS call extracts all listing data
6. **Fallback Selectors** - 5+ CSS selectors per element type
7. **Error Recovery** - Returns fallback URLs on failure

### Programmatic Usage

```javascript
const { searchTravel, formatForMessage } = require('./scrape.js');

const result = await searchTravel({
  destination: 'Paris',
  checkin: '2026-04-17',
  checkout: '2026-04-23',
  guests: 4,
  origin: 'BOS',
  budget: 6000
});

if (result.success) {
  console.log(formatForMessage(result));
}
```

---

## Input Parameters

| Param | Required | Format | Example |
|-------|----------|--------|---------|
| destination | Yes | City, Country | "Paris, France" |
| checkIn | Yes | YYYY-MM-DD | "2026-04-17" |
| checkOut | Yes | YYYY-MM-DD | "2026-04-23" |
| guests | Yes | Integer 1-16 | 4 |
| origin | No | Airport code | "BOS" (default) |
| budget | No | USD integer | 6000 |
| tripType | No | family/romantic/budget/luxury | "family" |

---

## Secure Credentials Storage (~/.claude/secrets.env)

All sensitive data stored in one secure file. One-time setup, then auto-reads.

### Frequent Flyer Miles
```bash
# Airlines - miles balance + expiration
MILES_UNITED=125000
MILES_UNITED_EXPIRES=2027-03-15
MILES_DELTA=45000
MILES_DELTA_EXPIRES=2026-12-31
MILES_AMERICAN=32000
MILES_JETBLUE=18000
MILES_SOUTHWEST=25000

# Preferred airlines (for routing)
PREFERRED_AIRLINES=United,JetBlue,Delta
```

### Hotel Points
```bash
# Hotel loyalty programs + expiration
POINTS_MARRIOTT=82000
POINTS_MARRIOTT_EXPIRES=2027-06-01
POINTS_HILTON=156000
POINTS_HILTON_EXPIRES=never
POINTS_HYATT=28000
POINTS_IHG=45000
```

### Lounge Access
```bash
# Airport lounge memberships
LOUNGE_PRIORITY_PASS=true
LOUNGE_AMEX_CENTURION=true
LOUNGE_UNITED_CLUB=false
LOUNGE_DELTA_SKY_CLUB=false
```

### Airbnb Session (for wishlist automation)
```bash
# Airbnb session cookies (NOT password - just session token)
# Export from browser using Cookie-Editor extension
AIRBNB_SESSION_COOKIES='[{"name":"_airbed_session_id","value":"..."}]'
```

### Traveler Preferences
```bash
# TSA PreCheck / Global Entry
TSA_PRECHECK=true
GLOBAL_ENTRY=true

# Seat preferences
SEAT_PREF=aisle
LEGROOM_PREF=extra  # extra/standard

# Airbnb preferences
AIRBNB_SUPERHOST_ONLY=false
AIRBNB_INSTANT_BOOK=true
```

### Price Alert Settings
```bash
# Price drop monitoring
PRICE_ALERT_ENABLED=true
PRICE_ALERT_THRESHOLD=10  # Alert when price drops 10%+
PRICE_CHECK_INTERVAL=3600  # Check every hour (seconds)
```

### Mistake Fare Settings
```bash
# Mistake fare sniping
MISTAKE_FARE_ENABLED=true
MISTAKE_FARE_ROUTES=BOS-CDG,BOS-FCO,BOS-LHR,BOS-NRT  # Routes to monitor
MISTAKE_FARE_THRESHOLD=50  # Alert when 50%+ below average
```

---

## What's New in v4.2

### 1. Price Drop Alerts
Monitor saved searches and notify when prices drop below threshold.
- Background price monitoring every hour (configurable)
- Tracks both flights and Airbnbs from previous searches
- Sends text: "🚨 PRICE DROP: Paris flights now $1,450 (was $1,796) -19%"
- Configurable threshold (default: 10% drop)

### 2. Points Sweet Spot Finder
Calculate optimal use of miles vs cash for every flight.
- Shows cents-per-point value for each redemption option
- Highlights when miles > 2cpp value (exceptional redemption)
- Compares cash price vs points+taxes to find true savings
- "💰 Use miles: 45k + $89 = 2.3cpp (vs $1,125 cash)"

### 3. Expiration Countdown
Track miles/points expiration and warn before loss.
- Reads expiration dates from secrets.env
- Alerts: "⚠️ 45k Delta miles expire in 30 days!"
- Suggests redemption options when expiration approaching
- Weekly summary of expiring balances

### 4. Family Room Optimizer
Auto-compare accommodation configurations for 4+ guests.
- Compares: 2x hotel rooms vs suite vs 2BR Airbnb vs connecting rooms
- Factors in: sq footage, separate bedrooms, kitchen savings, points efficiency
- "2BR Airbnb beats 2 hotel rooms by $120/night + has kitchen"
- Highlights best value for families specifically

### 5. Flexible Date Matrix (±3 days)
Compact grid showing cheapest options across date range.
- Searches ±3 days from requested dates
- Shows grid format for quick comparison
- Highlights cheapest combination with exact dates
- "📅 Shift to Apr 14-20: Save $380 (-22%)"

### 6. Lounge Access Check
Show available airport lounges based on your memberships.
- Reads lounge access from secrets.env
- Maps layover airports to available lounges
- "🛋️ BOS T-C: Priority Pass lounge | CDG 2E: Amex Centurion"
- Helpful for long layovers (shows if worth it)

### 7. Historical Price Context
Show where current price sits vs route average.
- Builds local price history database from searches
- "This route averages $1,950. Current: $1,612 (-17%)"
- Gives confidence to book NOW vs wait
- Shows seasonal trends when enough data

### 8. Mistake Fare Sniper 🎯
Real-time monitoring for airline pricing errors (50-90% off).
- Monitors configured routes continuously
- Detects prices 50%+ below historical average
- Instant text alert: "🚨 MISTAKE FARE: BOS→Paris $287 (normally $1,600)!"
- Includes direct booking link + "Book NOW - may be fixed soon"
- Runs as background daemon

---

## What's New in v4.1

### Frequent Flyer Miles Integration
- Show cash price + miles redemption option
- Calculate value per mile (is miles or cash better?)
- Alert when miles = better value than cash
- Filter to preferred airlines for miles earning

### Airbnb Wishlist Automation
- Login using stored session cookies
- Create wishlists from search results
- Ask after results: "Save to wishlist? Reply A1, A4, A7"
- Auto-create folder named after search (e.g., "Paris Apr17-23 4pax")

### Hotel Points Comparison (4-5 Star Luxury Discounts Only)
- Focus on luxury hotels with large discounts (30%+ off)
- Compare discounted hotel vs Airbnb value
- Show: "Ritz Carlton: $450 → $285/night (-37%) vs Airbnb A3: $195"
- Skip budget hotels entirely

### Traveler Preferences
- Filter flights for TSA PreCheck lanes
- Prefer nonstop + short layovers
- Apply seat preferences to booking links

---

## What's New in v4.3

### Conditional Output Rules (Clean, Relevant Output)
Only show features when applicable to THIS search:

| Feature | Show When |
|---------|-----------|
| Lounge Info | User has lounge passes AND flight has layover >= 2 hours |
| Miles Option | User has miles for that specific airline |
| Expiration Warning | Miles/points actually expiring within 90 days |
| Hotel Points | User has >= 10k hotel points AND qualifying hotels found |
| Family Optimizer | guests >= 4 OR tripType === "family" |
| Flexible Dates (full grid) | User requested OR savings >= 15% |
| Flexible Dates (single line) | Savings 10-15%, compact suggestion only |
| Price Context (expanded) | Sample size >= 10 AND deviation >= 15% |
| Wishlist Prompt | AIRBNB_SESSION_COOKIES configured |
| Amenity Icons | Show TOP 3 only (AC, WiFi, Kitchen priority) |
| Fast/Slow Flight | ⚡ only < 7hrs, 🐢 only > 14hrs |

### Output Simplification
- **Before**: 7-8 emojis per listing (cluttered)
- **After**: 3-4 relevant emojis max

**Example - Clean Airbnb Output:**
```
A1. Marais Loft 🏅 ⭐4.92
Le Marais | $260/n | 💰 -25%
❄️📶🍳 | Free cancel
→ airbnb.com/rooms/21303487
```

### Fixed Runtime Errors
All undefined functions now implemented:
- `sleep()`, `parsePrice()`, `parseBalance()`
- `selectWithFallback()`, `extractText()`, `extractPrice()`
- `offsetDate()`, `dateDiff()`, `dateDiffDays()`
- `getActiveSearches()`, `recordPrice()`, `scrapeCurrentPrice()`

### Bug Fixes
- Fixed `data` undefined in `calculateBestValue()` sort
- Fixed race condition in parallel date matrix scraping (chunked)
- Fixed infinite loop risk in mistake fare daemon (mutex lock)
- Fixed miles parsing with commas (125,000 → 125000)
- Added JSON.parse error handling for cookies

---

## What's New in v4.0

### Circuit Breaker Pattern
After 3 consecutive failures, wait 60s before retrying (prevents rate limit escalation).

### Complete A1-A10 Output Examples
All 10 Airbnb listings shown with links in output format section.

### Weekday Date Logic
Flexible date search now properly offsets to weekday starts.

## What's New in v3.9

### Price Indicators (Simplified)
- **💰 -15%** = Money bag = good deal (10-24% below avg)
- **💸 +8%** = Money with wings = expensive (above avg)
- **🔥 -25%+** = Fire = exceptional deal (25%+ discount)
- No indicator = normal/average price

### Required: Direct Booking Links
**ALL listings MUST have clickable links:**
- **Flights**: Google Flights deep link with full itinerary
- **Airbnbs**: `airbnb.com/rooms/[ID]` for ALL 10 listings
- **Fallback**: Search URL + "[link]" note if direct unavailable

### Visual Output Symbols (Max 35 chars/line for iMessage)
| Symbol | Meaning |
|--------|---------|
| 💰 | Good deal (10-24% below avg) |
| 💸 | Expensive (above avg) |
| 🔥 | Exceptional deal (25%+ off) |
| ⚡ | Fast flight (<8 hrs) |
| 🐢 | Slow flight (>14 hrs) |
| ⭐ | Rating with review count |
| 🏅 | Superhost |
| ✅ | Free cancellation |
| ❌ | No free cancellation |
| 🆕 | New listing (<6 months) |

### Amenity Emojis (NO CONFLICTS)
| Emoji | Amenity |
|-------|---------|
| ❄️ | AC |
| 📶 | WiFi |
| 🍳 | Kitchen |
| 🧺 | Washer/Dryer |
| 🏊 | Pool |
| 🛁 | Hot Tub |
| 💪 | Gym |
| 🅿️ | Parking |
| 🐾 | Pet-friendly |
| 🪵 | Fireplace (NOT 🔥 - that's for deals) |

---

## Core Helper Functions (v4.3)

### Essential Utilities
```javascript
// Sleep function - REQUIRED for retry logic
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Parse price from text (handles commas, currency symbols)
function parsePrice(text) {
  if (!text) return 0;
  const match = text.match(/[\d,]+\.?\d*/);
  return match ? parseFloat(match[0].replace(/,/g, '')) : 0;
}

// Parse miles balance (handles commas like "125,000")
function parseBalance(value) {
  if (!value) return 0;
  return parseInt(String(value).replace(/,/g, ''), 10) || 0;
}

// Date helpers
function offsetDate(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function dateDiff(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

const dateDiffDays = dateDiff; // Alias
```

### Selector Helpers
```javascript
// Try multiple selectors until one works
async function selectWithFallback(page, selectors) {
  for (const sel of selectors) {
    const elements = await page.$$(sel);
    if (elements.length > 0) return elements;
  }
  return [];
}

// Extract text from element using fallback selectors
async function extractText(element, selectors) {
  for (const sel of selectors) {
    const el = await element.$(sel);
    if (el) {
      const text = await el.evaluate(e => e.textContent.trim());
      if (text) return text;
    }
  }
  return null;
}

// Extract price number from element
async function extractPrice(element, selectors) {
  const text = await extractText(element, selectors);
  return parsePrice(text);
}

// Extract star rating (1-5)
async function extractStars(element, selectors) {
  const text = await extractText(element, selectors);
  if (!text) return 0;
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

// Extract discount percentage
async function extractDiscount(element, selectors) {
  const text = await extractText(element, selectors);
  if (!text) return 0;
  const match = text.match(/(\d+)%/);
  return match ? parseInt(match[1]) : 0;
}
```

### Database Helper Functions
```javascript
// Get active price monitoring searches
async function getActiveSearches() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM saved_searches WHERE active = 1', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// Record price to history
async function recordPrice(search, currentPrice) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO price_history (search_hash, route, destination, check_in, check_out, guests, total_price)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [search.search_hash, search.route, search.destination, search.check_in, search.check_out, search.guests, currentPrice],
      (err) => err ? reject(err) : resolve()
    );
  });
}

// Scrape current price for a saved search
async function scrapeCurrentPrice(search) {
  const result = await scrapeQuickPrice(search.destination, {
    checkIn: search.check_in,
    checkOut: search.check_out
  });
  return result.total;
}
```

### Safe JSON Parsing
```javascript
// Parse cookies with error handling
function parseCookiesJson(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (e) {
    console.error('Invalid AIRBNB_SESSION_COOKIES JSON. Please re-export from browser.');
    return null;
  }
}
```

### Chunked Parallel Scraping (Rate Limit Safe)
```javascript
// Scrape date matrix without overwhelming rate limits
async function generateDateMatrixSafe(baseSearch, daysRange = 3) {
  const matrix = [];

  // Generate date combinations
  for (let departOffset = -daysRange; departOffset <= daysRange; departOffset++) {
    for (let returnOffset = -daysRange; returnOffset <= daysRange; returnOffset++) {
      const checkIn = offsetDate(baseSearch.checkIn, departOffset);
      const checkOut = offsetDate(baseSearch.checkOut, returnOffset);
      const nights = dateDiff(checkIn, checkOut);
      if (nights >= (baseSearch.minNights || 1)) {
        matrix.push({ checkIn, checkOut, nights });
      }
    }
  }

  // Chunked parallel execution (3 at a time)
  const results = [];
  const chunkSize = 3;

  for (let i = 0; i < matrix.length; i += chunkSize) {
    const chunk = matrix.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(async dates => {
        const price = await scrapeQuickPrice(baseSearch.destination, dates);
        return { ...dates, price: price.total };
      })
    );
    results.push(...chunkResults);

    // Respect rate limits between chunks
    if (i + chunkSize < matrix.length) {
      await sleep(2000);
    }
  }

  return results.sort((a, b) => a.price - b.price);
}
```

### Mistake Fare Daemon with Lock
```javascript
// Prevent overlapping runs
let mistakeFareRunning = false;

async function scheduleMistakeFareCheck() {
  if (mistakeFareRunning) {
    console.log('Mistake fare check already running, skipping');
    return;
  }

  mistakeFareRunning = true;
  try {
    await checkForMistakeFares();
  } catch (err) {
    console.error('Mistake fare check failed:', err.message);
  } finally {
    mistakeFareRunning = false;
    // Schedule next run
    setTimeout(scheduleMistakeFareCheck, 5 * 60 * 1000);
  }
}

// Start daemon
if (process.env.MISTAKE_FARE_ENABLED === 'true') {
  scheduleMistakeFareCheck();
}
```

---

## Conditional Output Logic (v4.3)

### Should Show Feature?
```javascript
// Determine what to show based on context
function getOutputFlags(search, userConfig, results) {
  const flags = {};

  // Lounge: need passes + layover
  flags.showLounges = (
    getUserLoungeAccess().length > 0 &&
    results.flights.some(f => f.layoverMinutes >= 120)
  );

  // Miles: only for airlines user has miles for
  const userMiles = getMilesBalances();
  flags.showMilesFor = Object.keys(userMiles).filter(k => userMiles[k] > 0);

  // Expiration: only if something expiring
  flags.showExpiration = getExpiringBalances(90).length > 0;

  // Hotels: user has points + qualifying hotels found
  const hotelPoints = getHotelPoints();
  const hasHotelPoints = Object.values(hotelPoints).some(p => p >= 10000);
  flags.showHotels = hasHotelPoints && results.hotels.length > 0;

  // Family optimizer: 4+ guests or family trip
  flags.showFamilyOptimizer = (
    search.guests >= 4 || search.tripType === 'family'
  );

  // Date matrix: show if savings significant
  const savings = results.flexDateSavings || 0;
  flags.showDateMatrixFull = search.flexibleDates || savings >= 15;
  flags.showDateMatrixCompact = !flags.showDateMatrixFull && savings >= 10;

  // Price context: only if meaningful data
  flags.showPriceContext = (
    results.historical?.sampleSize >= 10 &&
    Math.abs(results.historical.pctDiff) >= 15
  );

  // Wishlist: only if cookies configured
  flags.showWishlistPrompt = !!parseCookiesJson(process.env.AIRBNB_SESSION_COOKIES);

  return flags;
}
```

### Top 3 Amenities Only
```javascript
// Priority order for amenities
const AMENITY_PRIORITY = ['ac', 'wifi', 'kitchen', 'washer', 'pool', 'parking'];

function getTopAmenities(listing, max = 3) {
  const amenities = listing.amenities || [];
  const sorted = amenities.sort((a, b) => {
    const aIdx = AMENITY_PRIORITY.indexOf(a);
    const bIdx = AMENITY_PRIORITY.indexOf(b);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });
  return sorted.slice(0, max);
}

function formatAmenities(listing) {
  const top = getTopAmenities(listing, 3);
  const EMOJI_MAP = {
    ac: '❄️', wifi: '📶', kitchen: '🍳', washer: '🧺',
    pool: '🏊', parking: '🅿️', hottub: '🛁', gym: '💪'
  };
  return top.map(a => EMOJI_MAP[a] || '').join('');
}
```

---

## Scraping Implementation

### Selector Fallback Chains (Sites Change Often!)

**Google Flights - Flight Cards:**
```javascript
const FLIGHT_CARD_SELECTORS = [
  '[data-ved] li[data-id]',           // 2026 primary
  '.gws-flights-results__result-item', // Fallback 1
  '[jsname="IWWDBc"]',                 // Fallback 2
  'li[data-flt]',                      // Fallback 3
  '.gws-flights__result-item'          // Legacy
];

function getFlightCards() {
  for (const sel of FLIGHT_CARD_SELECTORS) {
    const cards = document.querySelectorAll(sel);
    if (cards.length >= 3) return cards;
  }
  throw new Error('Flight cards not found - selectors may be outdated');
}
```

**Google Flights - Prices:**
```javascript
const PRICE_SELECTORS = [
  'span[aria-label*="$"]',
  '[data-price]',
  '.gws-flights-results__price',
  'span[data-gs]',
  '.YMlIz'  // Class-based fallback
];
```

**Google Flights - Duration:**
```javascript
const DURATION_SELECTORS = [
  '[aria-label*="hr"]',
  '[aria-label*="hour"]',
  '.gws-flights-results__duration',
  '.Ak5kof'
];
```

**Airbnb - Listing Cards:**
```javascript
const AIRBNB_CARD_SELECTORS = [
  '[itemprop="itemListElement"]',      // Primary 2026
  '[data-testid="card-container"]',    // Fallback 1
  'div[data-search-result-id]',        // Fallback 2
  '.c1l1h97y',                         // Class fallback
  '.lxq01kf'                           // Alt class
];
```

**Airbnb - Prices (Current + Strikethrough):**
```javascript
const PRICE_CURRENT_SELECTORS = [
  '[data-testid="price-availability-row"] span',
  '._1y74zjx',
  'span._tyxjp1'
];

const PRICE_ORIGINAL_SELECTORS = [
  '[style*="line-through"]',
  'del',
  '.c1pk68c3',
  's'  // HTML strikethrough
];
```

**Airbnb - Rating & Reviews:**
```javascript
const RATING_SELECTORS = [
  'span[aria-label*="rating"]',
  '[data-testid="listing-card-subtitle"] span',
  '.r1dxllyb'
];
```

**Airbnb - Superhost Badge:**
```javascript
const SUPERHOST_SELECTORS = [
  '[aria-label*="Superhost"]',
  'svg[aria-label*="Superhost"]',
  '.c1yo0219'
];
```

### Retry Logic with Exponential Backoff
```javascript
async function scrapeWithRetry(url, extractFn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

      // Dynamic wait - poll for content instead of fixed sleep
      await page.waitForFunction(
        (sel) => document.querySelectorAll(sel).length >= 3,
        { timeout: 10000 },
        FLIGHT_CARD_SELECTORS[0]
      );

      const data = await page.evaluate(extractFn);
      await page.close();
      return data;
    } catch (err) {
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
      await sleep(delay);

      if (attempt === maxRetries - 1) {
        return { error: err.message, fallbackUrl: url };
      }
    }
  }
}
```

### Rate Limiting
```javascript
const RATE_LIMITS = {
  googleFlights: { requestsPerMin: 10, delayMs: 6000 },
  airbnb: { requestsPerMin: 5, delayMs: 12000 }  // Airbnb is stricter
};

let lastRequest = { googleFlights: 0, airbnb: 0 };

async function rateLimitedFetch(site, fetchFn) {
  const now = Date.now();
  const minDelay = RATE_LIMITS[site].delayMs;
  const elapsed = now - lastRequest[site];

  if (elapsed < minDelay) {
    await sleep(minDelay - elapsed);
  }

  lastRequest[site] = Date.now();
  return fetchFn();
}
```

### Circuit Breaker Pattern
```javascript
// After 3 consecutive failures, pause for 60s before retrying
const circuitBreaker = {
  failures: { googleFlights: 0, airbnb: 0 },
  lastFailure: { googleFlights: 0, airbnb: 0 },
  threshold: 3,
  cooldown: 60000  // 60 seconds
};

async function withCircuitBreaker(site, fetchFn) {
  const now = Date.now();
  const breaker = circuitBreaker;

  // Check if in cooldown period
  if (breaker.failures[site] >= breaker.threshold) {
    const elapsed = now - breaker.lastFailure[site];
    if (elapsed < breaker.cooldown) {
      const remaining = Math.ceil((breaker.cooldown - elapsed) / 1000);
      throw new Error(`Circuit open for ${site}. Retry in ${remaining}s`);
    }
    // Reset after cooldown
    breaker.failures[site] = 0;
  }

  try {
    const result = await fetchFn();
    breaker.failures[site] = 0;  // Reset on success
    return result;
  } catch (err) {
    breaker.failures[site]++;
    breaker.lastFailure[site] = now;
    throw err;
  }
}
```

### Browser Initialization
```javascript
const puppeteer = require('puppeteer');

async function initBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-images',  // Faster loading
      '--disable-css'      // Skip CSS rendering
    ]
  });
}

// User agent rotation to avoid detection
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
```

---

## Google Flights Deep Link Construction

### URL Structure
```
https://www.google.com/travel/flights/booking?
  hl=en&
  gl=us&
  curr=USD&
  tfs={encoded_itinerary}&
  tfu={encoded_params}
```

### Building the Itinerary (`tfs` parameter)
```javascript
function buildFlightDeepLink(flight) {
  // tfs is a base64-encoded protobuf with flight segments
  // Simplified approach: extract from clicked flight card

  const flightCard = getFlightCards()[flightIndex];
  const bookingLink = flightCard.querySelector('a[href*="/flights/booking"]');

  if (bookingLink) {
    return bookingLink.href;  // Use Google's own deep link
  }

  // Fallback: construct search URL with filters
  const params = new URLSearchParams({
    hl: 'en',
    gl: 'us',
    curr: 'USD',
    f: `${flight.origin}`,
    t: `${flight.destination}`,
    d: flight.departDate,  // YYYY-MM-DD
    r: flight.returnDate,
    px: flight.passengers,
    s: '0'  // Sort by best
  });

  return `https://www.google.com/travel/flights/search?${params}`;
}
```

### Extracting Deep Links (Best Method)
```javascript
// Google Flights includes booking links in the DOM
// Click the flight card and capture the booking URL

async function extractFlightDeepLinks(page) {
  const flights = [];
  const cards = await page.$$('[data-ved] li[data-id]');

  for (let i = 0; i < Math.min(5, cards.length); i++) {
    // Click to expand flight details
    await cards[i].click();
    await page.waitForTimeout(500);

    // Extract booking URL from expanded view
    const bookingUrl = await page.$eval(
      'a[href*="flights/booking"]',
      el => el.href
    ).catch(() => null);

    const flightData = await extractFlightData(cards[i]);
    flightData.bookingUrl = bookingUrl || buildFallbackUrl(flightData);

    flights.push(flightData);
  }

  return flights;
}
```

---

## Discount Detection (Luxury → Budget)

### Method 1: Strikethrough Price Detection
```javascript
function detectDiscount(listingCard) {
  const originalPriceEl = listingCard.querySelector('[style*="line-through"], del, s');
  const currentPriceEl = listingCard.querySelector('[data-testid="price-availability-row"]');

  if (originalPriceEl && currentPriceEl) {
    const original = parsePrice(originalPriceEl.textContent);
    const current = parsePrice(currentPriceEl.textContent);
    const discount = ((original - current) / original) * 100;

    return {
      hasDiscount: true,
      original,
      current,
      discountPct: Math.round(discount),
      emoji: discount >= 25 ? '🔥' : discount >= 10 ? '💰' : ''
    };
  }

  return { hasDiscount: false };
}
```

### Method 2: "X% Off" Badge Detection
```javascript
const DISCOUNT_BADGE_SELECTORS = [
  '[aria-label*="% off"]',
  'span:contains("% off")',
  '.discountBadge',
  '[data-testid="discount-badge"]'
];

function detectDiscountBadge(listingCard) {
  for (const sel of DISCOUNT_BADGE_SELECTORS) {
    const badge = listingCard.querySelector(sel);
    if (badge) {
      const match = badge.textContent.match(/(\d+)%\s*off/i);
      if (match) return parseInt(match[1]);
    }
  }
  return null;
}
```

### Method 3: Compare to Session Average (No External API)
```javascript
// Calculate "expensive" threshold from current search results
function calculatePriceBaseline(listings) {
  const prices = listings.map(l => l.pricePerNight);
  const sorted = [...prices].sort((a, b) => a - b);

  // Median as baseline
  const median = sorted[Math.floor(sorted.length / 2)];

  // Mark as "deal" if 15%+ below median
  // Mark as "expensive" if 15%+ above median
  return {
    median,
    dealThreshold: median * 0.85,
    expensiveThreshold: median * 1.15
  };
}
```

### Method 4: Luxury → Budget Detection
```javascript
// Detect normally expensive listings now in budget
// Uses listing quality signals (Superhost, high reviews) + lower price

function detectLuxuryOnDiscount(listing, baseline) {
  const isHighQuality = (
    listing.isSuperhost ||
    listing.rating >= 4.9 ||
    listing.reviewCount >= 100
  );

  const isBelowExpected = listing.pricePerNight < baseline.median * 0.8;

  if (isHighQuality && isBelowExpected) {
    return {
      isLuxuryDeal: true,
      savings: baseline.median - listing.pricePerNight,
      label: `🏆 Normally $${Math.round(baseline.median * 1.3)}/night`
    };
  }

  return { isLuxuryDeal: false };
}
```

### Flexible Date Search
```javascript
// Search +/- 3 days from requested dates to find deals
async function searchFlexibleDates(baseSearch, page) {
  const datesToCheck = [
    { offset: -3, label: 'Earlier' },
    { offset: 3, label: 'Later' },
    { offset: 0, weekday: true, label: 'Weekday start' }
  ];

  const results = [];

  for (const dateOption of datesToCheck) {
    let searchDates;
    if (dateOption.weekday) {
      searchDates = offsetToNextWeekday(baseSearch.dates);
    } else {
      searchDates = offsetDates(baseSearch.dates, dateOption.offset);
    }

    const url = buildSearchUrl({ ...baseSearch, dates: searchDates });
    const prices = await scrapeWithRetry(url, extractPrices);
    const totalCost = prices.flight + prices.bestAirbnb;

    if (totalCost < baseSearch.budget * 0.85) {
      results.push({
        dates: searchDates,
        total: totalCost,
        savings: baseSearch.baselineTotal - totalCost,
        emoji: '💰'
      });
    }
  }

  return results.sort((a, b) => a.total - b.total).slice(0, 3);
}

// Helper: offset to next weekday (Tue-Thu are cheapest)
function offsetToNextWeekday(dates) {
  const checkIn = new Date(dates.checkIn);
  const day = checkIn.getDay();  // 0=Sun, 6=Sat

  // Move Sat/Sun to Tuesday, move Fri to Tuesday
  if (day === 0) checkIn.setDate(checkIn.getDate() + 2);  // Sun → Tue
  if (day === 5) checkIn.setDate(checkIn.getDate() + 4);  // Fri → Tue
  if (day === 6) checkIn.setDate(checkIn.getDate() + 3);  // Sat → Tue

  const nights = dateDiffDays(dates.checkIn, dates.checkOut);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + nights);

  return {
    checkIn: checkIn.toISOString().split('T')[0],
    checkOut: checkOut.toISOString().split('T')[0]
  };
}
```

---

## Error States & Fallbacks

### When Scraping Fails
```
🚫 FLIGHTS UNAVAILABLE
Could not load flight data. Try:
🔗 google.com/travel/flights?q=BOS+to+Paris

🚫 AIRBNBS UNAVAILABLE
Could not load listings. Try:
🔗 airbnb.com/s/Paris--France/homes?guests=4
```

### When No Results Match Budget
```
⚠️ NO OPTIONS UNDER $6,000

Closest options found:
F1 + A3 = $6,450 (8% over budget)
F2 + A5 = $6,200 (3% over budget)

💡 Try flexible dates or fewer nights
```

### When Partial Data
```
✈️ FLIGHTS (3 of 5 loaded)
[show available flights]

⚠️ Some listings missing links
```

---

## Output Format (Max 35 chars/line)

### Flight Results
```
✈️ FLIGHTS (BOS→Paris, 4 pax)

F1. JetBlue ⚡
$1,796 | 7h 05m | Nonstop
🔗 [booking link]

F2. TAP 💰 -18%
$1,612 | 10h 30m | 1 stop
🔗 [booking link]

F3. Delta 💸 +12%
$2,368 | 7h 00m | Nonstop
🔗 [booking link]
```

### Airbnb Results (ALL 10 with links)
```
🏠 AIRBNBS (6 nights, 4 guests)

A1. Marais Loft 🏅 ⭐4.92 (127)
📍 Le Marais | $1,560 ($260/n)
💰 -25% | ❄️📶🍳 | ✅
🔗 airbnb.com/rooms/21303487

A2. Eiffel View 🔥 -30%
📍 Trocadero | $1,710 ($285/n)
⭐5.0 (15) | ❄️📶 | ✅
🔗 airbnb.com/rooms/137844905

A3. Montmartre 2BR ⭐4.92 (13)
📍 Montmartre | $1,170 ($195/n)
💰 -18% | 📶🍳 | ✅
🔗 airbnb.com/rooms/903529509

A4. Terrace Apt ⭐4.82 (11)
📍 Palais Tokyo | $1,920 ($320/n)
📶🍳 | ❌
🔗 airbnb.com/rooms/117478472

A5. Grenelle 2BR 🏅 ⭐4.85+
📍 7th Arr | $1,320 ($220/n)
💰 -15% | ❄️📶🍳🧺 | ✅
🔗 airbnb.com/rooms/847291035

A6. Chaillot Family 🏅 ⭐4.9+
📍 Arc Triomphe | $1,650 ($275/n)
❄️📶🍳🧺 | ✅
🔗 airbnb.com/rooms/293847561

A7. Latin Quarter ⭐4.91 (67)
📍 5th Arr | $1,590 ($265/n)
📶🍳 | ✅
🔗 airbnb.com/rooms/582917463

A8. Notre Dame 2BR ⭐4.85+
📍 Latin Q | $1,740 ($290/n)
🪵📶🍳 | ❌
🔗 airbnb.com/rooms/194726583

A9. Luxembourg 2BR ⭐4.9+
📍 6th Arr | $1,590 ($265/n)
📶🍳 | ✅
🔗 airbnb.com/rooms/627391845

A10. Seine Barge 💸 +15%
📍 Louvre | $2,100 ($350/n)
⭐4.9+ | 🛁📶🍳 | ❌
🔗 airbnb.com/rooms/839274651
```

### Recommendations
```
📊 RECS (Budget: $6k)

✈️ BEST FLIGHT
F2. TAP 💰 -18%
$1,612 | 10h 30m
🔗 [link]

🏠 TOP 5 AIRBNBS
1. A1 Marais 🏅 💰
2. A2 Eiffel 🔥
3. A3 Montmartre 💰
4. A5 Grenelle 🏅
5. A7 Latin Q

🔥 DATE DEALS
📅 Apr 14-20: $3,800 💰 -22%
📅 May 1-7: $3,600 🔥 -28%

🏆 LUXURY→BUDGET
Penthouse $4.8k (was $7.2k)

💵 BEST: F2+A1 = $3,172
```

---

## Frequent Flyer Miles Integration

### Reading Miles Balance
```javascript
const dotenv = require('dotenv');
dotenv.config({ path: path.join(os.homedir(), '.claude/secrets.env') });

function getMilesBalances() {
  return {
    united: parseInt(process.env.MILES_UNITED) || 0,
    delta: parseInt(process.env.MILES_DELTA) || 0,
    american: parseInt(process.env.MILES_AMERICAN) || 0,
    jetblue: parseInt(process.env.MILES_JETBLUE) || 0,
    southwest: parseInt(process.env.MILES_SOUTHWEST) || 0
  };
}

function getPreferredAirlines() {
  return (process.env.PREFERRED_AIRLINES || 'United,Delta').split(',');
}
```

### Miles Redemption Display
```javascript
// Calculate if miles redemption is good value
function calculateMilesValue(cashPrice, milesRequired, taxesFees) {
  // Cash price minus what you'd pay with miles (taxes/fees)
  const valueSaved = cashPrice - taxesFees;
  const centsPerMile = (valueSaved / milesRequired) * 100;

  return {
    centsPerMile: centsPerMile.toFixed(2),
    isGoodValue: centsPerMile >= 1.5,  // 1.5 cpp = good redemption
    emoji: centsPerMile >= 2.0 ? '🔥' : centsPerMile >= 1.5 ? '💰' : ''
  };
}
```

### Flight Output with Miles
```
✈️ FLIGHTS (BOS→Paris, 4 pax)

F1. United ⚡ 🎯 Preferred
$2,100 | OR 58k miles + $89 💰
7h 05m | Nonstop
You have: 125k miles ✅
🔗 [booking link]

F2. TAP 💰 -18%
$1,612 | 10h 30m | 1 stop
(No miles option)
🔗 [booking link]

F3. Delta
$1,820 | OR 52k miles + $95
7h 00m | Nonstop
You have: 45k miles ⚠️ (need 7k more)
🔗 [booking link]
```

---

## Airbnb Wishlist Automation

### Loading Session Cookies
```javascript
async function loadAirbnbSession(page) {
  const cookiesJson = process.env.AIRBNB_SESSION_COOKIES;
  if (!cookiesJson) {
    throw new Error('AIRBNB_SESSION_COOKIES not set in secrets.env');
  }

  const cookies = JSON.parse(cookiesJson);
  await page.setCookie(...cookies);

  // Verify login by checking for profile element
  await page.goto('https://www.airbnb.com');
  const isLoggedIn = await page.$('[data-testid="cypress-headernav-profile"]');

  if (!isLoggedIn) {
    throw new Error('Airbnb session expired. Please re-export cookies.');
  }

  return true;
}
```

### Creating Wishlist
```javascript
async function createWishlist(page, listingIds, searchParams) {
  // Generate folder name from search
  const folderName = `${searchParams.destination} ${searchParams.checkIn}-${searchParams.checkOut.slice(5)} ${searchParams.guests}pax`;

  // Create new wishlist
  await page.goto('https://www.airbnb.com/wishlists');
  await page.click('[data-testid="create-wishlist-button"]');
  await page.type('[data-testid="wishlist-name-input"]', folderName);
  await page.click('[data-testid="save-button"]');

  // Add each listing
  for (const id of listingIds) {
    await page.goto(`https://www.airbnb.com/rooms/${id}`);
    await page.click('[data-testid="wishlist-button"]');
    await page.click(`[data-testid="wishlist-${folderName}"]`);
    await sleep(500);
  }

  return folderName;
}
```

### Post-Search Wishlist Prompt
After showing results, skill sends:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💾 SAVE TO WISHLIST?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reply with listing IDs to save
Example: "A1, A4, A7"

Will create folder:
"Paris Apr17-23 4pax"
```

### Handling Wishlist Response
When user replies with IDs:
```javascript
function parseWishlistRequest(message) {
  // Match A1, A2, etc (case insensitive)
  const ids = message.match(/a\d+/gi) || [];
  return ids.map(id => id.toUpperCase());
}

// Example: "A1, A4, A7" → ["A1", "A4", "A7"]
// Example: "save a1 and a3" → ["A1", "A3"]
```

Confirmation message:
```
✅ Added to wishlist "Paris Apr17-23 4pax":
• A1 - Marais Loft 🏅
• A4 - Terrace Apt
• A7 - Latin Quarter

🔗 airbnb.com/wishlists/123456
```

---

## Hotel Points Comparison

### Reading Points Balances
```javascript
function getHotelPoints() {
  return {
    marriott: parseInt(process.env.POINTS_MARRIOTT) || 0,
    hilton: parseInt(process.env.POINTS_HILTON) || 0,
    hyatt: parseInt(process.env.POINTS_HYATT) || 0,
    ihg: parseInt(process.env.POINTS_IHG) || 0
  };
}
```

### Hotel vs Airbnb Comparison Output
```
🏨 HOTEL POINTS OPTIONS

Marriott Le Méridien Etoile
35k pts/night × 6 = 210k pts
You have: 82k ⚠️ (need 128k)
Cash: $285/night ($1,710 total)

Hilton Paris Opera
45k pts/night × 6 = 270k pts
You have: 156k ⚠️ (need 114k)
Cash: $265/night ($1,590 total)

VS AIRBNB:
A3 Montmartre: $195/night ($1,170)
💰 Save $420-$540 vs hotels
```

---

## Credit Card Optimization

### Bonus Tracking
```javascript
function getCardBonuses() {
  const bonuses = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CARD_')) {
      const cardName = key.replace('CARD_', '').replace(/_/g, ' ');
      bonuses[cardName] = value;  // e.g., "3x"
    }
  }
  return bonuses;
}
```

### Card Recommendation Output
```
💳 USE CHASE SAPPHIRE (3x)
Earn 5,388 pts on $1,796 flight
= $80 value toward future travel
```

---

## Traveler Preferences

### Applying Preferences
```javascript
function getTravelerPrefs() {
  return {
    tsaPreCheck: process.env.TSA_PRECHECK === 'true',
    globalEntry: process.env.GLOBAL_ENTRY === 'true',
    seatPref: process.env.SEAT_PREF || 'any',
    legroomPref: process.env.LEGROOM_PREF || 'standard',
    superhostOnly: process.env.AIRBNB_SUPERHOST_ONLY === 'true',
    instantBook: process.env.AIRBNB_INSTANT_BOOK === 'true'
  };
}
```

### Filtering Results
```javascript
function filterByPrefs(listings, prefs) {
  return listings.filter(listing => {
    if (prefs.superhostOnly && !listing.isSuperhost) return false;
    if (prefs.instantBook && !listing.instantBook) return false;
    return true;
  });
}
```

---

---

## Price Drop Alerts Implementation

### Price History Database
```javascript
const sqlite3 = require('sqlite3');
const path = require('path');

const db = new sqlite3.Database(
  path.join(os.homedir(), '.claude/skills/travel-search/price_history.db')
);

// Initialize tables
db.run(`
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY,
    search_hash TEXT,
    route TEXT,
    destination TEXT,
    check_in DATE,
    check_out DATE,
    guests INTEGER,
    flight_price REAL,
    airbnb_price REAL,
    total_price REAL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS saved_searches (
    id INTEGER PRIMARY KEY,
    search_hash TEXT UNIQUE,
    route TEXT,
    destination TEXT,
    check_in DATE,
    check_out DATE,
    guests INTEGER,
    initial_price REAL,
    alert_threshold REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT 1
  )
`);
```

### Background Price Monitor
```javascript
// Run as background daemon
const PRICE_CHECK_INTERVAL = parseInt(process.env.PRICE_CHECK_INTERVAL) || 3600;

async function startPriceMonitor() {
  setInterval(async () => {
    const activeSearches = await getActiveSearches();

    for (const search of activeSearches) {
      const currentPrice = await scrapeCurrentPrice(search);
      const previousPrice = search.initial_price;
      const dropPct = ((previousPrice - currentPrice) / previousPrice) * 100;

      if (dropPct >= search.alert_threshold) {
        await sendPriceDropAlert(search, currentPrice, dropPct);
      }

      // Record to history
      await recordPrice(search, currentPrice);
    }
  }, PRICE_CHECK_INTERVAL * 1000);
}
```

### Price Drop Alert Output
```
🚨 PRICE DROP ALERT!

Paris Apr 17-23, 4 guests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✈️ Flights: $1,450 (was $1,796)
   💰 -$346 (-19%)

🏠 Top Airbnb: $1,350 (was $1,560)
   💰 -$210 (-13%)

📊 Total: $2,800 (was $3,356)
   🔥 -$556 (-17%)

🔗 Book now: [link]
```

---

## Points Sweet Spot Finder Implementation

### Redemption Value Calculator
```javascript
// Standard redemption value benchmarks (cents per point)
const REDEMPTION_BENCHMARKS = {
  united: { economy: 1.2, business: 2.5, first: 3.5 },
  delta: { economy: 1.1, business: 2.0, first: 2.5 },
  american: { economy: 1.3, business: 2.2, first: 3.0 },
  jetblue: { economy: 1.3, business: 1.8 },
  marriott: { standard: 0.7, premium: 1.0 },
  hilton: { standard: 0.5, premium: 0.7 },
  hyatt: { standard: 1.5, premium: 2.0 }
};

function calculateRedemptionValue(program, cashPrice, milesRequired, taxesFees) {
  const valueSaved = cashPrice - taxesFees;
  const centsPerPoint = (valueSaved / milesRequired) * 100;
  const benchmark = REDEMPTION_BENCHMARKS[program]?.economy || 1.0;

  return {
    centsPerPoint: centsPerPoint.toFixed(2),
    rating: centsPerPoint >= benchmark * 2 ? 'exceptional' :
            centsPerPoint >= benchmark * 1.5 ? 'great' :
            centsPerPoint >= benchmark ? 'good' : 'poor',
    emoji: centsPerPoint >= 2.0 ? '🔥' :
           centsPerPoint >= 1.5 ? '💰' :
           centsPerPoint < 1.0 ? '👎' : '',
    recommendation: centsPerPoint >= 1.5 ? 'USE_MILES' : 'PAY_CASH'
  };
}
```

### Sweet Spot Output
```
🎯 POINTS SWEET SPOT ANALYSIS

F1. United BOS→CDG
Cash: $2,100 for 4 passengers

Miles option:
58k miles + $89 taxes
= 2.3 cpp 🔥 EXCEPTIONAL

You have: 125k United miles ✅
💡 USE MILES - Save $2,011 cash

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

F2. Delta BOS→CDG
Cash: $1,820 for 4 passengers

Miles option:
72k miles + $145 taxes
= 1.2 cpp (average)

💡 PAY CASH - miles not worth it
```

---

## Expiration Countdown Implementation

### Expiration Tracker
```javascript
function getExpiringBalances(daysAhead = 90) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const expiring = [];

  const programs = ['UNITED', 'DELTA', 'AMERICAN', 'MARRIOTT', 'HILTON', 'HYATT'];

  for (const program of programs) {
    const balance = parseInt(process.env[`MILES_${program}`] || process.env[`POINTS_${program}`]) || 0;
    const expiresStr = process.env[`MILES_${program}_EXPIRES`] || process.env[`POINTS_${program}_EXPIRES`];

    if (balance > 0 && expiresStr && expiresStr !== 'never') {
      const expires = new Date(expiresStr);
      if (expires <= cutoff) {
        const daysLeft = Math.ceil((expires - now) / (24 * 60 * 60 * 1000));
        expiring.push({
          program,
          balance,
          expires,
          daysLeft,
          urgency: daysLeft <= 30 ? 'critical' : daysLeft <= 60 ? 'warning' : 'notice'
        });
      }
    }
  }

  return expiring.sort((a, b) => a.daysLeft - b.daysLeft);
}
```

### Expiration Alert Output
```
⚠️ MILES EXPIRING SOON!

🚨 CRITICAL (30 days)
Delta: 45,000 miles
Expires: Mar 26, 2026
💡 Book $800+ flight to use them

⚠️ WARNING (60 days)
Marriott: 82,000 points
Expires: Apr 25, 2026
💡 3-night stay at Cat 5 property

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reply "use delta" for redemption options
```

---

## Family Room Optimizer Implementation

### Accommodation Comparison
```javascript
async function compareAccommodations(destination, dates, guests) {
  const results = {
    airbnb2BR: null,
    hotelRooms: null,
    hotelSuite: null,
    hotelConnecting: null
  };

  // Scrape 2BR Airbnb options
  results.airbnb2BR = await scrapeAirbnb({
    destination,
    dates,
    guests,
    bedrooms: 2
  });

  // Scrape hotel options (4-5 star with discounts only)
  const hotels = await scrapeHotels({
    destination,
    dates,
    guests,
    minStars: 4,
    minDiscount: 30
  });

  // Calculate best value
  const comparison = calculateBestValue(results, guests);
  return comparison;
}

function calculateBestValue(options, guests) {
  const scores = [];

  for (const [type, data] of Object.entries(options)) {
    if (!data) continue;

    const score = {
      type,
      pricePerNight: data.totalPrice / data.nights,
      pricePerPerson: data.totalPrice / guests,
      sqftPerPerson: data.sqft ? data.sqft / guests : null,
      hasKitchen: data.hasKitchen || false,
      separateBedrooms: data.bedrooms >= 2,
      pointsOption: data.pointsPrice || null
    };

    // Calculate meal savings if kitchen available
    if (score.hasKitchen) {
      score.mealSavings = data.nights * guests * 15; // ~$15/person/day
      score.effectivePrice = data.totalPrice - score.mealSavings;
    }

    scores.push(score);
  }

  // Sort by effective price (fixed: was using undefined 'data')
  const defaultNights = options.airbnb2BR?.nights || 6;
  return scores.sort((a, b) => {
    const aPrice = a.effectivePrice || (a.pricePerNight * defaultNights);
    const bPrice = b.effectivePrice || (b.pricePerNight * defaultNights);
    return aPrice - bPrice;
  });
}
```

### Family Optimizer Output
```
👨‍👩‍👧‍👦 FAMILY ROOM OPTIMIZER (4 guests)

BEST VALUE:
🏠 2BR Airbnb - Le Marais
$1,560 total ($260/night)
✅ 2 bedrooms | 850 sqft
✅ Full kitchen (save ~$360 on meals)
💰 Effective cost: $1,200

VS OTHER OPTIONS:

🏨 2x Hotel Rooms - Marriott
$2,280 total ($380/night)
❌ No kitchen | 450 sqft total
⚠️ $720 more than Airbnb

🏨 Suite - Hilton
$1,890 total ($315/night)
✅ 1 bedroom + pullout
❌ No kitchen | 550 sqft
⚠️ $330 more than Airbnb

💡 RECOMMENDATION: 2BR Airbnb
Save $720 vs hotel rooms + kitchen!
```

---

## Flexible Date Matrix Implementation

### Date Grid Generator
```javascript
async function generateDateMatrix(baseSearch, daysRange = 3) {
  const matrix = [];

  // Generate date combinations
  for (let departOffset = -daysRange; departOffset <= daysRange; departOffset++) {
    for (let returnOffset = -daysRange; returnOffset <= daysRange; returnOffset++) {
      const checkIn = offsetDate(baseSearch.checkIn, departOffset);
      const checkOut = offsetDate(baseSearch.checkOut, returnOffset);

      // Maintain minimum stay length
      const nights = dateDiff(checkIn, checkOut);
      if (nights < baseSearch.minNights) continue;

      matrix.push({ checkIn, checkOut, nights });
    }
  }

  // Scrape prices for each combination (parallelized)
  const results = await Promise.all(
    matrix.map(async dates => {
      const price = await scrapeQuickPrice(baseSearch.destination, dates);
      return { ...dates, price };
    })
  );

  return results.sort((a, b) => a.price - b.price);
}
```

### Date Matrix Output
```
📅 FLEXIBLE DATE MATRIX (±3 days)

Cheapest combos for Paris, 4 guests:

         Mon   Tue   Wed   Thu   Fri
Apr 14   -     $2.8k $2.9k $3.1k $3.4k
Apr 15   $2.9k $2.7k▼$2.8k $3.0k $3.3k
Apr 16   $3.0k $2.8k $2.9k $3.1k $3.5k
Apr 17   $3.2k $3.0k $3.1k $3.4k $3.6k
Apr 18   $3.4k $3.2k $3.3k $3.5k $3.8k

🔥 BEST: Apr 15 (Tue) = $2,700
   vs Apr 17 = $3,200
   💰 Save $500 (-16%)

Reply "shift to apr 15" to search
```

---

## Lounge Access Implementation

### Lounge Database
```javascript
const LOUNGE_DATABASE = {
  'BOS': {
    'Terminal C': [
      { name: 'The Lounge', access: ['PRIORITY_PASS'] },
      { name: 'Delta Sky Club', access: ['DELTA_SKY_CLUB', 'AMEX_PLATINUM'] }
    ],
    'Terminal E': [
      { name: 'Air France Lounge', access: ['PRIORITY_PASS', 'AIR_FRANCE_FLYING_BLUE'] }
    ]
  },
  'CDG': {
    'Terminal 2E': [
      { name: 'Amex Centurion', access: ['AMEX_CENTURION', 'AMEX_PLATINUM'] },
      { name: 'Air France Salon', access: ['PRIORITY_PASS', 'SKYTEAM_ELITE'] }
    ],
    'Terminal 2F': [
      { name: 'Star Alliance Lounge', access: ['PRIORITY_PASS', 'STAR_ALLIANCE_GOLD'] }
    ]
  }
  // ... more airports
};

function getAvailableLounges(airports, userAccess) {
  const available = [];

  for (const airport of airports) {
    const airportLounges = LOUNGE_DATABASE[airport] || {};

    for (const [terminal, lounges] of Object.entries(airportLounges)) {
      for (const lounge of lounges) {
        const hasAccess = lounge.access.some(a => userAccess.includes(a));
        if (hasAccess) {
          available.push({
            airport,
            terminal,
            name: lounge.name,
            accessMethod: lounge.access.find(a => userAccess.includes(a))
          });
        }
      }
    }
  }

  return available;
}
```

### Lounge Check Output
```
🛋️ LOUNGE ACCESS FOR YOUR TRIP

✈️ BOS (Departure)
Terminal C: The Lounge
   Via: Priority Pass ✅

✈️ CDG (Arrival/Layover)
Terminal 2E: Amex Centurion Lounge
   Via: Amex Platinum ✅
   ⭐ Premium lounge - spa, dining

Terminal 2E: Air France Salon
   Via: Priority Pass ✅

💡 4-hour layover = worth visiting!
```

---

## Historical Price Context Implementation

### Price History Analysis
```javascript
async function getHistoricalContext(route, dates) {
  const history = await db.all(`
    SELECT AVG(total_price) as avg_price,
           MIN(total_price) as min_price,
           MAX(total_price) as max_price,
           COUNT(*) as sample_size
    FROM price_history
    WHERE route = ?
    AND strftime('%m', check_in) = strftime('%m', ?)
  `, [route, dates.checkIn]);

  if (history[0].sample_size < 3) {
    return { hasData: false };
  }

  const seasonality = await getSeasonalTrend(route, dates);

  return {
    hasData: true,
    avgPrice: history[0].avg_price,
    minPrice: history[0].min_price,
    maxPrice: history[0].max_price,
    sampleSize: history[0].sample_size,
    seasonality
  };
}

function formatPriceContext(currentPrice, historical) {
  const diff = currentPrice - historical.avgPrice;
  const pctDiff = (diff / historical.avgPrice) * 100;

  return {
    comparison: pctDiff < -15 ? 'well_below' :
                pctDiff < -5 ? 'below' :
                pctDiff < 5 ? 'average' :
                pctDiff < 15 ? 'above' : 'well_above',
    emoji: pctDiff < -15 ? '🔥' :
           pctDiff < -5 ? '💰' :
           pctDiff > 15 ? '💸' : '',
    message: `${pctDiff > 0 ? '+' : ''}${Math.round(pctDiff)}% vs avg`
  };
}
```

### Historical Context Output
```
📊 PRICE CONTEXT

BOS → Paris (April)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Current: $3,172 total
Average: $3,850 (based on 12 searches)
Range: $2,900 - $4,200

📉 17% BELOW AVERAGE 💰

Seasonal trend: April prices typically
rise 8-12% as departure approaches

💡 RECOMMENDATION: Book now
Price is below average and rising
```

---

## Missing Function Implementations

### Hotel Scraping (for Family Room Optimizer)
```javascript
const HOTEL_SELECTORS = {
  card: ['[data-testid="property-card"]', '.sr-property-item', '.hotel-card'],
  name: ['[data-testid="title"]', '.hotel-name', 'h3'],
  price: ['[data-testid="price-and-discounted-price"]', '.bui-price-display__value'],
  originalPrice: ['[data-testid="price-and-discounted-price"] del', '.bui-price-display__original'],
  stars: ['[data-testid="rating-stars"]', '.bui-rating'],
  discount: ['[data-testid="badge-discount"]', '.bui-badge']
};

async function scrapeHotels({ destination, dates, guests, minStars = 4, minDiscount = 30 }) {
  // Focus on luxury hotels with big discounts only
  const url = `https://www.booking.com/searchresults.html?dest=${encodeURIComponent(destination)}&checkin=${dates.checkIn}&checkout=${dates.checkOut}&group_adults=${guests}&nflt=class%3D4%3Bclass%3D5`;

  return await scrapeWithRetry(url, async (page) => {
    const hotels = [];
    const cards = await selectWithFallback(page, HOTEL_SELECTORS.card);

    for (const card of cards.slice(0, 10)) {
      const hotel = {
        name: await extractText(card, HOTEL_SELECTORS.name),
        price: await extractPrice(card, HOTEL_SELECTORS.price),
        originalPrice: await extractPrice(card, HOTEL_SELECTORS.originalPrice),
        stars: await extractStars(card, HOTEL_SELECTORS.stars),
        discount: await extractDiscount(card, HOTEL_SELECTORS.discount)
      };

      // Only include if meets luxury + discount criteria
      if (hotel.stars >= minStars && hotel.discount >= minDiscount) {
        hotels.push(hotel);
      }
    }

    return hotels;
  });
}

function buildHotelSearchUrl(destination, dates, guests) {
  return `https://www.booking.com/searchresults.html?dest=${encodeURIComponent(destination)}&checkin=${dates.checkIn}&checkout=${dates.checkOut}&group_adults=${guests}&nflt=class%3D4%3Bclass%3D5`;
}
```

### Quick Price Scraping (for Date Matrix + Mistake Fares)
```javascript
async function scrapeQuickFlightPrice(origin, dest, dates = null) {
  // Quick scrape for price monitoring - gets lowest price only
  const dateParam = dates ? `&tfs=${dates.checkIn}` : '';
  const url = `https://www.google.com/travel/flights?q=${origin}+to+${dest}${dateParam}`;

  return await scrapeWithRetry(url, async (page) => {
    await page.waitForSelector(PRICE_SELECTORS[0], { timeout: 10000 });
    const priceEl = await selectWithFallback(page, PRICE_SELECTORS);
    return parsePrice(await priceEl[0].textContent());
  });
}

async function scrapeQuickPrice(destination, dates) {
  const [flightPrice, airbnbPrice] = await Promise.all([
    scrapeQuickFlightPrice('BOS', getAirportCode(destination), dates),
    scrapeTopAirbnbPrice(destination, dates)
  ]);
  return { flight: flightPrice, airbnb: airbnbPrice, total: flightPrice + airbnbPrice };
}

async function scrapeTopAirbnbPrice(destination, dates) {
  const url = `https://www.airbnb.com/s/${encodeURIComponent(destination)}/homes?checkin=${dates.checkIn}&checkout=${dates.checkOut}`;

  return await scrapeWithRetry(url, async (page) => {
    await page.waitForSelector(PRICE_CURRENT_SELECTORS[0], { timeout: 10000 });
    const prices = await page.$$eval(PRICE_CURRENT_SELECTORS[0], els =>
      els.slice(0, 5).map(el => parseFloat(el.textContent.replace(/[^0-9.]/g, '')))
    );
    // Return median of top 5 for baseline
    prices.sort((a, b) => a - b);
    return prices[Math.floor(prices.length / 2)] || 0;
  });
}

function getAirportCode(destination) {
  const codes = {
    'Paris': 'CDG', 'London': 'LHR', 'Rome': 'FCO', 'Tokyo': 'NRT',
    'Barcelona': 'BCN', 'Amsterdam': 'AMS', 'Dublin': 'DUB', 'Lisbon': 'LIS'
  };
  return codes[destination.split(',')[0]] || destination;
}
```

### Seasonal Trend Analysis
```javascript
async function getSeasonalTrend(route, dates) {
  const monthlyAvg = await db.all(`
    SELECT strftime('%m', check_in) as month, AVG(total_price) as avg
    FROM price_history
    WHERE route = ?
    GROUP BY month
    ORDER BY month
  `, [route]);

  if (monthlyAvg.length < 3) {
    return { trend: 'insufficient_data', message: 'Need more searches to establish trend' };
  }

  const targetMonth = dates.checkIn.slice(5, 7);
  const prevMonth = String((parseInt(targetMonth) - 1) || 12).padStart(2, '0');
  const nextMonth = String((parseInt(targetMonth) % 12) + 1).padStart(2, '0');

  const current = monthlyAvg.find(m => m.month === targetMonth)?.avg;
  const prev = monthlyAvg.find(m => m.month === prevMonth)?.avg;
  const next = monthlyAvg.find(m => m.month === nextMonth)?.avg;

  if (!current) return { trend: 'unknown' };

  const changePrev = prev ? ((current - prev) / prev) * 100 : 0;
  const changeNext = next ? ((next - current) / current) * 100 : 0;

  return {
    trend: changePrev > 5 ? 'rising' : changePrev < -5 ? 'falling' : 'stable',
    changeSinceLast: Math.round(changePrev),
    expectedNextMonth: Math.round(changeNext),
    message: changePrev > 10
      ? 'Prices rising - book soon'
      : changePrev < -10
      ? 'Prices falling - may want to wait'
      : 'Prices stable'
  };
}
```

### Booking URL Construction
```javascript
async function getBookingUrl(origin, dest, dates = null) {
  // Build Google Flights booking deep link
  const params = new URLSearchParams({
    hl: 'en',
    gl: 'us',
    f: origin,
    t: dest,
    curr: 'USD'
  });

  if (dates) {
    params.append('d', dates.checkIn);
    params.append('r', dates.checkOut);
  }

  return `https://www.google.com/travel/flights?${params}`;
}
```

---

## Alert Notification System

### Notification Methods
```javascript
// Configure in secrets.env:
// NOTIFY_METHOD=imessage|sms|pushover
// For iMessage (default on macOS), uses existing sendMessage.sh

async function sendAlert(message, urgency = 'normal') {
  const method = process.env.NOTIFY_METHOD || 'imessage';

  switch (method) {
    case 'imessage':
      return sendViaiMessage(message);
    case 'sms':
      return sendViaTwilio(message);
    case 'pushover':
      return sendViaPushover(message, urgency);
    default:
      console.log('[ALERT]', message);
  }
}

async function sendViaiMessage(message) {
  const { execSync } = require('child_process');
  const chatId = process.env.ALERT_CHAT_ID;

  // Use existing sendMessage.sh infrastructure
  execSync(`~/.claude/skills/sms-assistant/scripts/send-sms "${chatId}" "${message.replace(/"/g, '\\"')}"`);
}

async function sendViaTwilio(message) {
  const accountSid = process.env.TWILIO_SID;
  const authToken = process.env.TWILIO_TOKEN;

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      Body: message,
      From: process.env.TWILIO_FROM,
      To: process.env.TWILIO_TO
    })
  });

  return response.ok;
}

async function sendViaPushover(message, urgency) {
  const priority = urgency === 'critical' ? 1 : 0;

  await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: process.env.PUSHOVER_TOKEN,
      user: process.env.PUSHOVER_USER,
      message,
      priority: String(priority)
    })
  });
}
```

### Alert Sending Functions
```javascript
async function sendPriceDropAlert(search, currentPrice, dropPct) {
  const message = `🚨 PRICE DROP!\n\n${search.destination} ${search.check_in}\n` +
    `Now: $${currentPrice} (was $${search.initial_price})\n` +
    `💰 -${Math.round(dropPct)}% savings!\n\n` +
    `Book: ${await getBookingUrl(search.origin, search.destination)}`;

  await sendAlert(message, dropPct >= 20 ? 'critical' : 'normal');
}

async function sendMistakeFareAlert(data) {
  const message = `🚨🚨 MISTAKE FARE! 🚨🚨\n\n` +
    `${data.route}: $${data.currentPrice}\n` +
    `Normal price: $${data.avgPrice}\n` +
    `🔥 ${Math.round(data.discount)}% OFF!\n\n` +
    `⚡ ACT FAST!\n${data.bookingUrl}`;

  await sendAlert(message, 'critical');
}

async function sendExpirationAlert(program, balance, daysLeft) {
  const message = `⚠️ MILES EXPIRING!\n\n` +
    `${program}: ${balance.toLocaleString()} miles\n` +
    `Expires in ${daysLeft} days\n\n` +
    `💡 Use them or lose them!`;

  await sendAlert(message, daysLeft <= 14 ? 'critical' : 'normal');
}
```

### Add to secrets.env
```bash
### Notification Settings
# Method: imessage (default), sms, pushover
NOTIFY_METHOD=imessage
ALERT_CHAT_ID=5aeb0a0073194c75a6811dca35d56d38

# Alternative: Twilio SMS
# TWILIO_SID=ACxxxxxxxxxx
# TWILIO_TOKEN=xxxxxxxxxx
# TWILIO_FROM=+15550001111
# TWILIO_TO=+15551234567

# Alternative: Pushover
# PUSHOVER_USER=xxxxxxxxxx
# PUSHOVER_TOKEN=xxxxxxxxxx
```

---

## Extended Lounge Database

### Complete Airport Lounge Coverage
```javascript
const LOUNGE_DATABASE = {
  // === NORTH AMERICA ===
  'BOS': {
    'Terminal C': [
      { name: 'The Lounge', access: ['PRIORITY_PASS'], hours: '5am-9pm' },
      { name: 'Delta Sky Club', access: ['DELTA_SKY_CLUB', 'AMEX_PLATINUM'], hours: '5am-10pm' }
    ],
    'Terminal E': [
      { name: 'Air France Lounge', access: ['PRIORITY_PASS', 'SKYTEAM_ELITE'], hours: '6am-9pm' }
    ]
  },
  'JFK': {
    'Terminal 1': [
      { name: 'Primeclass Lounge', access: ['PRIORITY_PASS'], hours: '24hr' },
      { name: 'Korean Air Lounge', access: ['SKYTEAM_ELITE'] }
    ],
    'Terminal 4': [
      { name: 'Amex Centurion', access: ['AMEX_CENTURION', 'AMEX_PLATINUM'], premium: true },
      { name: 'Delta Sky Club', access: ['DELTA_SKY_CLUB', 'AMEX_PLATINUM'] }
    ],
    'Terminal 7': [
      { name: 'British Airways Lounge', access: ['ONEWORLD_EMERALD', 'BA_GOLD'] }
    ]
  },
  'LAX': {
    'TBIT': [
      { name: 'Star Alliance Lounge', access: ['STAR_ALLIANCE_GOLD', 'UNITED_CLUB'] },
      { name: 'Qantas First Lounge', access: ['ONEWORLD_EMERALD'], premium: true }
    ],
    'Terminal 2': [
      { name: 'Amex Centurion', access: ['AMEX_CENTURION', 'AMEX_PLATINUM'], premium: true }
    ],
    'Terminal 7': [
      { name: 'United Club', access: ['UNITED_CLUB', 'STAR_ALLIANCE_GOLD'] }
    ]
  },
  'ORD': {
    'Terminal 1': [
      { name: 'United Polaris', access: ['UNITED_POLARIS'], premium: true },
      { name: 'United Club', access: ['UNITED_CLUB', 'STAR_ALLIANCE_GOLD'] }
    ],
    'Terminal 5': [
      { name: 'Amex Centurion', access: ['AMEX_CENTURION', 'AMEX_PLATINUM'], premium: true }
    ]
  },
  'SFO': {
    'International G': [
      { name: 'Amex Centurion', access: ['AMEX_CENTURION', 'AMEX_PLATINUM'], premium: true },
      { name: 'United Polaris', access: ['UNITED_POLARIS'], premium: true }
    ],
    'Terminal 3': [
      { name: 'United Club', access: ['UNITED_CLUB', 'STAR_ALLIANCE_GOLD'] }
    ]
  },
  'MIA': {
    'Terminal D': [
      { name: 'Amex Centurion', access: ['AMEX_CENTURION', 'AMEX_PLATINUM'], premium: true }
    ],
    'Terminal N': [
      { name: 'Admirals Club', access: ['ADMIRALS_CLUB', 'ONEWORLD_EMERALD'] }
    ]
  },
  'ATL': {
    'Terminal F': [
      { name: 'Delta Sky Club', access: ['DELTA_SKY_CLUB', 'AMEX_PLATINUM'] }
    ],
    'Concourse E': [
      { name: 'The Club', access: ['PRIORITY_PASS'] }
    ]
  },

  // === EUROPE ===
  'CDG': {
    'Terminal 2E': [
      { name: 'Amex Centurion', access: ['AMEX_CENTURION', 'AMEX_PLATINUM'], premium: true },
      { name: 'Air France Business', access: ['PRIORITY_PASS', 'SKYTEAM_ELITE'] }
    ],
    'Terminal 2F': [
      { name: 'Star Alliance Lounge', access: ['PRIORITY_PASS', 'STAR_ALLIANCE_GOLD'] }
    ]
  },
  'LHR': {
    'Terminal 3': [
      { name: 'Cathay Pacific Lounge', access: ['ONEWORLD_EMERALD'], premium: true },
      { name: 'No1 Lounge', access: ['PRIORITY_PASS'] }
    ],
    'Terminal 5': [
      { name: 'BA Galleries First', access: ['BA_FIRST', 'ONEWORLD_EMERALD'], premium: true },
      { name: 'Aspire Lounge', access: ['PRIORITY_PASS'] }
    ]
  },
  'AMS': {
    'Lounge 2': [
      { name: 'KLM Crown Lounge', access: ['SKYTEAM_ELITE'] },
      { name: 'Aspire Lounge', access: ['PRIORITY_PASS'] }
    ]
  },
  'FCO': {
    'Terminal 3': [
      { name: 'Plaza Premium', access: ['PRIORITY_PASS'] }
    ]
  },
  'BCN': {
    'Terminal 1': [
      { name: 'Sala VIP Pau Casals', access: ['PRIORITY_PASS'] }
    ]
  },
  'DUB': {
    'Terminal 2': [
      { name: '51st & Green', access: ['PRIORITY_PASS'] }
    ]
  },
  'LIS': {
    'Terminal 1': [
      { name: 'ANA Lounge', access: ['PRIORITY_PASS', 'STAR_ALLIANCE_GOLD'] }
    ]
  },

  // === ASIA ===
  'NRT': {
    'Terminal 1': [
      { name: 'ANA Lounge', access: ['STAR_ALLIANCE_GOLD'] },
      { name: 'United Club', access: ['UNITED_CLUB'] }
    ]
  },
  'HND': {
    'International': [
      { name: 'JAL First Lounge', access: ['JAL_FIRST', 'ONEWORLD_EMERALD'], premium: true },
      { name: 'ANA Suite Lounge', access: ['ANA_FIRST'], premium: true }
    ]
  },
  'SIN': {
    'Terminal 3': [
      { name: 'SilverKris Lounge', access: ['STAR_ALLIANCE_GOLD'] },
      { name: 'SATS Premier', access: ['PRIORITY_PASS'] }
    ]
  },
  'HKG': {
    'Terminal 1': [
      { name: 'Cathay The Pier', access: ['CATHAY_FIRST', 'ONEWORLD_EMERALD'], premium: true },
      { name: 'Plaza Premium', access: ['PRIORITY_PASS'] }
    ]
  },
  'ICN': {
    'Terminal 2': [
      { name: 'Korean Air Lounge', access: ['SKYTEAM_ELITE'] },
      { name: 'Asiana Lounge', access: ['STAR_ALLIANCE_GOLD'] }
    ]
  }
};

// User access configuration reader
function getUserLoungeAccess() {
  const access = [];

  if (process.env.LOUNGE_PRIORITY_PASS === 'true') access.push('PRIORITY_PASS');
  if (process.env.LOUNGE_AMEX_CENTURION === 'true') {
    access.push('AMEX_CENTURION', 'AMEX_PLATINUM');
  }
  if (process.env.LOUNGE_AMEX_PLATINUM === 'true') access.push('AMEX_PLATINUM');
  if (process.env.LOUNGE_UNITED_CLUB === 'true') {
    access.push('UNITED_CLUB', 'STAR_ALLIANCE_GOLD');
  }
  if (process.env.LOUNGE_DELTA_SKY_CLUB === 'true') access.push('DELTA_SKY_CLUB');
  if (process.env.LOUNGE_ADMIRALS_CLUB === 'true') {
    access.push('ADMIRALS_CLUB', 'ONEWORLD_EMERALD');
  }

  return access;
}

function getAvailableLounges(airports, userAccess) {
  const available = [];

  for (const airport of airports) {
    const airportLounges = LOUNGE_DATABASE[airport] || {};

    for (const [terminal, lounges] of Object.entries(airportLounges)) {
      for (const lounge of lounges) {
        const hasAccess = lounge.access.some(a => userAccess.includes(a));
        if (hasAccess) {
          available.push({
            airport,
            terminal,
            name: lounge.name,
            premium: lounge.premium || false,
            accessMethod: lounge.access.find(a => userAccess.includes(a))
          });
        }
      }
    }
  }

  return available;
}
```

---

## Mistake Fare Sniper Implementation

### Mistake Fare Detector
```javascript
// Background daemon for mistake fare detection
const MISTAKE_FARE_THRESHOLD = parseInt(process.env.MISTAKE_FARE_THRESHOLD) || 50;
const MONITORED_ROUTES = (process.env.MISTAKE_FARE_ROUTES || '').split(',');

// Historical average prices (built from searches)
async function getRouteAverage(route) {
  const result = await db.get(`
    SELECT AVG(flight_price) as avg_price
    FROM price_history
    WHERE route = ?
    AND recorded_at > datetime('now', '-90 days')
  `, [route]);

  return result?.avg_price || null;
}

async function checkForMistakeFares() {
  for (const route of MONITORED_ROUTES) {
    const [origin, dest] = route.split('-');
    const avgPrice = await getRouteAverage(route);

    if (!avgPrice) continue;

    // Check current price
    const currentPrice = await scrapeQuickFlightPrice(origin, dest);
    const discount = ((avgPrice - currentPrice) / avgPrice) * 100;

    if (discount >= MISTAKE_FARE_THRESHOLD) {
      await sendMistakeFareAlert({
        route,
        currentPrice,
        avgPrice,
        discount,
        bookingUrl: await getBookingUrl(origin, dest)
      });
    }
  }
}

// Run every 5 minutes
setInterval(checkForMistakeFares, 5 * 60 * 1000);
```

### Mistake Fare Alert Output
```
🚨🚨🚨 MISTAKE FARE ALERT! 🚨🚨🚨

BOS → Paris (CDG)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 CURRENT: $287 roundtrip
📊 NORMAL: $1,600 avg

🔥 82% OFF - LIKELY ERROR!

⚡ ACT FAST - may be fixed soon!

Available dates: Mar 15-22, Apr 2-9

🔗 BOOK NOW:
google.com/flights/booking?...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Mistake fares usually honored if
booked before airline fixes them!
```

---

## Changelog

### v4.4 (Current)
- **NEW: Puppeteer Scraper** - 10-20x faster than chrome-control approach
  - Headless Chrome via Puppeteer with direct DOM evaluation
  - Parallel tab execution (flights + Airbnb simultaneously)
  - Auto-dismiss modals via injected JS (cookie banners, login prompts, price alerts)
  - Network interception to capture API responses
  - Batch JS extraction (single call for all data)
  - Target execution time: 15-30 seconds
- **CLI interface**: `node scrape.js --dest "Paris" --checkin "2026-04-17" --checkout "2026-04-23"`
- **Two output formats**: JSON (default) and message (for iMessage)
- **Fallback URLs**: Always provides search URLs even on scrape failure
- **5 flight options** with prices, airlines, duration, stops, booking links
- **10 Airbnb listings** with prices, ratings, review counts, amenities, direct links

### v4.3
- **Conditional output rules**: Only show features when relevant to THIS search
- **Clean output**: Top 3 amenities only, reduced emoji clutter
- **Core helper functions**: sleep(), parsePrice(), parseBalance(), offsetDate(), dateDiff()
- **Selector helpers**: selectWithFallback(), extractText(), extractPrice(), extractStars()
- **Database helpers**: getActiveSearches(), recordPrice(), scrapeCurrentPrice()
- **Bug fixes**:
  - Fixed `data` undefined in calculateBestValue() sort
  - Fixed race condition with chunked parallel scraping (3 at a time)
  - Fixed infinite loop in mistake fare daemon (mutex lock)
  - Fixed miles parsing with commas (parseBalance)
  - Added JSON.parse error handling for cookies
- **Output flags**: getOutputFlags() determines what to show
- **Amenity limiting**: getTopAmenities() prioritizes AC, WiFi, Kitchen

### v4.2.1
- **Fixed undefined functions**: scrapeHotels(), scrapeQuickFlightPrice(), getSeasonalTrend(), getBookingUrl()
- **Alert notification system**: sendAlert() with iMessage, Twilio SMS, Pushover support
- **Extended lounge database**: 20+ airports (was 2), includes JFK, LAX, ORD, SFO, LHR, HKG, NRT, SIN
- **Quick price scraping**: For date matrix and mistake fare monitoring
- **Seasonal trend analysis**: Monthly average comparison with trend detection
- **Hotel scraping**: Booking.com selectors for 4-5 star luxury properties

### v4.2
- **Price Drop Alerts**: Background monitoring with configurable thresholds
- **Points Sweet Spot**: Calculate cents-per-point, recommend cash vs miles
- **Expiration Countdown**: Track expiring miles/points with warnings
- **Family Room Optimizer**: Compare 2BR vs hotel rooms vs suites
- **Flexible Date Matrix**: Compact ±3 day grid with best price
- **Lounge Access Check**: Map your memberships to available lounges
- **Historical Price Context**: Show where price sits vs route average
- **Mistake Fare Sniper**: Real-time monitoring for pricing errors
- **No credit card data**: Removed credit card tracking per user request

### v4.1
- **Frequent flyer miles**: Show cash + miles options, calculate value
- **Airbnb wishlist automation**: Login via cookies, create folders, add listings
- **Hotel points comparison**: Luxury hotels with 30%+ discounts only
- **Traveler preferences**: TSA PreCheck, seat prefs, Superhost filter
- **Wishlist prompt**: Ask to save listings after results (reply with IDs)
- **Secure storage**: All credentials in ~/.claude/secrets.env

### v4.0
- **Input parameters table**: destination, checkIn, checkOut, guests, origin, budget, tripType
- **Circuit breaker**: Pause 60s after 3 consecutive failures
- **Browser init**: Puppeteer setup with UA rotation
- **Weekday logic**: offsetToNextWeekday() for cheaper Tue-Thu starts
- **Complete A1-A10 example**: All 10 Airbnbs with links shown
- **Sub-agent reviewed**: 9.1/10 final score

### v3.9
- Selector fallback chains (3-5 per element)
- Retry with exponential backoff (1s, 2s, 4s)
- Rate limiting (10 req/min Google, 5 req/min Airbnb)
- Deep link extraction (click + capture)
- 4 discount detection methods
- Flexible date search (+/- 3 days)
- Error states with fallback UI
- Emoji fix: 🪵 fireplace (🔥 = deals only)
- Max 35 chars/line for iMessage

### v3.8
- New price emojis (💰/💸/🔥)
- Required ALL links
- Luxury→Budget hunting

### v3.7
- Summary format with flexible dates
- 10 Airbnbs, faster scraping
