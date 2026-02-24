#!/usr/bin/env python3
"""
Travel Search v3.1 - Review-Aware Travel Search with Sentiment Analysis

This version adds REAL review processing:
- Sentiment analysis of neighborhood reviews
- Aspect-based scoring (safety, walkability, food scene, etc.)
- Trip-type-aware neighborhood ranking
- Airbnb review quality scoring (rating * log(review_count))
- 30-day review caching
- Structured JSON output for LLM consumption

Changelog:
v3.0 - Major upgrade: Real review integration
  - Added review_analyzer.py module for sentiment analysis
  - Neighborhood ranking based on actual review sentiment
  - Aspect-based scoring (safety, walkability, food_scene, family_friendly, etc.)
  - Trip-type-weighted scoring (family trips weight safety/walkability higher)
  - Airbnb review quality score: rating * log10(review_count)
  - 30-day review caching to avoid re-fetching
  - Structured JSON output mode for LLM consumption
  - Claude integration: analyze_reviews command processes WebSearch results
v2.2 - Added search history and default criteria
v2.1 - Simplified preferences, aggregator-only rental car URLs
v2.0 - Added multi-site flights, rental car, transportation research
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field
from urllib.parse import quote_plus
import logging
from pathlib import Path

# Import review analyzer module
try:
    from review_analyzer import (
        analyze_reviews_from_text,
        analyze_transportation_from_text,
        format_neighborhood_ranking,
        format_transport_recommendation,
        format_transport_with_notes,
        format_airbnb_ranking,
        compare_neighborhoods,
        get_neighborhood_airbnb_url,
        AirbnbListing,
        rank_airbnb_listings,
        load_cached_reviews,
        save_cached_reviews,
        ReviewCache,
        NeighborhoodReview,
        TransportRecommendation
    )
    REVIEW_ANALYZER_AVAILABLE = True
except ImportError:
    REVIEW_ANALYZER_AVAILABLE = False

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration - can be overridden by environment variables
DEFAULT_ORIGIN = os.environ.get('TRAVEL_SEARCH_ORIGIN', 'Boston')

# Config files
CONFIG_DIR = Path.home() / '.config' / 'travel-search'
PREFS_CONFIG_PATH = CONFIG_DIR / 'preferences.json'
DEFAULTS_CONFIG_PATH = CONFIG_DIR / 'defaults.json'
HISTORY_CONFIG_PATH = CONFIG_DIR / 'history.json'
MAX_HISTORY = 3  # Number of recent searches to keep

# Constants with documentation
MAX_GUESTS = 16  # Airbnb/flight site limit
MAX_NIGHTS = 30  # Practical trip planning limit

# Parse accommodation budget ratio with fallback
try:
    ACCOMMODATION_BUDGET_RATIO = float(os.environ.get('TRAVEL_SEARCH_ACCOM_RATIO', '0.5'))
    if not 0 < ACCOMMODATION_BUDGET_RATIO < 1:
        logger.warning("TRAVEL_SEARCH_ACCOM_RATIO must be between 0 and 1, using default 0.5")
        ACCOMMODATION_BUDGET_RATIO = 0.5
except ValueError:
    logger.warning("Invalid TRAVEL_SEARCH_ACCOM_RATIO, using default 0.5")
    ACCOMMODATION_BUDGET_RATIO = 0.5

# Parse max date combos with fallback
try:
    MAX_DATE_COMBOS = int(os.environ.get('TRAVEL_SEARCH_MAX_COMBOS', '5'))
    if MAX_DATE_COMBOS < 1:
        MAX_DATE_COMBOS = 5
except ValueError:
    logger.warning("Invalid TRAVEL_SEARCH_MAX_COMBOS, using default 5")
    MAX_DATE_COMBOS = 5


@dataclass
class TravelPreferences:
    """User travel preferences (no sensitive data)."""
    preferred_airlines: List[str] = field(default_factory=list)  # e.g., ["United", "Delta"]
    preferred_alliances: List[str] = field(default_factory=list)  # e.g., ["Star Alliance"]
    preferred_car_companies: List[str] = field(default_factory=list)  # e.g., ["Enterprise"]
    default_origin: str = ""


@dataclass
class SearchDefaults:
    """Default search criteria - saved after first search, used for subsequent searches."""
    guests: Optional[int] = None
    budget: Optional[int] = None
    origin: str = ""
    trip_type: str = ""
    include_rental_car: bool = True


@dataclass
class SearchHistoryEntry:
    """A single search history entry (compact)."""
    destination: str
    dates: str  # e.g., "Apr 17-23"
    nights: int
    guests: int
    budget: Optional[int]
    trip_type: str
    timestamp: str  # ISO format


@dataclass
class TravelSearch:
    """Represents a travel search request with all parameters."""
    destination: str
    date_start: str  # YYYY-MM-DD
    date_end: str    # YYYY-MM-DD
    nights: int
    guests: int
    budget: Optional[int] = None
    trip_type: str = "general"  # family, romantic, adventure, budget, luxury
    origin: str = DEFAULT_ORIGIN
    include_rental_car: bool = True
    preferences: Optional[TravelPreferences] = None

    def validate(self) -> List[str]:
        """Validate search parameters. Returns list of error messages."""
        errors = []

        # Validate guests
        if self.guests < 1:
            errors.append(f"Guest count must be at least 1, got {self.guests}")
        if self.guests > MAX_GUESTS:
            errors.append(f"Guest count too high ({self.guests}). Max supported: {MAX_GUESTS}")

        # Validate nights
        if self.nights < 1:
            errors.append(f"Number of nights must be at least 1, got {self.nights}")
        if self.nights > MAX_NIGHTS:
            errors.append(f"Number of nights too high ({self.nights}). Max: {MAX_NIGHTS}")

        # Validate budget
        if self.budget is not None and self.budget <= 0:
            errors.append(f"Budget must be positive, got ${self.budget}")

        # Validate dates
        try:
            start = datetime.strptime(self.date_start, "%Y-%m-%d")
            end = datetime.strptime(self.date_end, "%Y-%m-%d")
            today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

            if start < today:
                errors.append(f"Start date {self.date_start} is in the past")

            if end < start:
                errors.append(f"End date {self.date_end} is before start date {self.date_start}")

            # Check if nights fit within date range
            date_range_days = (end - start).days
            if self.nights > date_range_days:
                errors.append(
                    f"Cannot fit {self.nights} nights in {date_range_days}-day window "
                    f"({self.date_start} to {self.date_end})"
                )

            # Warn if dates are far in the future
            days_until_start = (start - today).days
            if days_until_start > 365:
                logger.warning(f"Start date is {days_until_start} days away - prices may not be accurate")

        except ValueError as e:
            errors.append(f"Invalid date format: {e}")

        # Validate destination (basic check)
        if not self.destination or len(self.destination.strip()) < 2:
            errors.append("Destination must be at least 2 characters")

        # Validate trip type
        valid_types = ["family", "romantic", "adventure", "budget", "luxury", "general"]
        if self.trip_type not in valid_types:
            errors.append(f"Invalid trip type '{self.trip_type}'. Valid: {', '.join(valid_types)}")

        return errors


def get_current_year() -> int:
    """Get current year, or next year if we're in December."""
    now = datetime.now()
    if now.month == 12 and now.day > 15:
        return now.year + 1
    return now.year


