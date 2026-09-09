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


def test_course_without_path_has_no_linestring():
    kml = course_to_kml(MINIMAL_COURSE, cn=True)
    assert "LineString" not in kml


def test_course_with_path_emits_linestring_after_polygons():
    course = dict(MINIMAL_COURSE)
    course["path"] = [
        {"lat": 52.0003, "lon": 4.9003},
        {"lat": 52.005, "lon": 4.905},
        {"lat": 52.0103, "lon": 4.9103},
    ]
    kml = course_to_kml(course, cn=True)
    assert kml.count("<LineString>") == 1
    assert "<name>Path</name>" in kml
    assert "4.9003,52.0003,0 4.905,52.005,0 4.9103,52.0103,0" in kml
    assert kml.rfind("<Polygon>") < kml.find("<LineString>")


def test_include_path_false_omits_linestring():
    course = dict(MINIMAL_COURSE)
    course["path"] = [{"lat": 52.0, "lon": 4.9}, {"lat": 52.01, "lon": 4.91}]
    kml = course_to_kml(course, cn=True, include_path=False)
    assert "LineString" not in kml


def test_single_point_path_is_ignored():
    course = dict(MINIMAL_COURSE)
    course["path"] = [{"lat": 52.0, "lon": 4.9}]
    kml = course_to_kml(course, cn=True)
    assert "LineString" not in kml
