"""
Tests for validate_course.py
Run with: pytest scripts/test_validate_course.py -v
"""

import copy
import json
import sys
from pathlib import Path

import pytest

# Add scripts to path so we can import validate_course
sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_course import (
    haversine_m,
    polygon_centroid,
    polygon_area_signed,
    polygon_self_intersects,
    point_in_polygon,
    bboxes_overlap,
    polygons_overlap,
    segments_intersect,
    validate_course,
)

# Minimal valid course: two non-overlapping polygons ~300m apart
VALID_COURSE = {
    "id": "001",
    "name": "Test Course",
    "country": "NL",
    "center_lat": 52.3512,
    "center_lon": 4.9284,
    "distance_m": 300,
    "status": "provisional",
    "polygons": [
        {
            "name": "Start",
            "order": 0,
            "points": [
                {"lat": 52.3500, "lon": 4.9270},
                {"lat": 52.3505, "lon": 4.9275},
                {"lat": 52.3495, "lon": 4.9280},
            ],
        },
        {
            "name": "Finish",
            "order": 1,
            "points": [
                {"lat": 52.3520, "lon": 4.9300},
                {"lat": 52.3525, "lon": 4.9305},
                {"lat": 52.3515, "lon": 4.9310},
            ],
        },
    ],
}


def write_course(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


# --- Unit tests for helper functions ---


class TestHaversine:
    def test_same_point_returns_zero(self):
        assert haversine_m(52.0, 4.0, 52.0, 4.0) == 0

    def test_known_distance(self):
        # Amsterdam to Rotterdam ~58 km
        d = haversine_m(52.3676, 4.9041, 51.9244, 4.4777)
        assert 57_000 < d < 59_000


class TestPolygonCentroid:
    def test_triangle_centroid(self):
        pts = [{"lat": 0, "lon": 0}, {"lat": 1, "lon": 0}, {"lat": 0.5, "lon": 1}]
        lat, lon = polygon_centroid(pts)
        assert abs(lat - 0.5) < 1e-9
        assert abs(lon - 1 / 3) < 1e-9

    def test_empty_polygon_raises(self):
        with pytest.raises(ValueError, match="Empty polygon"):
            polygon_centroid([])


class TestPolygonAreaSigned:
    def test_triangle_has_nonzero_area(self):
        pts = [{"lat": 0, "lon": 0}, {"lat": 1, "lon": 0}, {"lat": 0.5, "lon": 1}]
        assert abs(polygon_area_signed(pts)) > 0.1

    def test_less_than_three_points_returns_zero(self):
        assert polygon_area_signed([{"lat": 0, "lon": 0}]) == 0
        assert polygon_area_signed([{"lat": 0, "lon": 0}, {"lat": 1, "lon": 0}]) == 0

    def test_collinear_points_return_zero(self):
        pts = [{"lat": 0, "lon": 0}, {"lat": 1, "lon": 1}, {"lat": 2, "lon": 2}]
        assert abs(polygon_area_signed(pts)) < 1e-12


class TestPolygonSelfIntersects:
    def test_triangle_does_not_self_intersect(self):
        pts = [{"lat": 0, "lon": 0}, {"lat": 1, "lon": 0}, {"lat": 0.5, "lon": 1}]
        assert polygon_self_intersects(pts) is False

    def test_bowtie_self_intersects(self):
        # Bowtie: (0,0)-(1,1) crosses (0,1)-(1,0)
        pts = [
            {"lat": 0, "lon": 0},
            {"lat": 1, "lon": 1},
            {"lat": 1, "lon": 0},
            {"lat": 0, "lon": 1},
        ]
        assert polygon_self_intersects(pts) is True


class TestPointInPolygon:
    def test_inside_triangle(self):
        pts = [{"lat": 0, "lon": 0}, {"lat": 1, "lon": 0}, {"lat": 0.5, "lon": 1}]
        assert point_in_polygon({"lat": 0.5, "lon": 0.3}, pts) is True

    def test_outside_triangle(self):
        pts = [{"lat": 0, "lon": 0}, {"lat": 1, "lon": 0}, {"lat": 0.5, "lon": 1}]
        assert point_in_polygon({"lat": 2, "lon": 2}, pts) is False


class TestBboxesOverlap:
    def test_overlapping_boxes(self):
        a = [{"lat": 0, "lon": 0}, {"lat": 2, "lon": 2}]
        b = [{"lat": 1, "lon": 1}, {"lat": 3, "lon": 3}]
        assert bboxes_overlap(a, b) is True

    def test_non_overlapping_boxes(self):
        a = [{"lat": 0, "lon": 0}, {"lat": 1, "lon": 1}]
        b = [{"lat": 5, "lon": 5}, {"lat": 6, "lon": 6}]
        assert bboxes_overlap(a, b) is False


class TestPolygonsOverlap:
    def test_separate_polygons_do_not_overlap(self):
        a = [
            {"lat": 52.35, "lon": 4.927},
            {"lat": 52.3505, "lon": 4.9275},
            {"lat": 52.3495, "lon": 4.928},
        ]
        b = [
            {"lat": 52.352, "lon": 4.93},
            {"lat": 52.3525, "lon": 4.9305},
            {"lat": 52.3515, "lon": 4.931},
        ]
        assert polygons_overlap(a, b) is False


class TestSegmentsIntersect:
    """Segment intersection in (lat, lon) as used by validate_course."""

    def test_proper_crossing(self):
        a1, a2 = {"lat": 0, "lon": 0}, {"lat": 2, "lon": 2}
        b1, b2 = {"lat": 0, "lon": 2}, {"lat": 2, "lon": 0}
        assert segments_intersect(a1, a2, b1, b2) is True

    def test_parallel_disjoint(self):
        a1, a2 = {"lat": 0, "lon": 0}, {"lat": 0, "lon": 2}
        b1, b2 = {"lat": 1, "lon": 0}, {"lat": 1, "lon": 2}
        assert segments_intersect(a1, a2, b1, b2) is False

    def test_t_intersection(self):
        a1, a2 = {"lat": 0, "lon": 0}, {"lat": 0, "lon": 2}
        b1, b2 = {"lat": 0, "lon": 1}, {"lat": 1, "lon": 1}
        assert segments_intersect(a1, a2, b1, b2) is True

    def test_collinear_overlapping(self):
        a1, a2 = {"lat": 0, "lon": 0}, {"lat": 0, "lon": 2}
        b1, b2 = {"lat": 0, "lon": 1}, {"lat": 0, "lon": 3}
        assert segments_intersect(a1, a2, b1, b2) is True

    def test_collinear_disjoint(self):
        a1, a2 = {"lat": 0, "lon": 0}, {"lat": 0, "lon": 1}
        b1, b2 = {"lat": 0, "lon": 2}, {"lat": 0, "lon": 3}
        assert segments_intersect(a1, a2, b1, b2) is False


# --- Integration tests for validate_course ---


class TestValidateCourse:
    def test_valid_course_passes(self, tmp_path):
        path = tmp_path / "course.json"
        write_course(path, VALID_COURSE)
        ok, msg = validate_course(path)
        assert ok is True
        assert msg == "OK"

    def test_missing_required_field(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        del data["id"]
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg = validate_course(path)
        assert ok is False
        assert "Missing required field" in msg

    def test_invalid_status(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["status"] = "invalid"
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg = validate_course(path)
        assert ok is False
        assert "Invalid status" in msg

    def test_fewer_than_two_polygons(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["polygons"] = [data["polygons"][0]]
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg = validate_course(path)
        assert ok is False
        assert "At least two polygons" in msg

    def test_polygon_with_fewer_than_three_points(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["polygons"][0]["points"] = [{"lat": 0, "lon": 0}, {"lat": 1, "lon": 0}]
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg = validate_course(path)
        assert ok is False
        assert "at least 3 points" in msg

    def test_invalid_json(self, tmp_path):
        path = tmp_path / "course.json"
        path.write_text("{ invalid json", encoding="utf-8")
        ok, msg = validate_course(path)
        assert ok is False
        assert "Invalid JSON" in msg

    def test_json_array_rejected(self, tmp_path):
        path = tmp_path / "course.json"
        path.write_text("[1, 2, 3]", encoding="utf-8")
        ok, msg = validate_course(path)
        assert ok is False
        assert "object" in msg.lower()

    def test_closed_ring_polygon_accepted(self, tmp_path):
        """KML-style ring with first point repeated at end should validate."""
        data = copy.deepcopy(VALID_COURSE)
        for poly in data["polygons"]:
            pts = poly["points"]
            first = pts[0]
            poly["points"] = pts + [dict(first)]
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg = validate_course(path)
        assert ok is True, msg
        assert msg == "OK"

    def test_nonexistent_file(self, tmp_path):
        path = tmp_path / "nonexistent.json"
        ok, msg = validate_course(path)
        assert ok is False
        assert "Could not read" in msg or "file not found" in msg.lower()

    def test_real_course_from_repo(self):
        """Test against an actual course file if it exists."""
        repo_root = Path(__file__).resolve().parent.parent
        course_file = repo_root / "courses" / "1.json"
        if course_file.exists():
            ok, msg = validate_course(course_file)
            assert ok is True, msg
            assert msg == "OK"
