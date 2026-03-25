#!/usr/bin/env python3
"""
Validate a rowing course JSON file against the schema and geometric constraints.
Exit 0 on success, non-zero with human-readable error on failure.
Uses only stdlib: json, math, itertools — no external APIs.
"""

import json
import math
import sys
from itertools import combinations
from pathlib import Path

# Earth radius in meters for haversine
EARTH_RADIUS = 6_371_000

# Validation limits from spec
MIN_COURSE_LENGTH_M = 100
MAX_COURSE_LENGTH_M = 25_000
# Max gap between consecutive polygon centroids (catches coordinate typos; 5k head races have ~5k gap)
MAX_CONSECUTIVE_GAP_M = 25_000


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in meters between two WGS84 points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS * c


def polygon_centroid(points: list[dict]) -> tuple[float, float]:
    """Return (lat, lon) centroid of polygon points."""
    n = len(points)
    if n == 0:
        raise ValueError("Empty polygon")
    lat_sum = sum(p["lat"] for p in points)
    lon_sum = sum(p["lon"] for p in points)
    return lat_sum / n, lon_sum / n


def polygon_area_signed(points: list[dict]) -> float:
    """
    Signed area using shoelace formula in (lon, lat) space.
    Returns non-zero if polygon has distinct area (handles degenerate/collinear).
    """
    n = len(points)
    if n < 3:
        return 0
    total = 0
    for i in range(n):
        j = (i + 1) % n
        total += points[i]["lon"] * points[j]["lat"]
        total -= points[j]["lon"] * points[i]["lat"]
    return total / 2


def segments_intersect(a1: dict, a2: dict, b1: dict, b2: dict) -> bool:
    """
    Check if segment a1-a2 intersects segment b1-b2 (excluding shared endpoints).
    Uses cross-product orientation; handles proper intersections and T-intersections
    (one endpoint lying on the other segment).
    """
    def cross(o, a, b):
        return (a["lon"] - o["lon"]) * (b["lat"] - o["lat"]) - (a["lat"] - o["lat"]) * (b["lon"] - o["lon"])

    def on_segment(p, q, r):
        return (
            min(q["lat"], r["lat"]) <= p["lat"] <= max(q["lat"], r["lat"])
            and min(q["lon"], r["lon"]) <= p["lon"] <= max(q["lon"], r["lon"])
        )

    o1 = cross(a1, a2, b1)
    o2 = cross(a1, a2, b2)
    o3 = cross(b1, b2, a1)
    o4 = cross(b1, b2, a2)

    # General case: proper crossing intersection
    if (o1 * o2 < 0) and (o3 * o4 < 0):
        return True

    # Collinear / T-intersection: check each endpoint against the other segment
    if o1 == 0 and on_segment(b1, a1, a2):
        return True
    if o2 == 0 and on_segment(b2, a1, a2):
        return True
    if o3 == 0 and on_segment(a1, b1, b2):
        return True
    if o4 == 0 and on_segment(a2, b1, b2):
        return True

    return False


def polygon_self_intersects(points: list[dict]) -> bool:
    """Check if polygon has self-intersecting edges."""
    n = len(points)
    if n < 4:
        return False
    edges = [(i, (i + 1) % n) for i in range(n)]
    for (i, j), (k, l) in combinations(edges, 2):
        if i == k or i == l or j == k or j == l:
            continue
        if segments_intersect(points[i], points[j], points[k], points[l]):
            return True
    return False


def point_in_polygon(pt: dict, points: list[dict]) -> bool:
    """Ray casting: true if pt is inside polygon."""
    n = len(points)
    if n < 3:
        return False
    x, y = pt["lon"], pt["lat"]
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = points[i]["lon"], points[i]["lat"]
        xj, yj = points[j]["lon"], points[j]["lat"]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def bboxes_overlap(a: list[dict], b: list[dict]) -> bool:
    """Bounding box overlap check."""
    def box(points):
        lats = [p["lat"] for p in points]
        lons = [p["lon"] for p in points]
        return min(lats), max(lats), min(lons), max(lons)

    min_a, max_a, minlon_a, maxlon_a = box(a)
    min_b, max_b, minlon_b, maxlon_b = box(b)
    if max_a < min_b or max_b < min_a:
        return False
    if maxlon_a < minlon_b or maxlon_b < minlon_a:
        return False
    return True


