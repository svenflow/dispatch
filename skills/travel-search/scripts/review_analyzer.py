#!/usr/bin/env python3
"""
Review Analyzer for Travel Search v3.0

Fetches, analyzes, and caches neighborhood/destination reviews from:
- Reddit (via web search)
- TripAdvisor forums
- Travel blogs

Provides sentiment analysis and ranking based on trip type.
"""

import json
import re
import math
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field, asdict
import logging

logger = logging.getLogger(__name__)

# Cache configuration
CACHE_DIR = Path.home() / '.config' / 'travel-search' / 'review_cache'
CACHE_TTL_DAYS = 30  # Reviews don't change daily

# Sentiment keywords for aspect analysis
ASPECT_KEYWORDS = {
    "safety": {
        "positive": ["safe", "secure", "well-lit", "peaceful", "quiet at night", "no crime"],
        "negative": ["unsafe", "sketchy", "dangerous", "pickpocket", "crime", "avoid at night", "scary"]
    },
    "walkability": {
        "positive": ["walkable", "flat", "easy to walk", "pedestrian", "stroller friendly", "walking distance"],
        "negative": ["hilly", "spread out", "need car", "not walkable", "steep"]
    },
    "food_scene": {
        "positive": ["restaurants", "cafes", "great food", "bakeries", "dining", "foodie", "markets"],
        "negative": ["touristy food", "overpriced restaurants", "limited dining"]
    },
    "family_friendly": {
        "positive": ["family friendly", "kids", "playground", "stroller", "quiet", "parks", "museums for kids"],
        "negative": ["nightlife", "party", "loud", "bars", "clubs", "not for kids"]
    },
    "nightlife": {
        "positive": ["bars", "clubs", "nightlife", "party", "vibrant", "lively at night"],
        "negative": ["quiet", "dead at night", "closes early", "boring"]
    },
    "value": {
        "positive": ["affordable", "cheap", "budget", "value", "good prices", "reasonable"],
        "negative": ["expensive", "overpriced", "pricey", "tourist prices", "rip off"]
    },
    "transit": {
        "positive": ["metro", "subway", "easy transit", "well connected", "bus", "train station"],
        "negative": ["poor transit", "need uber", "far from metro", "limited transport"]
    },
    "authenticity": {
        "positive": ["local", "authentic", "non-touristy", "real", "neighborhood feel", "off beaten path"],
        "negative": ["touristy", "tourist trap", "crowded", "overrun", "generic"]
    }
}

# Destination-specific transport costs (weekly estimates in USD)
# Format: { "city_key": {"car": weekly_car_rental, "transit": weekly_transit_pass} }
DESTINATION_TRANSPORT_COSTS = {
    "paris": {"car": 450, "transit": 30, "notes": "Navigo week pass covers all zones"},
    "tokyo": {"car": 500, "transit": 25, "notes": "Suica/Pasmo rechargeable, JR Pass for day trips"},
    "london": {"car": 550, "transit": 75, "notes": "Oyster card with weekly cap"},
    "new york": {"car": 600, "transit": 35, "notes": "MetroCard unlimited weekly"},
    "rome": {"car": 350, "transit": 25, "notes": "Roma Pass good for 3 days + museums"},
    "barcelona": {"car": 300, "transit": 25, "notes": "T-Casual 10-trip cards"},
    "amsterdam": {"car": 400, "transit": 40, "notes": "OV-chipkaart, bikes often better"},
    "berlin": {"car": 300, "transit": 40, "notes": "7-day AB zone ticket"},
    "lisbon": {"car": 250, "transit": 20, "notes": "Viva Viagem card + 24h passes"},
    "madrid": {"car": 300, "transit": 25, "notes": "Tarjeta Multi"},
    "bangkok": {"car": 200, "transit": 15, "notes": "BTS/MRT day passes cheap"},
    "singapore": {"car": 700, "transit": 30, "notes": "Cars very expensive, MRT excellent"},
    "hong kong": {"car": 600, "transit": 25, "notes": "Octopus card, MTR excellent"},
    "sydney": {"car": 400, "transit": 50, "notes": "Opal card with weekly cap"},
    "los angeles": {"car": 350, "transit": 30, "notes": "Car basically required, limited transit"},
    "san francisco": {"car": 400, "transit": 40, "notes": "Clipper card, BART + Muni"},
    "chicago": {"car": 350, "transit": 30, "notes": "Ventra card, L train covers most areas"},
    "boston": {"car": 350, "transit": 25, "notes": "CharlieCard, T covers most tourist areas"},
    "miami": {"car": 300, "transit": 25, "notes": "Car needed outside downtown"},
    "seattle": {"car": 350, "transit": 30, "notes": "ORCA card, but hilly"},
    "default": {"car": 350, "transit": 50, "notes": "Average estimate - research specific city"},
}

