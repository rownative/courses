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

  function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function fmtTime(seconds) {
    if (seconds == null) return "—";
    const s = Math.round(Number(seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins + ":" + String(secs).padStart(2, "0");
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
    return fetch(API_BASE + "/me", { credentials: "include" })
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
      .catch(() => false);
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
    map = L.map("challenge-map").setView(center, 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(map);
  }

  function loadCourseForMap(courseId) {
    if (!courseId || !map) return;
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
              const layer = L.polygon(pts, { color: "#0af", fillColor: "#0af", fillOpacity: 0.2, weight: 2 });
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
    document.getElementById("corrected-header").classList.toggle("hidden", !hasHandicap);
    document.getElementById("points-header").classList.toggle("hidden", !hasHandicap);

    const boatFilter = document.getElementById("boat-filter");
    const sexFilter = document.getElementById("sex-filter");
    let boatType = boatFilter ? boatFilter.value : "";
    let sex = sexFilter ? sexFilter.value : "";

    let filtered = results.slice();
    if (boatType) filtered = filtered.filter((r) => (r.boatType || "") === boatType);
    if (sex) filtered = filtered.filter((r) => (r.sex || "") === sex);

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
    if (filtered.length === 0) {
      tbody.innerHTML = "<tr><td colspan='8'>No results yet.</td></tr>";
      return;
    }
    tbody.innerHTML = filtered
      .map((r, i) => {
        const rank = sortByRawTime ? i + 1 : (r.rank != null ? r.rank : i + 1);
        const workoutLink = r.activityId
          ? "<a href='https://intervals.icu/activities/i" + encodeURIComponent(String(r.activityId).replace(/^i/, "")) + "' target='_blank' rel='noopener'>↗</a>"
          : "";
        let row =
          "<tr>" +
          "<td>" + rank + "</td>" +
          "<td>" + escapeHtml(r.displayName || "Anonymous") + " " + workoutLink + "</td>" +
          "<td>" + escapeHtml(r.boatType || "—") + "</td>" +
          "<td class='time'>" + fmtTime(r.rawTimeS) + "</td>";
        if (hasHandicap) {
          row += "<td class='time'>" + fmtTime(r.correctedTimeS) + "</td>";
          row += "<td>" + (r.points != null ? r.points.toFixed(1) + "%" : "—") + "</td>";
        }
        row +=
          "<td>" + fmtDate(r.workoutDate) + "</td>" +
          "<td>" + escapeHtml(r.validationStatus || "valid") + "</td>" +
          "</tr>";
        return row;
      })
      .join("");
  }

  let isSignedIn = false;

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
    const categoryRow = document.getElementById("submit-category-row");
    const resultMsg = document.getElementById("submit-result-msg");
    const c = challenge;

    categoryRow.classList.toggle("hidden", !(c && c.hasHandicap));
    resultMsg.classList.add("hidden");
    resultMsg.innerHTML = "";
    displayNameInput.value = "Mock User";

    activitySelect.innerHTML = "<option value=''>Loading…</option>";
    fetch(API_BASE + "/me/activities", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const acts = data.activities || [];
        activitySelect.innerHTML = "<option value=''>Select a workout…</option>";
        acts.forEach((a) => {
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
    const body = {
      activityId: activityId,
      displayName: displayNameInput.value.trim() || undefined,
      boatType: challenge && challenge.hasHandicap ? boatTypeSelect.value : undefined,
      sex: challenge && challenge.hasHandicap ? sexSelect.value : undefined,
      weightClass: challenge && challenge.hasHandicap && weightClassSelect ? weightClassSelect.value : undefined,
    };

    submitBtn.disabled = true;
    fetch(API_BASE + "/challenges/" + encodeURIComponent(challengeId) + "/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          resultMsg.textContent = data.error;
          resultMsg.classList.add("error");
        } else {
          resultMsg.innerHTML = "Submitted! Rank: " + (data.rank || "—") + ". <a href='#' onclick='location.reload(); return false;'>Refresh</a> to see your result.";
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

  checkAuth()
    .then((signedIn) => {
      isSignedIn = signedIn;
      return loadChallenge().then(() => {
        loadResults();
        showSubmitSection();
      });
    })
    .catch((err) => {
      document.getElementById("challenge-header").innerHTML =
        "<p class='error'>" + escapeHtml(err.message || "Failed to load") + ". <a href='challenges.html'>Browse challenges</a></p>";
    });
})();
