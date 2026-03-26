# Testing

## Baseline line coverage (Mar 2026)

| Area | Typical % | CI gate |
|------|-----------|---------|
| `scripts/validate_course.py` | ~74% | ≥70% (`pytest --cov=validate_course --cov-fail-under=70`) |
| `scripts/generate_kml.py` (smoke tests only) | partial | Combined with validator in [`test.yml`](../.github/workflows/test.yml) |
| Worker modules except `index.ts` | ~90% lines (Istanbul) | Per-file ≥75% on `kml-to-course`, `course-time`, `content-filter`; `index.ts` excluded from coverage |

## Python (`courses` repo)

Install dev dependencies:

```bash
pip install -r scripts/requirements.txt
```

Run all Python tests:

```bash
pytest
```

Validator tests with coverage on the **`validate_course`** module (import name under `scripts/`; CI runs this with a line gate):

```bash
pytest scripts/test_validate_course.py \
  --cov=validate_course \
  --cov-report=term-missing \
  --cov-fail-under=70
```

`generate_kml` smoke test only:

```bash
pytest scripts/test_generate_kml.py \
  --cov=generate_kml \
  --cov-report=term-missing
```

### `generate_kml` smoke tests

[`scripts/test_generate_kml.py`](../scripts/test_generate_kml.py) checks that `course_to_kml` emits plausible KML for a minimal course dict.

## Worker (Cloudflare)

From the `worker` directory:

```bash
npm test
npm run test:coverage
```

Use **Istanbul** for coverage (`@vitest/coverage-istanbul`). The Cloudflare Workers Vitest pool does **not** support V8/native coverage ([docs](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/)).

HTML report: `npm run test:coverage` writes to `coverage/` (gitignored). In the worker repo, `src/index.ts` is excluded from the coverage report and thresholds; integration tests live in `test/index.spec.ts`.

## Frontend (`site/app.js`)

There is no automated browser suite yet. Before release, manually verify:

- Map loads and markers appear; open a course detail panel.
- With `?api=http://localhost:8787/api`, auth error messages show a sensible URL; KML download and sign-in links work.
- Challenge and organiser pages (if applicable) load without console errors.

To add automated UI tests later: Playwright/Cypress against static `serve_dev.py`, or extract small pure helpers from `app.js` and unit-test them with Vitest in this repo.
