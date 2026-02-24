# Travel Search Skill v3.5

**Review-aware travel search** with direct booking links, emoji-rich output, and discount hunting.

**Trigger words:** travel search, find trip, plan trip, flights and airbnb, vacation search, trip to [destination]

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

A1. Charming Marais Loft ⭐4.92 (127) 🟢🔻 -25%
    📍 Le Marais | $2,400 ($400/night)
    🏊 🌡️ 📶 🍳 | ✓ Free cancel
    🔗 airbnb.com/rooms/12345678

A2. Saint-Germain Family Flat ⭐4.88 (89)
    📍 Saint-Germain (6th) | $2,650 ($442/night)
    🛁 🅿️ 🌡️ 🍳 🧺 | ✗ No free cancel
    🔗 airbnb.com/rooms/23456789

A3. Opera Grands Boulevards ⭐4.98 (43) 🟢🔻 -20%
    📍 Opera (2nd) | $3,282 ($547/night)
    🌡️ 📶 🍳 | ✓ Free cancel
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

### Budget Summary
```
💰 BUDGET ($6,000)

OPTION 1 - Best Value (F2 + A1)
✈️ TAP Portugal:      $2,100
🏠 Marais Loft:       $2,400
🚇 Metro passes:        $120
💰 TOTAL:             $4,620  ($770/day)
───────────────────────────────

OPTION 2 - Central Location (F2 + A3)
✈️ TAP Portugal:      $2,100
🏠 Opera Apt:         $3,282
🚇 Metro passes:        $120
💰 TOTAL:             $5,502  ($917/day)
───────────────────────────────

OPTION 3 - Direct Flight (F1 + A1)
✈️ Air France:        $3,200
🏠 Marais Loft:       $2,400
🚇 Metro passes:        $120
💰 TOTAL:             $5,720  ($953/day)
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
- ✓ Free cancel
- ✗ No free cancel

### Amenities (Airbnb)
| Emoji | Amenity |
|-------|---------|
| 🏊 | Pool |
| 🛁 | Hot Tub |
| 🎱 | Pool Table |
| 🎮 | Game Room |
| 🏋️ | Gym |
| 🅿️ | Free Parking |
| 🌡️ | AC |
| 📶 | WiFi |
| 🍳 | Kitchen |
| 🧺 | Washer/Dryer |
| 🏖️ | Beach Access |
| ⛷️ | Ski-in/out |
| 🔥 | Fireplace |
| 🌳 | Garden |

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
quality_score = rating * log10(review_count + 1)

Examples:
- 5.0 rating, 1 review: 5.0 * log10(2) = 1.5
- 4.9 rating, 50 reviews: 4.9 * log10(51) = 8.4
- 4.5 rating, 200 reviews: 4.5 * log10(201) = 10.4
```

Higher scores = more trustworthy. A 4.9 with 50 reviews beats a 5.0 with 3 reviews.

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

## Supported Cities

Neighborhood recognition works best for these cities with pre-built lists:
- **Paris** (arrondissements, Le Marais, Saint-Germain, etc.)
- **Tokyo** (Shibuya, Shinjuku, Asakusa, etc.)
- **London** (Soho, Covent Garden, Shoreditch, etc.)
- **New York** (Manhattan, Brooklyn, SoHo, etc.)
- **Rome** (Trastevere, Monti, Centro Storico, etc.)
- **Barcelona** (Gothic Quarter, El Born, Gracia, etc.)
- **Amsterdam** (Jordaan, De Pijp, Centrum, etc.)
- **Berlin** (Mitte, Kreuzberg, Prenzlauer Berg, etc.)
- **Lisbon** (Alfama, Baixa, Bairro Alto, etc.)
- **Madrid** (Sol, Malasana, La Latina, etc.)

For other cities, neighborhood extraction uses pattern matching (less reliable).

## How to Execute This Skill

When user requests a travel search:

### Step 1: Extract Individual Flights
Use browser automation (chrome-control skill) to:
1. Open Google Flights with search criteria
2. Wait for results to load
3. Extract top 5 flights with: airline, price, duration, stops, booking URL
4. Check if price is below/above average for that route

### Step 2: Extract Individual Airbnbs
1. Open Airbnb search with filters (dates, guests, bedrooms)
2. Sort by "Top Rated"
3. Extract 10 listings: ID, name, price, strikethrough price (if any), rating, reviews, amenities
4. Compute discount % if strikethrough price exists
5. Use listing ID: `https://www.airbnb.com/rooms/[ID]`

### Step 3: Extract Rental Cars
1. Open Kayak/AutoSlash for rental car search
2. Extract top 5 from different companies
3. Get: company, car type, total price, pickup location
4. Also search Turo for the destination city

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

### v3.5 (Current)
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
