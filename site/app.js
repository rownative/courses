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

  // Elements
  let searchEl, countryFilter, distanceMin, distanceMax;
  let filterProvisional, filterEstablished;
  let detailPanel, detailContent, detailClose;
  let loginBtn;

  function initMap() {
    map = L.map("map").setView([30, 0], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(map);

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

  function loadCourses() {
    function tryLoad(url) {
      return fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(r.status);
          const ct = r.headers.get("content-type") || "";
          if (!ct.includes("application/json")) throw new Error("Not JSON");
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
        if (detailContent) {
          detailContent.innerHTML = `<p class="error">Could not load courses: ${e.message}</p>`;
          detailPanel?.classList.remove("hidden");
        }
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
    const dMinKm = parseFloat(distanceMin?.value) || 0;
    const dMaxKm = parseFloat(distanceMax?.value) || 25;
    const dMin = dMinKm * 1000;
    const dMax = dMaxKm * 1000;
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
      const liked = isSignedIn && userLiked.has(c.id);
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
      m.bindTooltip(c.name || c.id, { direction: "top" });
      markersLayer.addLayer(m);
    });

    // Re-zoom to fit all visible markers
    if (filtered.length === 0) return;
    if (filtered.length === 1) {
      const c = filtered[0];
      map.setView([c.center_lat, c.center_lon], 10);
    } else {
      const bounds = markersLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
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

  function renderDetail(full, meta) {
    const liked = userLiked.has(meta.id);
    const kmlUrl = API_BASE
      ? `${API_BASE}/courses/${meta.id}`
      : `${kmlBase}${meta.id}.kml`;
    const likeButtonHtml = isSignedIn
      ? `<button type="button" class="btn like-btn ${liked ? "liked" : ""}" data-id="${meta.id}">${liked ? "♥ Liked" : "♡ Like"}</button>`
      : "";
    let html = `
      <h2>${escapeHtml(meta.name)}</h2>
      <p><strong>Distance:</strong> ${meta.distance_m || "—"} m</p>
      <p><strong>Country:</strong> ${escapeHtml(meta.country || "—")}</p>
      <p><strong>Status:</strong> <span class="badge ${meta.status}">${meta.status}</span></p>
      ${meta.notes ? `<p class="notes">${escapeHtml(meta.notes)}</p>` : ""}
      <p>
        <a href="${kmlUrl}" download="${meta.id}.kml" class="btn">Download KML</a>
        ${likeButtonHtml}
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
            const layer = L.polygon(pts, {
              color: "#0af",
              fillColor: "#0af",
              fillOpacity: 0.2,
              weight: 2,
            });
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
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function toggleLike(id) {
    // Optimistic UI update when viewing this course
    if (selectedId === id) {
      const c = courses.find((x) => x.id === id);
      if (c) {
        if (userLiked.has(id)) {
          userLiked.delete(id);
        } else {
          userLiked.add(id);
        }
        fetchCourseDetail(id).then((full) => renderDetail(full, c));
      }
    }
    const url = `${API_BASE}/rowers/courses/${id}/follow/`;
    if (userLiked.has(id)) {
      fetch(`${API_BASE}/rowers/courses/${id}/unfollow/`, { method: "POST", credentials: "include" })
        .then((r) => { if (r.ok) { userLiked.delete(id); if (selectedId !== id) renderMarkers(); } })
        .catch(() => {});
    } else {
      fetch(url, { method: "POST", credentials: "include" })
        .then((r) => { if (r.ok) { userLiked.add(id); if (selectedId !== id) renderMarkers(); } })
        .catch(() => {});
    }
  }

  function checkAuth() {
    fetch(`${API_BASE}/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        isSignedIn = !!data.athleteId;
        userLiked = new Set(data.liked || []);
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
        renderMarkers();
        if (selectedId) {
          const c = courses.find((x) => x.id === selectedId);
          if (c) fetchCourseDetail(selectedId).then((full) => renderDetail(full, c)).catch(() => renderDetail(c, c));
        }
      })
      .catch(() => {
        isSignedIn = false;
        const legendLiked = document.getElementById("legend-liked");
        if (legendLiked) legendLiked.classList.add("hidden");
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
    distanceMin = document.getElementById("distance-min");
    distanceMax = document.getElementById("distance-max");
    filterProvisional = document.getElementById("filter-provisional");
    filterEstablished = document.getElementById("filter-established");
    detailPanel = document.getElementById("detail-panel");
    detailContent = document.getElementById("detail-content");
    detailClose = document.getElementById("close-detail");
    loginBtn = document.getElementById("sign-in-link");

    const runFilters = () => renderMarkers();
    if (searchEl) searchEl.addEventListener("input", runFilters);
    if (countryFilter) countryFilter.addEventListener("change", runFilters);
    if (distanceMin) distanceMin.addEventListener("input", runFilters);
    if (distanceMax) distanceMax.addEventListener("input", runFilters);
    if (filterProvisional) filterProvisional.addEventListener("change", runFilters);
    if (filterEstablished) filterEstablished.addEventListener("change", runFilters);

    if (detailClose) detailClose.addEventListener("click", () => {
      detailPanel.classList.add("hidden");
      selectedId = null;
      renderMarkers();
    });

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