# Neighborhood lat/lng bounds for Airbnb filtering (approx bounding boxes)
# Format: { "city_key": { "neighborhood": {"ne_lat": X, "ne_lng": Y, "sw_lat": Z, "sw_lng": W} } }
NEIGHBORHOOD_BOUNDS = {
    "paris": {
        "le marais": {"ne_lat": 48.865, "ne_lng": 2.365, "sw_lat": 48.852, "sw_lng": 2.348},
        "saint-germain": {"ne_lat": 48.857, "ne_lng": 2.345, "sw_lat": 48.848, "sw_lng": 2.320},
        "montmartre": {"ne_lat": 48.892, "ne_lng": 2.350, "sw_lat": 48.880, "sw_lng": 2.330},
        "latin quarter": {"ne_lat": 48.855, "ne_lng": 2.358, "sw_lat": 48.845, "sw_lng": 2.340},
        "bastille": {"ne_lat": 48.858, "ne_lng": 2.375, "sw_lat": 48.848, "sw_lng": 2.360},
    },
    "tokyo": {
        "shibuya": {"ne_lat": 35.665, "ne_lng": 139.710, "sw_lat": 35.655, "sw_lng": 139.695},
        "shinjuku": {"ne_lat": 35.700, "ne_lng": 139.710, "sw_lat": 35.685, "sw_lng": 139.690},
        "asakusa": {"ne_lat": 35.720, "ne_lng": 139.805, "sw_lat": 35.708, "sw_lng": 139.790},
        "ginza": {"ne_lat": 35.678, "ne_lng": 139.775, "sw_lat": 35.665, "sw_lng": 139.760},
    },
    "london": {
        "soho": {"ne_lat": 51.518, "ne_lng": -0.125, "sw_lat": 51.510, "sw_lng": -0.140},
        "covent garden": {"ne_lat": 51.515, "ne_lng": -0.115, "sw_lat": 51.508, "sw_lng": -0.130},
        "south bank": {"ne_lat": 51.510, "ne_lng": -0.095, "sw_lat": 51.500, "sw_lng": -0.120},
        "shoreditch": {"ne_lat": 51.530, "ne_lng": -0.070, "sw_lat": 51.520, "sw_lng": -0.085},
    },
    "new york": {
        "soho": {"ne_lat": 40.730, "ne_lng": -73.995, "sw_lat": 40.720, "sw_lng": -74.010},
        "west village": {"ne_lat": 40.740, "ne_lng": -73.995, "sw_lat": 40.730, "sw_lng": -74.010},
        "williamsburg": {"ne_lat": 40.720, "ne_lng": -73.945, "sw_lat": 40.705, "sw_lng": -73.965},
        "upper west side": {"ne_lat": 40.805, "ne_lng": -73.960, "sw_lat": 40.775, "sw_lng": -73.985},
    },
    "rome": {
        "trastevere": {"ne_lat": 41.895, "ne_lng": 12.475, "sw_lat": 41.882, "sw_lng": 12.460},
        "centro storico": {"ne_lat": 41.905, "ne_lng": 12.485, "sw_lat": 41.895, "sw_lng": 12.465},
        "monti": {"ne_lat": 41.900, "ne_lng": 12.500, "sw_lat": 41.890, "sw_lng": 12.485},
    },
}

# Trip type to aspect weights (what matters most for each type)
TRIP_TYPE_WEIGHTS = {
    "family": {
        "safety": 1.5, "walkability": 1.3, "family_friendly": 1.5, "value": 1.0,
        "transit": 1.2, "food_scene": 0.8, "nightlife": 0.2, "authenticity": 0.6
    },
    "romantic": {
        "food_scene": 1.4, "walkability": 1.3, "authenticity": 1.3, "safety": 1.0,
        "nightlife": 0.8, "value": 0.7, "transit": 0.8, "family_friendly": 0.3
    },
    "budget": {
        "value": 1.6, "transit": 1.3, "authenticity": 1.2, "safety": 1.0,
        "walkability": 0.9, "food_scene": 0.8, "nightlife": 0.6, "family_friendly": 0.5
    },
    "luxury": {
        "food_scene": 1.4, "safety": 1.3, "authenticity": 1.0, "walkability": 1.0,
        "nightlife": 0.9, "value": 0.3, "transit": 0.7, "family_friendly": 0.5
    },
    "adventure": {
        "authenticity": 1.5, "transit": 1.3, "value": 1.1, "safety": 0.9,
        "walkability": 1.0, "food_scene": 0.9, "nightlife": 0.8, "family_friendly": 0.3
    },
    "general": {
        "safety": 1.0, "walkability": 1.0, "food_scene": 1.0, "value": 1.0,
        "transit": 1.0, "authenticity": 1.0, "nightlife": 0.7, "family_friendly": 0.7
    }
}


