---
name: vacation-house
description: Track ski house search in VT/NH/ME. Criteria, websites, properties, timing strategy. Use when discussing vacation home buying.
---

# Vacation House Search

Nikhil & Caro are looking to buy a ski house in the next 1-2 years.

## Search Criteria

| Requirement | Details |
|-------------|---------|
| **Bedrooms** | 3+ minimum |
| **Bathrooms** | 3+ full minimum |
| **Land** | 10+ acres minimum |
| **Water** | Pond or lake frontage (huge bonus) |
| **Location** | Vermont, New Hampshire, or Maine |
| **Ski access** | Max 45 min to a ski mountain |
| **Setting** | Rural, dark skies (no main streets) |

## Caroline's Aesthetic (THE VIBE)

Caroline has specific taste. Properties MUST match this vibe:

### Interior Requirements
- **Log cabin / rustic construction** - exposed beams, post-and-beam, hand-hewn wood
- **Warm natural materials** - wood floors, stone fireplaces, quality hardwoods
- **Vaulted/cathedral ceilings** - open, dramatic feel
- **Character** - not cookie-cutter, unique details welcome

### Exterior/Setting Requirements
- **Mountain views** - Green Mountains, Adirondacks, etc.
- **Water features** - lake frontage, pond, waterfall, stream
- **"Wild" feel** - private, nature-immersed, adventurous character
- **Dark skies** - rural enough to see stars

### Reference Properties (Caroline's Picks)
These are the gold standard - match this energy:

1. **187 East Hill Rd, Woodbury VT** - $1.25M
   - LOG HOME with exotic hardwoods (Brazilian cherry, mahogany)
   - 218 ACRES with WATERFALL + trail system
   - Private dock + beach on Woodbury Lake
   - "Wild" energy - this is the unicorn benchmark

2. **206 Conway Rd, Starksboro VT** - $726.5K
   - Post-and-beam log home, 28ft vaulted ceilings
   - 30 acres with 1-acre spring-fed pond
   - Guest cabin + 3 fire pits + pavilion
   - Views of Adirondacks, Green Mtns, Lake Champlain
   - Only 2 baths (below minimum) but perfect vibe

## Best Search Websites

