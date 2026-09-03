"""Tests for audit_courses.py"""

import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_courses import audit, format_report, is_path_like, load_courses, percentile, polygon_records
from test_validate_course import VALID_COURSE


def write(tmp_path: Path, name: str, data) -> Path:
    p = tmp_path / name
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


class TestPercentile:
    def test_empty(self):
        assert percentile([], 50) == 0

    def test_median_and_extremes(self):
        vals = [10, 20, 30, 40, 50]
        assert percentile(vals, 0) == 10
        assert percentile(vals, 50) == 30
        assert percentile(vals, 100) == 50

    def test_unsorted_input(self):
        assert percentile([50, 10, 30], 50) == 30


class TestLoadCourses:
    def test_skips_non_object_and_invalid_json(self, tmp_path):
        good = write(tmp_path, "1.json", VALID_COURSE)
        write(tmp_path, "index.json", [{"id": "1"}])
        bad = tmp_path / "bad.json"
        bad.write_text("{ nope", encoding="utf-8")
        loaded = load_courses([good, tmp_path / "index.json", bad])
        assert [f for f, _ in loaded] == [good]


class TestAudit:
    def test_clean_library_reports_nothing(self, tmp_path):
        f = write(tmp_path, "1.json", VALID_COURSE)
        report = audit(load_courses([f]))
        assert report["courses"] == 1
        assert report["polygons"] == 2
        assert report["oversized"] == []
        assert report["path_like"] == []
        assert report["distance_mismatch"] == []
        assert report["order_anomalies"] == []
        assert report["validation_failures"] == []
        text = format_report(report)
        assert "1 courses, 2 polygons" in text

    def test_path_like_polygon_is_separated_from_gate_stats(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["polygons"].append({
            "name": "Route",
            "order": 2,
            "points": [{"lat": 52.352 + i * 0.002, "lon": 4.94 + (i % 2) * 0.0003} for i in range(15)],
        })
        f = write(tmp_path, "2.json", data)
        report = audit(load_courses([f]))
        assert len(report["path_like"]) == 1
        assert report["path_like"][0]["polygon"] == "Route"
        assert report["extent_stats_m"]["max"] < 200  # gate stats exclude the ~3 km route
        assert "Route" in format_report(report)

    def test_oversized_gate_and_threshold(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["polygons"][1]["points"] = [
            {"lat": 52.3520, "lon": 4.9300},
            {"lat": 52.3520, "lon": 4.9400},
            {"lat": 52.3515, "lon": 4.9350},
        ]
        f = write(tmp_path, "3.json", data)
        assert len(audit(load_courses([f]), extent_threshold_m=400)["oversized"]) == 1
        assert audit(load_courses([f]), extent_threshold_m=1000)["oversized"] == []

    def test_distance_mismatch_and_order_anomaly(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["distance_m"] = 9999
        data["polygons"][1]["order"] = 7
        f = write(tmp_path, "4.json", data)
        report = audit(load_courses([f]))
        assert report["distance_mismatch"][0]["distance_m"] == 9999
        assert report["order_anomalies"][0]["orders"] == [0, 7]

    def test_validation_failure_listed(self, tmp_path):
        data = copy.deepcopy(VALID_COURSE)
        data["polygons"] = data["polygons"][:1]
        f = write(tmp_path, "5.json", data)
        report = audit(load_courses([f]))
        assert report["validation_failures"] == [{"course": "001", "error": "At least two polygons required"}]


class TestPolygonRecords:
    def test_records_and_path_like(self, tmp_path):
        f = write(tmp_path, "1.json", VALID_COURSE)
        recs = polygon_records(load_courses([f]))
        assert [r["polygon"] for r in recs] == ["Start", "Finish"]
        assert all(not is_path_like(r) for r in recs)
