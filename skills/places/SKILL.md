---
name: places
description: Search for places, restaurants, businesses using Google Places API. Find nearby locations, get directions, ratings, hours, reviews. Trigger words - places, nearby, restaurant, cafe, directions, find, location, business, open now.
---

# Google Places Skill

Search for places and get location information using the `goplaces` CLI (Google Places API).

## API Key

The API key is stored in macOS Keychain. To use goplaces, export it first:

```bash
export GOOGLE_PLACES_API_KEY=$(security find-generic-password -s "google-api-key" -w)
```

## Commands

### Text Search
```bash
# Search for places
goplaces search "coffee shops in San Francisco"
goplaces search "best pizza near me" --open-now
goplaces search "restaurants" --min-rating 4.5

# With filters
goplaces search "cafe" --price-level 2 --open-now --limit 5
```

### Nearby Search
```bash
# Find places near a location
goplaces nearby "37.7749,-122.4194" --type restaurant --radius 500
goplaces nearby "Times Square, NYC" --type cafe
```

### Place Details
```bash
# Get full details for a place
goplaces details <place_id>
goplaces details ChIJN1t_tDeuEmsRUsoyG83frY4
```

### Autocomplete
```bash
# Get place suggestions as you type
goplaces autocomplete "star"
goplaces autocomplete "blue bottle coff"
```

### Directions/Routes
```bash
# Get directions between places
goplaces route "San Francisco" "Los Angeles"
goplaces route "Central Park" "Times Square" --mode walking
```

### Photos
```bash
# Get place details WITH photos (returns photo names)
goplaces details <place_id> --photos

# Get actual photo URL from photo name
goplaces photo "<photo_name>" --max-width 800
goplaces photo "places/ChIJ.../photos/ATCDNf..." --max-width 1200
```

### Downloading Photos for SMS
When sharing place photos via SMS, download to /tmp and use `reply --image`:

```bash
# Get photo URL (use --json and extract photo_uri)
export GOOGLE_PLACES_API_KEY=$(security find-generic-password -s "google-api-key" -w)
URL=$(goplaces photo "<photo_name>" --max-width 800 --json | jq -r '.photo_uri')

# Download to /tmp
curl -sL "$URL" -o /tmp/place_photo.jpg

# Send via SMS (from transcript directory)
~/.claude/skills/sms-assistant/scripts/reply "Place Name - details" --image /tmp/place_photo.jpg
```

This shows the actual image in iMessage instead of a URL link.

## Output Options

```bash
# JSON output for scripting
goplaces search "coffee" --json

# Plain text for parsing
goplaces search "coffee" --plain

# Limit results
goplaces search "restaurants" --limit 10
```

## Usage Pattern

Always export the API key before running commands:

```bash
export GOOGLE_PLACES_API_KEY=$(security find-generic-password -s "google-api-key" -w) && goplaces search "coffee near me"
```

## Notes

- The Places API incurs usage costs - use responsibly
- Results include place_id which can be used for detailed lookups
- Use `--open-now` to filter for currently open businesses
- Use `--min-rating` to filter by Google rating (1-5)
