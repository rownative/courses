#!/usr/bin/env python3
"""
Regenerate courses/index.json from all course files in courses/.
Output: flat array of metadata per course, documented in courses/SCHEMA.md ("Index"):
id, name, country, center_lat, center_lon, distance_m, status, notes, has_path.
"""

import json
from pathlib import Path

COURSES_DIR = Path(__file__).resolve().parent.parent / "courses"
INDEX_PATH = COURSES_DIR / "index.json"

REQUIRED_FIELDS = ("id", "name", "country", "center_lat", "center_lon", "distance_m", "status")


def index_entry(data: object) -> dict | None:
    """Build one index entry from a course dict, or None if it is not an indexable course."""
    if not isinstance(data, dict) or not set(REQUIRED_FIELDS) <= set(data):
        return None
    entry = {k: data[k] for k in REQUIRED_FIELDS}
    notes = data.get("notes")
    entry["notes"] = notes.strip() if isinstance(notes, str) else ""
    path = data.get("path")
    entry["has_path"] = isinstance(path, list) and len(path) >= 2
    return entry


def build_index(courses_dir: Path = COURSES_DIR) -> list[dict]:
    entries = []
    for f in sorted(courses_dir.glob("*.json"), key=lambda p: p.name):
        if f.name == "index.json":
            continue
        try:
            with open(f, encoding="utf-8") as fp:
                data = json.load(fp)
        except (json.JSONDecodeError, OSError):
            continue
        entry = index_entry(data)
        if entry is not None:
            entries.append(entry)
    return entries


def main() -> None:
    entries = build_index()
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)
    print(f"Wrote {INDEX_PATH} with {len(entries)} courses")


if __name__ == "__main__":
    main()
