#!/usr/bin/env python3
"""
Regenerate kml/*.kml from course JSON files.
Port of Rowsandall coursetokml / getcoursefolder logic.
Coordinates: lon,lat,0. Polygons sorted CCW. Optional crewnerdify (Start, WP1.., Finish).
"""

import json
import math
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom import minidom

COURSES_DIR = Path(__file__).resolve().parent.parent / "courses"
KML_DIR = Path(__file__).resolve().parent.parent / "kml"
KML_NS = "http://www.opengis.net/kml/2.2"


def _tag(name: str) -> str:
    """KML namespaced tag."""
    return f"{{{KML_NS}}}{name}"


def get_polar_angle(point: dict, ref_lat: float, ref_lon: float) -> float:
    """Polar angle of point relative to reference (for CCW sort)."""
    return math.atan2(
        point["lat"] - ref_lat,
        point["lon"] - ref_lon,
    )


def sort_coordinates_ccw(points: list[dict]) -> list[dict]:
    """Sort polygon points counterclockwise around centroid."""
    if len(points) < 3:
        return points
    n = len(points)
    cx = sum(p["lat"] for p in points) / n
    cy = sum(p["lon"] for p in points) / n
    return sorted(points, key=lambda p: get_polar_angle(p, cx, cy))


def crewnerdify_names(polygons: list[dict]) -> list[str]:
    """First→Start, last→Finish, intermediates→WP1, WP2, ..."""
    if len(polygons) <= 2:
        return [p["name"] for p in polygons]
    names = ["Start"]
    for i in range(1, len(polygons) - 1):
        names.append(f"WP{i}")
    names.append("Finish")
    return names


def course_to_kml(course: dict, cn: bool = False) -> str:
    """Generate KML string for a single course."""
    top = Element("kml", attrib={"xmlns": KML_NS})
    doc_el = SubElement(top, "Document")
    SubElement(doc_el, "name").text = "courses"
    SubElement(doc_el, "open").text = "1"

    # Styles (Rowsandall cyan fill ff7fffff, outline ff00ffff)
    style = SubElement(doc_el, "Style", id="default")
    SubElement(SubElement(style, "IconStyle"), "scale").text = "1.2"
    SubElement(SubElement(style, "LineStyle"), "color").text = "ff00ffff"
    SubElement(SubElement(style, "PolyStyle"), "color").text = "ff7fffff"

    stylemap = SubElement(doc_el, "StyleMap", attrib={"id": "default0"})
    p1 = SubElement(stylemap, "Pair")
    SubElement(p1, "key").text = "normal"
    SubElement(p1, "styleUrl").text = "#default"
    p2 = SubElement(stylemap, "Pair")
    SubElement(p2, "key").text = "highlight"
    SubElement(p2, "styleUrl").text = "#hl"

    style_hl = SubElement(doc_el, "Style", attrib={"id": "hl"})
    SubElement(SubElement(style_hl, "IconStyle"), "scale").text = "1.2"
    SubElement(SubElement(style_hl, "LineStyle"), "color").text = "ff00ffff"
    SubElement(SubElement(style_hl, "PolyStyle"), "color").text = "ff7fffff"

    # Course folder
    folder = SubElement(doc_el, "Folder", id=str(course["id"]))
    SubElement(folder, "name").text = course["name"]
    SubElement(folder, "open").text = "1"
    desc = SubElement(folder, "description")
    notes = (course.get("notes") or "").strip()
    desc.text = f"rownative.icu\n{notes}" if notes else f"rownative.icu {course['name']}"

    polygons = sorted(course["polygons"], key=lambda p: p.get("order", 0))
    names = crewnerdify_names(polygons) if cn else [p["name"] for p in polygons]

    for idx, poly in enumerate(polygons):
        pm = SubElement(folder, "Placemark")
        SubElement(pm, "name").text = names[idx]
        SubElement(pm, "description").text = poly["name"]
        SubElement(pm, "styleUrl").text = "#default0"
        poly_el = SubElement(pm, "Polygon")
        SubElement(poly_el, "tessellate").text = "1"
        ring = SubElement(SubElement(poly_el, "outerBoundaryIs"), "LinearRing")
        coords_el = SubElement(ring, "coordinates")

        pts = sort_coordinates_ccw(poly["points"])
        coord_strs = [f"{p['lon']},{p['lat']},0" for p in pts]
        # Close ring (repeat first point)
        if len(pts) > 1 and (pts[0]["lat"] != pts[-1]["lat"] or pts[0]["lon"] != pts[-1]["lon"]):
            coord_strs.append(f"{pts[0]['lon']},{pts[0]['lat']},0")
        coords_el.text = " ".join(coord_strs)

    rough = tostring(top, encoding="unicode", method="xml")
    return minidom.parseString(rough).toprettyxml(indent="  ")


def main() -> None:
    KML_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    for f in sorted(COURSES_DIR.glob("*.json"), key=lambda p: p.name):
        if f.name == "index.json":
            continue
        try:
            with open(f, encoding="utf-8") as fp:
                course = json.load(fp)
        except (json.JSONDecodeError, OSError):
            continue
        if "id" not in course or "polygons" not in course:
            continue
        kml = course_to_kml(course, cn=True)  # CrewNerd naming for cached KML
        out = KML_DIR / f"{course['id']}.kml"
        out.write_text(kml, encoding="utf-8")
        count += 1
    print(f"Wrote {count} KML files to {KML_DIR}")


if __name__ == "__main__":
    main()
