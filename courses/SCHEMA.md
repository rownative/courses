# Course JSON Schema

Each course is stored as a single JSON file in the `courses/` directory. The filename must be `{id}.json` where `id` matches the `id` field.

## Top-level fields

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `id` | string | yes | Unique course identifier (e.g. `"66"`, `"001"`). Preserved from Rowsandall for migration. |
| `name` | string | yes | Human-readable course name shown in CrewNerd and on the course page. |
| `country` | string | yes | Country code or full name (e.g. `"NL"`, `"United States"`). |
| `center_lat` | number | yes | Latitude of course center for map display and geo filtering. |
| `center_lon` | number | yes | Longitude of course center. |
| `distance_m` | number | yes | Course length in meters (sum of centroid-to-centroid distances along polygon chain). |
| `notes` | string | no | Optional description shown in CrewNerd and on the course page. |
| `status` | string | yes | One of `provisional` or `established`. |
| `submitted_by` | string | no | Optional (e.g. `"migrated from Rowsandall"`). |
| `polygons` | array | yes | At least two polygons defining start, waypoints, and finish. |
| `path` | array | no | Traced course centreline as ordered `{lat, lon}` points, start to finish. Advisory: `polygons` remains the authority for timing and gate detection. See [Path](#path-optional). |

## Polygon object

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `name` | string | yes | Polygon name (e.g. `"Start"`, `"Gate 1"`, `"Finish"`). |
| `order` | number | yes | Order in course (0 = start, 1 = first waypoint, etc.). |
| `points` | array | yes | At least three `{lat, lon}` points. May close the ring (first point repeated at end). |

## Path (optional)

A `path` is the line a crew actually rows, traced along the water. It exists so that consumers
that *draw* a course have something better than gate-to-gate straight lines, and so that a
traced route has a proper home instead of being stored as a polygon (a polygon with dozens of
vertices and a kilometre-scale extent is read as a gate by everything that follows this schema,
which is the wrong shape entirely).

| Rule | Detail |
| ---- | ------ |
| Shape | Array of at least two `{lat, lon}` objects, in rowing order from start to finish. Do not close the ring for loop courses; the last point is where the crew finishes. |
| Advisory only | `polygons` stay authoritative for timing and gate detection. A consumer that ignores `path` sees exactly what it saw before. |
| `distance_m` unchanged | `distance_m` remains the centroid-to-centroid polygon chain, even when a `path` is present. The traced length is derivable from `path` by any consumer that wants it. |
| Must pass the gates | Validation requires the path to pass within 250 m of every polygon's centroid (or within the polygon's own extent, whichever is larger). A path that misses a gate is rejected, since that usually means the wrong route was traced. |
| Not a polygon | Never store a traced route in `polygons`. Move it to `path`. |

The cached KML in `kml/` emits the path as a `<LineString>` Placemark named `Path` after the gate
polygons.

```json
{
  "id": "179",
  "distance_m": 19599,
  "path": [
    {"lat": 55.9012, "lon": -4.4523},
    {"lat": 55.9021, "lon": -4.4498}
  ],
  "polygons": [ ... ]
}
```

## Example

```json
{
  "id": "001",
  "name": "Amstel Buiten",
  "country": "NL",
  "center_lat": 52.3512,
  "center_lon": 4.9284,
  "distance_m": 1500,
  "notes": "Optional description.",
  "status": "established",
  "polygons": [
    {
      "name": "Start",
      "order": 0,
      "points": [
        {"lat": 52.3500, "lon": 4.9270},
        {"lat": 52.3505, "lon": 4.9275},
        {"lat": 52.3495, "lon": 4.9280}
      ]
    },
    {
      "name": "Finish",
      "order": 1,
      "points": [
        {"lat": 52.3520, "lon": 4.9300},
        {"lat": 52.3525, "lon": 4.9305},
        {"lat": 52.3515, "lon": 4.9310}
      ]
    }
  ]
}
```

## Index (`courses/index.json`)

`scripts/generate_index.py` builds `courses/index.json`, a flat array with one entry per course.
It is what the map browser and third-party consumers fetch instead of all the course files, so it
carries everything needed to search and filter without a second request.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id`, `name`, `country`, `center_lat`, `center_lon`, `distance_m`, `status` | | Copied from the course file. |
| `notes` | string | The course's `notes`, trimmed; `""` when absent. Free-text search should cover `name` and `notes`. |
| `has_path` | boolean | `true` when the course file carries a usable `path` (two or more points). |

## Status values

| Value | Meaning |
| ----- | ------- |
| `provisional` | Structurally valid; not yet proven in a timed row. Served to CrewNerd normally. |
| `established` | Has been used for at least one timed result or endorsed by a curator. |
