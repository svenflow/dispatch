---
name: events
description: Search upcoming concerts, shows, sports events. Score demand/sellout likelihood, save as structured facts, fire reminder alerts. Trigger words - events, concerts, tickets, shows, ticketmaster, sellout, upcoming events.
---

# Events Skill

Search for upcoming events (concerts, shows, sports, festivals), score their sellout likelihood, and set proactive alerts so you never miss tickets.

## CLI

```bash
~/.claude/skills/events/scripts/events <command> [args]
```

### Search Events

```bash
# Search by artist/keyword
events search "Radiohead" --location "Boston, MA"

# Search by genre
events search --genre "electronic" --location "Boston, MA"

# Search by venue
events search --venue "TD Garden" --days 90

# Limit results
events search "Taylor Swift" --limit 10
```

### Score Demand

The CLI scores each event's sellout likelihood (0-100) based on:
- **Artist popularity** — follower counts, streaming numbers
- **Venue capacity vs. typical draw** — small venue + big artist = high demand
- **Time to event** — events further out have more time to sell out
- **Historical patterns** — does this artist/genre typically sell out?

Score thresholds:
- 🔴 80-100: Very likely to sell out — buy now
- 🟡 50-79: Moderate demand — watch closely
- 🟢 0-49: Low demand — safe to wait

### Set Alerts

```bash
# Alert me 4 weeks before an event's on-sale date
events alert EVENT_ID --advance 4w

# Alert when sellout score crosses a threshold
events alert EVENT_ID --threshold 70

# List active alerts
events alerts

# Remove an alert
events alert-remove ALERT_ID
```

Alerts integrate with the reminders system — they inject a task into the admin's session when triggered.

### Save Events as Facts

Events can be saved to the structured facts DB for long-term tracking:

```bash
events save EVENT_ID
```

This creates a structured fact with type `event` containing artist, venue, date, sellout score, and ticket URL.

## Data Sources

1. **Ticketmaster Discovery API** — primary source for events, venues, pricing
2. **Web scraping (webfetch)** — fallback for venues/artists not on Ticketmaster
3. **Songkick / Bandsintown** — supplementary artist tour data

## Integration with Travel Intelligence

When a trip is detected (via travel-intelligence skill), events automatically searches for notable events at the destination during travel dates. High-demand events are surfaced proactively.

## Nightly Task

The events skill can run as a nightly task to:
1. Re-score saved events for sellout likelihood changes
2. Check for new events matching saved artist/genre preferences
3. Fire alerts for events crossing score thresholds
4. Remove past events from tracking

## Architecture

- CLI: `~/.claude/skills/events/scripts/events` (Python, uv shebang)
- Uses Ticketmaster Discovery API (key stored in `~/.claude/secrets.env` as `TICKETMASTER_API_KEY`)
- Alerts stored as reminders via the reminders system
- Facts saved via structured facts pipeline
