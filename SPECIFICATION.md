# Rowing Courses Platform — Specification & Implementation Status

> Successor to the measured-courses feature of Rowsandall.com.  
> Companion service to intervals.icu. Designed for minimal hosting cost and community maintainability.

This document consolidates the [rowing-courses-spec](https://git.wereldraadsel.tech/sander/rowsandall/src/branch/develop/rowing-courses-spec.md), the implementation plan, and current delivery status.

---

## Background

Rowsandall.com will be shut down by end of 2026. The **measured courses** system serves two audiences:

- **On-the-water rowers** using CrewNerd (iOS), who sync polygon-defined courses for real-time navigation and automatic course timing.
- **Challenge organisers** who run time-windowed GPS speed orders with handicap scoring.

The new platform is a **companion to intervals.icu** — users log in via intervals.icu OAuth; the platform never manages credentials. CrewNerd compatibility is preserved; existing users need only a base URL change.

---

## Architecture Overview

```
GitHub (data + code)          Cloudflare (compute + state)      Clients
─────────────────────         ──────────────────────────────    ────────
courses-library repo          Worker (TypeScript)               CrewNerd (iOS)
  courses/*.json        ←──   serves KML, liked, challenge UI   intervals.icu
  kml/*.kml (cached)    ──→   D1 (SQLite)                       Browser
  site/ (Leaflet)             KV (liked courses per athlete ID)
GitHub Pages (static)    ↑
  map browser            └─── intervals.icu OAuth (identity + GPS)
  leaderboard pages (S2)
```

---

## Part 1 — Course Library and CrewNerd Integration

### 1.1 Course Data Model — Implemented

Each course is stored as `courses/{id}.json`:

```json
{
  "id": "66",
  "name": "Charles River GPS Speed Order",
  "country": "United States",
  "center_lat": 42.3677,
  "center_lon": -71.123349,
  "distance_m": 4703,
  "notes": "Optional description.",
  "status": "established",
  "polygons": [
    {"name": "Start", "order": 0, "points": [{"lat": ..., "lon": ...}]},
    {"name": "Finish", "order": 1, "points": [...]}
  ]
}
```

**Status values:** `provisional` | `established`

**Schema documentation:** `courses/SCHEMA.md`

### 1.2 Course Validation — Implemented

**File:** `scripts/validate_course.py`

- **Structural:** Valid JSON; ≥2 polygons; ≥3 points per polygon; non-zero area (shoelace); no self-intersecting edges
- **Distance:** Centroid-to-centroid chain 100 m–25 km; max consecutive gap 25 km; no polygon overlap
- Uses only stdlib (json, math, itertools); no external APIs
- Exit non-zero with human-readable error on failure

### 1.3 GitHub Actions — Implemented

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `validate.yml` | PRs modifying `courses/**` | Runs `validate_course.py` on changed files; posts result as PR comment |
| `deploy.yml` | Push to `main` | Regenerates `index.json` and `kml/*.kml`; deploys `site/` to GitHub Pages |

### 1.4 Scripts — Implemented

| Script | Purpose |
|--------|---------|
| `scripts/validate_course.py` | Structural + distance validation |
| `scripts/generate_index.py` | Regenerates `courses/index.json` |
| `scripts/generate_kml.py` | Regenerates `kml/*.kml` (CCW sort, CrewNerd naming, cyan styles) |
| `scripts/fix_countries.py` | Geocode missing country; normalize names (USA→United States, etc.) |
| `scripts/serve_dev.py` | Local dev: build `_site`, serve on :8000 |

### 1.5 Course Map Browser (GitHub Pages) — Implemented

**Location:** `site/` (HTML, JS, CSS)

**Static features:**
- Map centred on geolocation or world view
- Loads `index.json`; marker per course (green=established, orange=provisional)
- Filter by country, distance (km), status; search by name
- Map zooms to fit filtered markers (e.g. select USA → zoom to all US courses)
- Click marker → detail panel with polygon chain, KML download
- Fallback paths for local dev (`../courses/index.json` when `./index.json` not found)

**Dynamic features (require Worker):**
- `GET /api/me` → login state, liked courses
- Like/unlike buttons (POST to Worker)
- Submit form, ZIP import form

**Note:** Dynamic features show placeholder UI until the Worker is deployed.

### 1.6 Part 1 Remaining — Cloudflare Worker

The Worker is **not yet implemented**. The `rownative/worker` repo exists as a skeleton. Required for full Part 1:

**Authentication:**
- OAuth flow: `GET /oauth/authorize`, `GET /oauth/callback`
- Encrypted `rn_session` cookie (AES-GCM)
- HMAC-derived CrewNerd API key
- Token refresh on expiry

**Endpoints:**
- `GET /api/me` — `{athleteId, liked}` or 401
- `GET /api/courses/` — index with `?lat=&lon=&radius=`
- `GET /api/courses/{id}/` — KML, `?cn=true` for CrewNerd naming
- `GET /api/courses/kml/liked/` — liked courses KML
- `GET /api/courses/kml/?ids=1,2,3` — multi-course KML
- `POST /rowers/courses/{id}/follow/` and `/unfollow/`
- `POST /api/auth/crewnerd` — bearer token → API key
- `POST /api/courses/submit` — KML → GitHub PR
- `POST /api/courses/import-zip` — ZIP import for Rowsandall migrants

**Infrastructure:** KV namespace; Worker secrets (`INTERVALS_CLIENT_ID`, `INTERVALS_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`); intervals.icu OAuth app; DNS (`rownative.icu` → Pages + Worker for `/api/*`).

### 1.7 Part 1 Remaining — Rowsandall Prerequisites

- `scripts/export_from_rowsandall.py` — bulk course geometry export (Rowsandall repo)
- "Download my courses" ZIP export — **implemented** in Rowsandall
- Import endpoint — Worker deliverable

---

## Part 2 — Challenges and Leaderboards

**Goal:** Replace Rowsandall challenge / virtual race / speed order functionality.

**Scope:** D1 tables (challenges, challenge_results, standard_collections, course_standards); GPS validation via intervals.icu; handicap scoring; organiser panel; leaderboard pages.

**Status:** Not started. Full specification in [rowing-courses-spec §2](https://git.wereldraadsel.tech/sander/rowsandall/src/branch/develop/rowing-courses-spec.md).

---

## Key References

| Resource | URL |
|----------|-----|
| Source spec | https://git.wereldraadsel.tech/sander/rowsandall/src/branch/develop/rowing-courses-spec.md |
| Rowsandall courses | https://git.wereldraadsel.tech/sander/rowsandall (rowers/courses.py, courseutils.py) |
| intervals.icu OAuth | https://forum.intervals.icu/t/intervals-icu-oauth-support/2759 |
| CrewNerd integration | https://analytics.rowsandall.com/2024/04/16/rowsandall-crewnerd-courses/ |
| CrewNerd (app) | https://www.performancephones.com |
| Cloudflare Workers | https://developers.cloudflare.com/workers/ |
| Cloudflare KV | https://developers.cloudflare.com/kv/ |

---

## Repositories

| Repo | Purpose | Status |
|------|---------|--------|
| `rownative/courses` | Course data, site, scripts, workflows | Part 1 (library) complete |
| `rownative/worker` | Cloudflare Worker | Skeleton only; Part 1 Worker not implemented |

---

## Summary

**Part 1 — Course library:** Complete. Schema, validation, scripts, GitHub Actions, Leaflet map browser, KML cache, country fixer, dev server. 164 courses migrated.

**Part 1 — Worker:** Not implemented. OAuth, CrewNerd API, KML generation, submit/import endpoints, KV integration.

**Part 2:** Not started.

**Next steps:** Implement Cloudflare Worker per spec §1.6; configure intervals.icu OAuth; provision KV and secrets; set up DNS for rownative.icu.
