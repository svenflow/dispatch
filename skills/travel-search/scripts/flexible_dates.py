#!/usr/bin/env python3
"""
Flexible Dates Search v1.0

Searches multiple date ranges to find:
1. Much cheaper than usual options
2. Luxury properties dropping into budget

Uses historical price averages and discount detection.
"""

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


@dataclass
class FlexibleDateOption:
    """A flexible date option showing price vs average."""
    checkin: str  # YYYY-MM-DD
    checkout: str  # YYYY-MM-DD
    nights: int
    flight_price: int
    airbnb_price: int
    total_price: int
    avg_price: int  # Historical average for comparison
    savings_pct: int  # Percentage below average
    listing_name: str  # Best Airbnb for this date
    listing_id: str
    is_luxury_discount: bool = False  # True if normally expensive, now affordable
    original_luxury_price: Optional[int] = None


@dataclass
class FlexibleSearchResult:
    """Results from flexible date search."""
    base_checkin: str
    base_checkout: str
    budget: int
    cheaper_options: List[FlexibleDateOption] = field(default_factory=list)
    luxury_drops: List[FlexibleDateOption] = field(default_factory=list)


# Historical average prices by destination and month (rough estimates)
# Format: { "city": { "month": avg_total_trip_cost } }
HISTORICAL_AVERAGES = {
    "paris": {
        1: 4500, 2: 4200, 3: 4800, 4: 5500, 5: 5800, 6: 6200,
        7: 6500, 8: 6500, 9: 5800, 10: 5200, 11: 4500, 12: 5000
    },
    "tokyo": {
        1: 5000, 2: 4800, 3: 5500, 4: 6000, 5: 5500, 6: 5000,
        7: 5500, 8: 5500, 9: 5200, 10: 5500, 11: 5200, 12: 5000
    },
    "london": {
        1: 4200, 2: 4000, 3: 4500, 4: 5000, 5: 5500, 6: 5800,
        7: 6000, 8: 6000, 9: 5500, 10: 5000, 11: 4500, 12: 4800
    },
    "rome": {
        1: 3800, 2: 3600, 3: 4200, 4: 5000, 5: 5200, 6: 5500,
        7: 5800, 8: 5800, 9: 5200, 10: 4800, 11: 4000, 12: 4200
    },
    "barcelona": {
        1: 3500, 2: 3500, 3: 4000, 4: 4500, 5: 5000, 6: 5500,
        7: 6000, 8: 6200, 9: 5200, 10: 4500, 11: 3800, 12: 4000
    },
    "default": {
        1: 4000, 2: 3800, 3: 4200, 4: 4800, 5: 5000, 6: 5500,
        7: 6000, 8: 6000, 9: 5200, 10: 4800, 11: 4200, 12: 4500
    }
}

# Luxury threshold - properties normally above this are "luxury"
LUXURY_THRESHOLD_MULTIPLIER = 1.4  # 40% above budget = luxury


def get_historical_average(destination: str, month: int) -> int:
    """Get historical average trip cost for destination/month."""
    dest_lower = destination.lower()

    for city, averages in HISTORICAL_AVERAGES.items():
        if city in dest_lower or dest_lower in city:
            return averages.get(month, HISTORICAL_AVERAGES["default"][month])

    return HISTORICAL_AVERAGES["default"].get(month, 5000)


def generate_date_windows(
    base_checkin: str,
    base_checkout: str,
    flex_days: int = 7,
    num_windows: int = 6
) -> List[Tuple[str, str]]:
    """
    Generate alternative date windows around the base dates.

    Returns list of (checkin, checkout) tuples.
    """
    base_in = datetime.strptime(base_checkin, "%Y-%m-%d")
    base_out = datetime.strptime(base_checkout, "%Y-%m-%d")
    nights = (base_out - base_in).days

    windows = []

    # Include original dates
    windows.append((base_checkin, base_checkout))

    # Earlier dates
    for i in range(1, flex_days + 1):
        new_in = base_in - timedelta(days=i)
        new_out = new_in + timedelta(days=nights)
        windows.append((new_in.strftime("%Y-%m-%d"), new_out.strftime("%Y-%m-%d")))
        if len(windows) >= num_windows:
            break

    # Later dates
    for i in range(1, flex_days + 1):
        if len(windows) >= num_windows * 2:
            break
        new_in = base_in + timedelta(days=i)
        new_out = new_in + timedelta(days=nights)
        windows.append((new_in.strftime("%Y-%m-%d"), new_out.strftime("%Y-%m-%d")))

    return windows[:num_windows * 2]


