# Travel Search Skill v3.3

**Review-aware travel search** with sentiment analysis, neighborhood ranking, comparative analysis, and Airbnb quality scoring.

**Trigger words:** travel search, find trip, plan trip, flights and airbnb, vacation search, trip to [destination]

## What's New in v3.3

### Airbnb Neighborhood Display
- **Auto-detect neighborhood for each listing** using lat/lng coordinates
- Works for major cities: Paris, Tokyo, London, NYC, Rome, Barcelona, Amsterdam, Lisbon, Madrid, Berlin
- Each Airbnb listing shows `📍 Neighborhood` in output
- Expanded neighborhood coverage (60+ neighborhoods across 10 cities)

## What's New in v3.1

### Neighborhood Comparison
- **Head-to-head analysis**: "Le Marais vs Saint-Germain: Marais wins walkability (+0.3), Saint-Germain wins family-friendly (+0.4)"
- **Trip-type recommendation**: "Both excellent for family trips" or "Le Marais is better for romantic trips"
- Automatically compares top 3 neighborhoods in output

### Neighborhood-Targeted Airbnb URLs
- **Lat/lng bounds filtering**: URLs now target specific neighborhoods using bounding boxes
- **10 major cities supported**: Paris, Tokyo, London, NYC, Rome, Barcelona, Amsterdam, Berlin, Lisbon, Madrid
- Example: `get_neighborhood_airbnb_url("Paris", "Le Marais", ...)` returns URL with `ne_lat`, `sw_lat`, etc.

### Destination-Specific Transport Costs
- **20+ cities** with accurate weekly cost estimates
- Paris: Car $450, Transit $30 (Navigo week pass)
- Tokyo: Car $500, Transit $25 (Suica/JR Pass)
- No more hardcoded defaults - researched per destination

## What's New in v3.0

### Real Review Integration
- **Sentiment analysis** of neighborhood reviews
- **Aspect-based scoring**: safety, walkability, food scene, family-friendly, nightlife, value, transit, authenticity
- **Trip-type-weighted ranking**: Family trips weight safety/walkability higher; romantic trips weight food scene/walkability
- **30-day review caching**: Don't re-fetch reviews for same destination

### Airbnb Review Quality Scoring
- **Formula**: `rating * log10(review_count)`
- **Balances**: High ratings vs review volume (50 reviews at 4.9 > 3 reviews at 5.0)
- **Value score**: quality_score / (price / 1000)

### Structured Output for LLM
- `--structured` flag produces JSON with explicit execution steps
- Each step has action, expected output, and dependencies
- Deterministic workflow Claude can follow

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

## Limitations

1. **Keyword-based sentiment**: Not as accurate as ML models, but fast and works offline. Handles negations ("not safe" = negative).
2. **Neighborhood extraction**: Pre-built lists for 10 major cities. Other cities use regex patterns which may miss some neighborhoods.
3. **Browser automation can fail**: Sites block bots, show CAPTCHAs
4. **URLs may break**: Travel sites change URL formats frequently
5. **Prices are snapshots**: They change constantly
6. **No booking**: Manual action required
7. **Confidence depends on sample size**: 1 mention = "very low" confidence, 10+ = "high"

## Changelog

### v3.3
- Expanded neighborhood bounds: 60+ neighborhoods across 10 cities (Paris, Tokyo, London, NYC, Rome, Barcelona, Amsterdam, Lisbon, Madrid, Berlin)
- Added Paris: Opera, Louvre, Champs-Elysees, Belleville, Oberkampf, Pigalle, Batignolles, Republique
- Added Tokyo: Harajuku, Roppongi, Akihabara, Ueno
- Added London: Notting Hill, Kensington, Westminster, Marylebone
- Added NYC: East Village, Chelsea, Midtown, Tribeca, Lower East Side
- Added Rome: Testaccio, Prati, Termini
- Added Barcelona, Amsterdam, Lisbon, Madrid, Berlin (6 neighborhoods each)

### v3.2
- Auto-detect Airbnb listing neighborhood from lat/lng coordinates
- `detect_neighborhood_from_coords()` function for coordinate-based lookup
- AirbnbListing now supports `lat`, `lng`, `destination` fields
- Neighborhood auto-populated when ranking listings with coordinates

### v3.1
- Neighborhood head-to-head comparison output
- Neighborhood-targeted Airbnb URLs with lat/lng bounding boxes
- Destination-specific transport costs (20+ cities)
- Fixed neighborhood name normalization for URL matching

### v3.0
- Review sentiment analysis with aspect-based scoring
- Trip-type-weighted neighborhood ranking
- Airbnb review quality scoring (rating * log(review_count))
- 30-day review caching
- Structured JSON output mode for LLM consumption
- Transportation analysis (car vs transit)
- New commands: --analyze-reviews, --rank-airbnbs, --structured

### v2.2
- Search history (last 3 searches)
- Default criteria auto-saved from first search

### v2.1
- Simplified airline preferences (no FF numbers)
- Aggregator-only rental car URLs (Kayak, AutoSlash)
- Honest capability documentation

### v2.0
- Multi-site flight search (Google, Skyscanner, Kayak)
- Rental car search
- Transportation research queries
