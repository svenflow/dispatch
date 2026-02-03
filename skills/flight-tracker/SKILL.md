---
name: flight-tracker
description: Track flight status and get FlightAware links. Use when asked about flights, flight status, arrival times, or flight tracking. Trigger words - flight, flying, UA, AA, DL, landing, arriving, departure.
---

# Flight Tracker

Track flights and get accurate FlightAware links.

## Usage

```bash
uv run ~/.claude/skills/flight-tracker/scripts/track.py UA1372
uv run ~/.claude/skills/flight-tracker/scripts/track.py "UA 1372"
uv run ~/.claude/skills/flight-tracker/scripts/track.py DL405 --date 2026-01-30
uv run ~/.claude/skills/flight-tracker/scripts/track.py UA1372 --json
uv run ~/.claude/skills/flight-tracker/scripts/track.py UA1372 --all   # show all dates, not just today
```

The script will:
1. Fetch flight data from FlightAware (single HTTP GET, no API key needed)
2. Parse the embedded `trackpollBootstrap` JSON from the page
3. Filter to today's segments and output status, gates, times, and FlightAware URLs

## How It Works

FlightAware embeds all flight data as JSON in a `trackpollBootstrap` JavaScript variable on the page. The script fetches the HTML with a simple `requests.get()`, parses out the JSON with `raw_decode`, and extracts structured data including:
- Origin/destination airports (ICAO + IATA codes)
- Scheduled, estimated, and actual departure/arrival times (unix timestamps)
- Flight status (airborne, arrived, scheduled, etc.)
- Gate and terminal info
- Permalink URLs for each segment

No Chrome or API key required.

## Airline ICAO Codes

| IATA | ICAO | Airline |
|------|------|---------|
| UA | UAL | United Airlines |
| AA | AAL | American Airlines |
| DL | DAL | Delta Air Lines |
| WN | SWA | Southwest Airlines |
| B6 | JBU | JetBlue Airways |
| AS | ASA | Alaska Airlines |
| NK | NKS | Spirit Airlines |
| F9 | FFT | Frontier Airlines |
| HA | HAL | Hawaiian Airlines |

## Important Notes

- Multi-segment flights (e.g., SEA→SFO→BOS) have separate FlightAware pages per segment
- When someone says "my flight," find ALL segments and report on each
- **NEVER truncate URLs when sharing over SMS.** Always send the full FlightAware URL so it's clickable.
- The `--json` flag outputs structured data for programmatic use
