const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatCourseDistance,
  formatAveragePace,
  colorForResultId,
  courseTrackColors,
  createCourseTrackController,
} = require("../site/challenge-format.js");

test("formats valid course distance in whole metres", () => {
  assert.equal(formatCourseDistance(4999.6), "5000");
});

test("uses an em dash for unavailable or invalid course distance", () => {
  assert.equal(formatCourseDistance(null), "—");
  assert.equal(formatCourseDistance(0), "—");
  assert.equal(formatCourseDistance(-1), "—");
});

test("calculates pace per 500m from raw time and measured distance", () => {
  assert.equal(formatAveragePace(1320, 5000), "2:12.0");
  assert.equal(formatAveragePace(603, 2500), "2:00.6");
});

test("rounds pace to tenths without carrying seconds past 60", () => {
  assert.equal(formatAveragePace(599.9, 2500), "2:00.0");
});

test("does not calculate pace when time or distance is invalid", () => {
  assert.equal(formatAveragePace(1200, null), "—");
  assert.equal(formatAveragePace(null, 5000), "—");
  assert.equal(formatAveragePace(1200, 0), "—");
});

test("keeps course-track colours stable for a result", () => {
  assert.equal(colorForResultId("result-a"), colorForResultId("result-a"));
  assert.match(colorForResultId("result-a"), /^#[0-9a-f]{6}$/);
});

test("allocates each palette colour once before allowing overflow", async () => {
  const controller = createCourseTrackController({
    fetchTrack: async () => ({ latlng: [[1, 2], [3, 4]] }),
    createLayer: (latlng, color) => ({ latlng, color }),
    addLayer: () => {},
    removeLayer: () => {},
  });

  await Promise.all(Array.from({ length: 7 }, (_, index) => controller.setSelected("r" + (index + 1), true)));

  const firstSix = Array.from({ length: 6 }, (_, index) => controller.getColor("r" + (index + 1)));
  assert.equal(new Set(firstSix).size, 6);
  assert.ok(courseTrackColors.includes(controller.getColor("r7")));
});

test("releases a colour without recolouring active selections", async () => {
  const controller = createCourseTrackController({
    fetchTrack: async () => ({ latlng: [[1, 2], [3, 4]] }),
    createLayer: (latlng, color) => ({ latlng, color }),
    addLayer: () => {},
    removeLayer: () => {},
  });

  await controller.setSelected("r1", true);
  await controller.setSelected("r2", true);
  const r2Color = controller.getColor("r2");
  controller.retain(new Set(["r1", "r2"]));
  controller.setSelected("r1", false);
  await controller.setSelected("r3", true);

  assert.equal(controller.getColor("r3"), courseTrackColors[0]);
  assert.equal(controller.getColor("r2"), r2Color);
});

test("releases a colour when loading a selected path fails", async () => {
  const controller = createCourseTrackController({
    fetchTrack: async (resultId) => {
      if (resultId === "bad") throw new Error("gone");
      return { latlng: [[1, 2], [3, 4]] };
    },
    createLayer: (latlng, color) => ({ latlng, color }),
    addLayer: () => {},
    removeLayer: () => {},
  });

  assert.equal(await controller.setSelected("bad", true), false);
  assert.equal(controller.getColor("bad"), null);
  await controller.setSelected("good", true);
  assert.equal(controller.getColor("good"), courseTrackColors[0]);
});

test("does not add a stale course path after it has been switched off", async () => {
  let resolveTrack;
  const added = [];
  const removed = [];
  const controller = createCourseTrackController({
    fetchTrack: () => new Promise((resolve) => { resolveTrack = resolve; }),
    colorForId: colorForResultId,
    createLayer: (latlng, color) => ({ latlng, color }),
    addLayer: (layer) => added.push(layer),
    removeLayer: (layer) => removed.push(layer),
  });

  const pending = controller.setSelected("r1", true);
  controller.setSelected("r1", false);
  await Promise.resolve();
  resolveTrack({ latlng: [[1, 2], [3, 4]] });

  assert.equal(await pending, false);
  assert.equal(controller.isSelected("r1"), false);
  assert.deepEqual(added, []);
  assert.deepEqual(removed, []);
});

test("ignores an old load after deselect and reselect", async () => {
  const pendingTracks = [];
  const added = [];
  const controller = createCourseTrackController({
    fetchTrack: (resultId) => new Promise((resolve) => pendingTracks.push({ resultId, resolve })),
    createLayer: (latlng, color) => ({ latlng, color }),
    addLayer: (layer) => added.push(layer),
    removeLayer: () => {},
  });

  const first = controller.setSelected("r1", true);
  await Promise.resolve();
  controller.setSelected("r1", false);
  const second = controller.setSelected("r1", true);
  await Promise.resolve();

  assert.equal(pendingTracks.length, 2);
  pendingTracks[0].resolve({ latlng: [[1, 2], [3, 4]] });
  assert.equal(await first, false);
  assert.equal(controller.isSelected("r1"), true);

  pendingTracks[1].resolve({ latlng: [[5, 6], [7, 8]] });
  assert.equal(await second, true);
  assert.equal(added.length, 1);
  assert.deepEqual(added[0].latlng, [[5, 6], [7, 8]]);
  assert.equal(added[0].color, controller.getColor("r1"));
});

test("removes selected paths when their rows become hidden", async () => {
  const added = [];
  const removed = [];
  const controller = createCourseTrackController({
    fetchTrack: async () => ({ latlng: [[1, 2], [3, 4]] }),
    colorForId: colorForResultId,
    createLayer: (latlng, color) => ({ latlng, color }),
    addLayer: (layer) => added.push(layer),
    removeLayer: (layer) => removed.push(layer),
  });

  await controller.setSelected("r1", true);
  controller.retain(new Set());

  assert.equal(added.length, 1);
  assert.equal(removed.length, 1);
  assert.equal(controller.isSelected("r1"), false);
  assert.equal(controller.getColor("r1"), null);
  await controller.setSelected("r2", true);
  assert.equal(controller.getColor("r2"), courseTrackColors[0]);
});
