/**
 * Speed Orders — challenges list page
 */
(function () {
  "use strict";

  const API_BASE = (typeof window.ROWNATIVE_API !== "undefined" && window.ROWNATIVE_API)
    ? window.ROWNATIVE_API
    : "/api";

  const listEl = document.getElementById("challenges-list");
  const emptyState = document.getElementById("empty-state");
  const emptyCta = document.getElementById("empty-cta");
  const organiserCta = document.getElementById("organiser-cta");
  const organiserCtaText = document.getElementById("organiser-cta-text");
  const signInLink = document.getElementById("sign-in-link");
  const signInOrganiserLink = document.getElementById("sign-in-organiser-link");
  const signOutLink = document.getElementById("sign-out-link");
  const myTimesLink = document.getElementById("my-times-link");
  const organiserLink = document.getElementById("organiser-link");
  const importLink = document.getElementById("import-link");
  const submitLink = document.getElementById("submit-link");
  const updateLink = document.getElementById("update-link");
  const authTeaser = document.getElementById("auth-teaser");
  const userInfo = document.getElementById("user-info");

  let currentStatus = "active";
  let isSignedIn = false;
  let isOrganizer = false;
  let meAthleteId = null;
  let meAthleteDisplayName = null;

  function organiserIssueUrl() {
    if (typeof window.rownativeOrganiserRequestIssueUrl === "function") {
      return window.rownativeOrganiserRequestIssueUrl(meAthleteId, meAthleteDisplayName);
    }
    return "https://github.com/rownative/courses/issues/new?title=Request+to+become+challenge+organiser";
  }

  function fmtDateRange(start, end) {
    if (!start || !end) return "—";
    const s = start.slice(0, 10) || start;
    const e = end.slice(0, 10) || end;
    return s + " – " + e;
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = iso.slice(0, 10) || iso;
    return d;
  }

  function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }

  function leaderboardHref(id) {
    const u = "challenge.html?id=" + encodeURIComponent(id);
    return typeof window.rownativeAppendToHref === "function" ? window.rownativeAppendToHref(u) : u;
  }

  function courseOnMapHref(courseId) {
    const u = "index.html#course-" + encodeURIComponent(courseId);
    return typeof window.rownativeAppendToHref === "function" ? window.rownativeAppendToHref(u) : u;
  }

  function fmtDistanceM(m) {
    if (m == null || m === "") return "";
    const n = Number(m);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n >= 1000) {
      const km = n / 1000;
      const s = km >= 10 ? String(Math.round(km)) : String(Math.round(km * 10) / 10).replace(/\.0$/, "");
      return s + " km";
    }
    return Math.round(n) + " m";
  }

  function safeMapId(id) {
    return String(id).replace(/\W/g, "_");
  }

  const miniMaps = [];
  let challengesLoadSeq = 0;

  function destroyMiniMaps() {
    miniMaps.forEach((m) => {
      try {
        m.remove();
      } catch (e) {
        /* ignore */
      }
    });
    miniMaps.length = 0;
  }

  function initMiniMaps(challenges, loadSeq) {
    if (typeof L === "undefined") return;
    const defaultPolyStyle = { color: "#0af", fillColor: "#0af", fillOpacity: 0.2, weight: 2 };
    challenges.forEach((c) => {
      const el = document.getElementById("challenge-mini-map-" + safeMapId(c.id));
      if (!el) return;
      if (typeof window.rownativeMapHighContrastEnabled === "function" && window.rownativeMapHighContrastEnabled()) {
        el.classList.add("map-high-contrast");
      }
      const polyStyle =
        typeof window.rownativeLeafletPolygonStyle === "function"
          ? window.rownativeLeafletPolygonStyle()
          : defaultPolyStyle;
      const center =
        c.center_lat != null && c.center_lon != null ? [c.center_lat, c.center_lon] : [20, 0];
      const map = L.map(el, { scrollWheelZoom: false });
      miniMaps.push(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);
      map.setView(center, 4);
      const courseId = c.courseId;
      if (!courseId) {
        setTimeout(() => map.invalidateSize(), 0);
        return;
      }
      fetch("./courses/" + encodeURIComponent(courseId) + ".json")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          if (loadSeq !== challengesLoadSeq) return;
          if (!data.polygons || data.polygons.length === 0) return;
          const bounds = [];
          data.polygons.forEach((poly) => {
            const pts = (poly.points || []).map((p) => [p.lat, p.lon]);
            if (pts.length >= 2) {
              if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) {
                pts.push(pts[0]);
              }
              L.polygon(pts, polyStyle).addTo(map);
              pts.forEach((p) => bounds.push(p));
            }
          });
          if (bounds.length > 0) {
            map.fitBounds(bounds, { padding: [6, 6], maxZoom: 14 });
          }
        })
        .catch(() => {})
        .finally(() => {
          if (loadSeq !== challengesLoadSeq) return;
          setTimeout(() => map.invalidateSize(), 0);
        });
    });
  }

  function checkAuth() {
    return fetch(API_BASE + "/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        isSignedIn = !!data.athleteId;
        isOrganizer = !!data.isOrganizer;
        if (isSignedIn) {
          signInLink.classList.add("hidden");
          signInOrganiserLink.classList.toggle("hidden", isOrganizer);
          signOutLink.classList.remove("hidden");
          myTimesLink?.classList.remove("hidden");
          importLink?.classList.remove("hidden");
          submitLink?.classList.remove("hidden");
          updateLink?.classList.remove("hidden");
          authTeaser?.classList.add("hidden");
          userInfo?.classList.remove("hidden");
          userInfo.textContent = "Signed in";
          if (isOrganizer) {
            organiserLink?.classList.remove("hidden");
          } else {
            organiserLink?.classList.add("hidden");
          }
        } else {
          signInLink.classList.remove("hidden");
          signInOrganiserLink.classList.remove("hidden");
          signOutLink.classList.add("hidden");
          myTimesLink?.classList.add("hidden");
          organiserLink?.classList.add("hidden");
          importLink?.classList.add("hidden");
          submitLink?.classList.add("hidden");
          updateLink?.classList.add("hidden");
          authTeaser?.classList.remove("hidden");
          userInfo?.classList.add("hidden");
        }
      })
      .catch(() => {
        meAthleteId = null;
        meAthleteDisplayName = null;
        signInLink.classList.remove("hidden");
        signInOrganiserLink.classList.add("hidden");
        organiserLink?.classList.add("hidden");
      });
  }

  function loadChallenges(status) {
    currentStatus = status;
    const loadSeq = ++challengesLoadSeq;
    destroyMiniMaps();
    listEl.innerHTML = "<p>Loading…</p>";
    emptyState.classList.add("hidden");

    fetch(API_BASE + "/challenges?status=" + encodeURIComponent(status), { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const challenges = data.challenges || [];
        if (challenges.length === 0) {
          listEl.innerHTML = "";
          emptyState.classList.remove("hidden");
          if (isSignedIn) {
            if (isOrganizer) {
              emptyCta.innerHTML = '<a href="organiser.html" class="btn">Set up a Challenge</a>';
            } else {
              emptyCta.innerHTML =
                '<a href="' +
                escapeAttr(organiserIssueUrl()) +
                '" target="_blank" rel="noopener" class="btn">Request to become challenge organiser</a>';
            }
          } else {
            emptyCta.innerHTML = '<a href="/oauth/authorize" class="btn">Sign in</a> to set up or join challenges.';
          }
        } else {
          emptyState.classList.add("hidden");
          listEl.innerHTML = challenges
            .map((c) => {
              const dist = fmtDistanceM(c.distance_m);
              const distHtml = dist
                ? "<span class='challenge-distance'> · " + escapeHtml(dist) + "</span>"
                : "";
              const badge = c.hasHandicap
                ? '<span class="badge handicap">Handicap scoring</span>'
                : '<span class="badge raw">Raw times only</span>';
              return (
                '<div class="challenge-card">' +
                '<div class="challenge-card-inner">' +
                '<div class="challenge-card-main">' +
                '<h3 class="challenge-title">' +
                '<a href="' +
                escapeAttr(leaderboardHref(c.id)) +
                '">' +
                escapeHtml(c.name) +
                "</a></h3>" +
                '<div class="challenge-course-line">' +
                '<a href="' +
                escapeAttr(courseOnMapHref(c.courseId)) +
                '">' +
                escapeHtml(c.courseName || "Course " + c.courseId) +
                "</a>" +
                distHtml +
                "</div>" +
                '<div class="meta">' +
                "Row between " +
                fmtDateRange(c.rowStart, c.rowEnd) +
                "<br>" +
                "Submit by " +
                fmtDate(c.submitEnd) +
                " · " +
                (c.resultsCount || 0) +
                " results" +
                "</div>" +
                '<div class="meta">' +
                badge +
                "</div>" +
                "</div>" +
                '<div class="challenge-card-map-wrap">' +
                '<div class="challenge-square-map">' +
                '<div class="challenge-mini-map" id="challenge-mini-map-' +
                safeMapId(c.id) +
                '" role="img" aria-label="Course map"></div>' +
                "</div></div></div></div>"
              );
            })
            .join("");
          requestAnimationFrame(() => initMiniMaps(challenges, loadSeq));
        }

        if (isSignedIn) {
          organiserCta.classList.remove("hidden");
          if (isOrganizer) {
            organiserCtaText.innerHTML = '<a href="organiser.html">Set up a Challenge</a> — create and manage your own Speed Orders.';
          } else {
            organiserCtaText.innerHTML =
              'Want to run your own? <a href="' +
              escapeAttr(organiserIssueUrl()) +
              '" target="_blank" rel="noopener">Request to become challenge organiser</a>.';
          }
        } else {
          organiserCta.classList.add("hidden");
        }
      })
      .catch(() => {
        destroyMiniMaps();
        listEl.innerHTML = "<p class='error'>Failed to load challenges.</p>";
        emptyState.classList.add("hidden");
      });
  }

  document.querySelectorAll(".challenges-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".challenges-tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadChallenges(btn.dataset.status);
    });
  });

  checkAuth().then(() => loadChallenges("active"));
})();
