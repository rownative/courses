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
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()

    def _handle_oauth_authorize(self) -> bool:
        """Mock sign-in: set cookie and redirect to /."""
        headers = {
            "Set-Cookie": "rn_mock_signed_in=1; Path=/; Max-Age=86400; SameSite=Lax",
        }
        self._send_redirect("/", 302, headers)
        return True

    def _handle_oauth_logout(self) -> bool:
        """Mock sign-out: clear cookie and redirect to /."""
        headers = {
            "Set-Cookie": "rn_mock_signed_in=; Path=/; Max-Age=0; SameSite=Lax",
        }
        self._send_redirect("/", 302, headers)
        return True

    def _handle_api_me(self) -> bool:
        cookie_header = self.headers.get("Cookie")
        signed_in = _is_mock_signed_in(cookie_header)
        if signed_in:
            self._send_json({"athleteId": "mock-123", "liked": list(MOCK_LIKED)})
        else:
            self._send_json({"athleteId": None, "liked": []})
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

        # API
        if path in ("/api/me", "/api/me/"):
            return self._handle_api_me()
        if path in ("/api/me/course-times", "/api/me/course-times/"):
            return self._handle_api_me_course_times()
        m = re.match(r"^/api/me/course-times/([^/]+)/?$", path)
        if m and self.command == "DELETE":
            return self._handle_api_me_course_times_delete(m.group(1))
        if path in ("/api/me/activities", "/api/me/activities/"):
            return self._handle_api_me_activities()
        m = re.match(r"^/api/me/activities/([^/]+)/track/?$", path)
        if m:
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
        m = re.match(r"^/api/courses/(\d+)/?$", path)
        if m:
            return self._handle_api_courses_single_kml(m.group(1))

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
    parser.add_argument("-p", "--port", type=int, default=8000, help="Port (default: 8000)")
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
    with socketserver.TCPServer(("", args.port), MockAPIRequestHandler) as httpd:
        print(f"Serving at http://localhost:{args.port}/")
        print("Mock API enabled: /api/* and /oauth/* return mock data for GUI testing.")
        print("  Sign in: click 'Sign in with intervals.icu' (no real OAuth)")
        print("Press Ctrl+C to stop")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
