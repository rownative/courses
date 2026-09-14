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
    PATH_GATE_TOLERANCE_M,
    POLYGON_EXTENT_WARN_M,
    course_warnings,
    polygon_chain_length_m,
    strip_duplicate_closing_vertex,
    validate_course_detailed,
    haversine_m,
    path_length_m,
    path_min_distance_m,
    point_to_segment_m,
    polygon_centroid,
    polygon_area_signed,
    polygon_extent_m,
    polygon_self_intersects,
    point_in_polygon,
    bboxes_overlap,
    polygons_overlap,
    segments_intersect,
    validate_course,
    validate_path,
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


class TestStripDuplicateClosingVertex:
    TRI = [{"lat": 0, "lon": 0}, {"lat": 1, "lon": 0}, {"lat": 0.5, "lon": 1}]

    def test_open_ring_unchanged(self):
        assert strip_duplicate_closing_vertex(self.TRI) == self.TRI

    def test_closing_vertex_dropped(self):
        assert strip_duplicate_closing_vertex(self.TRI + [dict(self.TRI[0])]) == self.TRI

    def test_consecutive_duplicates_dropped(self):
        ring = [self.TRI[0], dict(self.TRI[0]), self.TRI[1], self.TRI[2], dict(self.TRI[2])]
        assert strip_duplicate_closing_vertex(ring) == self.TRI

    def test_duplicates_then_closing_vertex(self):
        ring = [self.TRI[0], self.TRI[1], dict(self.TRI[1]), self.TRI[2], dict(self.TRI[0])]
        assert strip_duplicate_closing_vertex(ring) == self.TRI

    def test_non_consecutive_repeat_kept(self):
        # A genuine revisit of a vertex is geometry, not a KML artefact
        ring = [self.TRI[0], self.TRI[1], self.TRI[2], {"lat": 0.2, "lon": 0.2}, dict(self.TRI[1])]
        assert len(strip_duplicate_closing_vertex(ring)) == 5


class TestCourseWarnings:
    def test_clean_course_has_no_warnings(self):
        assert course_warnings(VALID_COURSE) == []

    def test_oversized_polygon_warned(self):
        data = copy.deepcopy(VALID_COURSE)
        data["polygons"][1]["points"] = [
            {"lat": 52.3520, "lon": 4.9300},
            {"lat": 52.3520, "lon": 4.9400},  # ~680 m east
            {"lat": 52.3515, "lon": 4.9350},
        ]
        data["distance_m"] = round(polygon_chain_length_m(data["polygons"]))
        ws = course_warnings(data)
        assert len(ws) == 1
        assert "Finish" in ws[0] and f"> {POLYGON_EXTENT_WARN_M}m" in ws[0]

    def test_path_like_polygon_warned(self):
        data = copy.deepcopy(VALID_COURSE)
        # 14 vertices spread over ~2 km: a traced route, not a gate
        data["polygons"][1]["points"] = [{"lat": 52.352 + i * 0.0015, "lon": 4.93 + (i % 2) * 0.0003} for i in range(14)]
        data["distance_m"] = round(polygon_chain_length_m(data["polygons"]))
        ws = course_warnings(data)
        assert any("traced route" in w and "`path`" in w for w in ws)

    def test_order_anomaly_warned(self):
        data = copy.deepcopy(VALID_COURSE)
        data["polygons"][1]["order"] = 5
        ws = course_warnings(data)
        assert any("polygon orders" in w for w in ws)

    def test_distance_mismatch_warned(self):
        data = copy.deepcopy(VALID_COURSE)
        data["distance_m"] = 5000  # chain is ~300 m
        ws = course_warnings(data)
        assert any("distance_m is 5000" in w for w in ws)

    def test_small_distance_difference_tolerated(self):
        data = copy.deepcopy(VALID_COURSE)
        data["distance_m"] = round(polygon_chain_length_m(data["polygons"])) + 20
        assert course_warnings(data) == []


class TestPolygonExtent:
    def test_two_points_is_their_distance(self):
        pts = [{"lat": 52.0, "lon": 4.0}, {"lat": 52.0, "lon": 4.001}]
        assert abs(polygon_extent_m(pts) - haversine_m(52.0, 4.0, 52.0, 4.001)) < 1e-6

    def test_closing_vertex_ignored(self):
        pts = [{"lat": 0, "lon": 0}, {"lat": 0, "lon": 0.001}, {"lat": 0.001, "lon": 0}]
        closed = pts + [dict(pts[0])]
        assert polygon_extent_m(closed) == polygon_extent_m(pts)

    def test_single_point_is_zero(self):
        assert polygon_extent_m([{"lat": 1, "lon": 1}]) == 0


class TestPointToSegment:
    def test_point_on_segment_is_zero(self):
        a, b = {"lat": 52.0, "lon": 4.0}, {"lat": 52.0, "lon": 4.01}
        assert point_to_segment_m(52.0, 4.005, a, b) < 0.01

    def test_perpendicular_distance(self):
        a, b = {"lat": 52.0, "lon": 4.0}, {"lat": 52.0, "lon": 4.01}
        # 0.001 deg of latitude is ~111 m
        d = point_to_segment_m(52.001, 4.005, a, b)
        assert 110 < d < 112

    def test_beyond_endpoint_measures_to_endpoint(self):
        a, b = {"lat": 52.0, "lon": 4.0}, {"lat": 52.0, "lon": 4.01}
        d = point_to_segment_m(52.0, 4.02, a, b)
        assert abs(d - haversine_m(52.0, 4.02, 52.0, 4.01)) < 1.0

    def test_degenerate_segment(self):
        a = {"lat": 52.0, "lon": 4.0}
        d = point_to_segment_m(52.001, 4.0, a, a)
        assert 110 < d < 112


