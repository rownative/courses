/**
 * Challenge detail — leaderboard and submit result
 */
(function () {
  "use strict";

  const API_BASE = (typeof window.ROWNATIVE_API !== "undefined" && window.ROWNATIVE_API)
    ? window.ROWNATIVE_API
    : "/api";

  const params = new URLSearchParams(window.location.search);
  const challengeId = params.get("id");
  if (!challengeId) {
    document.getElementById("challenge-header").innerHTML = "<p class='error'>No challenge specified. <a href='challenges.html'>Browse challenges</a></p>";
    document.getElementById("sidebar-content").innerHTML = "";
    throw new Error("No challenge id");
  }

  let challenge = null;
  let results = [];
  let map = null;
  let coursesBase = "./courses/";
  let sortByRawTime = null;  // null | "asc" | "desc"
  let courseTrackController = null;
  /** Set in checkAuth — used to show organiser moderation callout */
  let currentAthleteId = null;

  function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
  }

  function fmtTime(seconds) {
    if (seconds == null) return "—";
    const s = Math.round(Number(seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins + ":" + String(secs).padStart(2, "0");
  }

  const challengeFormat = window.rownativeChallengeFormat;

  function showCourseTrackMessage(message) {
    const el = document.getElementById("course-track-message");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("hidden", !message);
  }

  function fetchCourseTrack(resultId) {
    const url = API_BASE + "/challenges/" + encodeURIComponent(challengeId) + "/results/" + encodeURIComponent(resultId) + "/track";
    return fetch(url, { credentials: "include" }).then((response) => {
      if (!response.ok) throw new Error("Course path could not be loaded");
      return response.json();
    });
  }

  function initCourseTrackController() {
    if (courseTrackController) return;
    courseTrackController = challengeFormat.createCourseTrackController({
      fetchTrack: fetchCourseTrack,
      createLayer: (latlng, color) => L.polyline(latlng, { color, weight: 4, opacity: 0.9 }),
      addLayer: (layer) => layer.addTo(map),
      removeLayer: (layer) => map.removeLayer(layer),
      onLoadError: () => {
        showCourseTrackMessage("That course path is no longer available.");
        renderLeaderboard();
      },
    });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    return (iso + "").slice(0, 10);
  }

  function getStatusBadge(rowStart, rowEnd, submitEnd) {
    const now = new Date();
    const rs = new Date(rowStart || 0);
    const se = new Date(submitEnd || 0);
    if (rs > now) return { cls: "upcoming", text: "Upcoming" };
    if (now > se) return { cls: "closed", text: "Submissions closed" };
    if (now >= rs && now <= se) return { cls: "open", text: "Open for submissions" };
    return { cls: "closed", text: "Submissions closed" };
  }

  function checkAuth() {
    const meUrl = API_BASE + "/me";
    return fetch(meUrl, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const signedIn = !!data.athleteId;
        const signInLink = document.getElementById("sign-in-link");
        const signOutLink = document.getElementById("sign-out-link");
        const myTimesLink = document.getElementById("my-times-link");
        const organiserLink = document.getElementById("organiser-link");
        const importLink = document.getElementById("import-link");
        const submitLink = document.getElementById("submit-link");
        const updateLink = document.getElementById("update-link");
        const userInfo = document.getElementById("user-info");
        currentAthleteId = data.athleteId ? String(data.athleteId) : null;
        if (signedIn) {
          signInLink.classList.add("hidden");
          signOutLink.classList.remove("hidden");
          myTimesLink?.classList.remove("hidden");
          if (data.isOrganizer && organiserLink) organiserLink.classList.remove("hidden");
          else if (organiserLink) organiserLink.classList.add("hidden");
          importLink?.classList.remove("hidden");
          submitLink?.classList.remove("hidden");
          updateLink?.classList.remove("hidden");
          userInfo?.classList.remove("hidden");
          userInfo.textContent = "Signed in";
        } else {
          currentAthleteId = null;
          signInLink.classList.remove("hidden");
          signOutLink.classList.add("hidden");
          myTimesLink?.classList.add("hidden");
          organiserLink?.classList.add("hidden");
          importLink?.classList.add("hidden");
          submitLink?.classList.add("hidden");
          updateLink?.classList.add("hidden");
          userInfo?.classList.add("hidden");
        }
        return signedIn;
      })
      .catch(() => {
        currentAthleteId = null;
        return false;
      });
  }

  function organiserModerateHref() {
    const u = "organiser.html?moderate=" + encodeURIComponent(challengeId);
    return typeof window.rownativeAppendToHref === "function"
      ? window.rownativeAppendToHref(u)
      : u;
  }

  function updateOrganiserModerateCallout() {
    const el = document.getElementById("organiser-moderate-callout");
    const link = document.getElementById("organiser-moderate-link");
    if (!el || !link || !challenge || !currentAthleteId) {
      if (el) el.classList.add("hidden");
      return;
    }
    const oid = challenge.organizerId != null ? String(challenge.organizerId) : "";
    if (oid && oid === currentAthleteId) {
      link.setAttribute("href", organiserModerateHref());
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }

  function loadChallenge() {
    return fetch(API_BASE + "/challenges/" + encodeURIComponent(challengeId), { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Challenge not found");
        return r.json();
      })
      .then((data) => {
        challenge = data;
        renderHeader();
        renderSidebar();
        initMap();
        loadCourseForMap(data.courseId);
        updateOrganiserModerateCallout();
        return data;
      });
  }

  function loadResults() {
    return fetch(API_BASE + "/challenges/" + encodeURIComponent(challengeId) + "/results", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { results: [] })
      .then((data) => {
        results = data.results || [];
        renderLeaderboard();
      });
  }

  function renderHeader() {
    const c = challenge;
    if (!c) return;
    const badge = getStatusBadge(c.rowStart, c.rowEnd, c.submitEnd);
    const courseLink = '<a href="index.html#course-' + escapeHtml(c.courseId) + '">' + escapeHtml(c.courseName || "Course " + c.courseId) + "</a>";
    const html =
      "<h1>" + escapeHtml(c.name) + "</h1>" +
      "<div class='meta'>" + courseLink + "</div>" +
      "<div class='meta'>Row between " + fmtDate(c.rowStart) + " – " + fmtDate(c.rowEnd) + "</div>" +
      "<div class='meta'>Submit by " + fmtDate(c.submitEnd) + "</div>" +
      "<span class='badge " + badge.cls + "'>" + badge.text + "</span>";
    document.getElementById("challenge-header").innerHTML = html;
  }

  function renderSidebar() {
    const c = challenge;
    if (!c) return;
    let html = "<h3>Challenge info</h3>";
    html += "<p><strong>Organiser:</strong> " + escapeHtml(c.organizerName || "Anonymous") + "</p>";
    if (c.collectionName) {
      html += "<p><strong>Scoring:</strong> " + escapeHtml(c.collectionName) + "</p>";
    }
    if (c.notes) {
      html += "<p>" + escapeHtml(c.notes) + "</p>";
    }
    html += "<p>Like this course on the map to sync it to CrewNerd. Row the course during the window. Log your workout in intervals.icu, then submit it here.</p>";
    document.getElementById("sidebar-content").innerHTML = html;
  }

  function initMap() {
    const c = challenge;
    const center = (c && c.center_lat != null) ? [c.center_lat, c.center_lon] : [42, -71];
    const mapEl = document.getElementById("challenge-map");
    if (mapEl && typeof window.rownativeMapHighContrastEnabled === "function" && window.rownativeMapHighContrastEnabled()) {
      mapEl.classList.add("map-high-contrast");
    }
    map = L.map("challenge-map").setView(center, 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(map);
    initCourseTrackController();
  }

  function loadCourseForMap(courseId) {
    if (!courseId || !map) return;
    const defaultPolyStyle = { color: "#0af", fillColor: "#0af", fillOpacity: 0.2, weight: 2 };
    const polyStyle =
      typeof window.rownativeLeafletPolygonStyle === "function"
        ? window.rownativeLeafletPolygonStyle()
        : defaultPolyStyle;
    const url = coursesBase + courseId + ".json";
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (data.polygons && data.polygons.length > 0) {
          const bounds = [];
          data.polygons.forEach((poly) => {
            const pts = (poly.points || []).map((p) => [p.lat, p.lon]);
            if (pts.length >= 2) {
              if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) {
                pts.push(pts[0]);
              }
              const layer = L.polygon(pts, polyStyle);
              layer.bindTooltip(poly.name || "");
              layer.addTo(map);
              pts.forEach((p) => bounds.push(p));
            }
          });
          if (bounds.length > 0) {
            map.fitBounds(bounds, { padding: [20, 20], maxZoom: 14 });
          }
        }
      })
      .catch(() => {});
  }

  function renderLeaderboard() {
    const c = challenge;
    const hasHandicap = c && c.hasHandicap;
    const showAge = hasHandicap && results.some((r) => r.crewAvgAge != null);
    document.getElementById("corrected-header").classList.toggle("hidden", !hasHandicap);
    document.getElementById("points-header").classList.toggle("hidden", !hasHandicap);
    document.getElementById("age-header").classList.toggle("hidden", !showAge);

    const boatFilter = document.getElementById("boat-filter");
    const sexFilter = document.getElementById("sex-filter");
    let boatType = boatFilter ? boatFilter.value : "";
    let sex = sexFilter ? sexFilter.value : "";

    let filtered = results.slice();
    if (boatType) filtered = filtered.filter((r) => (r.boatType || "") === boatType);
    if (sex) filtered = filtered.filter((r) => (r.sex || "") === sex);

    if (courseTrackController) {
      courseTrackController.retain(new Set(filtered.filter((r) => r.hasCourseTrack === true).map((r) => String(r.id))));
    }

    const sortKey = hasHandicap ? "correctedTimeS" : "rawTimeS";
    if (sortByRawTime === "asc") {
      filtered.sort((a, b) => (a[sortKey] ?? 999999) - (b[sortKey] ?? 999999));
    } else if (sortByRawTime === "desc") {
      filtered.sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
    }

    const boatTypes = [...new Set(results.map((r) => r.boatType).filter(Boolean))].sort();
    const sexes = [...new Set(results.map((r) => r.sex).filter(Boolean))].sort();

    let filtersHtml = "";
    if (boatTypes.length > 1) {
      filtersHtml += "<select id='boat-filter'><option value=''>All boats</option>";
      boatTypes.forEach((bt) => {
        const sel = bt === boatType ? " selected" : "";
        filtersHtml += "<option value='" + escapeHtml(bt) + "'" + sel + ">" + escapeHtml(bt) + "</option>";
      });
      filtersHtml += "</select>";
    }
    if (sexes.length > 1) {
      filtersHtml += "<select id='sex-filter'><option value=''>All</option>";
      sexes.forEach((s) => {
        const label = s === "M" ? "Male" : s === "F" ? "Female" : s === "X" ? "Mixed" : s;
        const sel = s === sex ? " selected" : "";
        filtersHtml += "<option value='" + escapeHtml(s) + "'" + sel + ">" + escapeHtml(label) + "</option>";
      });
      filtersHtml += "</select>";
    }
    document.getElementById("leaderboard-filters").innerHTML = filtersHtml || "<span></span>";

    document.getElementById("boat-filter")?.addEventListener("change", () => renderLeaderboard());
    document.getElementById("sex-filter")?.addEventListener("change", () => renderLeaderboard());

    const rawTimeHeader = document.getElementById("raw-time-header");
    if (rawTimeHeader && !rawTimeHeader.dataset.bound) {
      rawTimeHeader.dataset.bound = "1";
      rawTimeHeader.addEventListener("click", () => {
        sortByRawTime = sortByRawTime === "asc" ? "desc" : "asc";
        renderLeaderboard();
      });
      rawTimeHeader.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          rawTimeHeader.click();
        }
      });
    }
    if (rawTimeHeader) {
      rawTimeHeader.title = sortByRawTime === "asc" ? "Click to sort descending (slowest first)" : "Click to sort ascending (fastest first)";
      rawTimeHeader.textContent = sortByRawTime ? "Raw time " + (sortByRawTime === "asc" ? "↑" : "↓") : "Raw time";
    }

    const tbody = document.getElementById("leaderboard-body");
    const colSpan = 9 + (hasHandicap ? 2 : 0) + (showAge ? 1 : 0);
    if (filtered.length === 0) {
      tbody.innerHTML = "<tr><td colspan='" + colSpan + "'>No results yet.</td></tr>";
      return;
    }
    tbody.innerHTML = filtered
      .map((r, i) => {
        const rank = sortByRawTime ? i + 1 : (r.rank != null ? r.rank : i + 1);
        const resultId = r.id != null ? String(r.id) : "";
        const canShowCourseTrack = Boolean(resultId) && r.hasCourseTrack === true;
        const isTrackSelected = canShowCourseTrack && courseTrackController && courseTrackController.isSelected(resultId);
        const trackColor = isTrackSelected ? courseTrackController.getColor(resultId) : null;
        const workoutLink = r.activityId
          ? "<a href='https://intervals.icu/activities/i" + encodeURIComponent(String(r.activityId).replace(/^i/, "")) + "' target='_blank' rel='noopener'>↗</a>"
          : "";
        let row =
          "<tr class='course-track-row" + (isTrackSelected ? " track-selected' style='--course-track-color: " + trackColor + "'" : "'") + ">" +
          "<td>" + rank + "</td>" +
          "<td>" + escapeHtml(r.displayName || "Anonymous") + " " + workoutLink + "</td>" +
          "<td>" + escapeHtml(r.boatType || "—") + "</td>";
        if (showAge) {
          row += "<td>" + (r.crewAvgAge != null ? escapeHtml(String(r.crewAvgAge)) : "—") + "</td>";
        }
        row += "<td class='time'>" + fmtTime(r.rawTimeS) + "</td>";
        row += "<td class='distance'>" + challengeFormat.formatCourseDistance(r.courseDistanceM) + "</td>";
        row += "<td class='time'>" + challengeFormat.formatAveragePace(r.rawTimeS, r.courseDistanceM) + "</td>";
        row += "<td>";
        if (canShowCourseTrack) {
          row +=
            "<label class='course-track-toggle' title='Show this timed course path'>" +
            "<input class='course-track-checkbox' type='checkbox' data-result-id='" + escapeHtml(resultId) + "' aria-label='Show path for " + escapeHtml(r.displayName || "result") + "'" +
            (isTrackSelected ? " checked" : "") +
            " />" +
            (isTrackSelected ? "<span class='course-track-swatch' aria-hidden='true'></span>" : "") +
            "</label>";
        } else {
          row += "<span class='course-track-unavailable'>Not shared</span>";
        }
        row += "</td>";
        if (hasHandicap) {
          row += "<td class='time'>" + fmtTime(r.correctedTimeS) + "</td>";
          row += "<td>" + (r.points != null ? r.points.toFixed(1) + "%" : "—") + "</td>";
        }
        row +=
          "<td class='date'>" + fmtDate(r.workoutDate) + "</td>" +
          "<td>" + escapeHtml(r.validationStatus || "valid") + "</td>" +
          "</tr>";
        return row;
      })
      .join("");

    if (!tbody.dataset.courseTrackBound) {
      tbody.dataset.courseTrackBound = "1";
      tbody.addEventListener("change", (event) => {
        const input = event.target;
        if (!input.classList || !input.classList.contains("course-track-checkbox") || !courseTrackController) return;
        showCourseTrackMessage("");
        courseTrackController.setSelected(input.dataset.resultId, input.checked);
        renderLeaderboard();
      });
    }
  }

  let isSignedIn = false;
  let statusCheckInterval = null;

  function startStatusRefresh() {
    if (statusCheckInterval) return;
    statusCheckInterval = setInterval(() => {
      if (document.visibilityState === "visible") showSubmitSection();
    }, 60000);
  }

  function stopStatusRefresh() {
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
      statusCheckInterval = null;
    }
  }

  function showSubmitSection() {
    const c = challenge;
    if (!c) return;
    const badge = getStatusBadge(c.rowStart, c.rowEnd, c.submitEnd);
    const canSubmit = badge.cls === "open" && isSignedIn;
    const section = document.getElementById("submit-result-section");
    if (canSubmit) {
      section.classList.remove("hidden");
    } else {
      section.classList.add("hidden");
    }
  }

  function openSubmitModal() {
    const modal = document.getElementById("submit-modal");
    const activitySelect = document.getElementById("submit-activity");
    const displayNameInput = document.getElementById("submit-display-name");
    const handicapRow = document.getElementById("submit-handicap-row");
    const resultMsg = document.getElementById("submit-result-msg");
    const c = challenge;

    handicapRow.classList.toggle("hidden", !(c && c.hasHandicap));
    resultMsg.classList.add("hidden");
    resultMsg.classList.remove("error");
    resultMsg.innerHTML = "";
    displayNameInput.value = "";
    const shareCoursePathInput = document.getElementById("submit-share-course-path");
    if (shareCoursePathInput) shareCoursePathInput.checked = false;
    fetch(API_BASE + "/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : {})
      .then((me) => {
        displayNameInput.value = me.athleteDisplayName || "";
      })
      .catch(() => {});

    activitySelect.innerHTML = "<option value=''>Loading…</option>";
    fetch(API_BASE + "/me/activities", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const acts = data.activities || [];
        const rowStart = c?.rowStart ? String(c.rowStart).slice(0, 10) : null;
        const rowEnd = c?.rowEnd ? String(c.rowEnd).slice(0, 10) : null;
        const filtered = (rowStart && rowEnd)
          ? acts.filter((a) => {
              const d = a.start_date_local ? String(a.start_date_local).slice(0, 10) : "";
              return d >= rowStart && d <= rowEnd;
            })
          : acts;
        activitySelect.innerHTML = "<option value=''>Select a workout…</option>";
        if (filtered.length === 0) {
          const msg = acts.length === 0 ? "No workouts" : ("No workouts in row window (" + fmtDate(rowStart) + " – " + fmtDate(rowEnd) + ")");
          activitySelect.innerHTML += "<option value='' disabled>" + msg + "</option>";
        }
        filtered.forEach((a) => {
          const date = a.start_date_local ? a.start_date_local.slice(0, 10) : "";
          const label = date ? date + " — " + (a.name || "Untitled") : (a.name || "Untitled");
          activitySelect.innerHTML += "<option value='" + escapeHtml(a.id) + "'>" + escapeHtml(label) + "</option>";
        });
      })
      .catch(() => {
        activitySelect.innerHTML = "<option value=''>Failed to load</option>";
      });

    modal.classList.remove("hidden");
  }

  function closeSubmitModal() {
    document.getElementById("submit-modal").classList.add("hidden");
  }

  function showCourseValidation(data) {
    const diagnostics = data.gateDiagnostics;
    if (!diagnostics || diagnostics.reason === "no_gates") return;
    const dialog = document.createElement("dialog");
    dialog.className = "course-validation-dialog";
    dialog.setAttribute("aria-labelledby", "submit-course-validation-title");
    dialog.innerHTML = '<h3 id="submit-course-validation-title">Session does not match the course</h3>' +
      '<p class="validation-summary"></p><p>Orange: GPS trace · Green: passed gate · Red dashed: missed gate</p>' +
      '<div class="validation-map" aria-label="Course gates and session GPS trace"></div>' +
      '<form method="dialog"><button class="btn btn-secondary">Close</button></form>';
    dialog.querySelector(".validation-summary").textContent = diagnostics.reason === "gate_order"
      ? "Your session crossed every gate, but did not complete them in the required order."
      : "Missed gates: " + diagnostics.gates.filter((gate) => !gate.passed).map((gate) => gate.name).join(", ") + ".";
    document.body.appendChild(dialog);
    dialog.showModal();
    const validationMap = L.map(dialog.querySelector(".validation-map"));
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
    }).addTo(validationMap);
    const layers = L.featureGroup().addTo(validationMap);
    if (Array.isArray(data.latlng) && data.latlng.length >= 2) {
      L.polyline(data.latlng, { color: "#e65c00", weight: 4 }).addTo(layers);
    }
    diagnostics.gates.forEach((gate) => {
      L.polygon(gate.points.map((point) => [point.lat, point.lon]), {
        color: gate.passed ? "#16803c" : "#c62828",
        weight: gate.passed ? 3 : 5,
        dashArray: gate.passed ? null : "6 4",
        fillOpacity: gate.passed ? 0.15 : 0.35,
      }).addTo(layers);
    });
    validationMap.invalidateSize();
    if (layers.getBounds().isValid()) validationMap.fitBounds(layers.getBounds(), { padding: [40, 40], maxZoom: 16 });
    dialog.addEventListener("close", () => {
      validationMap.remove();
      dialog.remove();
    }, { once: true });
  }

  function doSubmit() {
    const activitySelect = document.getElementById("submit-activity");
    const displayNameInput = document.getElementById("submit-display-name");
    const boatTypeSelect = document.getElementById("submit-boat-type");
    const sexSelect = document.getElementById("submit-sex");
    const resultMsg = document.getElementById("submit-result-msg");
    const submitBtn = document.getElementById("submit-modal-submit");

    const activityId = activitySelect.value;
    if (!activityId) {
      resultMsg.textContent = "Please select a workout.";
      resultMsg.classList.remove("hidden");
      resultMsg.classList.add("error");
      return;
    }

    const weightClassSelect = document.getElementById("submit-weight-class");
    const crewAvgAgeInput = document.getElementById("submit-crew-avg-age");
    const shareCoursePathInput = document.getElementById("submit-share-course-path");
    let crewAvgAge = undefined;
    if (challenge && challenge.hasHandicap && crewAvgAgeInput && crewAvgAgeInput.value.trim() !== "") {
      const n = parseInt(crewAvgAgeInput.value.trim(), 10);
      if (!isNaN(n) && n >= 8 && n <= 120) crewAvgAge = n;
    }
    const body = {
      activityId: activityId,
      displayName: displayNameInput.value.trim() || undefined,
      boatType: boatTypeSelect && boatTypeSelect.value ? boatTypeSelect.value : undefined,
      sex: challenge && challenge.hasHandicap ? sexSelect.value : undefined,
      weightClass: challenge && challenge.hasHandicap && weightClassSelect ? weightClassSelect.value : undefined,
      crewAvgAge: crewAvgAge,
      shareCoursePath: !!(shareCoursePathInput && shareCoursePathInput.checked),
    };

    const submitPath = API_BASE + "/challenges/" + encodeURIComponent(challengeId) + "/submit";

    submitBtn.disabled = true;
    fetch(submitPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          const noGates = data.gateDiagnostics?.reason === "no_gates";
          resultMsg.textContent = noGates
            ? "This session is not near the selected course. Its GPS trace does not pass any course gates."
            : data.validationNote ? data.error + ": " + data.validationNote : data.error;
          resultMsg.classList.add("error");
          if (!noGates && data.gateDiagnostics) showCourseValidation(data);
          if (data.error.includes("crewAvgAge") || data.error.includes("crew age")) {
            const crewAgeInput = document.getElementById("submit-crew-avg-age");
            if (crewAgeInput) crewAgeInput.focus();
          }
        } else {
          const replaceNote = data.replaced ? " Your previous result in this category has been replaced." : "";
          resultMsg.innerHTML = "Submitted! Rank: " + (data.rank || "—") + "." + replaceNote + " <a href='#' onclick='location.reload(); return false;'>Refresh</a> to see your result.";
          resultMsg.classList.remove("error");
          setTimeout(() => {
            closeSubmitModal();
            loadResults();
          }, 1500);
        }
        resultMsg.classList.remove("hidden");
      })
      .catch((err) => {
        resultMsg.textContent = "Error: " + (err.message || "Submit failed");
        resultMsg.classList.add("error");
        resultMsg.classList.remove("hidden");
      })
      .finally(() => {
        submitBtn.disabled = false;
      });
  }

  document.getElementById("submit-result-btn")?.addEventListener("click", openSubmitModal);
  document.getElementById("submit-modal-close")?.addEventListener("click", closeSubmitModal);
  document.getElementById("submit-modal-submit")?.addEventListener("click", doSubmit);
  document.querySelector("[data-dismiss='modal']")?.addEventListener("click", closeSubmitModal);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      showSubmitSection();
      startStatusRefresh();
    } else {
      stopStatusRefresh();
    }
  });

  checkAuth()
    .then((signedIn) => {
      isSignedIn = signedIn;
      return loadChallenge().then(() => {
        loadResults();
        showSubmitSection();
        startStatusRefresh();
      });
    })
    .catch((err) => {
      document.getElementById("challenge-header").innerHTML =
        "<p class='error'>" + escapeHtml(err.message || "Failed to load") + ". <a href='challenges.html'>Browse challenges</a></p>";
    });
})();
