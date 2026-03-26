/**
 * Local dev only: scripts/serve_dev.py injects this into _site/index.html when live reload is on.
 * Polls /__dev/reload and refreshes when the server rebuilds (file change under site/, courses/, kml/, or generators).
 */
(function () {
  var h = location.hostname;
  if (h !== "localhost" && h !== "127.0.0.1") return;
  var last = -1;
  function poll() {
    fetch("/__dev/reload", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("bad status");
        return r.json();
      })
      .then(function (d) {
        var s = typeof d.seq === "number" ? d.seq : 0;
        if (last < 0) {
          last = s;
        } else if (s !== last) {
          location.reload();
          return;
        }
      })
      .catch(function () {})
      .finally(function () {
        setTimeout(poll, 800);
      });
  }
  poll();
})();