@dataclass
class NeighborhoodReview:
    """Analyzed neighborhood data with scores."""
    name: str
    mention_count: int = 0
    sentiment_score: float = 0.0  # -1 to 1
    aspect_scores: Dict[str, float] = field(default_factory=dict)  # aspect -> score
    pros: List[str] = field(default_factory=list)
    cons: List[str] = field(default_factory=list)
    best_for: List[str] = field(default_factory=list)
    sample_quotes: List[str] = field(default_factory=list)
    weighted_score: float = 0.0  # Final score based on trip type


@dataclass
class TransportRecommendation:
    """Transportation analysis for destination."""
    needs_car: bool = False
    confidence: float = 0.0
    public_transit_quality: str = ""  # "excellent", "good", "limited", "poor"
    car_pros: List[str] = field(default_factory=list)
    car_cons: List[str] = field(default_factory=list)
    transit_tips: List[str] = field(default_factory=list)
    estimated_weekly_cost: Dict[str, int] = field(default_factory=dict)  # "car": 300, "transit": 50


@dataclass
class ReviewCache:
    """Cached review data for a destination."""
    destination: str
    trip_type: str
    neighborhoods: List[NeighborhoodReview] = field(default_factory=list)
    transportation: Optional[TransportRecommendation] = None
    sources_analyzed: int = 0
    cached_at: str = ""  # ISO format
    expires_at: str = ""  # ISO format


def get_cache_path(destination: str, trip_type: str) -> Path:
    """Get cache file path for destination."""
    slug = re.sub(r'[^\w]', '_', destination.lower())
    return CACHE_DIR / f"{slug}_{trip_type}.json"


def load_cached_reviews(destination: str, trip_type: str) -> Optional[ReviewCache]:
    """Load cached reviews if valid."""
    cache_path = get_cache_path(destination, trip_type)
    if not cache_path.exists():
        return None

    try:
        with open(cache_path, 'r') as f:
            data = json.load(f)

        expires_at = datetime.fromisoformat(data.get('expires_at', '2000-01-01'))
        if datetime.now() > expires_at:
            logger.info(f"Cache expired for {destination}")
            return None

        # Reconstruct dataclasses
        neighborhoods = [
            NeighborhoodReview(**n) for n in data.get('neighborhoods', [])
        ]
        transport = None
        if data.get('transportation'):
            transport = TransportRecommendation(**data['transportation'])

        return ReviewCache(
            destination=data['destination'],
            trip_type=data['trip_type'],
            neighborhoods=neighborhoods,
            transportation=transport,
            sources_analyzed=data.get('sources_analyzed', 0),
            cached_at=data.get('cached_at', ''),
            expires_at=data.get('expires_at', '')
        )
    except (json.JSONDecodeError, IOError, TypeError) as e:
        logger.warning(f"Failed to load cache: {e}")
        return None


