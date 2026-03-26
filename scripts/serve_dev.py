#!/usr/bin/env python3
"""
Build and serve the site for local development.
Runs generate_index, generate_kml, then serves from a build directory
so index.json, courses/, and kml/ are at the expected paths.

With mock API: intercepts /api/* and /oauth/* to return mock responses,
enabling full GUI testing without the Cloudflare Worker backend.
"""

from __future__ import annotations

import argparse
import json
from urllib.parse import parse_qs, urlparse
import http.server
import os
import re
import shutil
import socketserver
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_DIR = ROOT / "site"
COURSES_DIR = ROOT / "courses"
KML_DIR = ROOT / "kml"
BUILD_DIR = ROOT / "_site"

# In-memory mock state (persists for the lifetime of the server process)
MOCK_LIKED = set()  # type: set[str]
MOCK_COURSE_TIMES = []  # type: list[dict]
MOCK_COURSE_TIME_ID = 1
MOCK_CHALLENGES = []  # type: list[dict]
MOCK_CHALLENGE_RESULTS = []  # type: list[dict]
MOCK_CHALLENGE_ID = 1
MOCK_RESULT_ID = 1
MOCK_STANDARD_COLLECTIONS = []  # type: list[dict]


def _parse_cookies(header):
    """Parse Cookie header into a dict."""
    if not header:
        return {}
    result = {}
    for part in header.split(";"):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            result[k.strip()] = v.strip()
    return result


def _is_mock_signed_in(cookie_header):
    return _parse_cookies(cookie_header).get("rn_mock_signed_in") == "1"


def _is_mock_organizer(cookie_header):
    return _parse_cookies(cookie_header).get("rn_mock_organizer") == "1"


def _load_removed_challenges():
    """Load removed challenge IDs from courses/removed-challenges.json."""
    path = COURSES_DIR / "removed-challenges.json"
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
                return set(str(x) for x in (data if isinstance(data, list) else []))
        except (json.JSONDecodeError, OSError):
            pass
    return set()


def _load_courses_index():
    """Load course index for name lookup."""
    path = BUILD_DIR / "index.json"
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
                return {str(c["id"]): c.get("name", f"Course {c['id']}") for c in (data if isinstance(data, list) else [])}
        except (json.JSONDecodeError, OSError, KeyError):
            pass
    return {}


def _enrich_challenge_from_course_index(ch):
    """Add center_lat, center_lon, distance_m from index.json (matches Worker challenge API)."""
    out = dict(ch)
    cid = str(out.get("courseId") or "")
    if not cid:
        return out
    for path in (BUILD_DIR / "index.json", COURSES_DIR / "index.json"):
        if not path.exists():
            continue
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            for row in data if isinstance(data, list) else []:
                if str(row.get("id")) == cid:
                    if row.get("center_lat") is not None:
                        out["center_lat"] = row["center_lat"]
                    if row.get("center_lon") is not None:
                        out["center_lon"] = row["center_lon"]
                    if row.get("distance_m") is not None:
                        out["distance_m"] = row["distance_m"]
                    return out
        except (json.JSONDecodeError, OSError, KeyError, TypeError):
            continue
    return out


def _json_response(data, status=200):
    body = json.dumps(data).encode("utf-8")
    return body


class MockAPIRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Request handler that mocks /api/* and /oauth/* for local GUI testing."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BUILD_DIR), **kwargs)

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.end_headers()
        self.wfile.write(_json_response(data, status))

    def _send_redirect(self, location, status=302, extra_headers=None):
        self.send_response(status)
        self.send_header("Location", location)
        if extra_headers:
            for k, v in extra_headers:
                self.send_header(k, v)
        self.end_headers()

    def _handle_oauth_authorize(self) -> bool:
        """Mock sign-in: set cookie and redirect to /. Use ?mock_organizer=1 for organiser."""
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        is_organizer = "1" in qs.get("mock_organizer", [])
        headers = [("Set-Cookie", "rn_mock_signed_in=1; Path=/; Max-Age=86400; SameSite=Lax")]
        if is_organizer:
            headers.append(("Set-Cookie", "rn_mock_organizer=1; Path=/; Max-Age=86400; SameSite=Lax"))
        self._send_redirect("/", 302, headers)
        return True

    def _handle_oauth_logout(self) -> bool:
        """Mock sign-out: clear cookies and redirect to /."""
        headers = [
            ("Set-Cookie", "rn_mock_signed_in=; Path=/; Max-Age=0; SameSite=Lax"),
            ("Set-Cookie", "rn_mock_organizer=; Path=/; Max-Age=0; SameSite=Lax"),
        ]
        self._send_redirect("/", 302, headers)
        return True

    def _handle_api_me(self) -> bool:
        cookie_header = self.headers.get("Cookie")
        signed_in = _is_mock_signed_in(cookie_header)
        is_organizer = _is_mock_organizer(cookie_header)
        if signed_in:
            self._send_json({
                "athleteId": "mock-123",
                "liked": list(MOCK_LIKED),
                "isOrganizer": is_organizer,
                "athleteDisplayName": "Mock Athlete",
            })
        else:
            self._send_json({"athleteId": None, "liked": [], "isOrganizer": False})
        return True

    def _handle_api_me_course_times(self) -> bool:
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        # Normalize keys to match worker response (snake_case from DB)
        out = []
        for t in MOCK_COURSE_TIMES:
            out.append({
                "id": t.get("id"),
                "activity_id": t.get("activity_id"),
                "course_id": t.get("course_id"),
                "time_s": t.get("time_s"),
                "distance_m": t.get("distance_m"),
                "workout_date": t.get("workout_date"),
                "workout_name": t.get("workout_name"),
                "created_at": t.get("created_at"),
            })
        self._send_json({"courseTimes": out})
        return True

    def _handle_api_me_course_times_delete(self, time_id: str) -> bool:
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        global MOCK_COURSE_TIMES
        MOCK_COURSE_TIMES = [t for t in MOCK_COURSE_TIMES if str(t.get("id")) != time_id]
        self._send_json({})
        return True

    def _handle_api_me_activities(self) -> bool:
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        # Mock OTW rowing activities for the calculate-time modal
        activities = [
            {"id": "mock-activity-1", "name": "Morning row", "start_date_local": "2025-03-15T08:00:00"},
            {"id": "mock-activity-2", "name": "5k time trial", "start_date_local": "2025-03-18T09:30:00"},
        ]
        self._send_json({"activities": activities})
        return True

    def _handle_api_me_activities_track(self, activity_id: str) -> bool:
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        # Mock GPS track: simple line (lat, lon pairs)
        latlng = [
            [52.31, 6.63],
            [52.32, 6.64],
            [52.33, 6.65],
            [52.34, 6.66],
        ]
        self._send_json({"latlng": latlng})
        return True

    def _handle_api_rowers_follow_unfollow(self, course_id: str, action: str) -> bool:
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        if action == "follow":
            MOCK_LIKED.add(course_id)
        else:
            MOCK_LIKED.discard(course_id)
        self._send_json({"liked": list(MOCK_LIKED)})
        return True

    def _handle_api_courses_calculate_time(self, course_id: str) -> bool:
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        # Read body for activityId
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body"}, 400)
            return True
        # Mock valid result
        self._send_json({
            "valid": True,
            "timeS": 1234,
            "distanceM": 5000,
            "validationNote": "",
        })
        return True

    def _handle_api_courses_course_times(self, course_id: str) -> bool:
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body"}, 400)
            return True
        global MOCK_COURSE_TIMES, MOCK_COURSE_TIME_ID
        time_id = str(MOCK_COURSE_TIME_ID)
        MOCK_COURSE_TIME_ID += 1
        MOCK_COURSE_TIMES.append({
            "id": time_id,
            "activity_id": data.get("activityId", "mock-activity-1"),
            "course_id": course_id,
            "time_s": data.get("timeS", 0),
            "distance_m": data.get("distanceM", 0),
            "workout_date": data.get("workoutDate", ""),
            "workout_name": data.get("workoutName", ""),
            "created_at": "2025-03-20T12:00:00",
        })
        self._send_json({"saved": True})
        return True

    def _handle_api_courses_submit(self) -> bool:
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        self._send_json({
            "prUrl": "https://github.com/rownative/courses/pull/999",
            "message": "Course submitted (mock)",
        })
        return True

    def _handle_api_courses_update(self) -> bool:
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        self._send_json({
            "prUrl": "https://github.com/rownative/courses/pull/998",
            "message": "Course updated (mock)",
        })
        return True

    def _handle_api_courses_import_zip(self) -> bool:
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        self._send_json({
            "alreadyInLibrary": 3,
            "prsOpened": 1,
            "likedRestored": 5,
            "prUrls": ["https://github.com/rownative/courses/pull/997"],
        })
        return True

    def _handle_api_courses_list(self) -> bool:
        """GET /api/courses — list courses for organiser dropdown."""
        path = BUILD_DIR / "index.json"
        if not path.exists():
            self._send_json({"courses": []})
            return True
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            courses_list = data if isinstance(data, list) else []
            self._send_json({"courses": courses_list})
        except (json.JSONDecodeError, OSError):
            self._send_json({"courses": []})
        return True

    def _handle_api_challenges_list(self, status: str) -> bool:
        """GET /api/challenges?status=active|upcoming|past"""
        removed = _load_removed_challenges()
        course_names = _load_courses_index()
        all_challenges = MOCK_CHALLENGES + [
            {
                "id": "mock-ch-1",
                "name": "Charles River March Speed Order",
                "courseId": "1",
                "courseName": course_names.get("1", "Course 1"),
                "rowStart": "2026-03-01T00:00:00",
                "rowEnd": "2026-03-25T23:59:59",
                "submitEnd": "2026-03-30T23:59:59",
                "collectionId": "hocr",
                "hasHandicap": True,
                "organizerId": "mock-123",
                "resultsCount": 12,
                "isPublic": True,
            },
            {
                "id": "mock-ch-2",
                "name": "Quinsig Spring Challenge",
                "courseId": "1",
                "courseName": course_names.get("1", "Course 1"),
                "rowStart": "2026-04-01T00:00:00",
                "rowEnd": "2026-04-30T23:59:59",
                "submitEnd": "2026-05-05T23:59:59",
                "collectionId": None,
                "hasHandicap": False,
                "organizerId": "mock-456",
                "resultsCount": 3,
                "isPublic": True,
            },
            {
                "id": "mock-ch-3",
                "name": "Head of the Fish Creek (Past)",
                "courseId": "102",
                "courseName": course_names.get("102", "Course 102"),
                "rowStart": "2025-10-01T00:00:00",
                "rowEnd": "2025-10-15T23:59:59",
                "submitEnd": "2025-10-20T23:59:59",
                "collectionId": None,
                "hasHandicap": False,
                "organizerId": "mock-789",
                "resultsCount": 8,
                "isPublic": True,
            },
        ]
        filtered = [c for c in all_challenges if c["id"] not in removed]
        from datetime import datetime
        now = datetime.utcnow()
        result = []
        for c in filtered:
            rs = c["rowStart"].replace("Z", "")[:19]
            re = c["rowEnd"].replace("Z", "")[:19]
            se = c["submitEnd"].replace("Z", "")[:19]
            row_start = datetime.fromisoformat(rs) if rs else now
            row_end = datetime.fromisoformat(re) if re else now
            submit_end = datetime.fromisoformat(se) if se else now
            if status == "active":
                if row_start <= now <= row_end and now <= submit_end:
                    result.append(_enrich_challenge_from_course_index(dict(c)))
            elif status == "upcoming":
                if row_start > now:
                    result.append(_enrich_challenge_from_course_index(dict(c)))
            elif status == "past":
                if row_end < now or submit_end < now:
                    result.append(_enrich_challenge_from_course_index(dict(c)))
        self._send_json({"challenges": result})
        return True

    def _handle_api_challenges_detail(self, challenge_id: str) -> bool:
        """GET /api/challenges/{id}"""
        removed = _load_removed_challenges()
        if challenge_id in removed:
            self._send_json({"error": "Not found"}, 404)
            return True
        course_names = _load_courses_index()
        all_challenges = MOCK_CHALLENGES + [
            {
                "id": "mock-ch-1",
                "name": "Charles River March Speed Order",
                "courseId": "1",
                "courseName": course_names.get("1", "Course 1"),
                "rowStart": "2026-03-01T00:00:00",
                "rowEnd": "2026-03-25T23:59:59",
                "submitEnd": "2026-03-30T23:59:59",
                "collectionId": "hocr",
                "collectionName": "HOCR",
                "hasHandicap": True,
                "organizerId": "mock-123",
                "organizerName": "Mock Organiser",
                "notes": "Row the full course. Handicap scoring applies.",
                "isPublic": True,
            },
            {
                "id": "mock-ch-2",
                "name": "Quinsig Spring Challenge",
                "courseId": "1",
                "courseName": course_names.get("1", "Course 1"),
                "rowStart": "2026-04-01T00:00:00",
                "rowEnd": "2026-04-30T23:59:59",
                "submitEnd": "2026-05-05T23:59:59",
                "collectionId": None,
                "collectionName": None,
                "hasHandicap": False,
                "organizerId": "mock-456",
                "organizerName": "Anonymous",
                "notes": None,
                "isPublic": True,
            },
            {
                "id": "mock-ch-3",
                "name": "Head of the Fish Creek (Past)",
                "courseId": "102",
                "courseName": course_names.get("102", "Course 102"),
                "rowStart": "2025-10-01T00:00:00",
                "rowEnd": "2025-10-15T23:59:59",
                "submitEnd": "2025-10-20T23:59:59",
                "collectionId": None,
                "collectionName": None,
                "hasHandicap": False,
                "organizerId": "mock-789",
                "organizerName": "Anonymous",
                "notes": None,
                "isPublic": True,
            },
        ]
        ch = next((c for c in all_challenges if c["id"] == challenge_id), None)
        if not ch:
            ch = next((c for c in MOCK_CHALLENGES if c["id"] == challenge_id), None)
        if ch:
            self._send_json(_enrich_challenge_from_course_index(dict(ch)))
        else:
            self._send_json({"error": "Not found"}, 404)
        return True

    def _handle_api_challenges_results(self, challenge_id: str) -> bool:
        """GET /api/challenges/{id}/results"""
        removed = _load_removed_challenges()
        if challenge_id in removed:
            self._send_json({"error": "Not found"}, 404)
            return True
        results = [r for r in MOCK_CHALLENGE_RESULTS if r.get("challengeId") == challenge_id]
        if not results and challenge_id in ("mock-ch-1", "mock-ch-2", "mock-ch-3"):
            results = [
                {"id": "r1", "rank": 1, "displayName": "Alice R.", "boatType": "1x", "sex": "F", "crewAvgAge": 28, "rawTimeS": 1320, "correctedTimeS": 1280, "points": 98.5, "workoutDate": "2026-03-10", "validationStatus": "valid"},
                {"id": "r2", "rank": 2, "displayName": "Bob M.", "boatType": "1x", "sex": "M", "crewAvgAge": 35, "rawTimeS": 1280, "correctedTimeS": 1290, "points": 97.2, "workoutDate": "2026-03-12", "validationStatus": "valid"},
                {"id": "r3", "rank": 3, "displayName": "Crew Masters 8+", "boatType": "8+", "sex": "M", "crewAvgAge": 52, "rawTimeS": 1100, "correctedTimeS": 1305, "points": 96.1, "workoutDate": "2026-03-14", "validationStatus": "valid"},
            ]
        self._send_json({"results": results})
        return True

    def _handle_api_challenges_submit(self, challenge_id: str) -> bool:
        """POST /api/challenges/{id}/submit"""
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body"}, 400)
            return True
        global MOCK_CHALLENGE_RESULTS, MOCK_RESULT_ID
        result_id = f"mock-result-{MOCK_RESULT_ID}"
        MOCK_RESULT_ID += 1
        raw_time = data.get("rawTimeS", 1350)
        new_result = {
            "id": result_id,
            "challengeId": challenge_id,
            "athleteId": "mock-123",
            "displayName": data.get("displayName", "Mock User"),
            "boatType": data.get("boatType", "1x"),
            "sex": data.get("sex", "M"),
            "crewAvgAge": data.get("crewAvgAge"),
            "rawTimeS": raw_time,
            "correctedTimeS": data.get("correctedTimeS", raw_time),
            "points": data.get("points", 95),
            "workoutDate": data.get("workoutDate", "2026-03-15"),
            "validationStatus": "valid",
        }
        MOCK_CHALLENGE_RESULTS.append(new_result)
        results_for_challenge = [r for r in MOCK_CHALLENGE_RESULTS if r.get("challengeId") == challenge_id]
        rank = len(results_for_challenge)
        self._send_json({
            "success": True,
            "resultId": result_id,
            "rank": rank,
            "rawTimeS": raw_time,
            "correctedTimeS": new_result["correctedTimeS"],
            "points": new_result["points"],
            "validationNote": "",
        })
        return True

    def _handle_api_organiser_challenges_list(self) -> bool:
        """GET /api/organiser/challenges"""
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        course_names = _load_courses_index()
        mine = [c for c in MOCK_CHALLENGES if c.get("organizerId") == "mock-123"]
        for c in mine:
            c.setdefault("courseName", course_names.get(str(c.get("courseId", "")), f"Course {c.get('courseId')}"))
            c.setdefault("resultsCount", len([r for r in MOCK_CHALLENGE_RESULTS if r.get("challengeId") == c["id"]]))
        self._send_json({"challenges": mine})
        return True

    def _handle_api_organiser_challenges_create(self) -> bool:
        """POST /api/organiser/challenges"""
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        if not _is_mock_organizer(self.headers.get("Cookie")):
            self._send_json({"error": "Organiser access required"}, 403)
            return True
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body"}, 400)
            return True
        global MOCK_CHALLENGES, MOCK_CHALLENGE_ID
        ch_id = f"mock-ch-{MOCK_CHALLENGE_ID}"
        MOCK_CHALLENGE_ID += 1
        course_names = _load_courses_index()
        course_id = str(data.get("courseId", "1"))
        new_ch = {
            "id": ch_id,
            "name": data.get("name", "New Challenge"),
            "courseId": course_id,
            "courseName": course_names.get(course_id, f"Course {course_id}"),
            "rowStart": data.get("rowStart", ""),
            "rowEnd": data.get("rowEnd", ""),
            "submitEnd": data.get("submitEnd", ""),
            "collectionId": data.get("collectionId"),
            "hasHandicap": bool(data.get("hasHandicap")),
            "organizerId": "mock-123",
            "organizerName": "Mock Organiser",
            "resultsCount": 0,
            "isPublic": data.get("isPublic", True),
        }
        MOCK_CHALLENGES.append(new_ch)
        self._send_json({"id": ch_id, "challenge": new_ch})
        return True

    def _handle_api_organiser_standard_collections_list(self) -> bool:
        """GET /api/organiser/standard-collections"""
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        builtin = [
            {"id": "hocr", "name": "HOCR", "isBuiltin": True},
            {"id": "fisa", "name": "FISA Masters", "isBuiltin": True},
            {"id": "charles", "name": "Charles River", "isBuiltin": True},
        ]
        custom = [c for c in MOCK_STANDARD_COLLECTIONS]
        self._send_json({"collections": builtin + custom})
        return True

    def _handle_api_organiser_standard_collections_create(self) -> bool:
        """POST /api/organiser/standard-collections — accepts JSON or multipart/form-data"""
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        if not _is_mock_organizer(self.headers.get("Cookie")):
            self._send_json({"error": "Organiser access required"}, 403)
            return True
        content_length = int(self.headers.get("Content-Length", 0))
        content_type = self.headers.get("Content-Type", "")
        name = "Custom collection"
        if "multipart/form-data" in content_type:
            try:
                body = self.rfile.read(content_length) if content_length else b""
                boundary = None
                for part in content_type.split(";"):
                    part = part.strip()
                    if part.startswith("boundary="):
                        boundary = part[9:].strip().strip('"')
                        break
                if boundary:
                    parts = body.split(b"--" + boundary.encode("ascii"))
                    for part in parts[1:]:
                        if b"name=\"name\"" in part or b'name="name"' in part:
                            idx = part.find(b"\r\n\r\n")
                            if idx < 0:
                                idx = part.find(b"\n\n")
                                sep = 2
                            else:
                                sep = 4
                            if idx >= 0:
                                end = part.find(b"\r\n", idx + sep)
                                if end < 0:
                                    end = part.find(b"\n", idx + sep)
                                val = part[idx + sep : end] if end >= 0 else part[idx + sep :]
                                name = val.decode("utf-8", errors="replace").strip()
                                if name:
                                    break
            except Exception:
                pass
        else:
            body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
            try:
                data = json.loads(body) if body.strip() else {}
                name = data.get("name", name)
            except json.JSONDecodeError:
                pass
        global MOCK_STANDARD_COLLECTIONS
        coll_id = f"mock-coll-{len(MOCK_STANDARD_COLLECTIONS) + 1}"
        MOCK_STANDARD_COLLECTIONS.append({
            "id": coll_id,
            "name": name,
            "isBuiltin": False,
        })
        self._send_json({"id": coll_id, "message": "Created (mock)"})
        return True

    def _handle_api_organiser_results_override(self, result_id: str) -> bool:
        """POST /api/organiser/results/{id}/override"""
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        if not _is_mock_organizer(self.headers.get("Cookie")):
            self._send_json({"error": "Organiser access required"}, 403)
            return True
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body"}, 400)
            return True
        status = data.get("status", "manual_ok")
        note = data.get("note", "")
        for r in MOCK_CHALLENGE_RESULTS:
            if r.get("id") == result_id:
                r["validationStatus"] = "manual_ok" if status == "manual_ok" else "dq"
                r["validationNote"] = note
                self._send_json({"updated": True})
                return True
        self._send_json({"error": "Result not found"}, 404)
        return True

    def _handle_api_organiser_challenges_results(self, challenge_id: str) -> bool:
        """GET /api/organiser/challenges/{id}/results — all results including pending"""
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        if not _is_mock_organizer(self.headers.get("Cookie")):
            self._send_json({"error": "Organiser access required"}, 403)
            return True
        results = [r for r in MOCK_CHALLENGE_RESULTS if r.get("challengeId") == challenge_id]
        if not results and challenge_id in ("mock-ch-1", "mock-ch-2", "mock-ch-3"):
            results = [
                {"id": "r1", "rank": 1, "displayName": "Alice R.", "boatType": "1x", "rawTimeS": 1320, "validationStatus": "valid"},
                {"id": "r2", "rank": 2, "displayName": "Bob M.", "boatType": "1x", "rawTimeS": 1280, "validationStatus": "pending"},
            ]
        self._send_json({"results": results})
        return True

    def _handle_api_organiser_results_track(self, result_id: str) -> bool:
        """GET /api/organiser/results/{id}/track — track overlay for moderation"""
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        if not _is_mock_organizer(self.headers.get("Cookie")):
            self._send_json({"error": "Organiser access required"}, 403)
            return True
        # Mock track: simple line
        latlng = [[52.23 + i * 0.001, 6.84 + i * 0.0005] for i in range(50)]
        self._send_json({"latlng": latlng})
        return True

    def _handle_api_courses_single_kml(self, course_id: str) -> bool:
        """Serve KML file from local build."""
        kml_path = BUILD_DIR / "kml" / f"{course_id}.kml"
        if not kml_path.exists():
            self.send_error(404, "KML not found")
            return True
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.google-earth.kml+xml")
        self.send_header("Content-Disposition", f'attachment; filename="{course_id}.kml"')
        self.end_headers()
        with open(kml_path, "rb") as f:
            self.wfile.write(f.read())
        return True

    def _handle_api_courses_kml_liked(self) -> bool:
        if not _is_mock_signed_in(self.headers.get("Cookie")):
            self._send_json({"error": "Unauthorised"}, 401)
            return True
        # Return minimal KML bundle for liked courses (valid KML for CrewNerd download)
        ids = list(MOCK_LIKED)
        placemarks = ""
        for cid in ids:
            placemarks += f'<Placemark><name>Course {cid}</name><Point><coordinates>0,0,0</coordinates></Point></Placemark>'
        kml_content = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<kml xmlns="http://www.opengis.net/kml/2.2">'
            "<Document><name>Liked courses (mock)</name>"
            f"{placemarks}"
            "</Document></kml>"
        )
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.google-earth.kml+xml")
        self.send_header("Content-Disposition", 'attachment; filename="liked-courses.kml"')
        self.end_headers()
        self.wfile.write(kml_content.encode("utf-8"))
        return True

    def _try_handle_mock(self) -> bool:
        path = self.path
        if "?" in path:
            path = path.split("?")[0]

        # OAuth
        if path in ("/oauth/authorize", "/oauth/authorize/"):
            return self._handle_oauth_authorize()
        if path in ("/oauth/logout", "/oauth/logout/"):
            return self._handle_oauth_logout()

        # API (GET-only for read endpoints so POST in do_POST is not misrouted)
        if path in ("/api/me", "/api/me/") and self.command == "GET":
            return self._handle_api_me()
        if path in ("/api/me/course-times", "/api/me/course-times/") and self.command == "GET":
            return self._handle_api_me_course_times()
        m = re.match(r"^/api/me/course-times/([^/]+)/?$", path)
        if m and self.command == "DELETE":
            return self._handle_api_me_course_times_delete(m.group(1))
        if path in ("/api/me/activities", "/api/me/activities/") and self.command == "GET":
            return self._handle_api_me_activities()
        m = re.match(r"^/api/me/activities/([^/]+)/track/?$", path)
        if m and self.command == "GET":
            return self._handle_api_me_activities_track(m.group(1))
        m = re.match(r"^/api/rowers/courses/(\d+)/(follow|unfollow)/?$", path)
        if m and self.command == "POST":
            return self._handle_api_rowers_follow_unfollow(m.group(1), m.group(2))
        m = re.match(r"^/api/courses/(\d+)/calculate-time/?$", path)
        if m and self.command == "POST":
            return self._handle_api_courses_calculate_time(m.group(1))
        m = re.match(r"^/api/courses/(\d+)/course-times/?$", path)
        if m and self.command == "POST":
            return self._handle_api_courses_course_times(m.group(1))
        if path in ("/api/courses/submit", "/api/courses/submit/"):
            if self.command == "POST":
                return self._handle_api_courses_submit()
        if path in ("/api/courses/update", "/api/courses/update/"):
            if self.command == "POST":
                return self._handle_api_courses_update()
        if path in ("/api/courses/import-zip", "/api/courses/import-zip/"):
            if self.command == "POST":
                return self._handle_api_courses_import_zip()
        if path in ("/api/courses/kml/liked", "/api/courses/kml/liked/"):
            return self._handle_api_courses_kml_liked()
        if path in ("/api/courses", "/api/courses/"):
            return self._handle_api_courses_list()
        m = re.match(r"^/api/courses/(\d+)/?$", path)
        if m:
            return self._handle_api_courses_single_kml(m.group(1))

        # Challenges API
        m = re.match(r"^/api/challenges/?$", path)
        if m and self.command == "GET":
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            status = (qs.get("status") or ["active"])[0]
            if status not in ("active", "upcoming", "past"):
                status = "active"
            return self._handle_api_challenges_list(status)
        m = re.match(r"^/api/challenges/([^/]+)/?$", path)
        if m and self.command == "GET":
            return self._handle_api_challenges_detail(m.group(1))
        m = re.match(r"^/api/challenges/([^/]+)/results/?$", path)
        if m and self.command == "GET":
            return self._handle_api_challenges_results(m.group(1))
        m = re.match(r"^/api/challenges/([^/]+)/submit/?$", path)
        if m and self.command == "POST":
            return self._handle_api_challenges_submit(m.group(1))

        # Organiser API
        if path in ("/api/organiser/challenges", "/api/organiser/challenges/"):
            if self.command == "GET":
                return self._handle_api_organiser_challenges_list()
            if self.command == "POST":
                return self._handle_api_organiser_challenges_create()
        m = re.match(r"^/api/organiser/challenges/([^/]+)/results/?$", path)
        if m and self.command == "GET":
            return self._handle_api_organiser_challenges_results(m.group(1))
        if path in ("/api/organiser/standard-collections", "/api/organiser/standard-collections/"):
            if self.command == "GET":
                return self._handle_api_organiser_standard_collections_list()
            if self.command == "POST":
                return self._handle_api_organiser_standard_collections_create()
        m = re.match(r"^/api/organiser/results/([^/]+)/override/?$", path)
        if m and self.command == "POST":
            return self._handle_api_organiser_results_override(m.group(1))
        m = re.match(r"^/api/organiser/results/([^/]+)/track/?$", path)
        if m and self.command == "GET":
            return self._handle_api_organiser_results_track(m.group(1))

        return False

    def do_GET(self) -> None:
        if self._try_handle_mock():
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self._try_handle_mock():
            return
        # POST to non-API paths: 405 or fallback
        self.send_error(405, "Method Not Allowed")

    def do_DELETE(self) -> None:
        if self._try_handle_mock():
            return
        self.send_error(405, "Method Not Allowed")

    def log_message(self, format: str, *args) -> None:
        # Suppress default logging for cleaner output; uncomment to debug
        # super().log_message(format, *args)
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve rownative courses site locally")
    parser.add_argument("-p", "--port", type=int, default=8080, help="Port (default: 8080)")
    parser.add_argument("--no-build", action="store_true", help="Skip regenerating index and KML")
    args = parser.parse_args()

    if not args.no_build:
        print("Regenerating index and KML...")
        for name in ["generate_index.py", "generate_kml.py"]:
            script = ROOT / "scripts" / name
            if script.exists():
                subprocess.run([sys.executable, str(script)], cwd=str(ROOT), check=True)

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    # Copy site files
    for f in SITE_DIR.iterdir():
        if f.is_file():
            shutil.copy2(f, BUILD_DIR / f.name)
    # Copy index and data
    if (COURSES_DIR / "index.json").exists():
        shutil.copy2(COURSES_DIR / "index.json", BUILD_DIR / "index.json")
    if KML_DIR.exists():
        dst = BUILD_DIR / "kml"
        dst.mkdir(exist_ok=True)
        for f in KML_DIR.glob("*.kml"):
            shutil.copy2(f, dst / f.name)
    if COURSES_DIR.exists():
        dst = BUILD_DIR / "courses"
        dst.mkdir(exist_ok=True)
        for f in COURSES_DIR.glob("*.json"):
            shutil.copy2(f, dst / f.name)

    os.chdir(BUILD_DIR)
    port = args.port
    for attempt in range(10):
        try:
            with socketserver.TCPServer(("", port), MockAPIRequestHandler) as httpd:
                if port != args.port:
                    print(f"Port {args.port} was in use; using port {port} instead.")
                print(f"Serving at http://localhost:{port}/")
                print("Mock API enabled: /api/* and /oauth/* return mock data for GUI testing.")
                print("  Sign in: click 'Sign in with intervals.icu' (no real OAuth)")
                print("  Sign in as organiser: /oauth/authorize?mock_organizer=1")
                print("Press Ctrl+C to stop")
                httpd.serve_forever()
        except OSError as e:
            addr_in_use = (
                getattr(e, "errno", None) in (98, 10048)  # EADDRINUSE, WSAEADDRINUSE
                or "address already in use" in str(e).lower()
            )
            if addr_in_use:
                port += 1
                if attempt == 9:
                    print(f"Error: Could not bind to port {args.port} or fallback ports.", file=sys.stderr)
                    print("Stop the process using the port, or run with -p PORT", file=sys.stderr)
                    sys.exit(1)
            else:
                raise


if __name__ == "__main__":
    main()
