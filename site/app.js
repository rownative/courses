/**
 * Rowing Courses — Leaflet map browser
 * Static: markers, filters, search, detail view, KML download
 * Dynamic (requires Worker): /api/me, like buttons, submit, import
 */

(function () {
  "use strict";

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* ignore — private mode / disabled storage */
    }
  }

  let coursesBase = "./courses/";  // Base for course JSON; set to "../courses/" when using fallback
  let kmlBase = "./kml/";          // Base for KML; set to "../kml/" when using fallback
  const urlApi = typeof URLSearchParams !== "undefined" ? new URLSearchParams(location.search).get("api") : null;
  /** Prefer api-config.js (normalized ?api= including /api suffix); raw urlApi alone can omit /api. */
  const API_BASE =
    (typeof window.ROWNATIVE_API !== "undefined" && window.ROWNATIVE_API)
      ? window.ROWNATIVE_API
      : urlApi || "/api";
  /** OAuth links must target the Worker when API_BASE is a full URL (e.g. local dev). */
  function oauthHref(path) {
    if (API_BASE.startsWith("http")) {
      const base = API_BASE.replace(/\/api\/?$/, "");
      const returnTo = encodeURIComponent(location.origin + location.pathname + location.search);
      return base + path + "?local=1&return_to=" + returnTo;
    }
    return path;
  }

  let map;
  let markersLayer;
  /** Course outline polygons when a course is open — not cleared by renderMarkers() (avoids reload loop with checkAuth). */
  let courseDetailLayer;
  let trackLayer;
  let courses = [];
  let selectedId = null;
  let userLiked = new Set();
  let isSignedIn = false;
  let athleteId = null;
  let highContrastMode = false;

  // Elements
  let searchEl, countryFilter, distanceRange;
  let filterProvisional, filterEstablished;
  let detailPanel, detailContent, detailClose;
  let loginBtn;
  let highContrastCheckbox;
  let baseLayerOsm;
  let baseLayerSatellite;
  let seaMarksLayer;

  /** High contrast toggle lives in the Leaflet layers panel (same box as base map / seamarks). */
  function appendHighContrastToLayersControl(layersCtrl) {
    const container = layersCtrl.getContainer();
    const section = container.querySelector("section.leaflet-control-layers-list");
    if (!section) return;
    const label = document.createElement("label");
    label.className = "leaflet-control-layers-high-contrast";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = "high-contrast";
    input.setAttribute("aria-label", "High contrast mode for course polygons");
    label.appendChild(input);
    label.appendChild(document.createTextNode(" High contrast"));
    section.appendChild(label);
  }

  function initMap() {
    if (typeof L === "undefined" || typeof L.map !== "function") {
      showLoadError("Map library (Leaflet) did not load. Check the network tab or disable ad blockers for this site.");
      return;
    }
    try {
    map = L.map("map").setView([30, 0], 2);

    baseLayerOsm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a>',
      maxZoom: 19,
    });

    baseLayerSatellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution:
          "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        maxZoom: 19,
      }
    );

    seaMarksLayer = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
      attribution: 'Sea marks © <a href="https://www.openseamap.org" rel="noopener">OpenSeaMap</a>',
      opacity: 0.95,
      minZoom: 9,
      maxZoom: 18,
    });

    const basePref = storageGet("rownative-map-base");
    const useSatellite = basePref === "satellite";
    if (useSatellite) {
      baseLayerSatellite.addTo(map);
    } else {
      baseLayerOsm.addTo(map);
    }

    if (storageGet("rownative-map-seamarks") === "1") {
      seaMarksLayer.addTo(map);
    }

    const layersCtrl = L.control
      .layers(
        { Map: baseLayerOsm, Satellite: baseLayerSatellite },
        { "Sea marks (OpenSeaMap)": seaMarksLayer },
        { collapsed: false, position: "bottomleft" }
      )
      .addTo(map);
    appendHighContrastToLayersControl(layersCtrl);

    map.on("baselayerchange", function (e) {
      storageSet("rownative-map-base", e.name === "Satellite" ? "satellite" : "osm");
    });
    map.on("overlayadd", function (e) {
      if (e.name === "Sea marks (OpenSeaMap)") {
        storageSet("rownative-map-seamarks", "1");
      }
    });
    map.on("overlayremove", function (e) {
      if (e.name === "Sea marks (OpenSeaMap)") {
        storageSet("rownative-map-seamarks", "0");
      }
    });

    highContrastMode = storageGet("rownative-high-contrast") === "1";
    const mapEl = document.getElementById("map");
    if (mapEl) mapEl.classList.toggle("high-contrast", highContrastMode);

    markersLayer = L.featureGroup().addTo(map);
    markersLayer._clearLayers = markersLayer.clearLayers;
    markersLayer.clearLayers = function () {
      this.eachLayer((l) => this.removeLayer(l));
    };
    trackLayer = L.featureGroup().addTo(map);
    courseDetailLayer = L.featureGroup().addTo(map);

    if (navigator.geolocation && !parseCourseHash()) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.setView([pos.coords.latitude, pos.coords.longitude], 8);
        },
        () => {},
        { enableHighAccuracy: false, timeout: 5000 }
      );
    }
    } catch (err) {
      console.error("initMap:", err);
      showLoadError("Map failed to initialise: " + (err && err.message ? err.message : String(err)));
    }
  }

  function showLoadError(msg) {
    const el = document.getElementById("load-error-banner");
    if (el) {
      el.textContent = msg;
      el.classList.remove("hidden");
    }
  }

  function showAuthError(msg) {
    const el = document.getElementById("load-error-banner");
    if (el) {
      const current = el.textContent;
      el.textContent = current ? current + " | Auth: " + msg : "Auth: " + msg;
      el.classList.remove("hidden");
    }
  }

  /** `#course-id` or `#course=id` deep links (e.g. from challenges / my-times). */
  function parseCourseHash() {
    const h = (location.hash || "").replace(/^#/, "");
    if (h.startsWith("course-")) {
      const rest = h.slice("course-".length);
      if (!rest) return null;
      try {
        return decodeURIComponent(rest);
      } catch (e) {
        return rest;
      }
    }
    const eq = /^course=(.+)$/.exec(h);
    if (eq && eq[1]) {
      try {
        return decodeURIComponent(eq[1].trim());
      } catch (e) {
        return eq[1].trim();
      }
    }
    return null;
  }

  function findCourseById(id) {
    return courses.find((x) => String(x.id) === String(id));
  }

  /** After checkAuth / filters: update like button + my times only (course polygons live on courseDetailLayer, not markersLayer). */
  function refreshOpenCourseDetail() {
    if (!selectedId || !detailPanel || detailPanel.classList.contains("hidden")) return;
    const c = findCourseById(selectedId);
    if (!c) return;
    const sid = String(selectedId);
    const liked = userLiked.has(sid);
    const likeBtn = detailContent && detailContent.querySelector(".like-btn");
    if (likeBtn) {
      likeBtn.classList.toggle("liked", liked);
      likeBtn.textContent = liked ? "♥ Liked" : "♡ Like";
    }
    if (isSignedIn) loadDetailCourseTimes(selectedId);
  }

  function applyCourseHashFromLocation() {
    const rawId = parseCourseHash();
    if (!rawId) return;
    const c = findCourseById(rawId);
    if (c) {
      if (
        String(selectedId) === String(c.id) &&
        detailPanel &&
        !detailPanel.classList.contains("hidden")
      ) {
        return;
      }
      showDetail(c.id);
    } else if (detailPanel && detailContent) {
      selectedId = rawId;
      detailPanel.classList.remove("hidden");
      detailContent.innerHTML = `<p class="error">Course <code>${escapeHtml(String(rawId))}</code> is not in the list (check filters or index).</p>`;
    }
  }

  function onCourseHashChange() {
    const rawId = parseCourseHash();
    if (!rawId) {
      if (detailPanel) detailPanel.classList.add("hidden");
      selectedId = null;
      if (courseDetailLayer) courseDetailLayer.clearLayers();
      renderMarkers(true);
      return;
    }
    applyCourseHashFromLocation();
  }

  function loadCourses() {
    const base = location.origin + (location.pathname.endsWith("/") ? location.pathname : location.pathname.replace(/[^/]+$/, ""));
    function tryLoad(url) {
      const fullUrl = url.startsWith(".") ? base + url.slice(2) : url;
      return fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`index.json: HTTP ${r.status} from ${fullUrl}`);
          const ct = r.headers.get("content-type") || "";
          if (!ct.includes("application/json")) throw new Error(`index.json: not JSON (Content-Type: ${ct}) from ${fullUrl}`);
          return r.json();
        })
        .then((data) => {
          courses = Array.isArray(data) ? data : (data?.courses && Array.isArray(data.courses) ? data.courses : []);
          if (API_BASE && typeof API_BASE === "string" && API_BASE.startsWith("http")) {
            coursesBase = "https://raw.githubusercontent.com/rownative/courses/main/courses/";
          }
          renderMarkers();
          fillCountryFilter();
          applyCourseHashFromLocation();
        });
    }

    const apiFirst = API_BASE && typeof API_BASE === "string" && API_BASE.startsWith("http");
    const firstTry = apiFirst ? (API_BASE.replace(/\/api\/?$/, "") + "/api/courses") : "./index.json";
    return tryLoad(firstTry)
      .catch(() => {
        if (apiFirst) return tryLoad("./index.json");
        coursesBase = "../courses/";
        kmlBase = "../kml/";
        return tryLoad("../courses/index.json");
      })
      .catch((e) => {
        coursesBase = "./courses/";
        kmlBase = "./kml/";
        showLoadError("Courses: " + (e.message || String(e)));
        if (detailContent) {
          detailContent.innerHTML = `<p class="error">Could not load courses: ${e.message}</p>`;
          detailPanel?.classList.remove("hidden");
        }
      });
  }

  function renderLikedCourses() {
    const section = document.getElementById("liked-courses-section");
    const list = document.getElementById("liked-courses-list");
    if (!section || !list) return;
    section.classList.remove("hidden");
    if (!isSignedIn) {
      list.innerHTML = '<li class="liked-courses-empty">Sign in to see your liked courses.</li>';
      return;
    }
    const likedCourses = [...userLiked]
      .map((id) => {
        const c = courses.find((x) => String(x.id) === String(id));
        return c ? { ...c } : { id: String(id), name: `Course ${id}` };
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    if (likedCourses.length === 0) {
      list.innerHTML = '<li class="liked-courses-empty">No liked courses yet. Like a course from the map to add it here.</li>';
      return;
    }
    list.innerHTML = likedCourses
      .map((c) => {
        const name = (c.name || c.id).length > 35 ? (c.name || c.id).slice(0, 32) + "…" : (c.name || c.id);
        return `<li><a href="#" data-id="${c.id}" class="liked-course-link">${escapeHtml(name)}</a></li>`;
      })
      .join("");
    list.querySelectorAll(".liked-course-link").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        showDetail(a.dataset.id);
      });
    });
  }

  function fillCountryFilter() {
    const countries = [...new Set(courses.map((c) => c.country).filter(Boolean))].sort();
    countryFilter.innerHTML = '<option value="">All countries</option>';
    countries.forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      countryFilter.appendChild(o);
    });
  }

  function applyFilters() {
    const search = (searchEl?.value || "").toLowerCase();
    const country = countryFilter?.value || "";
    const rangeVal = distanceRange?.value || "0-25";
    const [minKm, maxKm] = rangeVal.split("-").map((s) => parseFloat(s) || 0);
    const dMin = minKm * 1000;
    const dMax = maxKm * 1000;
    const showProvisional = filterProvisional?.checked !== false;
    const showEstablished = filterEstablished?.checked !== false;

    return courses.filter((c) => {
      if (search && !(c.name || "").toLowerCase().includes(search)) return false;
      if (country && c.country !== country) return false;
      const d = c.distance_m || 0;
      if (d < dMin || d > dMax) return false;
      if (c.status === "provisional" && !showProvisional) return false;
      if (c.status === "established" && !showEstablished) return false;
      return true;
    });
  }

  function renderMarkers(preserveView) {
    markersLayer.clearLayers();
    const filtered = applyFilters();
    filtered.forEach((c) => {
      const lat = c.center_lat;
      const lon = c.center_lon;
      if (lat == null || lon == null) return;
      const liked = isSignedIn && userLiked.has(String(c.id));
      const fillColor = liked ? "#c66" : (c.status === "established" ? "#0a7" : "#fa0");
      const m = L.circleMarker([lat, lon], {
        radius: 8,
        fillColor,
        color: "#333",
        weight: 1,
        fillOpacity: 0.8,
      });
      m.courseId = c.id;
      m.on("click", () => showDetail(c.id));
      const tooltipText = c.name ? `${c.name} (ID: ${c.id})` : c.id;
      m.bindTooltip(tooltipText, { direction: "top" });
      markersLayer.addLayer(m);
    });

    // Re-zoom to fit all visible markers (skip when closing a course to keep local zoom)
    if (!preserveView) {
      if (filtered.length === 0) {
        renderLikedCourses();
        return;
      }
      if (filtered.length === 1) {
        const c = filtered[0];
        map.setView([c.center_lat, c.center_lon], 10);
      } else {
        const bounds = markersLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
      }
    }
    renderLikedCourses();
  }

  function showDetail(id) {
    const c = findCourseById(id);
    if (!c) {
      selectedId = null;
      return;
    }
    selectedId = id;
    detailContent.innerHTML = `<p>Loading…</p>`;
    detailPanel.classList.remove("hidden");
    fetchCourseDetail(id)
      .then((full) => renderDetail(full, c))
      .catch(() => {
        renderDetail(c, c);
      });
  }

  function fetchCourseDetail(id) {
    const idStr = encodeURIComponent(String(id));
    const load = (base) =>
      fetch(`${base}${idStr}.json`).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      });
    return load(coursesBase).catch(() => {
      if (String(coursesBase).includes("raw.githubusercontent.com")) {
        return load("./courses/");
      }
      throw new Error("Course JSON not found");
    });
  }

  function getPolygonOptions() {
    if (typeof window.rownativeLeafletPolygonStyle === "function") {
      return window.rownativeLeafletPolygonStyle();
    }
    return highContrastMode
      ? { color: "#e65c00", fillColor: "#e65c00", fillOpacity: 0.45, weight: 4 }
      : { color: "#0af", fillColor: "#0af", fillOpacity: 0.2, weight: 2 };
  }

  function fmtTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    const secsStr = ((seconds % 60) < 10 ? "0" : "") + secs;
    return mins + ":" + secsStr;
  }

  function loadDetailCourseTimes(courseId) {
    const listEl = document.getElementById("detail-course-times-list");
    if (!listEl) return;
    fetch(`${API_BASE}/me/course-times`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const all = data.courseTimes || [];
        const forCourse = all.filter((t) => String(t.course_id) === String(courseId));
        if (forCourse.length === 0) {
          listEl.innerHTML = '<li class="empty">No saved times yet</li>';
        } else {
          listEl.innerHTML = forCourse.map((t) => renderCourseTimeItem(t)).join("");
        }
      })
      .catch(() => {
        listEl.innerHTML = '<li class="empty">Could not load times</li>';
      });
  }

  function renderDetail(full, meta) {
    if (courseDetailLayer) courseDetailLayer.clearLayers();
    const idStr = String(meta.id);
    const idHtml = escapeHtml(idStr);
    const idPath = encodeURIComponent(idStr);
    const liked = userLiked.has(idStr);
    const kmlUrl = API_BASE
      ? `${API_BASE}/courses/${idPath}`
      : `${kmlBase}${idPath}.kml`;
    const likeButtonHtml = isSignedIn
      ? `<button type="button" class="btn like-btn ${liked ? "liked" : ""}" data-id="${idHtml}">${liked ? "♥ Liked" : "♡ Like"}</button>`
      : "";
    const calculateBtnHtml = isSignedIn
      ? `<button type="button" class="btn calculate-time-btn" data-id="${idHtml}" data-name="${escapeHtml(meta.name)}">Calculate my time</button>`
      : "";
    const courseTimesSection = isSignedIn
      ? `<div class="detail-course-times"><strong>My times</strong><ul id="detail-course-times-list">Loading…</ul></div>`
      : "";
    let html = `
      <h2>${escapeHtml(meta.name)}</h2>
      <p class="course-id"><strong>ID:</strong> <code>${idHtml}</code> — <code>courses/${idHtml}.json</code></p>
      <p><strong>Distance:</strong> ${meta.distance_m || "—"} m</p>
      <p><strong>Country:</strong> ${escapeHtml(meta.country || "—")}</p>
      <p><strong>Status:</strong> <span class="badge ${meta.status}">${meta.status}</span></p>
      ${meta.notes ? `<p class="notes">${escapeHtml(meta.notes)}</p>` : ""}
      <p>
        <a href="${kmlUrl}" download="${idHtml}.kml" class="btn">Download KML</a>
        ${likeButtonHtml}
        ${calculateBtnHtml}
        ${isSignedIn && meta.status === 'provisional' ? `<a href="update.html?id=${idPath}" class="btn">Update with new KML</a>` : ''}
      </p>
      ${courseTimesSection}
    `;

    detailContent.innerHTML = html;

    const likeBtn = detailContent.querySelector(".like-btn");
    if (likeBtn) {
      likeBtn.addEventListener("click", () => toggleLike(meta.id));
    }
    const calcBtn = detailContent.querySelector(".calculate-time-btn");
    if (calcBtn) {
      calcBtn.addEventListener("click", () => openCalculateTimeModal(meta.id, meta.name));
    }

    if (isSignedIn) {
      loadDetailCourseTimes(meta.id);
    }

    if (full.polygons && full.polygons.length > 0 && courseDetailLayer) {
      const bounds = [];
      full.polygons.forEach((poly) => {
        (poly.points || []).forEach((pt) => bounds.push([pt.lat, pt.lon]));
      });
      if (bounds.length > 0) {
        full.polygons.forEach((poly, idx) => {
          const pts = (poly.points || []).map((p) => [p.lat, p.lon]);
          if (pts.length >= 2) {
            if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) {
              pts.push(pts[0]);
            }
            const layer = L.polygon(pts, getPolygonOptions());
            layer.bindTooltip(poly.name || `Gate ${idx}`);
            courseDetailLayer.addLayer(layer);
          }
        });
        /** Desktop: map container size often wrong until after layout; devtools device mode masks this. */
        function fitMapToCourseBounds() {
          map.invalidateSize();
          map.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 });
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(fitMapToCourseBounds);
        });
      }
    }
  }

  function intervalsActivityUrl(activityId) {
    if (!activityId) return null;
    const id = String(activityId).replace(/^i/, "");
    return id ? `https://intervals.icu/activities/i${encodeURIComponent(id)}` : null;
  }

  function renderCourseTimeItem(t) {
    const date = (t.workout_date || t.created_at) ? (t.workout_date || t.created_at).slice(0, 10) : "—";
    const timeStr = fmtTime(t.time_s);
    const intervalsUrl = intervalsActivityUrl(t.activity_id);
    const trashSvg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2\"/><line x1=\"10\" y1=\"11\" x2=\"10\" y2=\"17\"/><line x1=\"14\" y1=\"11\" x2=\"14\" y2=\"17\"/></svg>";
    const removeBtn = t.id ? `<button type="button" class="detail-time-remove" data-time-id="${escapeHtml(t.id)}" aria-label="Remove">${trashSvg}</button>` : "";
    let linkPart = "";
    if (intervalsUrl) {
      const linkLabel = (t.workout_name && String(t.workout_name).trim()) || "Workout";
      linkPart = ` <a href="${escapeHtml(intervalsUrl)}" target="_blank" rel="noopener" class="detail-time-link">${escapeHtml(linkLabel)} ↗</a>`;
    }
    return `<li><span class="detail-time-date">${escapeHtml(date)}</span> <span class="detail-time-value">${escapeHtml(timeStr)}</span>${linkPart} ${removeBtn}</li>`;
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function toggleLike(id) {
    const wasLikedBeforeOptimistic = userLiked.has(String(id));
    // Optimistic UI update when viewing this course
    if (String(selectedId) === String(id)) {
      const c = findCourseById(id);
      if (c) {
        const sid = String(id);
        if (userLiked.has(sid)) {
          userLiked.delete(sid);
        } else {
          userLiked.add(sid);
        }
        renderLikedCourses();
        fetchCourseDetail(id).then((full) => renderDetail(full, c));
      }
    }
    const url = `${API_BASE}/rowers/courses/${id}/follow/`;
    // Use pre-optimistic state so we call follow/unfollow correctly
    if (wasLikedBeforeOptimistic) {
      fetch(`${API_BASE}/rowers/courses/${id}/unfollow/`, { method: "POST", credentials: "include" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          const ids = (data.liked || []).map((x) => (typeof x === "object" && x != null && "id" in x ? x.id : String(x)));
          userLiked = new Set(ids);
          if (selectedId !== id) renderMarkers();
          else renderLikedCourses();
        })
        .catch(() => {});
    } else {
      fetch(url, { method: "POST", credentials: "include" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          const ids = (data.liked || []).map((x) => (typeof x === "object" && x != null && "id" in x ? x.id : String(x)));
          userLiked = new Set(ids);
          if (selectedId !== id) renderMarkers();
          else renderLikedCourses();
        })
        .catch(() => {});
    }
  }

  let calculateModalCourseId = null;
  let calculateModalCourseName = null;
  let lastCalculateResult = null;

  function openCalculateTimeModal(courseId, courseName) {
    calculateModalCourseId = courseId;
    calculateModalCourseName = courseName || "Course";
    lastCalculateResult = null;
    clearTrackOnMap();
    const trackStatusEl = document.getElementById("calculate-track-status");
    if (trackStatusEl) trackStatusEl.textContent = "";
    const modal = document.getElementById("calculate-time-modal");
    const title = document.getElementById("calculate-modal-title");
    const select = document.getElementById("calculate-activity-select");
    const result = document.getElementById("calculate-result");
    const calcBtn = document.getElementById("calculate-btn");
    const saveBtn = document.getElementById("save-course-time-btn");
    if (title) title.textContent = "Calculate time on " + courseName;
    if (select) {
      select.innerHTML = "<option value=\"\">Loading…</option>";
      select.classList.remove("hidden");
    }
    if (result) {
      result.classList.add("hidden");
      result.innerHTML = "";
    }
    if (calcBtn) {
      calcBtn.classList.remove("hidden");
      calcBtn.disabled = true;
    }
    if (saveBtn) saveBtn.classList.add("hidden");
    if (modal) {
      modal.classList.remove("hidden");
      const detailPanel = document.getElementById("detail-panel");
      if (detailPanel && !detailPanel.classList.contains("hidden")) {
        const rect = detailPanel.getBoundingClientRect();
        modal.style.top = (rect.bottom + 8) + "px";
      } else {
        modal.style.top = "1rem";
      }
      modal.style.right = "1rem";
    }

    fetch(`${API_BASE}/me/activities`, { credentials: "include" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const err = new Error(data.error || `HTTP ${r.status}`);
          err.status = r.status;
          err.serverError = data.error;
          throw err;
        }
        return data;
      })
      .then((data) => {
        const acts = data.activities || [];
        if (!select) return;
        select.innerHTML = "<option value=\"\">Select a workout…</option>";
        acts.forEach((a) => {
          const date = a.start_date_local ? a.start_date_local.slice(0, 10) : "";
          const name = a.name || "Untitled";
          const label = date ? date + " — " + name : name;
          select.innerHTML += `<option value="${escapeHtml(a.id)}" data-date="${escapeHtml(date)}" data-name="${escapeHtml(name)}">${escapeHtml(label)}</option>`;
        });
        if (acts.length === 0) {
          select.innerHTML = "<option value=\"\">No OTW rowing workouts in last month</option>";
        }
        calcBtn.disabled = false;
        // When user selects a workout, fetch and show its track on the map
        const trackStatus = document.getElementById("calculate-track-status");
        const setTrackStatus = (msg, isError) => {
          if (!trackStatus) return;
          trackStatus.textContent = msg || "";
          trackStatus.classList.toggle("hidden", !msg);
          trackStatus.classList.toggle("error", !!isError);
        };
        select.onchange = () => {
          const activityId = select.value;
          if (!activityId) {
            clearTrackOnMap();
            setTrackStatus("");
            return;
          }
          setTrackStatus("Loading track…", false);
          const trackUrl = `${API_BASE}/me/activities/${encodeURIComponent(activityId)}/track`;
          fetch(trackUrl, { credentials: "include" })
            .then(async (r) => {
              const data = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
              return data;
            })
            .then((data) => {
              const latlng = data.latlng;
              if (Array.isArray(latlng) && latlng.length >= 2) {
                showTrackOnMap(latlng);
                setTrackStatus("Track shown on map.", false);
              } else {
                clearTrackOnMap();
                const msg = "This workout has no GPS track.";
                setTrackStatus(msg, true);
                showLoadError("Track: " + msg);
              }
            })
            .catch((e) => {
              clearTrackOnMap();
              const msg = e.message || "Failed to load track";
              setTrackStatus(msg, true);
              showLoadError("Track: " + msg);
            });
        };
      })
      .catch((e) => {
        const msg = e?.serverError || e?.message || "Failed to load activities";
        showLoadError("Activities: " + msg);
        if (select) select.innerHTML = "<option value=\"\">" + escapeHtml(msg) + "</option>";
      });
  }

  function clearTrackOnMap() {
    if (trackLayer) trackLayer.clearLayers();
  }

  function showTrackOnMap(latlng) {
    if (!trackLayer || !map || !Array.isArray(latlng) || latlng.length < 2) return;
    clearTrackOnMap();
    const pts = latlng.map((p) => [p[0], p[1]]);
    const polyline = L.polyline(pts, {
      color: "#e65c00",
      weight: 4,
      opacity: 0.9,
    });
    polyline.bindTooltip("Workout track", { permanent: false });
    trackLayer.addLayer(polyline);
    const trackBounds = polyline.getBounds();
    let combined = trackBounds;
    if (markersLayer && markersLayer.getBounds().isValid()) {
      combined = combined.extend(markersLayer.getBounds());
    }
    if (courseDetailLayer && courseDetailLayer.getBounds().isValid()) {
      combined = combined.extend(courseDetailLayer.getBounds());
    }
    if (combined.isValid()) map.fitBounds(combined, { padding: [30, 30], maxZoom: 16 });
  }

  function closeCalculateTimeModal() {
    const modal = document.getElementById("calculate-time-modal");
    if (modal) modal.classList.add("hidden");
    calculateModalCourseId = null;
    calculateModalCourseName = null;
    clearTrackOnMap();
  }

  function initCalculateTimeModal() {
    const modal = document.getElementById("calculate-time-modal");
    const calcBtn = document.getElementById("calculate-btn");
    const saveBtn = document.getElementById("save-course-time-btn");
    const closeBtn = document.getElementById("modal-close-btn");
    const backdrop = document.querySelector("[data-dismiss=\"modal\"]");

    if (backdrop) backdrop.addEventListener("click", closeCalculateTimeModal);
    if (closeBtn) closeBtn.addEventListener("click", closeCalculateTimeModal);

    if (calcBtn) {
      calcBtn.addEventListener("click", () => {
        const select = document.getElementById("calculate-activity-select");
        const activityId = select?.value;
        if (!activityId || !calculateModalCourseId) return;
        calcBtn.disabled = true;
        calcBtn.textContent = "Calculating…";
        const calcUrl = `${API_BASE}/courses/${calculateModalCourseId}/calculate-time${(location.search.includes("debug=1") || window.ROWNATIVE_DEBUG) ? "?debug=1" : ""}`;
        fetch(calcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ activityId }),
        })
          .then((r) => r.json())
          .then((data) => {
            lastCalculateResult = data;
            const resultEl = document.getElementById("calculate-result");
            if (data._debug) console.log("Course time _debug:", data._debug);
            if (data.valid) {
              const mins = Math.floor(data.timeS / 60);
              const secs = (data.timeS % 60).toFixed(1);
              const secsStr = ((data.timeS % 60) < 10 ? "0" : "") + secs;
              resultEl.innerHTML = `<p class="success">Time: ${mins}:${secsStr}</p>`;
              saveBtn.classList.remove("hidden");
              saveBtn.disabled = false;
            } else {
              resultEl.innerHTML =
                '<p class="error">Could not validate — track didn\'t pass all gates.</p>' +
                (data.validationNote ? `<pre class="validation-note">${escapeHtml(data.validationNote)}</pre>` : "") +
                (data.latlng && data.latlng.length >= 2 ? '<p class="track-hint">Your workout track is shown on the map.</p>' : '');
              saveBtn.classList.add("hidden");
              saveBtn.disabled = true;
            }
            resultEl.classList.remove("hidden");
          })
          .catch(() => {
            const resultEl = document.getElementById("calculate-result");
            resultEl.innerHTML = '<p class="error">Calculation failed. Try again.</p>';
            resultEl.classList.remove("hidden");
            saveBtn.classList.add("hidden");
            saveBtn.disabled = true;
          })
          .finally(() => {
            calcBtn.disabled = false;
            calcBtn.textContent = "Calculate";
          });
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        if (!lastCalculateResult || !lastCalculateResult.valid || !calculateModalCourseId) return;
        const select = document.getElementById("calculate-activity-select");
        const activityId = select?.value;
        if (!activityId) return;
        const opt = select?.options[select.selectedIndex];
        const workoutDate = opt?.dataset?.date || "";
        const workoutName = opt?.dataset?.name || "";
        saveBtn.disabled = true;
        fetch(`${API_BASE}/courses/${calculateModalCourseId}/course-times`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            activityId,
            timeS: lastCalculateResult.timeS,
            distanceM: lastCalculateResult.distanceM,
            validationNote: lastCalculateResult.validationNote || "",
            workoutDate: workoutDate || undefined,
            workoutName: workoutName || undefined,
          }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.saved) {
              saveBtn.textContent = "Saved ✓";
              loadDetailCourseTimes(calculateModalCourseId);
              setTimeout(() => closeCalculateTimeModal(), 800);
            }
          })
          .catch(() => {
            saveBtn.disabled = false;
          })
          .finally(() => {
            saveBtn.disabled = false;
          });
      });
    }
  }

  function checkAuth() {
    const meFetchUrl = `${API_BASE}/me`;
    const displayMeUrl = typeof API_BASE === "string" && API_BASE.startsWith("http")
      ? `${API_BASE}/me`
      : `${location.origin}${API_BASE}/me`;
    fetch(meFetchUrl, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`/api/me HTTP ${r.status} from ${displayMeUrl}`);
        return r.json();
      })
      .then((data) => {
        isSignedIn = !!data.athleteId;
        athleteId = data.athleteId || null;
        const raw = data.liked || [];
        const ids = Array.isArray(raw)
          ? raw.map((x) => (typeof x === "object" && x != null && "id" in x ? x.id : String(x)))
          : [];
        userLiked = new Set(ids);
        if (loginBtn) {
          if (data.athleteId) {
            loginBtn.textContent = "Sign out";
            loginBtn.href = oauthHref("/oauth/logout");
          } else {
            loginBtn.textContent = "Sign in with intervals.icu";
            loginBtn.href = oauthHref("/oauth/authorize");
          }
          loginBtn.classList.remove("hidden");
        }
        const legendLiked = document.getElementById("legend-liked");
        if (legendLiked) legendLiked.classList.toggle("hidden", !data.athleteId);
        const importLink = document.getElementById("import-link");
        const submitLink = document.getElementById("submit-link");
        const updateLink = document.getElementById("update-link");
        const authTeaser = document.getElementById("auth-teaser");
        if (importLink) importLink.classList.toggle("hidden", !data.athleteId);
        if (submitLink) submitLink.classList.toggle("hidden", !data.athleteId);
        if (updateLink) updateLink.classList.toggle("hidden", !data.athleteId);
        if (authTeaser) authTeaser.classList.toggle("hidden", !!data.athleteId);
        const myTimesLink = document.getElementById("my-times-link");
        if (myTimesLink) myTimesLink.classList.toggle("hidden", !data.athleteId);
        const organiserLink = document.getElementById("organiser-link");
        if (organiserLink) organiserLink.classList.toggle("hidden", !(data.athleteId && data.isOrganizer));
        renderMarkers(!!selectedId);
        refreshOpenCourseDetail();
      })
      .catch((e) => {
        isSignedIn = false;
        athleteId = null;
        showAuthError(e.message || "fetch failed");
        const legendLiked = document.getElementById("legend-liked");
        if (legendLiked) legendLiked.classList.add("hidden");
        renderLikedCourses();
        const importLink = document.getElementById("import-link");
        const submitLink = document.getElementById("submit-link");
        const updateLink = document.getElementById("update-link");
        const authTeaser = document.getElementById("auth-teaser");
        if (importLink) importLink.classList.add("hidden");
        if (submitLink) submitLink.classList.add("hidden");
        if (updateLink) updateLink.classList.add("hidden");
        const myTimesLink = document.getElementById("my-times-link");
        if (myTimesLink) myTimesLink.classList.add("hidden");
        if (authTeaser) authTeaser.classList.remove("hidden");
        if (loginBtn) {
          loginBtn.textContent = "Sign in with intervals.icu";
          loginBtn.href = oauthHref("/oauth/authorize");
          loginBtn.classList.remove("hidden");
        }
      });
  }

  function bindUI() {
    searchEl = document.getElementById("search");
    countryFilter = document.getElementById("country-filter");
    distanceRange = document.getElementById("distance-range");
    filterProvisional = document.getElementById("filter-provisional");
    filterEstablished = document.getElementById("filter-established");
    detailPanel = document.getElementById("detail-panel");
    detailContent = document.getElementById("detail-content");
    detailClose = document.getElementById("close-detail");
    loginBtn = document.getElementById("sign-in-link");

    const runFilters = () => renderMarkers();
    if (searchEl) searchEl.addEventListener("input", runFilters);
    if (countryFilter) countryFilter.addEventListener("change", runFilters);
    if (distanceRange) distanceRange.addEventListener("change", runFilters);
    if (filterProvisional) filterProvisional.addEventListener("change", runFilters);
    if (filterEstablished) filterEstablished.addEventListener("change", runFilters);

    highContrastCheckbox = document.getElementById("high-contrast");
    if (highContrastCheckbox) {
      highContrastCheckbox.checked = highContrastMode;
      highContrastCheckbox.addEventListener("change", () => {
        highContrastMode = highContrastCheckbox.checked;
        storageSet("rownative-high-contrast", highContrastMode ? "1" : "0");
        const mapEl = document.getElementById("map");
        if (mapEl) mapEl.classList.toggle("high-contrast", highContrastMode);
        renderMarkers(true);
        refreshOpenCourseDetail();
      });
    }

    window.addEventListener("hashchange", onCourseHashChange);

    if (detailClose) detailClose.addEventListener("click", () => {
      detailPanel.classList.add("hidden");
      selectedId = null;
      if (courseDetailLayer) courseDetailLayer.clearLayers();
      if (location.hash && /^#course[=-]/.test(location.hash)) {
        history.replaceState(null, "", location.pathname + location.search);
      }
      renderMarkers(true);  // preserve local zoom when closing course
    });

    if (detailContent) {
      detailContent.addEventListener("click", (e) => {
        const btn = e.target.closest(".detail-time-remove");
        if (!btn) return;
        const timeId = btn.dataset.timeId;
        if (!timeId) return;
        if (!confirm("Remove this saved time?")) return;
        btn.disabled = true;
        fetch(`${API_BASE}/me/course-times/${encodeURIComponent(timeId)}`, { method: "DELETE", credentials: "include" })
          .then((r) => r.ok ? r.json() : Promise.reject())
          .then(() => {
            if (selectedId) loadDetailCourseTimes(selectedId);
          })
          .catch(() => {
            btn.disabled = false;
            alert("Failed to remove.");
          });
      });
    }

    initCalculateTimeModal();
    renderLikedCourses();
  }

  function main() {
    initMap();
    bindUI();
    loadCourses().finally(() => {
      checkAuth();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