def polygons_overlap(points_a: list[dict], points_b: list[dict]) -> bool:
    """True if polygons overlap (intersect or one contains the other)."""
    if not bboxes_overlap(points_a, points_b):
        return False
    for pt in points_a:
        if point_in_polygon(pt, points_b):
            return True
    for pt in points_b:
        if point_in_polygon(pt, points_a):
            return True
    na, nb = len(points_a), len(points_b)
    for i in range(na):
        for j in range(nb):
            a1, a2 = points_a[i], points_a[(i + 1) % na]
            b1, b2 = points_b[j], points_b[(j + 1) % nb]
            if segments_intersect(a1, a2, b1, b2):
                return True
    return False


def validate_course(path: Path) -> tuple[bool, str]:
    """
    Validate course file. Returns (ok, message).
    """
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"
    except OSError as e:
        return False, f"Could not read file: {e}"

    if not isinstance(data, dict):
        return False, "Course file must be a JSON object"

    # Required fields
    required = ["id", "name", "country", "center_lat", "center_lon", "distance_m", "status", "polygons"]
    for key in required:
        if key not in data:
            return False, f"Missing required field: {key}"

    if data["status"] not in ("provisional", "established"):
        return False, f"Invalid status: {data['status']}"

    polygons = data["polygons"]
    if not isinstance(polygons, list):
        return False, "polygons must be an array"
    if len(polygons) < 2:
        return False, "At least two polygons required"

    # Sort by order for consistent processing
    polygons = sorted(polygons, key=lambda p: p.get("order", 0))

    pts_list = []  # deduplicated points used for all geometric checks

    for i, poly in enumerate(polygons):
        if "name" not in poly or "order" not in poly or "points" not in poly:
            return False, f"Polygon {i}: missing name, order, or points"
        pts = poly["points"]
        if not isinstance(pts, list):
            return False, f"Polygon {i} ({poly['name']}): points must be array"
        for j, p in enumerate(pts):
            if "lat" not in p or "lon" not in p:
                return False, f"Polygon {i} ({poly['name']}) point {j}: lat and lon required"
            if not isinstance(p["lat"], (int, float)) or not isinstance(p["lon"], (int, float)):
                return False, f"Polygon {i} ({poly['name']}) point {j}: lat/lon must be numbers"

        # Remove duplicate closing vertex (KML closed-ring encoding: first == last)
        if len(pts) >= 2 and pts[0]["lat"] == pts[-1]["lat"] and pts[0]["lon"] == pts[-1]["lon"]:
            pts = pts[:-1]

        if len(pts) < 3:
            return False, f"Polygon {i} ({poly['name']}): at least 3 points required"

        area = polygon_area_signed(pts)
        if abs(area) < 1e-12:
            return False, f"Polygon {i} ({poly['name']}): zero area (degenerate)"

        if polygon_self_intersects(pts):
            return False, f"Polygon {i} ({poly['name']}): self-intersecting edges"

        pts_list.append(pts)

    # pts_list is guaranteed complete here: any polygon failure returns early above.

    # Distance sanity
    centroids = [polygon_centroid(pts) for pts in pts_list]
    total_length = 0
    for i in range(len(centroids) - 1):
        d = haversine_m(centroids[i][0], centroids[i][1], centroids[i + 1][0], centroids[i + 1][1])
        if d > MAX_CONSECUTIVE_GAP_M:
            return False, f"Consecutive polygon gap {d:.0f}m > {MAX_CONSECUTIVE_GAP_M}m (between polygon {i} and {i+1})"
        total_length += d

    if total_length < MIN_COURSE_LENGTH_M:
        return False, f"Course length {total_length:.0f}m < {MIN_COURSE_LENGTH_M}m"
    if total_length > MAX_COURSE_LENGTH_M:
        return False, f"Course length {total_length:.0f}m > {MAX_COURSE_LENGTH_M}m"

    # No polygon overlap
    for i, j in combinations(range(len(polygons)), 2):
        if polygons_overlap(pts_list[i], pts_list[j]):
            return False, f"Polygons {i} ({polygons[i]['name']}) and {j} ({polygons[j]['name']}) overlap"

    return True, "OK"


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: validate_course.py <course.json> [course2.json ...]", file=sys.stderr)
        sys.exit(2)

    all_ok = True
    for p in sys.argv[1:]:
        path = Path(p)
        if not path.exists():
            print(f"{path}: file not found", file=sys.stderr)
            all_ok = False
            continue
        ok, msg = validate_course(path)
        if ok:
            print(f"{path}: OK")
        else:
            print(f"{path}: {msg}", file=sys.stderr)
            all_ok = False

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