def save_cached_reviews(cache: ReviewCache) -> bool:
    """Save reviews to cache."""
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path = get_cache_path(cache.destination, cache.trip_type)

        # Convert to dict
        data = {
            'destination': cache.destination,
            'trip_type': cache.trip_type,
            'neighborhoods': [asdict(n) for n in cache.neighborhoods],
            'transportation': asdict(cache.transportation) if cache.transportation else None,
            'sources_analyzed': cache.sources_analyzed,
            'cached_at': cache.cached_at,
            'expires_at': cache.expires_at
        }

        with open(cache_path, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    except IOError as e:
        logger.error(f"Failed to save cache: {e}")
        return False


def fetch_web_search_results(query: str) -> str:
    """
    Fetch web search results using the WebSearch tool (via Claude).
    Returns raw text content from search.

    In practice, Claude executes this via WebSearch tool.
    This function provides the interface.
    """
    # This is a placeholder - actual execution happens via Claude's WebSearch
    # Return format expected: text snippets from search results
    return ""


def analyze_sentiment_simple(text: str) -> float:
    """
    Keyword-based sentiment analysis with negation handling.
    Returns score from -1 (negative) to 1 (positive).

    Handles common negation patterns:
    - "not safe" -> flips "safe" to negative
    - "isn't great" -> flips "great" to negative
    - "wouldn't recommend" -> flips "recommend" to negative
    """
    text_lower = text.lower()

    positive_words = [
        "love", "great", "amazing", "excellent", "perfect", "beautiful",
        "recommend", "favorite", "best", "wonderful", "fantastic", "lovely",
        "charming", "clean", "safe", "quiet", "friendly", "convenient"
    ]
    negative_words = [
        "hate", "avoid", "terrible", "worst", "dirty", "dangerous",
        "overpriced", "crowded", "loud", "sketchy", "disappointing",
        "regret", "never again", "waste", "horrible", "awful"
    ]

    # Negation patterns to check
    negation_patterns = [
        r"not\s+", r"n't\s+", r"never\s+", r"no\s+", r"don't\s+",
        r"doesn't\s+", r"didn't\s+", r"won't\s+", r"wouldn't\s+",
        r"isn't\s+", r"aren't\s+", r"wasn't\s+", r"weren't\s+"
    ]

    pos_count = 0
    neg_count = 0

    for word in positive_words:
        # Check for negated positive (counts as negative)
        negated = False
        for neg in negation_patterns:
            if re.search(neg + word, text_lower):
                negated = True
                neg_count += 1  # Negated positive = negative
                break

        # Check for non-negated positive
        if not negated and word in text_lower:
            pos_count += 1

    for word in negative_words:
        # Check for negated negative (counts as neutral/slightly positive)
        negated = False
        for neg in negation_patterns:
            if re.search(neg + word, text_lower):
                negated = True
                # Negated negative is roughly neutral, slight positive lean
                pos_count += 0.5
                break

        # Check for non-negated negative
        if not negated and word in text_lower:
            neg_count += 1

    total = pos_count + neg_count
    if total == 0:
        return 0.0

    return (pos_count - neg_count) / total


def extract_aspect_scores(text: str) -> Dict[str, float]:
    """
    Extract aspect-specific sentiment scores from text.
    Returns dict of aspect -> score (-1 to 1).

    Applies negation handling to each aspect (e.g., "not safe" -> negative safety score).
    """
    text_lower = text.lower()
    scores = {}

    # Same negation patterns used in analyze_sentiment_simple
    negation_patterns = [
        r"not\s+", r"n't\s+", r"never\s+", r"no\s+", r"don't\s+",
        r"doesn't\s+", r"didn't\s+", r"won't\s+", r"wouldn't\s+",
        r"isn't\s+", r"aren't\s+", r"wasn't\s+", r"weren't\s+"
    ]

    for aspect, keywords in ASPECT_KEYWORDS.items():
        pos_hits = 0
        neg_hits = 0

        # Check positive keywords with negation handling
        for kw in keywords["positive"]:
            negated = False
            for neg in negation_patterns:
                if re.search(neg + re.escape(kw), text_lower):
                    negated = True
                    neg_hits += 1  # Negated positive = negative
                    break
            if not negated and kw in text_lower:
                pos_hits += 1

        # Check negative keywords with negation handling
        for kw in keywords["negative"]:
            negated = False
            for neg in negation_patterns:
                if re.search(neg + re.escape(kw), text_lower):
                    negated = True
                    pos_hits += 0.5  # Negated negative = slightly positive
                    break
            if not negated and kw in text_lower:
                neg_hits += 1

        total = pos_hits + neg_hits
        if total > 0:
            scores[aspect] = (pos_hits - neg_hits) / total
        else:
            scores[aspect] = 0.0

    return scores


def extract_neighborhood_mentions(text: str, destination: str) -> Dict[str, List[str]]:
    """
    Extract neighborhood names and their associated text snippets.
    Returns dict of neighborhood_name -> [sentences mentioning it].

    Enhanced with:
    - Pre-built lists for major cities
    - Hyphenated neighborhood names (Saint-Germain-des-Pres)
    - Numbered districts (7th arrondissement, 11e)
    - Lowercase mentions
    """
    # Known neighborhoods for major cities
    KNOWN_NEIGHBORHOODS = {
        "paris": [
            "marais", "le marais", "saint-germain", "saint germain", "saint-germain-des-pres",
            "montmartre", "latin quarter", "bastille", "belleville", "oberkampf",
            "1st arr", "2nd arr", "3rd arr", "4th arr", "5th arr", "6th arr", "7th arr",
            "8th arr", "9th arr", "10th arr", "11th arr", "12th arr", "13th arr", "14th arr",
            "15th arr", "16th arr", "17th arr", "18th arr", "19th arr", "20th arr",
            "1er", "2e", "3e", "4e", "5e", "6e", "7e", "8e", "9e", "10e", "11e", "12e",
            "champs-elysees", "opera", "pigalle", "batignolles", "menilmontant"
        ],
        "tokyo": [
            "shibuya", "shinjuku", "ginza", "asakusa", "ueno", "roppongi", "akihabara",
            "harajuku", "ikebukuro", "nakano", "shimokitazawa", "ebisu", "meguro",
            "nihonbashi", "marunouchi", "odaiba"
        ],
        "london": [
            "soho", "covent garden", "westminster", "kensington", "chelsea", "notting hill",
            "shoreditch", "camden", "brixton", "islington", "hackney", "greenwich",
            "south bank", "mayfair", "marylebone", "fitzrovia"
        ],
        "new york": [
            "manhattan", "brooklyn", "queens", "soho", "tribeca", "chelsea", "midtown",
            "upper east side", "upper west side", "east village", "west village",
            "williamsburg", "dumbo", "harlem", "lower east side", "greenpoint"
        ],
        "rome": [
            "trastevere", "centro storico", "monti", "testaccio", "prati", "san lorenzo",
            "esquilino", "garbatella", "ostiense", "vatican"
        ],
        "barcelona": [
            "gothic quarter", "el born", "eixample", "gracia", "barceloneta", "raval",
            "poble sec", "sant antoni", "sarria", "les corts", "diagonal"
        ],
        "amsterdam": [
            "jordaan", "de pijp", "centrum", "oud-west", "oud-zuid", "nieuw-west",
            "plantage", "westerpark", "oost", "noord", "canal ring", "red light district"
        ],
        "berlin": [
            "mitte", "kreuzberg", "prenzlauer berg", "friedrichshain", "charlottenburg",
            "schoneberg", "neukolln", "wedding", "moabit", "tiergarten"
        ],
        "lisbon": [
            "alfama", "baixa", "chiado", "bairro alto", "belem", "principe real",
            "mouraria", "graca", "santos", "cais do sodre", "lapa"
        ],
        "madrid": [
            "sol", "malasana", "chueca", "la latina", "lavapies", "salamanca",
            "retiro", "chamberi", "arguelles", "moncloa", "gran via"
        ]
    }

    neighborhoods = {}
    sentences = re.split(r'[.!?]', text)
    text_lower = text.lower()
    dest_lower = destination.lower()

    # Check known neighborhoods for this destination
    known_list = []
    for city, hoods in KNOWN_NEIGHBORHOODS.items():
        if city in dest_lower:
            known_list = hoods
            break

    # Find known neighborhoods in text
    for hood in known_list:
        if hood in text_lower:
            # Find sentences containing this neighborhood
            hood_sentences = []
            for sentence in sentences:
                if hood in sentence.lower():
                    hood_sentences.append(sentence.strip())
            if hood_sentences:
                # Normalize name for display
                name = hood.title().replace("-", " ").replace("Arr", "Arrondissement")
                if name not in neighborhoods:
                    neighborhoods[name] = []
                neighborhoods[name].extend(hood_sentences)

    # Also use pattern matching for neighborhoods not in our list
    for sentence in sentences:
        # Look for patterns like "the X neighborhood" or "in X" or "stay in X"
        patterns = [
            r'(?:the\s+)?([\w-]+(?:\s+[\w-]+)?)\s+(?:neighborhood|district|area|arrondissement|quarter)',
            r'stay\s+in\s+(?:the\s+)?([\w-]+(?:\s+[\w-]+)?)',
            r'(?:recommend|love|prefer)\s+(?:the\s+)?([\w-]+(?:\s+[\w-]+)?)',
        ]

        for pattern in patterns:
            matches = re.findall(pattern, sentence, re.IGNORECASE)
            for match in matches:
                name = match.strip().title()
                # Filter out common words
                stop_words = ['the', 'and', 'for', 'but', 'a', 'an', 'this', 'that', 'it', 'is']
                if len(name) > 2 and name.lower() not in stop_words:
                    if name not in neighborhoods:
                        neighborhoods[name] = []
                    if sentence.strip() not in neighborhoods[name]:
                        neighborhoods[name].append(sentence.strip())

    return neighborhoods


def calculate_weighted_score(
    neighborhood: NeighborhoodReview,
    trip_type: str
) -> float:
    """
    Calculate final weighted score based on trip type preferences.
    """
    weights = TRIP_TYPE_WEIGHTS.get(trip_type, TRIP_TYPE_WEIGHTS["general"])

    # Base sentiment contributes 30%
    base_score = (neighborhood.sentiment_score + 1) / 2  # Normalize to 0-1

    # Aspect scores contribute 70%
    aspect_total = 0.0
    weight_sum = 0.0

    for aspect, weight in weights.items():
        if aspect in neighborhood.aspect_scores:
            # Normalize aspect score to 0-1
            normalized = (neighborhood.aspect_scores[aspect] + 1) / 2
            aspect_total += normalized * weight
            weight_sum += weight

    if weight_sum > 0:
        aspect_avg = aspect_total / weight_sum
    else:
        aspect_avg = 0.5

    # Combine: 30% sentiment, 70% weighted aspects
    final_score = 0.3 * base_score + 0.7 * aspect_avg

    # Boost for high mention count (popularity bonus)
    if neighborhood.mention_count > 10:
        final_score *= 1.1
    elif neighborhood.mention_count > 5:
        final_score *= 1.05

    return min(1.0, final_score)  # Cap at 1.0


def determine_best_for(neighborhood: NeighborhoodReview) -> List[str]:
    """
    Determine which trip types this neighborhood is best for.
    """
    best_for = []

    for trip_type, weights in TRIP_TYPE_WEIGHTS.items():
        if trip_type == "general":
            continue

        score = calculate_weighted_score(neighborhood, trip_type)
        if score >= 0.7:
            best_for.append(trip_type)

    return best_for


def extract_pros_cons(neighborhood: NeighborhoodReview) -> Tuple[List[str], List[str]]:
    """
    Extract pros and cons from aspect scores.
    """
    pros = []
    cons = []

    aspect_labels = {
        "safety": ("safe", "safety concerns"),
        "walkability": ("walkable", "not very walkable"),
        "food_scene": ("great food scene", "limited dining"),
        "family_friendly": ("family-friendly", "not ideal for families"),
        "nightlife": ("good nightlife", "quiet at night"),
        "value": ("affordable", "expensive"),
        "transit": ("great transit", "limited transit"),
        "authenticity": ("authentic local feel", "touristy")
    }

    for aspect, score in neighborhood.aspect_scores.items():
        if aspect in aspect_labels:
            pro_label, con_label = aspect_labels[aspect]
            if score > 0.3:
                pros.append(pro_label)
            elif score < -0.3:
                cons.append(con_label)

    return pros[:5], cons[:3]  # Limit to top mentions


def analyze_reviews_from_text(
    raw_text: str,
    destination: str,
    trip_type: str
) -> List[NeighborhoodReview]:
    """
    Analyze raw review text and extract neighborhood recommendations.
    This is the core analysis function.
    """
    # Extract neighborhood mentions
    neighborhood_mentions = extract_neighborhood_mentions(raw_text, destination)

    reviews = []
    for name, sentences in neighborhood_mentions.items():
        combined_text = " ".join(sentences)

        review = NeighborhoodReview(
            name=name,
            mention_count=len(sentences),
            sentiment_score=analyze_sentiment_simple(combined_text),
            aspect_scores=extract_aspect_scores(combined_text),
            sample_quotes=sentences[:3]  # Keep top 3 quotes
        )

        review.pros, review.cons = extract_pros_cons(review)
        review.best_for = determine_best_for(review)
        review.weighted_score = calculate_weighted_score(review, trip_type)

        reviews.append(review)

    # Sort by weighted score
    reviews.sort(key=lambda x: x.weighted_score, reverse=True)

    return reviews


def analyze_transportation_from_text(raw_text: str, destination: str) -> TransportRecommendation:
    """
    Analyze transportation recommendations from review text.
    """
    text_lower = raw_text.lower()

    # Car-related keywords
    car_needed_signals = [
        "need a car", "rent a car", "car is essential", "car recommended",
        "driving is easier", "public transit is limited", "spread out"
    ]
    no_car_signals = [
        "don't need a car", "no car needed", "metro is great",
        "excellent public transit", "walkable", "don't rent a car",
        "car is useless", "parking nightmare", "avoid driving"
    ]

    car_score = sum(1 for s in car_needed_signals if s in text_lower)
    no_car_score = sum(1 for s in no_car_signals if s in text_lower)

    total = car_score + no_car_score
    needs_car = car_score > no_car_score if total > 0 else False
    confidence = abs(car_score - no_car_score) / max(total, 1)

    # Transit quality assessment
    if "excellent" in text_lower and ("metro" in text_lower or "transit" in text_lower):
        transit_quality = "excellent"
    elif "good" in text_lower and ("metro" in text_lower or "transit" in text_lower):
        transit_quality = "good"
    elif "limited" in text_lower and "transit" in text_lower:
        transit_quality = "limited"
    else:
        transit_quality = "moderate"

    # Extract specific tips
    tips = []
    sentences = re.split(r'[.!?]', raw_text)
    for s in sentences:
        s_lower = s.lower()
        if any(kw in s_lower for kw in ["tip", "recommend", "suggest", "advice", "metro", "uber"]):
            tips.append(s.strip())

    # Get destination-specific costs
    dest_lower = destination.lower()
    costs = DESTINATION_TRANSPORT_COSTS.get("default").copy()
    for city_key, city_costs in DESTINATION_TRANSPORT_COSTS.items():
        if city_key in dest_lower or dest_lower in city_key:
            costs = city_costs.copy()
            break

    return TransportRecommendation(
        needs_car=needs_car,
        confidence=confidence,
        public_transit_quality=transit_quality,
        transit_tips=tips[:5],
        estimated_weekly_cost={"car": costs["car"], "transit": costs["transit"]}
    )


def calculate_confidence(mention_count: int) -> str:
    """
    Calculate confidence level based on sample size.
    More mentions = higher confidence.
    """
    if mention_count >= 10:
        return "high"
    elif mention_count >= 5:
        return "medium"
    elif mention_count >= 2:
        return "low"
    else:
        return "very low"


def format_neighborhood_ranking(reviews: List[NeighborhoodReview], trip_type: str) -> str:
    """
    Format neighborhood rankings as human-readable output.
    Includes confidence scores based on sample size.
    """
    if not reviews:
        return "No neighborhood data available."

    # Summary statistics
    total_neighborhoods = len(reviews)
    high_rated = sum(1 for r in reviews if r.weighted_score >= 0.7)

    lines = [f"\n📍 NEIGHBORHOOD RANKINGS (for {trip_type} trip)"]
    lines.append(f"   Found {total_neighborhoods} neighborhoods, {high_rated} highly recommended\n")

    for i, r in enumerate(reviews[:5], 1):
        score_pct = int(r.weighted_score * 100)
        sentiment_pct = int((r.sentiment_score + 1) * 50)  # Convert -1..1 to 0..100
        confidence = calculate_confidence(r.mention_count)

        lines.append(f"{i}. {r.name} (score: {score_pct}/100, confidence: {confidence})")
        lines.append(f"   • {sentiment_pct}% positive sentiment ({r.mention_count} mentions)")

        if r.pros:
            lines.append(f"   • Pros: {', '.join(r.pros)}")
        if r.cons:
            lines.append(f"   • Cons: {', '.join(r.cons)}")
        if r.best_for:
            lines.append(f"   • Best for: {', '.join(r.best_for)}")

        lines.append("")

    if total_neighborhoods > 5:
        lines.append(f"   ... and {total_neighborhoods - 5} more neighborhoods analyzed")

    return "\n".join(lines)


def compare_neighborhoods(reviews: List[NeighborhoodReview], trip_type: str) -> str:
    """
    Generate comparative analysis between top neighborhoods.
    Shows head-to-head differences in key aspects.
    """
    if len(reviews) < 2:
        return ""

    lines = ["\n🔄 NEIGHBORHOOD COMPARISON:\n"]

    # Compare top 3 neighborhoods pairwise
    for i in range(min(2, len(reviews) - 1)):
        a = reviews[i]
        b = reviews[i + 1]

        lines.append(f"   {a.name} vs {b.name}:")

        # Find aspects where they differ significantly
        advantages_a = []
        advantages_b = []

        for aspect in TRIP_TYPE_WEIGHTS.get(trip_type, TRIP_TYPE_WEIGHTS["general"]).keys():
            score_a = a.aspect_scores.get(aspect, 0)
            score_b = b.aspect_scores.get(aspect, 0)
            diff = score_a - score_b

            aspect_label = aspect.replace("_", " ")
            if diff > 0.2:
                advantages_a.append(f"{aspect_label} (+{diff:.1f})")
            elif diff < -0.2:
                advantages_b.append(f"{aspect_label} (+{abs(diff):.1f})")

        if advantages_a:
            lines.append(f"      {a.name} wins: {', '.join(advantages_a)}")
        if advantages_b:
            lines.append(f"      {b.name} wins: {', '.join(advantages_b)}")

        if not advantages_a and not advantages_b:
            lines.append(f"      Very similar overall")

        # Overall recommendation
        if a.weighted_score > b.weighted_score + 0.1:
            lines.append(f"      ➡️ {a.name} is better for {trip_type} trips")
        elif b.weighted_score > a.weighted_score + 0.1:
            lines.append(f"      ➡️ {b.name} is better for {trip_type} trips")
        else:
            lines.append(f"      ➡️ Both excellent for {trip_type} trips")

        lines.append("")

    return "\n".join(lines)


def get_neighborhood_airbnb_url(
    destination: str,
    neighborhood: str,
    checkin: str,
    checkout: str,
    guests: int,
    min_bedrooms: int = 1
) -> Optional[str]:
    """
    Build Airbnb URL filtered to a specific neighborhood using lat/lng bounds.
    Returns None if neighborhood bounds not available.
    """
    dest_lower = destination.lower()

    # Find city bounds data
    city_bounds = None
    for city_key, bounds in NEIGHBORHOOD_BOUNDS.items():
        if city_key in dest_lower or dest_lower in city_key:
            city_bounds = bounds
            break

    if not city_bounds:
        return None

    # Find neighborhood bounds (normalize name for matching)
    # Normalize both to same format for comparison
    def normalize(s: str) -> str:
        return s.lower().replace("-", " ").replace("_", " ").strip()

    hood_normalized = normalize(neighborhood)
    hood_bounds = None

    for hood_key, bounds in city_bounds.items():
        hood_key_normalized = normalize(hood_key)
        if hood_key_normalized in hood_normalized or hood_normalized in hood_key_normalized:
            hood_bounds = bounds
            break

    if not hood_bounds:
        return None

    # Build URL with bounding box
    # Airbnb uses ne_lat, ne_lng, sw_lat, sw_lng params
    url = (
        f"https://www.airbnb.com/s/{destination.replace(' ', '-')}/homes?"
        f"adults={guests}&checkin={checkin}&checkout={checkout}"
        f"&min_bedrooms={min_bedrooms}"
        f"&ne_lat={hood_bounds['ne_lat']}&ne_lng={hood_bounds['ne_lng']}"
        f"&sw_lat={hood_bounds['sw_lat']}&sw_lng={hood_bounds['sw_lng']}"
        f"&zoom=15"
    )
    return url


def format_transport_recommendation(transport: TransportRecommendation) -> str:
    """
    Format transportation recommendation as human-readable output.
    """
    lines = ["\n🚗 TRANSPORTATION ANALYSIS:\n"]

    if transport.needs_car:
        lines.append(f"   ➡️  RENTAL CAR RECOMMENDED (confidence: {int(transport.confidence * 100)}%)")
    else:
        lines.append(f"   ➡️  NO CAR NEEDED (confidence: {int(transport.confidence * 100)}%)")

    lines.append(f"   • Public transit quality: {transport.public_transit_quality}")

    if transport.transit_tips:
        lines.append("   • Tips:")
        for tip in transport.transit_tips[:3]:
            lines.append(f"      - {tip[:100]}...")

    car_cost = transport.estimated_weekly_cost.get('car', 'N/A')
    transit_cost = transport.estimated_weekly_cost.get('transit', 'N/A')
    lines.append(f"\n   💰 Est. weekly costs: Car ~${car_cost} | Transit ~${transit_cost}")

    return "\n".join(lines)


def format_transport_with_notes(transport: TransportRecommendation, destination: str) -> str:
    """
    Format transportation recommendation with destination-specific notes.
    """
    base_output = format_transport_recommendation(transport)

    # Get notes for this destination
    dest_lower = destination.lower()
    notes = None
    for city_key, costs in DESTINATION_TRANSPORT_COSTS.items():
        if city_key in dest_lower or dest_lower in city_key:
            notes = costs.get("notes")
            break

    if notes:
        base_output += f"\n   💡 Tip: {notes}"

    return base_output


# =============================================================================
# Airbnb Review Quality Scoring
# =============================================================================

@dataclass
class AirbnbListing:
    """Represents an Airbnb listing with review data."""
    listing_id: str
    name: str
    price_total: int  # Total for stay
    rating: float
    review_count: int
    superhost: bool = False
    neighborhood: str = ""

    @property
    def review_quality_score(self) -> float:
        """
        Calculate review quality score.
        Formula: rating * log10(review_count + 1)

        This balances:
        - High ratings (4.9 vs 4.5)
        - Review volume (50 reviews is more trustworthy than 3)

        Examples:
        - 5.0 rating, 1 review: 5.0 * log10(2) = 1.5
        - 4.9 rating, 50 reviews: 4.9 * log10(51) = 8.4
        - 4.5 rating, 200 reviews: 4.5 * log10(201) = 10.4
        """
        if self.review_count == 0:
            return 0.0
        return self.rating * math.log10(self.review_count + 1)

    @property
    def value_score(self) -> float:
        """
        Calculate value score (quality per dollar).
        Higher is better.
        """
        if self.price_total == 0:
            return 0.0
        return self.review_quality_score / (self.price_total / 1000)


def rank_airbnb_listings(
    listings: List[AirbnbListing],
    sort_by: str = "review_quality"  # "review_quality", "value", "price"
) -> List[AirbnbListing]:
    """
    Rank Airbnb listings by specified criteria.
    """
    if sort_by == "review_quality":
        return sorted(listings, key=lambda x: x.review_quality_score, reverse=True)
    elif sort_by == "value":
        return sorted(listings, key=lambda x: x.value_score, reverse=True)
    elif sort_by == "price":
        return sorted(listings, key=lambda x: x.price_total)
    else:
        return listings


def format_airbnb_ranking(listings: List[AirbnbListing]) -> str:
    """
    Format Airbnb listings with review quality scores.
    """
    lines = ["\n🏠 AIRBNB RANKINGS (by review quality):\n"]

    for i, listing in enumerate(listings[:10], 1):
        superhost_badge = " 🏆" if listing.superhost else ""
        quality_score = listing.review_quality_score

        lines.append(f"{i}. {listing.name}{superhost_badge}")
        lines.append(f"   ⭐ {listing.rating} ({listing.review_count} reviews) | Quality Score: {quality_score:.1f}")
        lines.append(f"   💰 ${listing.price_total:,} total")
        if listing.neighborhood:
            lines.append(f"   📍 {listing.neighborhood}")
        lines.append(f"   🔗 https://www.airbnb.com/rooms/{listing.listing_id}")
        lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    # Test with sample data
    sample_text = """
    I highly recommend staying in Le Marais neighborhood. It's incredibly walkable,
    has great restaurants and cafes, and feels very safe. The metro is right there.
    Saint-Germain is also excellent for families - the Luxembourg Gardens playground
    is amazing for kids. It's a bit expensive but worth it.
    Montmartre is charming but very hilly with a stroller. The views are beautiful
    but it can feel touristy around Sacre-Coeur.
    For budget travelers, I'd suggest the 11th arrondissement - more affordable,
    authentic neighborhood feel, good food scene.
    """

    reviews = analyze_reviews_from_text(sample_text, "Paris", "family")
    print(format_neighborhood_ranking(reviews, "family"))
