# Speed Orders (Challenges) — Specification and Implementation Plan

Time-windowed GPS challenges on measured courses. Organisers create challenges; participants row the course during the window, upload their workout, and appear on a public leaderboard. Supports raw-time and handicap scoring.

**References**: [Rowsandall OTW Challenges](https://analytics.rowsandall.com/2020/06/14/otw-challenges-how-do-they-work/), [rowing-courses-spec Stage 2](https://git.wereldraadsel.tech/sander/rowsandall/src/branch/develop/rowing-courses-spec.md)

---

## 1. Overview

### 1.1 Concepts

- **Challenge** — A time-windowed competition on a specific course. Has a row window (when you can row), a submission deadline, and optional handicap scoring.
- **Organiser** — User who creates and manages challenges. Status is granted via `organisers.json` (repo admins add athlete IDs).
- **Result** — A submitted workout validated against the course. Includes raw time, optional corrected time (handicap), and validation status.

### 1.2 User Flows

**Participant**:
1. Browse challenges (active / upcoming / past)
2. Open challenge detail → see leaderboard, map, course info
3. When submissions open: select workout, enter display name, declare category (if handicap)
4. Submit → GPS validated; result appears on leaderboard or error with validation note

**Organiser**:
1. Request organiser status (GitHub issue) → admins add to `organisers.json`
2. Create challenge: course, row window, submit deadline, handicap option
3. Manage standard collections (built-in or custom CSV)
4. Moderate results: approve or disqualify pending/invalid submissions
5. View GPS track overlay for disputed results

---

## 2. Specification

### 2.1 Challenges List Page (`challenges.html`)

- **Title**: "Speed Orders"
- **Intro**: "Time-windowed GPS challenges on measured courses. Row the course, upload your workout, see how you rank."
- **Filter tabs**: Active | Upcoming | Past
- **Challenge cards**: Course name (link to map), challenge name, row window, submit deadline, results count, handicap badge, "View leaderboard" button
- **Empty state**: "No challenges in this category. Check back later or set up your own."
- **Signed-in CTA**: Organiser → "Set up a Challenge"; Non-organiser → "Request to become challenge organiser" (GitHub issue)

### 2.2 Challenge Detail Page (`challenge.html?id={uuid}`)

- **Header**: Challenge name, course link, row window, submit deadline, status badge (Open for submissions | Submissions closed | Upcoming)
- **Map**: Leaflet with course polygons
- **Leaderboard**: Rank, Athlete, Boat, Raw time, Corrected time (if handicap), Points (if handicap), Date, Status; filters by boat type and sex
- **Submit result** (signed-in, when open): Modal with activity selector, display name, category (if handicap). Button hidden after submit deadline.

### 2.3 Organiser Panel (`organiser.html`)

- **Access**: Organisers only; others see "Request to become challenge organiser"
- **Create challenge**: Name, course, row window, submit deadline, handicap checkbox, standard collection, notes
- **Standard collections**: Built-in (HOCR, FISA Masters, Charles River) + custom CSV upload
- **My challenges**: Table with View leaderboard link
- **Moderate results**: Select challenge, list pending/invalid results, Approve or Disqualify with note

### 2.4 Status Logic

| Condition | Status |
|-----------|--------|
| `row_start` > now | Upcoming |
| `now` > `submit_end` | Submissions closed |
| `row_start` ≤ now ≤ `submit_end` | Open for submissions |

Submit button visible only when status is "Open" and user is signed in.

### 2.5 Validation Rules (Worker — Phase 2)

On result submission, the Worker must:

1. Validate challenge exists and `now <= submit_end`
2. Fetch activity from intervals.icu
3. Fetch GPS streams, load course JSON
4. Run `calculateCourseTime()` — validate gates, multi-pass
5. **Validate workout date** (`start_time` from GPS) is within `row_start`..`row_end`
6. If handicap: lookup standard, compute corrected time and points

### 2.6 Boat Type and Category

- **Current**: intervals.icu does not expose boat type. User declares at submission.

- **Form fields** (handicap challenges): Boat type (1x, 2x, 2-, 4x, 4-, 4+, 8+), Sex (M/F/Mixed), Weight (HWT/LWT), Age (optional)

- **Future**: When intervals.icu adds equipment metadata, pre-fill from activity; user can override. Store `category_source`: `user_declared` or `intervals_icu`.

### 2.7 Organiser Status

- **Request**: "Request to become challenge organiser" opens GitHub issue
- **Grant**: Admins add athlete ID to `courses/organisers.json`
- **Worker**: Fetches `organisers.json` from GitHub (cached in KV); `isOrganizer` = athlete in list
- **Revoke**: Remove athlete ID from file

### 2.8 Challenge Removal

- **Config**: `courses/removed-challenges.json` lists challenge IDs to hide
- **Worker**: Filters these IDs when listing challenges
- **Admin**: Add ID via PR

---

## 3. API Contract

### 3.1 Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/challenges?status=active\|upcoming\|past` | List challenges |
| GET | `/api/challenges/{id}` | Challenge detail |
| GET | `/api/challenges/{id}/results` | Leaderboard results |
| POST | `/api/challenges/{id}/submit` | Submit result (auth required) |

### 3.2 Organiser (auth + isOrganizer required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/organiser/challenges` | My challenges |
| POST | `/api/organiser/challenges` | Create challenge |
| GET | `/api/organiser/challenges/{id}/results` | All results (incl. pending) |
| POST | `/api/organiser/results/{id}/override` | Approve or disqualify |
| GET | `/api/organiser/standard-collections` | List collections |
| POST | `/api/organiser/standard-collections` | Upload custom CSV |

### 3.3 Submit Request Body

```json
{
  "activityId": "string",
  "displayName": "optional",
  "boatType": "1x|2x|2-|4x|4-|4+|8+",
  "sex": "M|F|X",
  "weightClass": "HWT|LWT",
  "ageMin": 0,
  "ageMax": 0
}
```

### 3.4 GET /api/me

Response includes `isOrganizer: boolean` when signed in.

---

## 4. Data Model

### 4.1 challenges

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID |
| name | TEXT | Challenge name |
| course_id | TEXT | FK to courses |
| row_start | TEXT | ISO 8601 |
| row_end | TEXT | ISO 8601 |
| submit_end | TEXT | ISO 8601 |
| collection_id | TEXT | FK to standard_collections (nullable) |
| organizer_id | TEXT | intervals.icu athlete ID |
| is_public | INTEGER | 0 or 1 |
| notes | TEXT | Optional |
| created_at | TEXT | ISO 8601 |

### 4.2 challenge_results

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID |
| challenge_id | TEXT | FK |
| athlete_id | TEXT | intervals.icu athlete ID |
| activity_id | TEXT | intervals.icu activity ID |
| display_name | TEXT | From profile or user input |
| raw_time_s | REAL | Seconds |
| corrected_time_s | REAL | Handicap only |
| points | REAL | Handicap only |
| boat_type | TEXT | 1x, 2x, etc. |
| sex | TEXT | M, F, X |
| weight_class | TEXT | HWT, LWT |
| category_source | TEXT | user_declared \| intervals_icu |
| start_time | TEXT | From GPS |
| validation_status | TEXT | pending, valid, manual_ok, invalid, dq |
| validation_note | TEXT | Error or override reason |
| submitted_at | TEXT | ISO 8601 |

---

## 5. Implementation Plan

### Phase 1 — GUI with Mock API (Done)

| Step | Status | Description |
|------|--------|-------------|
| 1 | Done | Mock challenge API in `serve_dev.py` (all endpoints, `?mock_organizer=1`) |
| 2 | Done | Challenges list page |
| 3 | Done | Challenge detail / leaderboard |
| 4 | Done | Organiser panel |

**Config files**: `courses/organisers.json`, `courses/removed-challenges.json` (empty `[]`)

### Phase 2 — Worker and D1 (Remaining)

| Step | Status | Description |
|------|--------|-------------|
| 5 | Done | D1 migrations: challenges, challenge_results, standard_collections |
| 6 | Done | Organiser status: fetch `organisers.json`, extend `/api/me` |
| 7 | Done | Challenge CRUD API (Worker) |
| 8 | Done | Standard collections API |
| 9 | Done | Result submission with GPS validation (validate workout in row window) |
| 10 | Done | Handicap scoring logic |
| 11 | Done | Organiser moderation API |
| 12 | Done | Track overlay for moderation |
| 13 | Done | Validation log and multi-pass |
| 14 | | Private challenges |
| 15 | | Display name from intervals.icu profile |
| 16 | | Documentation and deploy |
| 17 | | Challenge removal (config file) |
| 18 | | (Future) intervals.icu activity metadata |

---

## 6. Known Gaps (Current Implementation)

| Gap | Phase 1 Behaviour | Phase 2 Target |
|-----|-------------------|----------------|
| Workout date validation | Mock accepts any activity | Validate `start_time` within `row_start`..`row_end` |
| Submit button refresh | Set once on page load | Consider periodic refresh or visibility check |
| Activity list filter | Shows all activities | Filter to last month, optionally within row window |
| GPS validation | Mock always succeeds | Full validation via `course-time.ts` |

---

## 7. Key Files

| File | Purpose |
|------|---------|
| `site/challenges.html` | Challenges list |
| `site/challenge.html` | Challenge detail |
| `site/organiser.html` | Organiser panel |
| `site/challenges.js` | Challenges list logic |
| `site/challenge.js` | Leaderboard + submit modal |
| `site/organiser.js` | Organiser forms |
| `scripts/serve_dev.py` | Mock API |
| `courses/organisers.json` | Organiser athlete IDs |
| `courses/removed-challenges.json` | Hidden challenge IDs |
