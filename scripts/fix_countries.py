#!/usr/bin/env python3
"""
Add missing country information via reverse geocoding and normalize country names.

Usage:
  python scripts/fix_countries.py              # apply changes
  python scripts/fix_countries.py --dry-run   # show what would change, don't write
  python scripts/fix_countries.py --normalize-only  # only normalize, skip geocoding

Requires: pip install geopy
Nominatim (OpenStreetMap) is used for geocoding; 1 request/second rate limit applies.
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Optional

COURSES_DIR = Path(__file__).resolve().parent.parent / "courses"

# Canonical names (target). Variations map to these.
COUNTRY_NORMALIZE = {
    # United States
    "united states of america": "United States",
    "usa": "United States",
    "u.s.": "United States",
    "u.s.a.": "United States",
    "united states": "United States",  # already canonical
    # United Kingdom
    "united kingdom": "United Kingdom",
    "uk": "United Kingdom",
    "gbr": "United Kingdom",
    "great britain": "United Kingdom",
    "england": "United Kingdom",
    "scotland": "United Kingdom",
    "wales": "United Kingdom",
    # Netherlands
    "netherlands": "Netherlands",
    "nederland": "Netherlands",
    "the netherlands": "Netherlands",
    "holland": "Netherlands",
    "nld": "Netherlands",
    # Germany
    "germany": "Germany",
    "deutschland": "Germany",
    "deu": "Germany",
    # Italy
    "italy": "Italy",
    "ita": "Italy",
    "italia": "Italy",
    # Canada
    "canada": "Canada",
    "can": "Canada",
    # Czech
    "czechia": "Czechia",
    "czech republic": "Czechia",
    "cze": "Czechia",
    # Slovakia
    "slovakia": "Slovakia",
    "slovensko": "Slovakia",
    "svk": "Slovakia",
    # Austria
    "austria": "Austria",
    "aut": "Austria",
    "österreich": "Austria",
}


def normalize_country(name: str) -> Optional[str]:
    """Return canonical country name or None if not in mapping."""
    if not name or not isinstance(name, str):
        return None
    key = name.strip()
    if not key:
        return None
    return COUNTRY_NORMALIZE.get(key.lower())


def needs_country(course: dict) -> bool:
    """True if course has missing or unknown country."""
    c = (course.get("country") or "").strip().lower()
    return not c or c == "unknown"


def geocode_country(lat: float, lon: float) -> Optional[str]:
    """Reverse geocode (lat, lon) to country name. Returns None on failure."""
    try:
        from geopy.geocoders import Nominatim
        from geopy.exc import GeocoderTimedOut, GeocoderServiceError
    except ImportError:
        print("geopy required: pip install geopy", file=sys.stderr)
        sys.exit(1)

    geolocator = Nominatim(user_agent="rowing-courses-fix-countries")
    try:
        location = geolocator.reverse(f"{lat}, {lon}", timeout=10, language="en")
        if location and location.raw:
            addr = location.raw.get("address", {}) or {}
            country = addr.get("country")
            if country:
                return country
    except (GeocoderTimedOut, GeocoderServiceError, Exception):
        pass
    return None


def process_courses(dry_run: bool, normalize_only: bool) -> None:
    """Process all course files; update country where needed."""
    total = 0
    normalized = 0
    geocoded = 0

    for f in sorted(COURSES_DIR.glob("*.json"), key=lambda p: p.name):
        if f.name == "index.json":
            continue
        try:
            with open(f, encoding="utf-8") as fp:
                course = json.load(fp)
        except (json.JSONDecodeError, OSError):
            continue

        total += 1
        orig = course.get("country", "")
        new_country = None
        action = None

        # 1. Normalize if we have a mapping
        norm = normalize_country(orig)
        if norm and norm != orig:
            new_country = norm
            action = "normalize"
            normalized += 1

        # 2. Geocode if missing/unknown (unless normalize-only)
        elif needs_country(course) and not normalize_only:
            lat = course.get("center_lat")
            lon = course.get("center_lon")
            if lat is not None and lon is not None:
                country = geocode_country(lat, lon)
                if country:
                    norm2 = normalize_country(country) or country
                    new_country = norm2
                    action = "geocode"
                    geocoded += 1
                time.sleep(1.1)  # Nominatim rate limit

        if new_country and new_country != orig:
            print(f"{f.name}: {repr(orig)} -> {repr(new_country)} ({action})")
            if not dry_run:
                course["country"] = new_country
                with open(f, "w", encoding="utf-8") as fp:
                    json.dump(course, fp, indent=2, ensure_ascii=False)

    print(f"Processed {total} courses; normalized {normalized}, geocoded {geocoded}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fix and normalize course country data")
    parser.add_argument("--dry-run", action="store_true", help="Show changes, don't write")
    parser.add_argument("--normalize-only", action="store_true", help="Only normalize names, skip geocoding")
    args = parser.parse_args()
    process_courses(dry_run=args.dry_run, normalize_only=args.normalize_only)


if __name__ == "__main__":
    main()
