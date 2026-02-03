#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests"]
# ///
"""
Flight tracker - looks up flight status and finds the correct FlightAware URL.

Usage:
    uv run track.py UA1372
    uv run track.py "UA 1372"
    uv run track.py DL405 --date 2026-01-30
    uv run track.py UA1372 --json
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone

import requests

IATA_TO_ICAO = {
    "UA": "UAL", "AA": "AAL", "DL": "DAL", "WN": "SWA",
    "B6": "JBU", "AS": "ASA", "NK": "NKS", "F9": "FFT",
    "HA": "HAL", "SW": "SWA", "G4": "AAY", "SY": "SCX",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
}


def parse_flight(flight_str: str) -> tuple[str, str]:
    """Parse 'UA1372' or 'UA 1372' into (iata_code, number)."""
    flight_str = flight_str.strip().upper().replace(" ", "")
    match = re.match(r"^([A-Z]{2})(\d{1,5})$", flight_str)
    if not match:
        print(f"Error: Could not parse flight number '{flight_str}'", file=sys.stderr)
        print("Expected format: UA1372, DL405, AA100", file=sys.stderr)
        sys.exit(1)
    return match.group(1), match.group(2)


def get_icao_flight(iata: str, number: str) -> str:
    icao = IATA_TO_ICAO.get(iata, iata)
    return f"{icao}{number}"


def fetch_flight_data(icao_flight: str) -> list[dict]:
    """Fetch flight data from FlightAware by parsing trackpollBootstrap from the page HTML."""
    url = f"https://www.flightaware.com/live/flight/{icao_flight}"
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()

    match = re.search(r"var\s+trackpollBootstrap\s*=\s*", resp.text)
    if not match:
        return []

    # Use raw_decode to handle the JSON object without needing to find the end
    decoder = json.JSONDecoder()
    data, _ = decoder.raw_decode(resp.text, match.end())
    flights = data.get("flights", {})

    segments = []
    for key, val in flights.items():
        log = val.get("activityLog", {}).get("flights", [])
        for seg in log:
            segments.append({
                "origin_icao": seg["origin"]["icao"],
                "origin_name": seg["origin"]["friendlyName"],
                "origin_iata": seg["origin"]["iata"],
                "dest_icao": seg["destination"]["icao"],
                "dest_name": seg["destination"]["friendlyName"],
                "dest_iata": seg["destination"]["iata"],
                "scheduled_depart": seg["gateDepartureTimes"]["scheduled"],
                "estimated_depart": seg["gateDepartureTimes"]["estimated"],
                "actual_depart": seg["gateDepartureTimes"]["actual"],
                "scheduled_arrive": seg["gateArrivalTimes"]["scheduled"],
                "estimated_arrive": seg["gateArrivalTimes"]["estimated"],
                "actual_arrive": seg["gateArrivalTimes"]["actual"],
                "status": seg.get("flightStatus", ""),
                "cancelled": seg.get("cancelled", False),
                "diverted": seg.get("diverted", False),
                "link": "https://www.flightaware.com" + seg.get("permaLink", ""),
                "gate_origin": seg["origin"].get("gate"),
                "terminal_origin": seg["origin"].get("terminal"),
                "gate_dest": seg["destination"].get("gate"),
                "terminal_dest": seg["destination"].get("terminal"),
            })

    return segments


def filter_segments_by_date(segments: list[dict], target_date: str | None = None) -> list[dict]:
    """Filter segments to only those on the target date (local departure date)."""
    if target_date:
        d = datetime.strptime(target_date, "%Y-%m-%d").date()
    else:
        # Use Pacific time as reference for "today"
        now_utc = datetime.now(timezone.utc)
        d = (now_utc - timedelta(hours=8)).date()

    today = d
    tomorrow = d + timedelta(days=1)

    result = []
    for seg in segments:
        ts = seg["scheduled_depart"]
        if ts is None:
            continue
        # Check if the local departure date matches
        # Extract date from permalink which uses UTC date
        # Instead, check if scheduled departure is within a ~36hr window
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        seg_local = dt - timedelta(hours=8)  # rough Pacific time
        seg_date = seg_local.date()
        if seg_date == today or seg_date == tomorrow:
            result.append(seg)

    # Sort by scheduled departure
    result.sort(key=lambda s: s["scheduled_depart"] or 0)
    return result


def format_time(ts: int | None, tz_offset_hours: int = 0) -> str:
    if ts is None:
        return "--"
    dt = datetime.fromtimestamp(ts, tz=timezone.utc) + timedelta(hours=tz_offset_hours)
    return dt.strftime("%I:%M %p").lstrip("0")


def main():
    parser = argparse.ArgumentParser(description="Track a flight and get FlightAware link")
    parser.add_argument("flight", help="Flight number (e.g., UA1372, DL405)")
    parser.add_argument("--date", help="Date to check (YYYY-MM-DD), defaults to today")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--all", action="store_true", help="Show all segments, not just today")
    args = parser.parse_args()

    iata, number = parse_flight(args.flight)
    icao_flight = get_icao_flight(iata, number)

    print(f"Looking up {iata}{number} ({icao_flight})...", file=sys.stderr)

    all_segments = fetch_flight_data(icao_flight)
    if not all_segments:
        print("No flight data found.", file=sys.stderr)
        sys.exit(1)

    if args.all:
        segments = all_segments
    else:
        segments = filter_segments_by_date(all_segments, args.date)

    if not segments:
        print("No segments found for today.", file=sys.stderr)
        print(f"General page: https://www.flightaware.com/live/flight/{icao_flight}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        print(json.dumps({"flight": f"{iata}{number}", "icao": icao_flight, "segments": segments}, indent=2))
    else:
        print(f"Flight: {iata}{number} ({icao_flight})")
        for i, seg in enumerate(segments, 1):
            status = seg["status"] or "scheduled"
            print(f"\n  {i}. {seg['origin_iata']} → {seg['dest_iata']}  [{status}]")
            if seg["gate_origin"]:
                print(f"     Gate: {seg['gate_origin']}{' T' + seg['terminal_origin'] if seg['terminal_origin'] else ''} → {seg['gate_dest'] or '?'}{' T' + seg['terminal_dest'] if seg['terminal_dest'] else ''}")
            dep = seg["actual_depart"] or seg["estimated_depart"] or seg["scheduled_depart"]
            arr = seg["actual_arrive"] or seg["estimated_arrive"] or seg["scheduled_arrive"]
            if dep:
                print(f"     Departs: {format_time(dep, -8)} PT / {format_time(dep, -5)} ET")
            if arr:
                print(f"     Arrives: {format_time(arr, -8)} PT / {format_time(arr, -5)} ET")
            print(f"     {seg['link']}")
        print()


if __name__ == "__main__":
    main()
