/**
 * Rowing Courses — Leaflet map browser
 * Static: markers, filters, search, detail view, KML download
 * Dynamic (requires Worker): /api/me, like buttons, submit, import
 */

(function () {
  "use strict";

  let coursesBase = "./courses/";  // Base for course JSON; set to "../courses/" when using fallback
  let kmlBase = "./kml/";          // Base for KML; set to "../kml/" when using fallback
  const API_BASE = (typeof window.ROWNATIVE_API !== "undefined" && window.ROWNATIVE_API) 
    ? window.ROWNATIVE_API 
    : "/api";

  let map;
  let markersLayer;
  let courses = [];
  let selectedId = null;
  let userLiked = new Set();
  let isSignedIn = false;
  let highContrastMode = false;

  // Elements
  let searchEl, countryFilter, distanceRange;
  let filterProvisional, filterEstablished;
  let detailPanel, detailContent, detailClose;
  let loginBtn;
  let highContrastCheckbox;

  function initMap() {
    map = L.map("map").setView([30, 0], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(map);

    highContrastMode = localStorage.getItem("rownative-high-contrast") === "1";
    const mapEl = document.getElementById("map");
    if (mapEl) mapEl.classList.toggle("high-contrast", highContrastMode);

    markersLayer = L.featureGroup().addTo(map);
    markersLayer._clearLayers = markersLayer.clearLayers;
    markersLayer.clearLayers = function () {
      this.eachLayer((l) => this.removeLayer(l));
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 8),
        () => {},
        { enableHighAccuracy: false, timeout: 5000 }
      );
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
          courses = Array.isArray(data) ? data : [];
          renderMarkers();
          fillCountryFilter();
        });
    }

    tryLoad("./index.json")
      .catch(() => {
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
    const prevBounds = preserveView && selectedId ? map.getBounds() : null;
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

    // Re-zoom to fit all visible markers
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
    renderLikedCourses();
  }

  function showDetail(id) {
    selectedId = id;
    const c = courses.find((x) => x.id === id);
    if (c) {
      detailContent.innerHTML = `<p>Loading…</p>`;
      detailPanel.classList.remove("hidden");
      fetchCourseDetail(id)
        .then((full) => renderDetail(full, c))
        .catch(() => {
          renderDetail(c, c);
        });
    }
  }

  function fetchCourseDetail(id) {
    return fetch(`${coursesBase}${id}.json`).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    });
  }

  function getPolygonOptions() {
    return highContrastMode
      ? { color: "#e65c00", fillColor: "#e65c00", fillOpacity: 0.45, weight: 4 }
      : { color: "#0af", fillColor: "#0af", fillOpacity: 0.2, weight: 2 };
  }

  function renderDetail(full, meta) {
    const liked = userLiked.has(String(meta.id));
    const kmlUrl = API_BASE
      ? `${API_BASE}/courses/${meta.id}`
      : `${kmlBase}${meta.id}.kml`;
    const likeButtonHtml = isSignedIn
      ? `<button type="button" class="btn like-btn ${liked ? "liked" : ""}" data-id="${meta.id}">${liked ? "♥ Liked" : "♡ Like"}</button>`
      : "";
    const calculateBtnHtml = isSignedIn
      ? `<button type="button" class="btn calculate-time-btn" data-id="${meta.id}" data-name="${escapeHtml(meta.name)}">Calculate my time</button>`
      : "";
    let html = `
      <h2>${escapeHtml(meta.name)}</h2>
      <p class="course-id"><strong>ID:</strong> <code>${meta.id}</code> — <code>courses/${meta.id}.json</code></p>
      <p><strong>Distance:</strong> ${meta.distance_m || "—"} m</p>
      <p><strong>Country:</strong> ${escapeHtml(meta.country || "—")}</p>
      <p><strong>Status:</strong> <span class="badge ${meta.status}">${meta.status}</span></p>
      ${meta.notes ? `<p class="notes">${escapeHtml(meta.notes)}</p>` : ""}
      <p>
        <a href="${kmlUrl}" download="${meta.id}.kml" class="btn">Download KML</a>
        ${likeButtonHtml}
        ${calculateBtnHtml}
        ${isSignedIn && meta.status === 'provisional' ? `<a href="update.html?id=${meta.id}" class="btn">Update with new KML</a>` : ''}
      </p>
    `;

    if (full.polygons && full.polygons.length > 0) {
      const bounds = [];
      full.polygons.forEach((poly) => {
        (poly.points || []).forEach((pt) => bounds.push([pt.lat, pt.lon]));
      });
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 });
        markersLayer.clearLayers();
        full.polygons.forEach((poly, idx) => {
          const pts = (poly.points || []).map((p) => [p.lat, p.lon]);
          if (pts.length >= 2) {
            if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) {
              pts.push(pts[0]);
            }
            const layer = L.polygon(pts, getPolygonOptions());
            layer.bindTooltip(poly.name || `Gate ${idx}`);
            markersLayer.addLayer(layer);
          }
        });
      }
    }

    detailContent.innerHTML = html;

    const likeBtn = detailContent.querySelector(".like-btn");
    if (likeBtn) {
      likeBtn.addEventListener("click", () => toggleLike(meta.id));
    }
    const calcBtn = detailContent.querySelector(".calculate-time-btn");
    if (calcBtn) {
      calcBtn.addEventListener("click", () => openCalculateTimeModal(meta.id, meta.name));
    }
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
      const c = courses.find((x) => x.id === id);
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
    if (modal) modal.classList.remove("hidden");

    fetch(`${API_BASE}/me/activities`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const acts = data.activities || [];
        if (!select) return;
        select.innerHTML = "<option value=\"\">Select a workout…</option>";
        acts.forEach((a) => {
          const label = a.start_date_local
            ? a.start_date_local.slice(0, 10) + " — " + (a.name || "Untitled")
            : a.name || "Untitled";
          select.innerHTML += `<option value="${escapeHtml(a.id)}">${escapeHtml(label)}</option>`;
        });
        if (acts.length === 0) {
          select.innerHTML = "<option value=\"\">No OTW rowing workouts in last month</option>";
        }
        calcBtn.disabled = false;
      })
      .catch(() => {
        if (select) select.innerHTML = "<option value=\"\">Failed to load activities</option>";
      });
  }

  function closeCalculateTimeModal() {
    const modal = document.getElementById("calculate-time-modal");
    if (modal) modal.classList.add("hidden");
    calculateModalCourseId = null;
    calculateModalCourseName = null;
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
        fetch(`${API_BASE}/courses/${calculateModalCourseId}/calculate-time`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ activityId }),
        })
          .then((r) => r.json())
          .then((data) => {
            lastCalculateResult = data;
            const resultEl = document.getElementById("calculate-result");
            if (data.valid) {
              const mins = Math.floor(data.timeS / 60);
              const secs = Math.round(data.timeS % 60);
              resultEl.innerHTML = `<p class="success">Time: ${mins}:${String(secs).padStart(2, "0")}</p>`;
              saveBtn.classList.remove("hidden");
            } else {
              resultEl.innerHTML =
                '<p class="error">Could not validate — track didn\'t pass all gates.</p>' +
                (data.validationNote ? `<pre class="validation-note">${escapeHtml(data.validationNote)}</pre>` : "");
              saveBtn.classList.add("hidden");
            }
            resultEl.classList.remove("hidden");
          })
          .catch(() => {
            const resultEl = document.getElementById("calculate-result");
            resultEl.innerHTML = '<p class="error">Calculation failed. Try again.</p>';
            resultEl.classList.remove("hidden");
            saveBtn.classList.add("hidden");
          })
          .finally(() => {
            calcBtn.disabled = false;
            calcBtn.textContent = "Calculate";
          });
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        if (!lastCalculateResult || !calculateModalCourseId) return;
        const select = document.getElementById("calculate-activity-select");
        const activityId = select?.value;
        if (!activityId) return;
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
          }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.saved) {
              saveBtn.textContent = "Saved ✓";
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
    const authUrl = `${location.origin}${API_BASE}/me`;
    fetch(`${API_BASE}/me`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`/api/me HTTP ${r.status} from ${authUrl}`);
        return r.json();
      })
      .then((data) => {
        isSignedIn = !!data.athleteId;
        const raw = data.liked || [];
        const ids = Array.isArray(raw)
          ? raw.map((x) => (typeof x === "object" && x != null && "id" in x ? x.id : String(x)))
          : [];
        userLiked = new Set(ids);
        if (loginBtn) {
          if (data.athleteId) {
            loginBtn.textContent = "Sign out";
            loginBtn.href = "/oauth/logout";
          } else {
            loginBtn.textContent = "Sign in with intervals.icu";
            loginBtn.href = "/oauth/authorize";
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
        renderMarkers();
        if (selectedId) {
          const c = courses.find((x) => x.id === selectedId);
          if (c) fetchCourseDetail(selectedId).then((full) => renderDetail(full, c)).catch(() => renderDetail(c, c));
        }
      })
      .catch((e) => {
        isSignedIn = false;
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
          loginBtn.href = "/oauth/authorize";
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
        localStorage.setItem("rownative-high-contrast", highContrastMode ? "1" : "0");
        const mapEl = document.getElementById("map");
        if (mapEl) mapEl.classList.toggle("high-contrast", highContrastMode);
        if (selectedId) {
          const c = courses.find((x) => x.id === selectedId);
          if (c) fetchCourseDetail(selectedId).then((full) => renderDetail(full, c)).catch(() => renderDetail(c, c));
        }
      });
    }

    if (detailClose) detailClose.addEventListener("click", () => {
      detailPanel.classList.add("hidden");
      selectedId = null;
      renderMarkers();
    });

    initCalculateTimeModal();
    renderLikedCourses();
    checkAuth();
  }

  function main() {
    initMap();
    bindUI();
    loadCourses();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