def calculate_savings(current_price: int, average_price: int) -> int:
    """Calculate savings percentage vs average."""
    if average_price <= 0:
        return 0
    return int(100 * (average_price - current_price) / average_price)


def find_flexible_deals(
    destination: str,
    base_checkin: str,
    base_checkout: str,
    budget: int,
    flight_prices: Dict[str, int],  # date -> price mapping
    airbnb_prices: Dict[str, Dict],  # date -> {price, name, id, original_price}
    flex_days: int = 7
) -> FlexibleSearchResult:
    """
    Find flexible date deals.

    Returns:
    - 3 "much cheaper" options (>15% below average)
    - 3 "luxury dropping into budget" options
    """
    result = FlexibleSearchResult(
        base_checkin=base_checkin,
        base_checkout=base_checkout,
        budget=budget,
    )

    base_in = datetime.strptime(base_checkin, "%Y-%m-%d")
    base_out = datetime.strptime(base_checkout, "%Y-%m-%d")
    nights = (base_out - base_in).days

    # Generate date windows to check
    windows = generate_date_windows(base_checkin, base_checkout, flex_days)

    cheaper_candidates = []
    luxury_candidates = []

    for checkin, checkout in windows:
        checkin_dt = datetime.strptime(checkin, "%Y-%m-%d")
        month = checkin_dt.month

        # Get prices for this date window
        flight_price = flight_prices.get(checkin, flight_prices.get("default", 2500))
        airbnb_data = airbnb_prices.get(checkin, {})
        airbnb_price = airbnb_data.get("price", 0)
        listing_name = airbnb_data.get("name", "Unknown")
        listing_id = airbnb_data.get("id", "")
        original_price = airbnb_data.get("original_price")

        if airbnb_price == 0:
            continue

        total_price = flight_price + airbnb_price
        avg_price = get_historical_average(destination, month)
        savings_pct = calculate_savings(total_price, avg_price)

        option = FlexibleDateOption(
            checkin=checkin,
            checkout=checkout,
            nights=nights,
            flight_price=flight_price,
            airbnb_price=airbnb_price,
            total_price=total_price,
            avg_price=avg_price,
            savings_pct=savings_pct,
            listing_name=listing_name,
            listing_id=listing_id,
        )

        # Check if it's a luxury property dropping into budget
        luxury_threshold = budget * LUXURY_THRESHOLD_MULTIPLIER
        if original_price and original_price > luxury_threshold and total_price <= budget:
            option.is_luxury_discount = True
            option.original_luxury_price = original_price
            luxury_candidates.append(option)
        # Check if it's significantly cheaper than average
        elif savings_pct >= 15 and total_price <= budget:
            cheaper_candidates.append(option)

    # Sort and select top 3 of each
    cheaper_candidates.sort(key=lambda x: x.savings_pct, reverse=True)
    luxury_candidates.sort(key=lambda x: (x.original_luxury_price or 0) - x.total_price, reverse=True)

    result.cheaper_options = cheaper_candidates[:3]
    result.luxury_drops = luxury_candidates[:3]

    return result


