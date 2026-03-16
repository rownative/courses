#!/usr/bin/env python3
"""
Build and serve the site for local development.
Runs generate_index, generate_kml, then serves from a build directory
so index.json, courses/, and kml/ are at the expected paths.
"""

import argparse
import http.server
import os
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
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", args.port), handler) as httpd:
        print(f"Serving at http://localhost:{args.port}/")
        print("Press Ctrl+C to stop")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
