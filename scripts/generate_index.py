#!/usr/bin/env python3
"""
Regenerate courses/index.json from all course files in courses/.
Output: flat array of metadata (id, name, country, center_lat, center_lon, distance_m, status).
"""

import json
from pathlib import Path

COURSES_DIR = Path(__file__).resolve().parent.parent / "courses"
INDEX_PATH = COURSES_DIR / "index.json"

FIELDS = ("id", "name", "country", "center_lat", "center_lon", "distance_m", "status")


def main() -> None:
    entries = []
    for f in sorted(COURSES_DIR.glob("*.json"), key=lambda p: p.name):
        if f.name == "index.json":
            continue
        try:
            with open(f, encoding="utf-8") as fp:
                data = json.load(fp)
        except (json.JSONDecodeError, OSError):
            continue
        entry = {k: data[k] for k in FIELDS if k in data}
        if set(FIELDS) <= set(entry):
            entries.append(entry)

    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)
    print(f"Wrote {INDEX_PATH} with {len(entries)} courses")


if __name__ == "__main__":
    main()