def format_flexible_results(result: FlexibleSearchResult) -> str:
    """Format flexible date results for display."""
    lines = ["\n🔥 FLEXIBLE DATE DEALS\n"]
    lines.append("━" * 45)

    # Much cheaper options
    if result.cheaper_options:
        lines.append("MUCH CHEAPER (vs normal prices):")
        for opt in result.cheaper_options:
            checkin_dt = datetime.strptime(opt.checkin, "%Y-%m-%d")
            display_dates = checkin_dt.strftime("%b %d") + f"-{int(checkin_dt.strftime('%d')) + opt.nights}"
            lines.append(
                f"📅 {display_dates}: F+A total ${opt.total_price:,} "
                f"🟢🔻 -{opt.savings_pct}%"
            )
        lines.append("")

    # Luxury dropping into budget
    if result.luxury_drops:
        lines.append("LUXURY → BUDGET (normally expensive, now in range):")
        for opt in result.luxury_drops:
            checkin_dt = datetime.strptime(opt.checkin, "%Y-%m-%d")
            display_dates = checkin_dt.strftime("%b %d") + f"-{int(checkin_dt.strftime('%d')) + opt.nights}"
            orig = opt.original_luxury_price or 0
            lines.append(
                f"🏆 {display_dates}: {opt.listing_name[:25]} "
                f"${opt.total_price:,} (was ${orig:,})"
            )
        lines.append("")

    if not result.cheaper_options and not result.luxury_drops:
        lines.append("No significant deals found for flexible dates.")
        lines.append("Try expanding the date range or adjusting budget.")

    return "\n".join(lines)


def to_json(result: FlexibleSearchResult) -> Dict[str, Any]:
    """Convert result to JSON-serializable dict."""
    return {
        "base_checkin": result.base_checkin,
        "base_checkout": result.base_checkout,
        "budget": result.budget,
        "cheaper_options": [
            {
                "checkin": o.checkin,
                "checkout": o.checkout,
                "nights": o.nights,
                "total_price": o.total_price,
                "savings_pct": o.savings_pct,
                "listing_name": o.listing_name,
                "listing_id": o.listing_id,
            }
            for o in result.cheaper_options
        ],
        "luxury_drops": [
            {
                "checkin": o.checkin,
                "checkout": o.checkout,
                "nights": o.nights,
                "total_price": o.total_price,
                "original_price": o.original_luxury_price,
                "listing_name": o.listing_name,
                "listing_id": o.listing_id,
            }
            for o in result.luxury_drops
        ]
    }


if __name__ == "__main__":
    # Example usage
    import argparse

    parser = argparse.ArgumentParser(description="Flexible Dates Search")
    parser.add_argument("destination")
    parser.add_argument("--checkin", required=True)
    parser.add_argument("--checkout", required=True)
    parser.add_argument("--budget", type=int, default=6000)
    parser.add_argument("--json", action="store_true")

    args = parser.parse_args()

    # Mock data for testing
    flight_prices = {
        "default": 2500,
        args.checkin: 2800,
    }

    # Generate some mock dates
    base_dt = datetime.strptime(args.checkin, "%Y-%m-%d")
    for i in range(-7, 8):
        dt = base_dt + timedelta(days=i)
        date_str = dt.strftime("%Y-%m-%d")
        # Vary prices by day of week
        if dt.weekday() in [4, 5]:  # Fri, Sat
            flight_prices[date_str] = 3200
        elif dt.weekday() in [1, 2]:  # Tue, Wed
            flight_prices[date_str] = 2100
        else:
            flight_prices[date_str] = 2500

    airbnb_prices = {
        args.checkin: {"price": 2400, "name": "Marais Loft", "id": "12345"},
    }

    for i in range(-7, 8):
        dt = base_dt + timedelta(days=i)
        date_str = dt.strftime("%Y-%m-%d")
        # Vary Airbnb prices
        base_price = 2400
        if dt.weekday() in [4, 5]:
            base_price = 2800
        elif dt.weekday() in [1, 2]:
            base_price = 2000

        # Add some luxury drops
        if i == -3:
            airbnb_prices[date_str] = {
                "price": 4500,
                "name": "Penthouse Marais",
                "id": "99999",
                "original_price": 8500
            }
        else:
            airbnb_prices[date_str] = {
                "price": base_price,
                "name": "Standard Apt",
                "id": f"{10000 + i}"
            }

    result = find_flexible_deals(
        destination=args.destination,
        base_checkin=args.checkin,
        base_checkout=args.checkout,
        budget=args.budget,
        flight_prices=flight_prices,
        airbnb_prices=airbnb_prices,
    )

    if args.json:
        print(json.dumps(to_json(result), indent=2))
    else:
        print(format_flexible_results(result))