def parse_date_range(date_range: str, year: Optional[int] = None) -> tuple[str, str]:
    """
    Parse date range like 'Apr 17-26' into start/end dates.

    Supported formats:
    - "Apr 17-26" (single month)
    - "Apr 17 - May 2" (cross-month)
    - "4/17-4/26" (numeric)
    - "2026-04-17 to 2026-04-26" (ISO format)
    """
    if year is None:
        year = get_current_year()

    months = {
        'jan': '01', 'january': '01', 'feb': '02', 'february': '02',
        'mar': '03', 'march': '03', 'apr': '04', 'april': '04',
        'may': '05', 'jun': '06', 'june': '06', 'jul': '07', 'july': '07',
        'aug': '08', 'august': '08', 'sep': '09', 'sept': '09', 'september': '09',
        'oct': '10', 'october': '10', 'nov': '11', 'november': '11',
        'dec': '12', 'december': '12'
    }

    date_range = date_range.strip()

    # ISO format: "2026-04-17 to 2026-04-26"
    iso_match = re.match(r'(\d{4}-\d{2}-\d{2})\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2})', date_range, re.I)
    if iso_match:
        return iso_match.group(1), iso_match.group(2)

    # Numeric: "4/17-4/26"
    numeric_match = re.match(r'(\d{1,2})/(\d{1,2})\s*-\s*(\d{1,2})/(\d{1,2})', date_range)
    if numeric_match:
        start_month = numeric_match.group(1).zfill(2)
        start_day = numeric_match.group(2).zfill(2)
        end_month = numeric_match.group(3).zfill(2)
        end_day = numeric_match.group(4).zfill(2)
        return f"{year}-{start_month}-{start_day}", f"{year}-{end_month}-{end_day}"

    # Single month: "Apr 17-26"
    single_month_match = re.match(r'(\w+)\s+(\d{1,2})\s*-\s*(\d{1,2})(?:\s|$)', date_range, re.I)
    if single_month_match:
        month_str = single_month_match.group(1).lower()
        month = months.get(month_str[:3])
        if not month:
            raise ValueError(f"Unknown month: {single_month_match.group(1)}")
        start_day = single_month_match.group(2).zfill(2)
        end_day = single_month_match.group(3).zfill(2)
        return f"{year}-{month}-{start_day}", f"{year}-{month}-{end_day}"

    # Cross-month: "Apr 17 - May 2"
    cross_month_match = re.match(r'(\w+)\s+(\d{1,2})\s*-\s*(\w+)\s+(\d{1,2})', date_range, re.I)
    if cross_month_match:
        start_month_str = cross_month_match.group(1).lower()
        end_month_str = cross_month_match.group(3).lower()
        start_month = months.get(start_month_str[:3])
        end_month = months.get(end_month_str[:3])
        if not start_month:
            raise ValueError(f"Unknown month: {cross_month_match.group(1)}")
        if not end_month:
            raise ValueError(f"Unknown month: {cross_month_match.group(3)}")
        start_day = cross_month_match.group(2).zfill(2)
        end_day = cross_month_match.group(4).zfill(2)
        end_year = year + 1 if int(end_month) < int(start_month) else year
        return f"{year}-{start_month}-{start_day}", f"{end_year}-{end_month}-{end_day}"

    raise ValueError(
        f"Could not parse date range: '{date_range}'. "
        f"Expected: 'Apr 17-26', 'Apr 17 - May 2', '4/17-4/26', or '2026-04-17 to 2026-04-26'"
    )


