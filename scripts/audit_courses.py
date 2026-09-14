#!/usr/bin/env python3
"""
Audit the whole course library for data-quality problems that per-file validation
does not (or did not) catch: oversized gate polygons, traced routes stored as polygons,
distance_m disagreeing with the polygon chain, odd polygon ordering, and files that
fail validation outright.

Usage:
  python scripts/audit_courses.py                # text report over courses/
  python scripts/audit_courses.py --extent 400   # list polygons wider than 400 m (default 400)
  python scripts/audit_courses.py --json         # machine-readable report
  python scripts/audit_courses.py courses/257.json courses/277.json

Exit status is always 0; this is a report, not a gate. Uses only stdlib.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_course import (  # noqa: E402
    DISTANCE_MISMATCH_WARN_FRACTION,
    DISTANCE_MISMATCH_WARN_MIN_M,
    PATH_LIKE_MIN_EXTENT_M,
    PATH_LIKE_MIN_VERTICES,
    polygon_chain_length_m,
    polygon_extent_m,
    strip_duplicate_closing_vertex,
    validate_course,
)

COURSES_DIR = Path(__file__).resolve().parent.parent / "courses"
DEFAULT_EXTENT_M = 400


def load_courses(paths: list[Path]) -> list[tuple[Path, dict]]:
    """Load course dicts; skips non-object JSON (index.json etc.) and unreadable files."""
    out = []
    for f in paths:
        try:
            with open(f, encoding="utf-8") as fp:
                data = json.load(fp)
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(data, dict) and "polygons" in data:
            out.append((f, data))
    return out


def percentile(values: list[float], pct: float) -> float:
    """Nearest-rank percentile of a list (0-100). Returns 0 for an empty list."""
    if not values:
        return 0.0
    ordered = sorted(values)
    k = max(0, min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1)))))
    return ordered[k]


def polygon_records(courses: list[tuple[Path, dict]]) -> list[dict]:
    """One record per polygon with its extent and vertex count."""
    records = []
    for f, c in courses:
        polygons = sorted(c["polygons"], key=lambda p: p.get("order", 0))
        for i, poly in enumerate(polygons):
            pts = strip_duplicate_closing_vertex(poly.get("points") or [])
            records.append({
                "course": str(c.get("id", f.stem)),
                "course_name": c.get("name", ""),
                "index": i,
                "polygon": poly.get("name", ""),
                "vertices": len(pts),
                "extent_m": round(polygon_extent_m(pts)) if len(pts) >= 2 else 0,
            })
    return records


def is_path_like(rec: dict) -> bool:
    return rec["vertices"] >= PATH_LIKE_MIN_VERTICES and rec["extent_m"] >= PATH_LIKE_MIN_EXTENT_M


def audit(courses: list[tuple[Path, dict]], extent_threshold_m: float = DEFAULT_EXTENT_M) -> dict:
    """Build the full report as a dict (see keys below)."""
    records = polygon_records(courses)
    path_like = [r for r in records if is_path_like(r)]
    gates = [r for r in records if not is_path_like(r)]
    extents = [r["extent_m"] for r in gates]

    oversized = sorted(
        (r for r in gates if r["extent_m"] > extent_threshold_m),
        key=lambda r: -r["extent_m"],
    )

    distance_mismatch = []
    order_anomalies = []
    for f, c in courses:
        polygons = sorted(c["polygons"], key=lambda p: p.get("order", 0))
        orders = [p.get("order") for p in polygons]
        if polygons and orders != list(range(len(polygons))):
            order_anomalies.append({"course": str(c.get("id", f.stem)), "orders": orders})
        declared = c.get("distance_m")
        if len(polygons) >= 2 and isinstance(declared, (int, float)) and not isinstance(declared, bool):
            chain = polygon_chain_length_m(polygons)
            diff = abs(declared - chain)
            if chain > 0 and diff > DISTANCE_MISMATCH_WARN_MIN_M and diff / chain > DISTANCE_MISMATCH_WARN_FRACTION:
                distance_mismatch.append({
                    "course": str(c.get("id", f.stem)),
                    "course_name": c.get("name", ""),
                    "distance_m": declared,
                    "chain_m": round(chain),
                })

    failures = []
    for f, c in courses:
        ok, msg = validate_course(f)
        if not ok:
            failures.append({"course": str(c.get("id", f.stem)), "error": msg})

    return {
        "courses": len(courses),
        "polygons": len(records),
        "extent_stats_m": {
            "median": percentile(extents, 50),
            "p90": percentile(extents, 90),
            "p99": percentile(extents, 99),
            "max": max(extents) if extents else 0,
        },
        "extent_threshold_m": extent_threshold_m,
        "oversized": oversized,
        "path_like": path_like,
        "distance_mismatch": distance_mismatch,
        "order_anomalies": order_anomalies,
        "validation_failures": failures,
    }


def format_report(report: dict) -> str:
    lines = []
    st = report["extent_stats_m"]
    lines.append(
        f"{report['courses']} courses, {report['polygons']} polygons. Gate extent: "
        f"median {st['median']:.0f} m, p90 {st['p90']:.0f} m, p99 {st['p99']:.0f} m, max {st['max']:.0f} m."
    )

    lines.append("")
    lines.append(f"Polygons wider than {report['extent_threshold_m']:.0f} m ({len(report['oversized'])}):")
    for r in report["oversized"]:
        lines.append(f"  {r['course']:>4}  {r['extent_m']:>5} m  {r['polygon']!r:<28} {r['course_name']}")

    lines.append("")
    lines.append(f"Traced routes stored as polygons ({len(report['path_like'])}); move these to `path`:")
    for r in report["path_like"]:
        lines.append(
            f"  {r['course']:>4}  {r['vertices']:>3} vertices  {r['extent_m']:>5} m  {r['polygon']!r}  {r['course_name']}"
        )

    lines.append("")
    lines.append(f"distance_m disagrees with the polygon chain ({len(report['distance_mismatch'])}):")
    for r in report["distance_mismatch"]:
        lines.append(f"  {r['course']:>4}  distance_m {r['distance_m']:>6}  chain {r['chain_m']:>6} m  {r['course_name']}")

    lines.append("")
    lines.append(f"Polygon order anomalies ({len(report['order_anomalies'])}):")
    for r in report["order_anomalies"]:
        lines.append(f"  {r['course']:>4}  orders {r['orders']}")

    lines.append("")
    lines.append(f"Files failing validation ({len(report['validation_failures'])}):")
    for r in report["validation_failures"]:
        lines.append(f"  {r['course']:>4}  {r['error']}")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit course geometry and metadata quality")
    parser.add_argument("files", nargs="*", help="Course JSON files (default: all of courses/)")
    parser.add_argument("--extent", type=float, default=DEFAULT_EXTENT_M, help="Report polygons wider than this many metres")
    parser.add_argument("--json", action="store_true", help="Emit the report as JSON")
    args = parser.parse_args()

    paths = [Path(f) for f in args.files] if args.files else sorted(COURSES_DIR.glob("*.json"), key=lambda p: p.name)
    report = audit(load_courses(paths), args.extent)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(format_report(report))


if __name__ == "__main__":
    main()
