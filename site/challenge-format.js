/* Shared presentation helpers for challenge results. */
(function (root, factory) {
  const api = factory();
  root.rownativeChallengeFormat = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function formatTime(seconds) {
    if (seconds == null) return "—";
    const s = Math.round(Number(seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins + ":" + String(secs).padStart(2, "0");
  }

  function formatCourseDistance(distanceM) {
    const distance = Number(distanceM);
    return Number.isFinite(distance) && distance > 0 ? String(Math.round(distance)) : "—";
  }

  function formatAveragePace(rawTimeS, distanceM) {
    const rawTime = Number(rawTimeS);
    const distance = Number(distanceM);
    if (!Number.isFinite(rawTime) || rawTime <= 0 || !Number.isFinite(distance) || distance <= 0) return "—";
    const totalTenths = Math.round(rawTime * 5000 / distance);
    const mins = Math.floor(totalTenths / 600);
    const secs = ((totalTenths % 600) / 10).toFixed(1);
    return mins + ":" + secs.padStart(4, "0");
  }

  const COURSE_TRACK_COLORS = Object.freeze(["#0b6e99", "#be4b20", "#6a4c93", "#2b8a3e", "#a61e4d", "#7950f2"]);

  function colorForResultId(resultId) {
    let hash = 0;
    const value = String(resultId || "");
    for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    return COURSE_TRACK_COLORS[Math.abs(hash) % COURSE_TRACK_COLORS.length];
  }

  function createCourseTrackController(options) {
    const selected = new Set();
    const layers = new Map();
    const generations = new Map();
    const colors = new Map();
    let allocationCount = 0;

    function nextGeneration(resultId) {
      const next = (generations.get(resultId) || 0) + 1;
      generations.set(resultId, next);
      return next;
    }

    function allocateColor(resultId) {
      if (colors.has(resultId)) return colors.get(resultId);
      const used = new Set(colors.values());
      let color = COURSE_TRACK_COLORS.find((candidate) => !used.has(candidate));
      if (!color) {
        color = COURSE_TRACK_COLORS[allocationCount % COURSE_TRACK_COLORS.length];
      }
      allocationCount += 1;
      colors.set(resultId, color);
      return color;
    }

    function deselect(resultId) {
      const id = String(resultId);
      selected.delete(id);
      nextGeneration(id);
      const layer = layers.get(id);
      if (layer) {
        options.removeLayer(layer);
        layers.delete(id);
      }
      colors.delete(id);
    }

    function setSelected(resultId, shouldShow) {
      const id = String(resultId);
      if (!shouldShow) {
        deselect(id);
        return Promise.resolve(false);
      }
      if (selected.has(id)) return Promise.resolve(true);

      selected.add(id);
      const color = allocateColor(id);
      const generation = nextGeneration(id);
      return Promise.resolve()
        .then(() => options.fetchTrack(id))
        .then((data) => {
          const latlng = data && data.latlng;
          if (!Array.isArray(latlng) || latlng.length < 2) throw new Error("Course path is unavailable");
          if (!selected.has(id) || generations.get(id) !== generation) return false;
          const layer = options.createLayer(latlng, color);
          layers.set(id, layer);
          options.addLayer(layer);
          return true;
        })
        .catch((error) => {
          if (selected.has(id) && generations.get(id) === generation) {
            deselect(id);
            if (typeof options.onLoadError === "function") options.onLoadError(id, error);
          }
          return false;
        });
    }

    function retain(visibleResultIds) {
      selected.forEach((id) => {
        if (!visibleResultIds.has(id)) deselect(id);
      });
    }

    return {
      setSelected,
      retain,
      isSelected(resultId) { return selected.has(String(resultId)); },
      getColor(resultId) { return colors.get(String(resultId)) || null; },
    };
  }

  return { formatCourseDistance, formatAveragePace, colorForResultId, createCourseTrackController, courseTrackColors: COURSE_TRACK_COLORS };
});
