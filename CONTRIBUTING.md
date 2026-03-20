# How to contribute

Thank you for your interest in contributing to the rownative courses library. This document explains how to add courses, update existing ones, and contribute code or improvements.

## Adding a new course

### Option 1: Web form (recommended)

1. Create your course in [Google Earth](https://earth.google.com):
   - Create a **Folder** with your course name
   - Add **Placemarks** for start, waypoints, and finish
   - Draw a polygon for each (right-click Placemark → Add → Polygon)
2. Export the Folder as KML (right-click → Save Place As)
3. Go to [rownative.icu/submit](https://rownative.icu/submit)
4. Sign in with your intervals.icu account
5. Upload the KML file and submit

A pull request will be opened automatically. Once validated and merged, your course appears on the map within minutes.

### Option 2: Pull request

1. Fork this repository
2. Add a JSON file to `courses/` following the schema in [`courses/SCHEMA.md`](courses/SCHEMA.md)
3. Run validation locally: `python scripts/validate_course.py courses/your-course.json`
4. Open a pull request — automated validation runs and reports any issues as a PR comment
5. On passing validation, a maintainer will merge the PR

New courses are assigned `status: provisional` until they have been used in a timed result or endorsed by a curator.

## Updating an existing course

### Provisional courses only

Only **provisional** courses can be updated via the web form. Established courses must be edited directly in the repository.

1. Find the course on the map at [rownative.icu](https://rownative.icu)
2. Click the course to open the detail panel
3. Click **Update with new KML** (only shown for provisional courses when signed in)
4. Upload your revised KML file and submit

A pull request will be opened with the updated geometry. The deploy workflow regenerates the KML from the JSON on merge.

### Editing established courses or making manual changes

1. Fork this repository
2. Edit `courses/{id}.json` (and optionally run `scripts/generate_kml.py` to regenerate KML)
3. Run validation: `python scripts/validate_course.py courses/{id}.json`
4. Open a pull request

## Migrating from Rowsandall

If you have courses on Rowsandall (which is shutting down by end of 2026):

1. On Rowsandall, use **Download my courses** to export a ZIP
2. Go to [rownative.icu/import](https://rownative.icu/import)
3. Sign in and upload the ZIP

We will restore your liked courses and open pull requests for owned courses not yet in the library.

## Course schema

Each course is stored as `courses/{id}.json`. Required fields:

- `id` — unique identifier (matches filename)
- `name` — human-readable course name
- `country` — country name or code
- `center_lat`, `center_lon` — map center
- `distance_m` — course length in meters
- `status` — `provisional` or `established`
- `polygons` — at least two polygons (start, waypoints, finish)

See [`courses/SCHEMA.md`](courses/SCHEMA.md) for the full schema.

## Validation

Before submitting, run validation locally:

```bash
pip install -r scripts/requirements.txt
python scripts/validate_course.py courses/your-course.json
```

Validation checks:

- Valid JSON and required fields
- At least 2 polygons with ≥3 points each
- Distance 100 m–25 km
- No polygon overlap within the course

## Contributing code or scripts

- **Bug fixes and improvements** — Open an issue first to discuss, or open a PR directly for small changes
- **New scripts** — Place in `scripts/` and document in the README
- **Site changes** — The site lives in `site/`. Run `python scripts/serve_dev.py` for local development

### Local development with mock API

`serve_dev.py` includes a mock API that intercepts `/api/*` and `/oauth/*` requests. This lets you test the full GUI locally without the Cloudflare Worker backend:

```bash
python scripts/serve_dev.py
```

Then open http://localhost:8000/. You can:

- Browse the map, search, and filter courses
- Click **Sign in with intervals.icu** to simulate being signed in (no real OAuth)
- Like/unlike courses, calculate times, save course times
- Test the Import, Submit, and Update pages

Mock data is in-memory and resets when you restart the server. Use `--no-build` to skip regenerating the index and KML on startup.

### Speed Orders (Challenges) GUI testing

The mock API includes challenge endpoints for testing the Speed Orders UI:

- **Challenges list** — Visit http://localhost:8000/challenges.html to see active, upcoming, and past challenges
- **Challenge detail** — Click "View leaderboard" on a challenge to see the leaderboard and submit a result (when signed in)
- **Organiser panel** — To test creating challenges and moderating results, sign in as organiser: use [Sign in as organiser (mock)](http://localhost:8000/oauth/authorize?mock_organizer=1) or add `?mock_organizer=1` to the OAuth authorize URL. Then visit http://localhost:8000/organiser.html

## Reporting issues

Open an issue at [github.com/rownative/courses/issues](https://github.com/rownative/courses/issues) for:

- Course data errors
- Site bugs
- Feature requests
- Questions

## License

By contributing, you agree that your contributions will be licensed under the same terms as the project:

- Course data: [Open Database License (ODbL) 1.0](LICENSE)
- Scripts: [MIT](LICENSE-CODE)