### Regional Specialists
- **[Coldwell Banker Lifestyles](https://www.thecblife.com)** - Covers VT/NH/ME ski + waterfront
- **[LakeHomes.com Vermont](https://www.lakehomes.com/vermont)** - Vermont lakes specifically
- **[NH Lakes Realty](https://www.nhlakesrealty.com)** - New Hampshire lakes specialist
- **[Hickok & Boardman](https://www.hickokandboardman.com)** - VT waterfront land
- **[Badger Peabody & Smith](https://www.badgerpeabodysmith.com)** - NH/VT/ME coverage
- **[Lakes Region ME/NH](https://www.lakesregionmenh.com)** - Maine/NH lakes region

### MLS & Broader Platforms
- **[PrimeMLS](https://primemls.com)** - The actual NH/VT MLS
- **[Redfin waterfront filter](https://www.redfin.com/state/Vermont/waterfront)** - Good filtering options
- **[Zillow](https://www.zillow.com)** - Good for price history/comps

## Timing Strategy

| Season | Pros | Cons |
|--------|------|------|
| **Spring (Mar-May)** | Most inventory, can see property thaw | More competition |
| **Fall (Sep-Nov)** | Sellers motivated before winter | Less inventory |
| **Mud Season (April)** | Fewer lookers, potential deals | Roads can be rough |
| **Winter** | See heating costs/snow clearing | Limited inventory, hard to tour land |

**Recommendation**: Start actively looking spring 2027 for a fall 2027 close, or fall 2026 if something perfect comes up.

## Area Notes

### Vermont
- **Stowe** - Most prestigious, strong appreciation, $$$ premium
- **Sugarbush/Mad River Valley** - More affordable entry, authentic VT vibe, good rentals
- **Killington/Okemo area** - Strong short-term rental market to offset costs
- **Northeast Kingdom** - Most affordable, more remote, less rental income potential

### New Hampshire
- **White Mountains** - Often more affordable than VT equivalents
- **Lakes Region** - Great water access, less ski proximity
- **Mt. Sunapee/Ragged Mountain area** - Underrated, good value

### Maine
- **Sugarloaf area** - Best skiing in Maine, growing market
- **Sunday River area** - More accessible from Boston
- **Lakes region** - Beautiful but longer drive to slopes

## Properties of Interest

### Currently Tracking

| Property | Price | Beds/Baths | Acres | Water | Status | Notes |
|----------|-------|------------|-------|-------|--------|-------|
| 206 Conway Rd, Starksboro VT | $726,500 | 3/2 | 30.43 | 1-acre pond | Active | Beautiful but only 2 baths (below minimum) |

### Viewed / Passed

(none yet)

### Purchased

(none yet)

## Budget Notes

(To be discussed - what's the target range?)

## Short-Term Rental Strategy

Many buyers offset costs with seasonal rentals. Consider:
- Killington and Mount Snow have active STR markets
- Check local zoning before buying (some towns restrict Airbnb)
- A property manager typically takes 20-30%
- Peak rental: ski season (Dec-Mar) and fall foliage (Sep-Oct)

---

## Redfin CLI Tool

Custom CLI that extracts cookies from Chrome to bypass Redfin's bot protection.

### Commands

```bash
# Search for a property by address
redfin search "206 Conway Road, Starksboro VT"

# Get property details (beds, baths, sqft, lot size, taxes)
redfin details <property_id>

# Get Google Street View image
redfin streetview "address" --save /tmp/streetview.jpg

# Get aerial/satellite view
redfin aerial "address" --save /tmp/aerial.jpg --zoom 17
```

### How it works

1. Redfin blocks direct API access (403 Forbidden)
2. CLI finds open Redfin tab in Chrome (or opens one)
3. Extracts cookies including AWS WAF token
4. Uses cookies to authenticate API requests
5. Returns property data from Redfin's stingray API

---

## Sending Listings to Users

**CRITICAL: When sharing listing images with users via SMS/iMessage:**
- **DO NOT** use Chrome screenshots
- **DO** download listing images directly via `curl` and attach them
- Listing photos are available at `image_url` in unified-search JSON output
- Download to `/tmp/` and attach via `send-sms --image`

**ALWAYS include these in listing messages:**

1. **Driving distance from home:**
   - Home: **7 Eastburn St, Brighton, MA** (hardcoded)
   - JSON: `drive_from_home` → `miles`, `hours`, `minutes`
   - Format: `🚗 Xhr Ymin (Z mi) from Brighton`

2. **Driving distance to ski mountains:**
   - JSON: `ski_driving` → array of `{name, drive_miles, drive_minutes}`
   - Format: `⛷️ 28min to Burke, 36min to Cannon`

3. **Listing URL:**
   - JSON: `url` field
   - ALWAYS include clickable link so user can see full listing

Example listing message format:
```
GRAFTON VT - $599K
5 bed / 3 bath / 3,000 sqft
🚗 2hr 32min (117 mi) from Brighton
⛷️ 35min to Stratton, 40min to Okemo
🔗 zillow.com/homedetails/...
```

Example workflow:
```bash
# Run unified search (driving distances included automatically)
~/.claude/skills/vacation-house/scripts/unified-search search --max-price 1500000 --json --top 10

# Download listing image
curl -o /tmp/listing.jpg "https://photos.zillowstatic.com/fp/..."

# Send with attachment
~/.claude/skills/sms-assistant/scripts/send-sms --image /tmp/listing.jpg "chat_id" "message"
```

### Note on data sources

- Active listings show current price and status
- Properties not on market show public records data (last sale price, tax records)
- Street View often unavailable for rural roads

---

## Property Deep-Dive Workflow

When asked to dig deeper on a specific property, follow this workflow:

### 1. Get Aerial/Satellite Imagery
```bash
~/.claude/skills/vacation-house/scripts/redfin aerial "ADDRESS" --save /tmp/property-aerial.jpg
```

### 2. Try Street View (often unavailable for rural)
```bash
~/.claude/skills/vacation-house/scripts/redfin streetview "ADDRESS" --save /tmp/property-street.jpg
```

### 3. Scrape Full Listing Details via Chrome
```bash
# Open listing in Chrome
~/.claude/skills/chrome-control/scripts/chrome open "ZILLOW_URL"

# Get tab ID from output, then extract text
~/.claude/skills/chrome-control/scripts/chrome text <TAB_ID>
```

### 4. Key Data Points to Extract
- **Price history** - when listed, price changes, previous sales
- **Days on market** - long DOM = negotiation opportunity
- **Previous sale price** - compare to current ask (big markup = red flag)
- **Tax assessment** - often much lower than asking
- **Renovations mentioned** - justify price increase?
- **Lot details** - acreage, features, frontage
- **Year built** - newer = less maintenance
- **HOA fees** - if applicable
- **Heating type** - propane/oil costs add up

### 5. Send Findings
Format as a summary with:
- Aerial photo attachment
- "The Good" - positive features
- "The Numbers" - price, taxes, DOM, price history
- "Flags" - concerns, negotiation leverage

### Example Deep-Dive Message:
```
🔍 THE DIRT ON [PROPERTY]:

**The Good:**
• [acreage] acres with [features]
• Built [year]
• [notable features]

**The Numbers:**
• Listed [date] - [X] days on market
• Sold for $[X] in [year]
• Now asking $[X] ([%] markup)
• Zestimate: $[X]
• Taxes: ~$[X]/year

**Flags:**
• [negotiation leverage]
• [concerns]
```

---

## Search Session Archives

**IMPORTANT: Every search session MUST be saved to `~/Documents/vacation-houses/{YYYY-MM-DD}/`**

### Directory Structure
```
~/Documents/vacation-houses/
├── favorites.md               # MASTER favorites list (persists across sessions)
├── 2026-02-15/
│   └── search-results.md      # All properties from this session
├── 2026-02-16/
│   └── ...
```

### Favorites File (~/Documents/vacation-houses/favorites.md)
**IMPORTANT:** When Nikhil or Caroline say they like a property, IMMEDIATELY add it to `~/Documents/vacation-houses/favorites.md`

This is the master list of all properties they've expressed interest in, across all search sessions. Add properties here whenever they say things like:
- "I like this one"
- "This is the best"
- "Add this to favorites"
- "#2 is my favorite"
- etc.

### Required Fields for Each Property
Every listing saved must include:
1. **Address** - full address
2. **Price** - current asking price
3. **Beds/Baths/Sqft/Acres**
4. **Drive time from Brighton** - from 7 Eastburn St
5. **Drive time to nearest ski mountains**
6. **Days on market** - how long it's been listed
7. **Listing URL** - clickable link
8. **Notes** - why it matches/doesn't match the vibe

### Example search-results.md format:
```markdown
# Vacation House Search - 2026-02-15

## Properties Found

### 1. 1970 E Hubbardton Rd, Castleton VT
- **Price:** $949,000
- **Beds/Baths:** 4/3
- **Sqft:** 3,003 | **Acres:** 34
- **Drive from Brighton:** 2hr 30min
- **Ski:** ~30min to Killington
- **Days on Market:** 45
- **Link:** zillow.com/homedetails/...
- **Notes:** 1880 farmhouse, vineyard, 5 barns, pond, brook. CAROLINE FAVORITE.
```

---

*Last updated: 2026-02-15*
