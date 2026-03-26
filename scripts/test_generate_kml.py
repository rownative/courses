"""Smoke tests for generate_kml.course_to_kml."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_kml import course_to_kml


MINIMAL_COURSE = {
    "id": "999",
    "name": "Smoke Test Course",
    "country": "NL",
    "center_lat": 52.0,
    "center_lon": 4.9,
    "distance_m": 500,
    "status": "provisional",
    "polygons": [
        {
            "name": "Start",
            "order": 0,
            "points": [
                {"lat": 52.0, "lon": 4.9},
                {"lat": 52.001, "lon": 4.9},
                {"lat": 52.0, "lon": 4.901},
            ],
        },
        {
            "name": "Finish",
            "order": 1,
            "points": [
                {"lat": 52.01, "lon": 4.91},
                {"lat": 52.011, "lon": 4.91},
                {"lat": 52.01, "lon": 4.911},
            ],
        },
    ],
}


def test_course_to_kml_contains_kml_structure():
    kml = course_to_kml(MINIMAL_COURSE, cn=True)
    assert "<?xml" in kml
    assert "kml" in kml.lower()
    assert "999" in kml or "Smoke Test" in kml
    assert "Placemark" in kml
    assert "coordinates" in kml


def test_course_to_kml_cn_uses_start_finish_names():
    kml = course_to_kml(MINIMAL_COURSE, cn=True)
    assert "Start" in kml
    assert "Finish" in kml
