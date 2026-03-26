#!/usr/bin/env python3
"""Run the dev server from courses/site. Serves on port 8080 with mock API."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
script = ROOT / "scripts" / "serve_dev.py"

if __name__ == "__main__":
    sys.exit(subprocess.run([sys.executable, str(script), "-p", "8080", *sys.argv[1:]]).returncode)
