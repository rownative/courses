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

## Polygon object

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `name` | string | yes | Polygon name (e.g. `"Start"`, `"Gate 1"`, `"Finish"`). |
| `order` | number | yes | Order in course (0 = start, 1 = first waypoint, etc.). |
| `points` | array | yes | At least three `{lat, lon}` points. May close the ring (first point repeated at end). |

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

## Status values

| Value | Meaning |
| ----- | ------- |
| `provisional` | Structurally valid; not yet proven in a timed row. Served to CrewNerd normally. |
| `established` | Has been used for at least one timed result or endorsed by a curator. |
