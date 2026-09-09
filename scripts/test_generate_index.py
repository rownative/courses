"""Tests for generate_index.py"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_index import build_index, index_entry
from test_validate_course import VALID_COURSE


def test_entry_has_documented_shape():
    entry = index_entry(VALID_COURSE)
    assert list(entry) == ["id", "name", "country", "center_lat", "center_lon", "distance_m", "status", "notes", "has_path"]
    assert entry["notes"] == ""
    assert entry["has_path"] is False


def test_notes_are_trimmed_and_path_detected():
    data = dict(VALID_COURSE, notes="\n\nFrom the castle to the crane  ", path=[{"lat": 1, "lon": 2}, {"lat": 3, "lon": 4}])
    entry = index_entry(data)
    assert entry["notes"] == "From the castle to the crane"
    assert entry["has_path"] is True


def test_null_notes_and_short_path():
    data = dict(VALID_COURSE, notes=None, path=[{"lat": 1, "lon": 2}])
    entry = index_entry(data)
    assert entry["notes"] == ""
    assert entry["has_path"] is False


def test_non_course_rejected():
    assert index_entry([1, 2, 3]) is None
    assert index_entry({"id": "1"}) is None


def test_build_index_skips_index_and_non_courses(tmp_path):
    (tmp_path / "1.json").write_text(json.dumps(VALID_COURSE), encoding="utf-8")
    (tmp_path / "index.json").write_text("[]", encoding="utf-8")
    (tmp_path / "organisers.json").write_text('["i1"]', encoding="utf-8")
    (tmp_path / "broken.json").write_text("{", encoding="utf-8")
    entries = build_index(tmp_path)
    assert [e["id"] for e in entries] == ["001"]
