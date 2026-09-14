#!/usr/bin/env python3
"""
Tidy course names that came out of the Rowsandall migration as "X - X", "X - X suffix"
or " - X" (the folder name and the placemark name were joined around a dash).

Rules, applied to the segments of a name split on " - ":
  * empty segments are dropped               " - Catterline Return"        -> "Catterline Return"
  * a segment that is a case-insensitive prefix of the next one is dropped
        "Head of the Red - Head of the Red"   -> "Head of the Red"
        "Carnegie Lake - Carnegie Lake 1k"    -> "Carnegie Lake 1k"
        "Seekonk R - Seekonk R - TOTS II"     -> "Seekonk R - TOTS II"
  * a name that is two copies of the same segment list is collapsed to one copy
        "Lake Q - Wormtown - Lake Q - Wormtown" -> "Lake Q - Wormtown"
        "A - B - A - B Rev F"                   -> "A - B Rev F"
  * everything else is left alone            "Brno - Prygl Rokle - Sirka"  unchanged

Usage:
  python scripts/tidy_names.py              # apply to every file in courses/
  python scripts/tidy_names.py --dry-run    # show what would change, write nothing
  python scripts/tidy_names.py courses/1.json courses/88.json

Uses only stdlib.
"""

import argparse
import json
import re
from pathlib import Path

COURSES_DIR = Path(__file__).resolve().parent.parent / "courses"

# A dash acting as a separator: surrounded by whitespace, or at the start/end of the name.
SEPARATOR = re.compile(r"(?:^|\s+)-(?:\s+|$)")


def _collapse_repeated_halves(segments: list[str]) -> list[str]:
    """
    "X - Y - X - Y" (the whole name repeated, possibly with a suffix on one copy) -> "X - Y".
    Each pair must match as a case-insensitive prefix; the longer of the pair is kept.
    """
    n = len(segments)
    if n < 4 or n % 2:
        return segments
    k = n // 2
    kept = []
    for a, b in zip(segments[:k], segments[k:]):
        la, lb = a.lower(), b.lower()
        if lb.startswith(la):
            kept.append(b)
        elif la.startswith(lb):
            kept.append(a)
        else:
            return segments
    return kept


def tidy_name(name: str) -> str:
    """Return the tidied name; unchanged if nothing applies. Non-strings pass through."""
    if not isinstance(name, str):
        return name
    segments = [re.sub(r"\s+", " ", seg).strip() for seg in SEPARATOR.split(name)]
    segments = [seg for seg in segments if seg]
    segments = _collapse_repeated_halves(segments)
    # Repeat until stable: "A B - A - A B Rev D" needs two passes to reach "A B Rev D".
    while True:
        out: list[str] = []
        for seg in segments:
            if out and seg.lower().startswith(out[-1].lower()):
                out.pop()
            out.append(seg)
        if out == segments:
            break
        segments = out
    return " - ".join(out)


def process(paths: list[Path], dry_run: bool) -> list[tuple[Path, str, str]]:
    """Tidy names in the given files. Returns (path, old, new) for every change."""
    changes = []
    for f in paths:
        try:
            raw = f.read_text(encoding="utf-8")
            course = json.loads(raw)
        except (json.JSONDecodeError, OSError):
            continue
        if not isinstance(course, dict) or "name" not in course:
            continue
        old = course["name"]
        new = tidy_name(old)
        if new == old:
            continue
        changes.append((f, old, new))
        if not dry_run:
            course["name"] = new
            text = json.dumps(course, indent=2, ensure_ascii=False)
            if raw.endswith("\n"):
                text += "\n"
            f.write_text(text, encoding="utf-8")
    return changes


def main() -> None:
    parser = argparse.ArgumentParser(description="Tidy 'X - X' style course names")
    parser.add_argument("files", nargs="*", help="Course JSON files (default: all of courses/)")
    parser.add_argument("--dry-run", action="store_true", help="Show changes, write nothing")
    args = parser.parse_args()

    paths = [Path(f) for f in args.files] if args.files else sorted(COURSES_DIR.glob("*.json"), key=lambda p: p.name)
    changes = process(paths, args.dry_run)
    for f, old, new in changes:
        print(f"{f.name}: {old!r} -> {new!r}")
    print(f"{'Would change' if args.dry_run else 'Changed'} {len(changes)} of {len(paths)} files")


if __name__ == "__main__":
    main()
