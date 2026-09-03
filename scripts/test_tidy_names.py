"""Tests for tidy_names.py"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tidy_names import process, tidy_name


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Head of the Red - Head of the Red", "Head of the Red"),
        ("Carnegie Lake - Carnegie Lake 1k", "Carnegie Lake 1k"),
        ("Textile River Regatta - Textile River Regatta Course", "Textile River Regatta Course"),
        ("Seekonk R - Seekonk R - TOTS II Course", "Seekonk R - TOTS II Course"),
        (" - Catterline Return", "Catterline Return"),
        (" - Seekonk R - TOTS TT", "Seekonk R - TOTS TT"),
        ("Mission Bay GPS Speed Order - Mission Bay GPS Speed Order", "Mission Bay GPS Speed Order"),
        ("head of the red - Head of the Red", "Head of the Red"),
        ("Tyne LDS/SBH - Tyne LDS/SBH", "Tyne LDS/SBH"),
        ("Quinsig  South - Quinsig South ", "Quinsig South"),
        ("Fish Creek B2B - Fish Creek - Fish Creek B2B Rev D", "Fish Creek B2B Rev D"),
        ("Lake Quinsigamond - Wormtown Chase - Lake Quinsigamond - Wormtown Chase", "Lake Quinsigamond - Wormtown Chase"),
        ("Lake Quinsigamond - South Cove to DRC Docks - Lake Quinsigamond - South Cove to DRC", "Lake Quinsigamond - South Cove to DRC Docks"),
        ("Charles River - DeWolfe - Charles River - DeWolfe Rev F", "Charles River - DeWolfe Rev F"),
    ],
)
def test_tidied(raw, expected):
    assert tidy_name(raw) == expected


@pytest.mark.parametrize(
    "name",
    [
        "Brno - Prygl Rokle - Sirka",
        "CCRC - Castle to Crane",
        "CCRC - Loch Ness - Ft Augustus",
        "9K Heerenveens Kanaal",
        "Head-of-the-Charles",
        "Uherské Hradiště",
        "Hodonin 1k",
        "Avon Head Long - Avon Head - Long",
        "NBP 1K Sprint - Rev B - NBP 1K Sprint",
        "Upper Charles Cut to Dam - Upper Charles - Cut to Dam",
    ],
)
def test_untouched(name):
    assert tidy_name(name) == name


def test_non_string_passes_through():
    assert tidy_name(None) is None
    assert tidy_name(42) == 42


def test_process_writes_and_reports(tmp_path):
    f = tmp_path / "1.json"
    f.write_text(json.dumps({"id": "1", "name": "Quinsig - Quinsig", "notes": "Zürich"}, ensure_ascii=False) + "\n", encoding="utf-8")
    unchanged = tmp_path / "2.json"
    unchanged.write_text(json.dumps({"id": "2", "name": "Fine"}), encoding="utf-8")
    index = tmp_path / "index.json"
    index.write_text("[]", encoding="utf-8")

    changes = process([f, unchanged, index], dry_run=True)
    assert changes == [(f, "Quinsig - Quinsig", "Quinsig")]
    assert json.loads(f.read_text(encoding="utf-8"))["name"] == "Quinsig - Quinsig"

    process([f, unchanged, index], dry_run=False)
    text = f.read_text(encoding="utf-8")
    data = json.loads(text)
    assert data["name"] == "Quinsig"
    assert data["notes"] == "Zürich"  # ensure_ascii=False preserved
    assert text.endswith("\n")
