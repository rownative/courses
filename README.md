# rownative/courses

Community library of GPS-defined rowing courses for use with [CrewNerd](https://www.crewtimer.com/crewnerd) and [rownative.icu](https://rownative.icu).

Each course is a set of GPS polygons (start, waypoints, finish) that define a measured rowing course. CrewNerd uses these to provide automatic course timing on the water.

## Using the courses

Browse and search courses at [rownative.icu](https://rownative.icu). Log in with your intervals.icu account to like courses and have them synced to CrewNerd.

## Submitting a course

You can submit a course via the web form at [rownative.icu/submit](https://rownative.icu/submit), or by opening a pull request directly:

1. Fork this repository.
2. Add a JSON file to `courses/` following the schema in [`courses/SCHEMA.md`](courses/SCHEMA.md).
3. Open a pull request — automated validation will run and report any issues as a PR comment.
4. On passing validation the PR is merged automatically and the course appears on the map within minutes.

New courses are assigned `status: provisional` until they have been used in a timed result or endorsed by a curator.

## Migrating from Rowsandall

If you have courses on Rowsandall, use the "Download my courses" button there to export a ZIP, then upload it at [rownative.icu/import](https://rownative.icu/import).

## Running validation locally
```bash
pip install -r scripts/requirements.txt
python scripts/validate_course.py courses/your-course.json
```

## License

Course data: [Open Database License (ODbL) 1.0](LICENSE) — you are free to use, share, and adapt the data as long as you attribute and keep it open.

Scripts in `scripts/`: [MIT](LICENSE-CODE).