def generate_date_combos(start: str, end: str, nights: int) -> List[Dict[str, str]]:
    """Generate all possible check-in/check-out combinations."""
    try:
        start_dt = datetime.strptime(start, "%Y-%m-%d")
        end_dt = datetime.strptime(end, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError(f"Invalid date format (start={start}, end={end}): {e}")

    combos = []
    current = start_dt
    while current + timedelta(days=nights) <= end_dt:
        checkout = current + timedelta(days=nights)
        combos.append({
            "checkin": current.strftime("%Y-%m-%d"),
            "checkout": checkout.strftime("%Y-%m-%d"),
            "checkin_display": current.strftime("%b %d"),
            "checkout_display": checkout.strftime("%b %d"),
        })
        current += timedelta(days=1)

    if not combos:
        date_range_days = (end_dt - start_dt).days
        raise ValueError(
            f"Cannot generate date combinations: {nights} nights doesn't fit "
            f"in {date_range_days}-day window ({start} to {end})"
        )

    return combos


# =============================================================================
# URL BUILDERS
# Note: These generate search URLs, not direct booking links. Travel sites
# frequently change their URL structures, so these may break. When they do,
# the search will simply redirect to the site's homepage - not ideal but safe.
# =============================================================================

def build_airbnb_url(
    destination: str,
    checkin: str,
    checkout: str,
    guests: int,
    max_price: Optional[int] = None,
    min_bedrooms: int = 1
) -> str:
    """Build Airbnb search URL."""
    dest_slug = re.sub(r'[^\w\s-]', '', destination)
    dest_slug = re.sub(r'\s+', '-', dest_slug.strip())
    dest_slug = quote_plus(dest_slug).replace('%2B', '-')

    url = (
        f"https://www.airbnb.com/s/{dest_slug}/homes?"
        f"adults={guests}&checkin={checkin}&checkout={checkout}"
        f"&min_bedrooms={min_bedrooms}"
    )
    if max_price:
        url += f"&price_max={max_price}"
    return url


def build_google_flights_url(
    origin: str,
    destination: str,
    departure: str,
    return_date: str,
    passengers: int
) -> str:
    """Build Google Flights search URL."""
    origin_encoded = quote_plus(origin)
    dest_encoded = quote_plus(destination)
    return (
        f"https://www.google.com/travel/flights?"
        f"q={origin_encoded}+to+{dest_encoded}+{passengers}+passengers+"
        f"{departure}+to+{return_date}"
    )


def build_skyscanner_url(
    origin: str,
    destination: str,
    departure: str,
    return_date: str,
    passengers: int
) -> str:
    """Build Skyscanner search URL."""
    origin_slug = quote_plus(origin.lower().replace(' ', '-'))
    dest_slug = quote_plus(destination.lower().replace(' ', '-'))
    dep_dt = datetime.strptime(departure, "%Y-%m-%d")
    ret_dt = datetime.strptime(return_date, "%Y-%m-%d")
    dep_fmt = dep_dt.strftime("%y%m%d")
    ret_fmt = ret_dt.strftime("%y%m%d")
    adults_param = f"adults={passengers}" if passengers > 1 else ""
    return (
        f"https://www.skyscanner.com/transport/flights/{origin_slug}/{dest_slug}/"
        f"{dep_fmt}/{ret_fmt}/?{adults_param}"
    )


def build_kayak_flights_url(
    origin: str,
    destination: str,
    departure: str,
    return_date: str,
    passengers: int
) -> str:
    """Build Kayak flights search URL."""
    origin_slug = quote_plus(origin)
    dest_slug = quote_plus(destination)
    return (
        f"https://www.kayak.com/flights/{origin_slug}-{dest_slug}/"
        f"{departure}/{return_date}/{passengers}adults"
    )


def build_rental_car_urls(location: str, pickup_date: str, dropoff_date: str) -> Dict[str, str]:
    """
    Build rental car search URLs.

    Only uses aggregator sites (Kayak, AutoSlash) which reliably accept
    location strings. Direct agency deep links (Enterprise, Hertz, Budget)
    require internal station IDs and are too brittle.
    """
    location_encoded = quote_plus(location)

    return {
        # Kayak - best for comparison across all agencies
        "kayak": f"https://www.kayak.com/cars/{location_encoded}/{pickup_date}/{dropoff_date}",
        # AutoSlash - tracks reservations and re-books if price drops
        "autoslash": (
            f"https://www.autoslash.com/?pickupLocation={location_encoded}"
            f"&pickupDate={pickup_date}&dropoffDate={dropoff_date}"
        ),
    }


def get_neighborhood_queries(destination: str, trip_type: str) -> Dict[str, List[str]]:
    """Generate search queries for neighborhood research."""
    reddit_queries = [
        f"best neighborhood to stay in {destination} reddit",
        f"{destination} where to stay {trip_type} reddit",
        f"best area {destination} tourists reddit",
    ]

    type_specific = {
        "family": [f"{destination} family friendly neighborhood reddit"],
        "romantic": [f"{destination} romantic neighborhood couples reddit"],
        "budget": [f"cheapest area to stay {destination} reddit"],
        "luxury": [f"{destination} luxury neighborhood upscale reddit"],
        "adventure": [f"best base for exploring {destination} reddit"],
    }
    if trip_type in type_specific:
        reddit_queries.extend(type_specific[trip_type])

    tripadvisor_queries = [
        f"site:tripadvisor.com {destination} best neighborhood",
        f"site:tripadvisor.com {destination} where to stay",
    ]

    return {"reddit": reddit_queries, "tripadvisor": tripadvisor_queries}


def get_transportation_queries(destination: str) -> Dict[str, List[str]]:
    """Generate queries to determine if rental car is needed vs public transit."""
    return {
        "reddit": [
            f"{destination} rental car vs public transportation reddit",
            f"do you need a car in {destination} reddit",
            f"{destination} getting around without car reddit",
        ],
        "tripadvisor": [
            f"site:tripadvisor.com {destination} need rental car",
            f"site:tripadvisor.com {destination} public transportation",
        ],
    }


def calculate_nightly_budget(total_budget: int, nights: int, trip_type: str) -> int:
    """Calculate nightly accommodation budget based on trip type."""
    ratios = {
        "luxury": 0.60, "budget": 0.40, "romantic": 0.55,
        "adventure": 0.45, "family": 0.50, "general": ACCOMMODATION_BUDGET_RATIO,
    }
    ratio = ratios.get(trip_type, ACCOMMODATION_BUDGET_RATIO)
    return int((total_budget * ratio) / nights)


def load_preferences() -> TravelPreferences:
    """Load travel preferences from config file."""
    if not PREFS_CONFIG_PATH.exists():
        return TravelPreferences()
    try:
        with open(PREFS_CONFIG_PATH, 'r') as f:
            data = json.load(f)
            return TravelPreferences(
                preferred_airlines=data.get('preferred_airlines', []),
                preferred_alliances=data.get('preferred_alliances', []),
                preferred_car_companies=data.get('preferred_car_companies', []),
                default_origin=data.get('default_origin', ''),
            )
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Failed to load preferences: {e}")
        return TravelPreferences()


def save_preferences(prefs: TravelPreferences) -> bool:
    """Save travel preferences to config file."""
    try:
        PREFS_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        data = {
            'preferred_airlines': prefs.preferred_airlines,
            'preferred_alliances': prefs.preferred_alliances,
            'preferred_car_companies': prefs.preferred_car_companies,
            'default_origin': prefs.default_origin,
        }
        with open(PREFS_CONFIG_PATH, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    except IOError as e:
        logger.error(f"Failed to save preferences: {e}")
        return False


def load_defaults() -> SearchDefaults:
    """Load default search criteria."""
    if not DEFAULTS_CONFIG_PATH.exists():
        return SearchDefaults()
    try:
        with open(DEFAULTS_CONFIG_PATH, 'r') as f:
            data = json.load(f)
            return SearchDefaults(
                guests=data.get('guests'),
                budget=data.get('budget'),
                origin=data.get('origin', ''),
                trip_type=data.get('trip_type', ''),
                include_rental_car=data.get('include_rental_car', True),
            )
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Failed to load defaults: {e}")
        return SearchDefaults()


def save_defaults(defaults: SearchDefaults) -> bool:
    """Save default search criteria."""
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        data = {
            'guests': defaults.guests,
            'budget': defaults.budget,
            'origin': defaults.origin,
            'trip_type': defaults.trip_type,
            'include_rental_car': defaults.include_rental_car,
        }
        with open(DEFAULTS_CONFIG_PATH, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    except IOError as e:
        logger.error(f"Failed to save defaults: {e}")
        return False


def load_history() -> List[SearchHistoryEntry]:
    """Load search history."""
    if not HISTORY_CONFIG_PATH.exists():
        return []
    try:
        with open(HISTORY_CONFIG_PATH, 'r') as f:
            data = json.load(f)
            return [
                SearchHistoryEntry(
                    destination=h.get('destination', ''),
                    dates=h.get('dates', ''),
                    nights=h.get('nights', 0),
                    guests=h.get('guests', 0),
                    budget=h.get('budget'),
                    trip_type=h.get('trip_type', ''),
                    timestamp=h.get('timestamp', ''),
                )
                for h in data.get('history', [])
            ]
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Failed to load history: {e}")
        return []


def save_history(history: List[SearchHistoryEntry]) -> bool:
    """Save search history (keeps last MAX_HISTORY entries)."""
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        data = {
            'history': [
                {
                    'destination': h.destination,
                    'dates': h.dates,
                    'nights': h.nights,
                    'guests': h.guests,
                    'budget': h.budget,
                    'trip_type': h.trip_type,
                    'timestamp': h.timestamp,
                }
                for h in history[:MAX_HISTORY]
            ]
        }
        with open(HISTORY_CONFIG_PATH, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    except IOError as e:
        logger.error(f"Failed to save history: {e}")
        return False


def add_to_history(search: 'TravelSearch') -> None:
    """Add a search to history."""
    history = load_history()

    # Format dates compactly
    try:
        start_dt = datetime.strptime(search.date_start, "%Y-%m-%d")
        end_dt = datetime.strptime(search.date_end, "%Y-%m-%d")
        dates_str = f"{start_dt.strftime('%b %d')}-{end_dt.strftime('%d')}"
    except ValueError:
        dates_str = f"{search.date_start}"

    entry = SearchHistoryEntry(
        destination=search.destination,
        dates=dates_str,
        nights=search.nights,
        guests=search.guests,
        budget=search.budget,
        trip_type=search.trip_type,
        timestamp=datetime.now().isoformat(),
    )

    # Add to front, remove duplicates of same destination
    history = [h for h in history if h.destination.lower() != search.destination.lower()]
    history.insert(0, entry)

    save_history(history[:MAX_HISTORY])


def update_defaults_from_search(search: 'TravelSearch') -> None:
    """Update defaults based on the current search (first search sets defaults)."""
    defaults = load_defaults()

    # Only update if not already set, OR if explicitly different
    if defaults.guests is None:
        defaults.guests = search.guests
    if defaults.budget is None and search.budget:
        defaults.budget = search.budget
    if not defaults.origin:
        defaults.origin = search.origin
    if not defaults.trip_type or defaults.trip_type == 'general':
        defaults.trip_type = search.trip_type

    save_defaults(defaults)


def build_search_plan(search: TravelSearch) -> Dict[str, Any]:
    """Build complete search plan with all URLs and queries."""
    date_combos = generate_date_combos(search.date_start, search.date_end, search.nights)
    date_combos = date_combos[:MAX_DATE_COMBOS]

    nightly_budget = None
    if search.budget:
        nightly_budget = calculate_nightly_budget(search.budget, search.nights, search.trip_type)

    # Min bedrooms based on guests
    if search.guests <= 2:
        min_bedrooms = 1
    elif search.guests <= 4:
        min_bedrooms = 2
    elif search.guests <= 6:
        min_bedrooms = 3
    else:
        min_bedrooms = 4

    # Airbnb searches
    airbnb_searches = []
    for combo in date_combos[:3]:
        airbnb_searches.append({
            "dates": f"{combo['checkin_display']} - {combo['checkout_display']}",
            "checkin": combo["checkin"],
            "checkout": combo["checkout"],
            "url": build_airbnb_url(
                search.destination, combo["checkin"], combo["checkout"],
                search.guests, nightly_budget, min_bedrooms
            )
        })

    primary_dates = date_combos[0]

    # Flight searches (multi-site)
    flight_searches = {
        "google_flights": build_google_flights_url(
            search.origin, search.destination,
            primary_dates["checkin"], primary_dates["checkout"], search.guests
        ),
        "skyscanner": build_skyscanner_url(
            search.origin, search.destination,
            primary_dates["checkin"], primary_dates["checkout"], search.guests
        ),
        "kayak": build_kayak_flights_url(
            search.origin, search.destination,
            primary_dates["checkin"], primary_dates["checkout"], search.guests
        ),
        "date_combos_to_check": [f"{c['checkin']} to {c['checkout']}" for c in date_combos]
    }

    # Rental car searches (aggregators only)
    rental_car_searches = None
    if search.include_rental_car:
        rental_car_searches = {
            "urls": build_rental_car_urls(
                search.destination, primary_dates["checkin"], primary_dates["checkout"]
            ),
            "pickup_date": primary_dates["checkin"],
            "dropoff_date": primary_dates["checkout"],
        }

    plan = {
        "search_params": {
            "destination": search.destination,
            "origin": search.origin,
            "date_range": f"{search.date_start} to {search.date_end}",
            "nights": search.nights,
            "guests": search.guests,
            "budget": search.budget,
            "nightly_budget": nightly_budget,
            "trip_type": search.trip_type,
            "min_bedrooms": min_bedrooms,
        },
        "date_combinations": date_combos,
        "neighborhood_research": get_neighborhood_queries(search.destination, search.trip_type),
        "transportation_research": get_transportation_queries(search.destination),
        "airbnb_searches": airbnb_searches,
        "flight_searches": flight_searches,
        "rental_car_searches": rental_car_searches,
        "preferences": {
            "airlines": search.preferences.preferred_airlines,
            "alliances": search.preferences.preferred_alliances,
            "car_companies": search.preferences.preferred_car_companies,
        } if search.preferences else None,
    }

    return plan


def print_history_compact() -> None:
    """Print recent search history in compact format."""
    history = load_history()
    if not history:
        return

    print("📜 RECENT SEARCHES:")
    for h in history:
        budget_str = f"${h.budget:,}" if h.budget else "no budget"
        print(f"   • {h.destination} | {h.dates} | {h.nights}n | {h.guests}p | {budget_str} | {h.trip_type}")
    print()


def print_defaults_compact() -> None:
    """Print current defaults in compact format."""
    defaults = load_defaults()
    if not defaults.guests and not defaults.budget and not defaults.origin and not defaults.trip_type:
        return

    parts = []
    if defaults.guests:
        parts.append(f"{defaults.guests}p")
    if defaults.budget:
        parts.append(f"${defaults.budget:,}")
    if defaults.origin:
        parts.append(f"from {defaults.origin}")
    if defaults.trip_type and defaults.trip_type != 'general':
        parts.append(defaults.trip_type)

    if parts:
        print(f"⚙️  DEFAULTS: {' | '.join(parts)}")
        print()


def build_structured_output(search: TravelSearch, plan: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build structured JSON output optimized for LLM consumption.
    Provides explicit execution steps Claude can follow deterministically.
    """
    structured = {
        "version": "3.0",
        "search_params": plan["search_params"],
        "execution_plan": [
            {
                "step": 1,
                "action": "web_search",
                "description": "Research neighborhood recommendations",
                "queries": plan["neighborhood_research"]["reddit"][:3],
                "expected_output": "neighborhood_reviews_text",
                "next_step_depends_on": True,
                "instructions": "Execute WebSearch for each query, combine results into single text block"
            },
            {
                "step": 2,
                "action": "analyze_reviews",
                "description": "Analyze neighborhood reviews with sentiment scoring",
                "command": f"python3 search.py --analyze-reviews --destination \"{search.destination}\" --trip-type {search.trip_type}",
                "input": "neighborhood_reviews_text from step 1",
                "expected_output": "ranked_neighborhoods",
                "instructions": "Pipe WebSearch results to analyze_reviews command for sentiment analysis"
            },
            {
                "step": 3,
                "action": "web_search",
                "description": "Research transportation (car vs transit)",
                "queries": plan["transportation_research"]["reddit"][:2],
                "expected_output": "transportation_reviews_text",
                "instructions": "Determine if rental car is needed based on reviews"
            },
            {
                "step": 4,
                "action": "browser_open",
                "description": "Search flights across multiple sites",
                "urls": [
                    plan["flight_searches"]["google_flights"],
                    plan["flight_searches"]["skyscanner"],
                    plan["flight_searches"]["kayak"]
                ],
                "expected_output": "flight_options with prices",
                "instructions": "Open each URL, extract prices and flight details"
            },
            {
                "step": 5,
                "action": "browser_open",
                "description": "Search Airbnbs in recommended neighborhoods",
                "urls": [s["url"] for s in plan["airbnb_searches"]],
                "filter_by": "top_neighborhoods from step 2",
                "expected_output": "airbnb_listings",
                "instructions": "Extract listing_id, name, price, rating, review_count for each listing"
            },
            {
                "step": 6,
                "action": "rank_airbnbs",
                "description": "Rank Airbnbs by review quality score",
                "command": "python3 search.py --rank-airbnbs",
                "input": "airbnb_listings from step 5",
                "expected_output": "ranked_airbnbs",
                "instructions": "Score = rating * log10(review_count). Higher is better."
            }
        ],
        "output_format": {
            "neighborhood_rankings": {
                "format": "1. Name (score: X/100)\n   - Y% positive sentiment\n   - Pros: ...\n   - Cons: ...",
                "limit": 5
            },
            "flight_summary": {
                "format": "Airline | Price | Duration | Stops",
                "sort_by": "price",
                "limit": 5
            },
            "airbnb_rankings": {
                "format": "1. Name (⭐X.XX, Y reviews) | Quality Score: Z\n   💰 $total | 📍 Neighborhood\n   🔗 airbnb.com/rooms/ID",
                "sort_by": "review_quality_score",
                "limit": 10
            },
            "budget_summary": {
                "format": "Flight + Airbnb + (Car if needed) = Total"
            }
        },
        "urls": {
            "flights": plan["flight_searches"],
            "airbnb": plan["airbnb_searches"],
            "rental_car": plan.get("rental_car_searches", {}).get("urls") if plan.get("rental_car_searches") else None
        }
    }

    return structured


def print_human_readable(search: TravelSearch, plan: Dict[str, Any]) -> None:
    """Print search plan in human-readable format."""
    print()
    print("🔍 TRAVEL SEARCH PLAN v3.0")
    print("=" * 60)

    # Show history and defaults first (compact)
    print_history_compact()
    print_defaults_compact()
    print(f"📍 Destination: {search.destination}")
    print(f"🛫 From: {search.origin}")
    print(f"📅 Date window: {search.date_start} to {search.date_end}")
    print(f"🌙 Trip length: {search.nights} nights")
    print(f"👥 Travelers: {search.guests}")

    if search.budget:
        nightly = plan["search_params"]["nightly_budget"]
        print(f"💰 Total budget: ${search.budget:,}")
        print(f"   └─ Accommodation budget: ~${nightly}/night")

    print(f"🎯 Trip type: {search.trip_type}")
    print(f"🛏️  Min bedrooms: {plan['search_params']['min_bedrooms']}")

    # Preferences
    if search.preferences and (search.preferences.preferred_airlines or search.preferences.preferred_alliances):
        print()
        print("✈️  AIRLINE PREFERENCES:")
        if search.preferences.preferred_airlines:
            print(f"   Airlines: {', '.join(search.preferences.preferred_airlines)}")
        if search.preferences.preferred_alliances:
            print(f"   Alliances: {', '.join(search.preferences.preferred_alliances)}")

    print()
    print("📅 DATE COMBINATIONS TO CHECK:")
    for i, combo in enumerate(plan["date_combinations"], 1):
        print(f"   {i}. {combo['checkin_display']} → {combo['checkout_display']}")
    print()

    # Neighborhood research
    print("🔎 NEIGHBORHOOD RESEARCH:")
    print("   Reddit:")
    for q in plan["neighborhood_research"]["reddit"][:3]:
        print(f"      • {q}")
    print()

    # Transportation research
    print("🚗 TRANSPORTATION RESEARCH:")
    print("   (Rental car vs public transit)")
    for q in plan["transportation_research"]["reddit"][:2]:
        print(f"      • {q}")
    print()

    # Airbnb
    print("🏠 AIRBNB SEARCHES:")
    for s in plan["airbnb_searches"]:
        print(f"   🔗 {s['url']}")
    print()
    print("   💡 For individual listings: https://www.airbnb.com/rooms/LISTING_ID")
    print()

    # Flights
    print("✈️  FLIGHT SEARCHES:")
    print(f"   🔗 Google Flights: {plan['flight_searches']['google_flights']}")
    print(f"   🔗 Skyscanner: {plan['flight_searches']['skyscanner']}")
    print(f"   🔗 Kayak: {plan['flight_searches']['kayak']}")
    print()
    print("   📝 Skyscanner finds more budget carriers. Google has price alerts.")
    print()

    # Rental cars
    if plan.get("rental_car_searches"):
        car = plan["rental_car_searches"]
        print("🚙 RENTAL CAR SEARCHES:")
        print(f"   🔗 Kayak (compare all): {car['urls']['kayak']}")
        print(f"   🔗 AutoSlash (price tracker): {car['urls']['autoslash']}")
        print()
        print("   💡 AutoSlash tracks your reservation and re-books if price drops.")
        print()

    # Instructions
    print("📋 EXECUTION:")
    print("   1. Research neighborhoods (WebSearch)")
    print("   2. Check if rental car needed (WebSearch)")
    print("   3. Compare flights across all 3 sites")
    print("   4. Browse Airbnbs, extract listing IDs")
    print("   5. If car needed, check Kayak + AutoSlash")
    print("   6. Calculate totals, rank by price/rating")
    print()

    # Important limitations
    print("⚠️  LIMITATIONS:")
    print("   • This generates URLs - Claude executes them via browser automation")
    print("   • Sites may block automation or change URL formats")
    print("   • Prices are point-in-time snapshots")
    print("   • No direct booking - requires manual action")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Travel Search v3.0 - Review-aware travel search with sentiment analysis",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s "Paris" -d "Apr 17-26" -n 6 -g 4 -b 6000 -t family
  %(prog)s "Tokyo" -d "May 1-15" -n 5 -g 2 --no-car
  %(prog)s "Rome" -d "Jun 1-10" -n 7  # uses saved defaults for guests/budget/type
  %(prog)s --history           # show last 3 searches
  %(prog)s --show-defaults     # show saved defaults
  %(prog)s --set-defaults -g 4 -b 6000 -t family -o Boston

Config: ~/.config/travel-search/
        """
    )

    parser.add_argument("destination", nargs="?")
    parser.add_argument("--dates", "-d")
    parser.add_argument("--nights", "-n", type=int)
    parser.add_argument("--guests", "-g", type=int)
    parser.add_argument("--budget", "-b", type=int)
    parser.add_argument("--type", "-t", default="general",
                        choices=["family", "romantic", "adventure", "budget", "luxury", "general"])
    parser.add_argument("--origin", "-o", default=DEFAULT_ORIGIN)
    parser.add_argument("--year", "-y", type=int, default=None)
    parser.add_argument("--no-car", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--verbose", "-v", action="store_true")

    # Preferences management
    parser.add_argument("--set-prefs", action="store_true", help="Set travel preferences")
    parser.add_argument("--airlines", help="Comma-separated preferred airlines")
    parser.add_argument("--alliances", help="Comma-separated preferred alliances")
    parser.add_argument("--car-companies", help="Comma-separated preferred car companies")
    parser.add_argument("--show-prefs", action="store_true", help="Show saved preferences")
    parser.add_argument("--clear-prefs", action="store_true", help="Clear all preferences")

    # Defaults and history management
    parser.add_argument("--history", action="store_true", help="Show last 3 searches")
    parser.add_argument("--show-defaults", action="store_true", help="Show saved defaults")
    parser.add_argument("--set-defaults", action="store_true", help="Set default search criteria")
    parser.add_argument("--clear-defaults", action="store_true", help="Clear saved defaults")
    parser.add_argument("--clear-history", action="store_true", help="Clear search history")

    # v3.0: Review analysis commands
    parser.add_argument("--analyze-reviews", action="store_true",
                        help="Analyze review text from stdin and output rankings")
    parser.add_argument("--rank-airbnbs", action="store_true",
                        help="Rank Airbnb listings from stdin JSON")
    parser.add_argument("--structured", action="store_true",
                        help="Output structured JSON for LLM consumption")

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # v3.0: Review analysis commands (use sys_module to avoid shadowing issues)
    import sys as sys_module

    if args.analyze_reviews:
        if not REVIEW_ANALYZER_AVAILABLE:
            print("❌ Review analyzer module not available", file=sys_module.stderr)
            raise SystemExit(1)

        # Read review text from stdin
        review_text = sys_module.stdin.read()
        if not review_text.strip():
            print("❌ No review text provided on stdin", file=sys_module.stderr)
            raise SystemExit(1)

        destination = args.destination if args.destination else "Unknown"
        trip_type = args.type if args.type else "general"

        # Check cache first
        cached = load_cached_reviews(destination, trip_type)
        if cached:
            print(f"📦 Using cached reviews (expires: {cached.expires_at})")
            print(format_neighborhood_ranking(cached.neighborhoods, trip_type))
            if cached.transportation:
                print(format_transport_recommendation(cached.transportation))
            sys.exit(0)

        # Analyze reviews
        neighborhoods = analyze_reviews_from_text(review_text, destination, trip_type)
        transportation = analyze_transportation_from_text(review_text, destination)

        # Cache results
        from datetime import datetime, timedelta
        now = datetime.now()
        cache = ReviewCache(
            destination=destination,
            trip_type=trip_type,
            neighborhoods=neighborhoods,
            transportation=transportation,
            sources_analyzed=1,
            cached_at=now.isoformat(),
            expires_at=(now + timedelta(days=30)).isoformat()
        )
        save_cached_reviews(cache)

        # Output
        if args.json:
            from dataclasses import asdict
            # Generate neighborhood-specific Airbnb URLs for JSON output
            neighborhood_urls = []
            for n in neighborhoods[:5]:
                url = get_neighborhood_airbnb_url(
                    destination, n.name, "CHECKIN", "CHECKOUT", 4, 2
                )
                if url:
                    neighborhood_urls.append({"neighborhood": n.name, "url_template": url})

            output = {
                "neighborhoods": [asdict(n) for n in neighborhoods],
                "transportation": asdict(transportation) if transportation else None,
                "neighborhood_airbnb_urls": neighborhood_urls
            }
            print(json.dumps(output, indent=2))
        else:
            print(format_neighborhood_ranking(neighborhoods, trip_type))
            # Add comparative analysis between top neighborhoods
            comparison = compare_neighborhoods(neighborhoods, trip_type)
            if comparison:
                print(comparison)

            # Generate neighborhood-specific Airbnb URLs
            hood_urls = []
            for n in neighborhoods[:3]:
                url = get_neighborhood_airbnb_url(
                    destination, n.name, "CHECKIN", "CHECKOUT", 4, 2
                )
                if url:
                    hood_urls.append((n.name, url.replace("CHECKIN", "[checkin]").replace("CHECKOUT", "[checkout]")))

            if hood_urls:
                print("\n🏠 NEIGHBORHOOD-SPECIFIC AIRBNB SEARCHES:")
                for name, url in hood_urls:
                    print(f"   {name}: {url}")
                print("   (Replace [checkin]/[checkout] with your dates)")

            print(format_transport_with_notes(transportation, destination))

        raise SystemExit(0)

    if args.rank_airbnbs:
        if not REVIEW_ANALYZER_AVAILABLE:
            print("❌ Review analyzer module not available", file=sys_module.stderr)
            raise SystemExit(1)

        # Read Airbnb listing JSON from stdin
        try:
            listings_data = json.loads(sys_module.stdin.read())
        except json.JSONDecodeError as e:
            print(f"❌ Invalid JSON: {e}", file=sys_module.stderr)
            raise SystemExit(1)

        listings = [
            AirbnbListing(
                listing_id=l.get("listing_id", ""),
                name=l.get("name", ""),
                price_total=l.get("price_total", 0),
                rating=l.get("rating", 0.0),
                review_count=l.get("review_count", 0),
                superhost=l.get("superhost", False),
                neighborhood=l.get("neighborhood", "")
            )
            for l in listings_data.get("listings", listings_data if isinstance(listings_data, list) else [])
        ]

        ranked = rank_airbnb_listings(listings, sort_by="review_quality")

        if args.json:
            output = [
                {
                    "listing_id": l.listing_id,
                    "name": l.name,
                    "price_total": l.price_total,
                    "rating": l.rating,
                    "review_count": l.review_count,
                    "superhost": l.superhost,
                    "review_quality_score": l.review_quality_score,
                    "value_score": l.value_score,
                    "url": f"https://www.airbnb.com/rooms/{l.listing_id}"
                }
                for l in ranked
            ]
            print(json.dumps(output, indent=2))
        else:
            print(format_airbnb_ranking(ranked))

        sys.exit(0)

    # Preferences commands
    if args.show_prefs:
        prefs = load_preferences()
        print("✈️  Travel Preferences:")
        print(f"   Airlines: {', '.join(prefs.preferred_airlines) or '(none)'}")
        print(f"   Alliances: {', '.join(prefs.preferred_alliances) or '(none)'}")
        print(f"   Car companies: {', '.join(prefs.preferred_car_companies) or '(none)'}")
        print(f"   Default origin: {prefs.default_origin or '(none)'}")
        sys.exit(0)

    if args.clear_prefs:
        if save_preferences(TravelPreferences()):
            print("✅ Preferences cleared")
        else:
            print("❌ Failed to clear preferences")
            sys.exit(1)
        sys.exit(0)

    # History commands
    if args.history:
        print_history_compact()
        sys.exit(0)

    if args.clear_history:
        if save_history([]):
            print("✅ History cleared")
        else:
            print("❌ Failed to clear history")
        sys.exit(0)

    # Defaults commands
    if args.show_defaults:
        print_defaults_compact()
        defaults = load_defaults()
        if not defaults.guests and not defaults.budget:
            print("No defaults saved. Run a search to auto-save defaults.")
        sys.exit(0)

    if args.clear_defaults:
        if save_defaults(SearchDefaults()):
            print("✅ Defaults cleared")
        else:
            print("❌ Failed to clear defaults")
        sys.exit(0)

    if args.set_defaults:
        defaults = SearchDefaults(
            guests=args.guests,
            budget=args.budget,
            origin=args.origin or DEFAULT_ORIGIN,
            trip_type=args.type,
            include_rental_car=not args.no_car,
        )
        if save_defaults(defaults):
            print("✅ Defaults saved:")
            if args.guests:
                print(f"   Guests: {args.guests}")
            if args.budget:
                print(f"   Budget: ${args.budget:,}")
            if args.origin:
                print(f"   Origin: {args.origin}")
            if args.type != 'general':
                print(f"   Type: {args.type}")
        else:
            print("❌ Failed to save defaults")
            sys.exit(1)
        sys.exit(0)

    if args.set_prefs:
        prefs = load_preferences()
        if args.airlines:
            prefs.preferred_airlines = [a.strip() for a in args.airlines.split(',')]
        if args.alliances:
            prefs.preferred_alliances = [a.strip() for a in args.alliances.split(',')]
        if args.car_companies:
            prefs.preferred_car_companies = [c.strip() for c in args.car_companies.split(',')]
        if args.origin:
            prefs.default_origin = args.origin
        if save_preferences(prefs):
            print("✅ Preferences saved:")
            if args.airlines:
                print(f"   Airlines: {args.airlines}")
            if args.alliances:
                print(f"   Alliances: {args.alliances}")
            if args.car_companies:
                print(f"   Car companies: {args.car_companies}")
        else:
            print("❌ Failed to save preferences")
            sys.exit(1)
        sys.exit(0)

    # Load defaults to fill in missing args
    defaults = load_defaults()

    # Validate required args for search (destination and dates always required)
    if not args.destination:
        parser.error("destination is required")
    if not args.dates:
        parser.error("--dates is required")
    if not args.nights:
        parser.error("--nights is required")

    # Apply defaults for optional args if not provided
    guests = args.guests
    if not guests and defaults.guests:
        guests = defaults.guests
    if not guests:
        parser.error("--guests is required (no default saved)")

    budget = args.budget if args.budget else defaults.budget
    trip_type = args.type if args.type != 'general' else (defaults.trip_type or 'general')
    origin = args.origin if args.origin != DEFAULT_ORIGIN else (defaults.origin or DEFAULT_ORIGIN)
    include_car = not args.no_car if args.no_car else defaults.include_rental_car

    try:
        date_start, date_end = parse_date_range(args.dates, args.year)
    except ValueError as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        sys.exit(1)

    prefs = load_preferences()

    search = TravelSearch(
        destination=args.destination,
        date_start=date_start,
        date_end=date_end,
        nights=args.nights,
        guests=guests,
        budget=budget,
        trip_type=trip_type,
        origin=origin,
        include_rental_car=include_car,
        preferences=prefs,
    )

    errors = search.validate()
    if errors:
        print("❌ Validation errors:", file=sys.stderr)
        for error in errors:
            print(f"   • {error}", file=sys.stderr)
        sys.exit(1)

    if args.validate_only:
        print("✅ Validation passed")
        sys.exit(0)

    plan = build_search_plan(search)

    # Save to history and update defaults
    add_to_history(search)
    update_defaults_from_search(search)

    if args.structured:
        structured = build_structured_output(search, plan)
        print(json.dumps(structured, indent=2))
    elif args.json:
        print(json.dumps(plan, indent=2))
    else:
        print_human_readable(search, plan)


if __name__ == "__main__":
    main()