class TestPathHelpers:
    PATH = [{"lat": 52.0, "lon": 4.0}, {"lat": 52.0, "lon": 4.01}, {"lat": 52.01, "lon": 4.01}]

    def test_min_distance_picks_nearest_segment(self):
        d = path_min_distance_m(self.PATH, 52.005, 4.0101)
        assert d < 10

    def test_min_distance_single_point_path(self):
        d = path_min_distance_m([{"lat": 52.0, "lon": 4.0}], 52.001, 4.0)
        assert 110 < d < 112

    def test_path_length(self):
        expected = haversine_m(52.0, 4.0, 52.0, 4.01) + haversine_m(52.0, 4.01, 52.01, 4.01)
        assert abs(path_length_m(self.PATH) - expected) < 1e-6
        assert path_length_m(self.PATH[:1]) == 0


# Path running through both VALID_COURSE gates (start centroid ~52.35, 4.9275; finish ~52.352, 4.9305)
VALID_PATH = [
    {"lat": 52.3498, "lon": 4.9272},
    {"lat": 52.3510, "lon": 4.9290},
    {"lat": 52.3522, "lon": 4.9308},
]


class TestValidatePath:
    polygons = VALID_COURSE["polygons"]

    def test_valid_path_accepted(self):
        assert validate_path(VALID_PATH, self.polygons) is None

    def test_not_a_list(self):
        assert "array" in validate_path({"lat": 1, "lon": 2}, self.polygons)

    def test_too_few_points(self):
        assert "at least 2" in validate_path(VALID_PATH[:1], self.polygons)

    def test_point_missing_lon(self):
        bad = [dict(VALID_PATH[0]), {"lat": 52.351}, dict(VALID_PATH[2])]
        assert "lat and lon required" in validate_path(bad, self.polygons)

    def test_point_not_numeric(self):
        bad = [dict(VALID_PATH[0]), {"lat": "52.351", "lon": 4.929}, dict(VALID_PATH[2])]
        assert "must be numbers" in validate_path(bad, self.polygons)

    def test_bool_rejected_as_number(self):
        bad = [dict(VALID_PATH[0]), {"lat": True, "lon": 4.929}, dict(VALID_PATH[2])]
        assert "must be numbers" in validate_path(bad, self.polygons)

    def test_point_out_of_range(self):
        bad = [dict(VALID_PATH[0]), {"lat": 95.0, "lon": 4.929}, dict(VALID_PATH[2])]
        assert "out of range" in validate_path(bad, self.polygons)

    def test_huge_gap_rejected(self):
        bad = [dict(VALID_PATH[0]), {"lat": 0.0, "lon": 0.0}, dict(VALID_PATH[2])]
        assert "gap" in validate_path(bad, self.polygons)

    def test_path_missing_a_gate_rejected(self):
        # Runs 2 km east of both gates
        far = [{"lat": 52.3498, "lon": 4.9572}, {"lat": 52.3522, "lon": 4.9608}]
        msg = validate_path(far, self.polygons)
        assert msg is not None
        assert "passes" in msg and "Start" in msg
        assert f"within {PATH_GATE_TOLERANCE_M}m" in msg

    def test_wide_gate_uses_its_own_extent_as_tolerance(self):
        # A 1 km wide gate: path 400 m from centroid is still acceptable
        wide = [
            {"name": "Start", "order": 0, "points": [
                {"lat": 52.3500, "lon": 4.9200},
                {"lat": 52.3500, "lon": 4.9347},   # ~1 km east
                {"lat": 52.3495, "lon": 4.9270},
            ]},
        ]
        path = [{"lat": 52.3460, "lon": 4.9200}, {"lat": 52.3460, "lon": 4.9350}]  # ~430 m south
        assert validate_path(path, wide) is None


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

    def test_course_with_valid_path_passes(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["path"] = VALID_PATH
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg = validate_course(path)
        assert ok is True, msg

    def test_course_with_null_path_passes(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["path"] = None
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg = validate_course(path)
        assert ok is True, msg

    def test_course_with_bad_path_fails(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["path"] = [{"lat": 52.3498, "lon": 4.9272}]
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg = validate_course(path)
        assert ok is False
        assert "path" in msg

    def test_course_with_path_missing_gate_fails(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["path"] = [{"lat": 52.3498, "lon": 4.9572}, {"lat": 52.3522, "lon": 4.9608}]
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg = validate_course(path)
        assert ok is False
        assert "passes" in msg

    def test_consecutive_duplicate_vertices_accepted(self, tmp_path):
        """KML exports often repeat a vertex; the zero-length edge must not read as self-intersection."""
        data = copy.deepcopy(VALID_COURSE)
        pts = data["polygons"][0]["points"]
        data["polygons"][0]["points"] = [pts[0], dict(pts[0]), pts[1], pts[2], dict(pts[2])]
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg = validate_course(path)
        assert ok is True, msg

    def test_detailed_returns_warnings_for_valid_course(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["distance_m"] = 5000
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg, warnings = validate_course_detailed(path)
        assert ok is True and msg == "OK"
        assert len(warnings) == 1 and "distance_m" in warnings[0]

    def test_detailed_returns_no_warnings_for_invalid_course(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["status"] = "bogus"
        path = tmp_path / "course.json"
        write_course(path, data)
        ok, msg, warnings = validate_course_detailed(path)
        assert ok is False and warnings == []

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
