/**
 * Organiser panel — create challenges, manage standard collections, moderate results
 */
(function () {
  "use strict";

  const API_BASE = (typeof window.ROWNATIVE_API !== "undefined" && window.ROWNATIVE_API)
    ? window.ROWNATIVE_API
    : "/api";

  const accessDenied = document.getElementById("access-denied");
  const organiserContent = document.getElementById("organiser-content");
  const createForm = document.getElementById("create-challenge-form");
  const createResult = document.getElementById("create-result");
  const challengeCourse = document.getElementById("challenge-course");
  const challengeCollection = document.getElementById("challenge-collection");
  const collectionRow = document.getElementById("collection-row");
  const handicapCheckbox = document.getElementById("challenge-handicap");
  const myChallengesBody = document.getElementById("my-challenges-body");
  const noChallengesMsg = document.getElementById("no-challenges-msg");
  const moderateSelect = document.getElementById("moderate-challenge-select");
  const moderationResults = document.getElementById("moderation-results");

  function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function fmtDateRange(start, end) {
    if (!start || !end) return "—";
    return (start + "").slice(0, 10) + " – " + (end + "").slice(0, 10);
  }

  function fmtTime(seconds) {
    if (seconds == null) return "—";
    const s = Math.round(Number(seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins + ":" + String(secs).padStart(2, "0");
  }

  function checkAuth() {
    return fetch(API_BASE + "/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const signedIn = !!data.athleteId;
        const isOrganizer = !!data.isOrganizer;
        const signInLink = document.getElementById("sign-in-link");
        const signInOrganiserLink = document.getElementById("sign-in-organiser-link");
        const signOutLink = document.getElementById("sign-out-link");
        const myTimesLink = document.getElementById("my-times-link");
        const organiserLink = document.getElementById("organiser-link");
        const importLink = document.getElementById("import-link");
        const submitLink = document.getElementById("submit-link");
        const updateLink = document.getElementById("update-link");
        const userInfo = document.getElementById("user-info");

        if (signedIn) {
          signInLink.classList.add("hidden");
          signInOrganiserLink.classList.add("hidden");
          signOutLink.classList.remove("hidden");
          myTimesLink?.classList.remove("hidden");
          if (isOrganizer) organiserLink?.classList.remove("hidden");
          else organiserLink?.classList.add("hidden");
          importLink?.classList.remove("hidden");
          submitLink?.classList.remove("hidden");
          updateLink?.classList.remove("hidden");
          userInfo?.classList.remove("hidden");
          userInfo.textContent = "Signed in";
        } else {
          signInLink.classList.remove("hidden");
          signInOrganiserLink.classList.remove("hidden");
          signOutLink.classList.add("hidden");
          myTimesLink?.classList.add("hidden");
          organiserLink?.classList.add("hidden");
          importLink?.classList.add("hidden");
          submitLink?.classList.add("hidden");
          updateLink?.classList.add("hidden");
          userInfo?.classList.add("hidden");
        }

        if (signedIn && isOrganizer) {
          accessDenied.classList.add("hidden");
          organiserContent.classList.remove("hidden");
          loadCourses();
          loadCollections();
          loadMyChallenges();
        } else {
          accessDenied.classList.remove("hidden");
          organiserContent.classList.add("hidden");
        }
        return { signedIn, isOrganizer };
      })
      .catch(() => {
        accessDenied.classList.remove("hidden");
        organiserContent.classList.add("hidden");
        return { signedIn: false, isOrganizer: false };
      });
  }

  function loadCourses() {
    fetch(API_BASE + "/courses", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const courses = data.courses || [];
        challengeCourse.innerHTML = "<option value=''>Select course…</option>";
        courses.slice(0, 50).forEach((c) => {
          const name = (c.name || "Course " + c.id).slice(0, 60);
          challengeCourse.innerHTML += "<option value='" + escapeHtml(c.id) + "'>" + escapeHtml(name) + "</option>";
        });
      })
      .catch(() => {
        challengeCourse.innerHTML = "<option value=''>Failed to load</option>";
      });
  }

  function loadCollections() {
    challengeCollection.innerHTML = "<option value=''>Loading…</option>";
    fetch(API_BASE + "/organiser/standard-collections", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const colls = data.collections || [];
        challengeCollection.innerHTML = "<option value=''>— Select collection —</option>";
        colls.forEach((c) => {
          challengeCollection.innerHTML +=
            "<option value='" + escapeHtml(c.id) + "'>" + escapeHtml(c.name) + (c.isBuiltin ? " (built-in)" : "") + "</option>";
        });
        const listEl = document.getElementById("collections-list");
        listEl.innerHTML = colls.map((c) => "<span class='badge'>" + escapeHtml(c.name) + "</span> ").join("") || "—";
      })
      .catch(() => {
        challengeCollection.innerHTML = "<option value=''>Failed to load</option>";
      });
  }

  const uploadCollectionForm = document.getElementById("upload-collection-form");
  const uploadCollectionResult = document.getElementById("upload-collection-result");

  if (uploadCollectionForm) {
    uploadCollectionForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("collection-name");
      const fileInput = document.getElementById("collection-csv");
      const name = nameInput?.value?.trim();
      const file = fileInput?.files?.[0];
      if (!name) {
        uploadCollectionResult.textContent = "Please enter a collection name.";
        uploadCollectionResult.classList.remove("hidden");
        uploadCollectionResult.classList.add("error");
        return;
      }
      if (!file) {
        uploadCollectionResult.textContent = "Please select a CSV file.";
        uploadCollectionResult.classList.remove("hidden");
        uploadCollectionResult.classList.add("error");
        return;
      }
      uploadCollectionResult.classList.add("hidden");
      const formData = new FormData();
      formData.append("name", name);
      formData.append("file", file);
      fetch(API_BASE + "/organiser/standard-collections", {
        method: "POST",
        body: formData,
        credentials: "include",
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) {
            uploadCollectionResult.textContent = data.error;
            uploadCollectionResult.classList.add("error");
          } else {
            uploadCollectionResult.innerHTML = "Collection created: <strong>" + escapeHtml(data.id || name) + "</strong>. It will appear in the dropdown above.";
            uploadCollectionResult.classList.remove("error");
            uploadCollectionForm.reset();
            loadCollections();
          }
          uploadCollectionResult.classList.remove("hidden");
        })
        .catch((err) => {
          uploadCollectionResult.textContent = "Error: " + (err.message || "Upload failed");
          uploadCollectionResult.classList.add("error");
          uploadCollectionResult.classList.remove("hidden");
        });
    });
  }

  let myChallenges = [];

  function loadMyChallenges() {
    fetch(API_BASE + "/organiser/challenges", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        myChallenges = data.challenges || [];
        if (myChallenges.length === 0) {
          myChallengesBody.innerHTML = "";
          noChallengesMsg.classList.remove("hidden");
          moderateSelect.innerHTML = "<option value=''>— Select challenge —</option>";
        } else {
          noChallengesMsg.classList.add("hidden");
          myChallengesBody.innerHTML = myChallenges
            .map(
              (c) =>
                "<tr>" +
                "<td>" + escapeHtml(c.name) + "</td>" +
                "<td>" + escapeHtml(c.courseName || c.courseId) + "</td>" +
                "<td>" + fmtDateRange(c.rowStart, c.rowEnd) + "</td>" +
                "<td>" + (c.resultsCount || 0) + "</td>" +
                "<td>" +
                "<a href='challenge.html?id=" + encodeURIComponent(c.id) + "' class='btn'>View</a> " +
                "</td>" +
                "</tr>"
            )
            .join("");
          moderateSelect.innerHTML = "<option value=''>— Select challenge —</option>";
          myChallenges.forEach((c) => {
            moderateSelect.innerHTML += "<option value='" + escapeHtml(c.id) + "'>" + escapeHtml(c.name) + "</option>";
          });
        }
      })
      .catch(() => {
        myChallengesBody.innerHTML = "";
        noChallengesMsg.classList.remove("hidden");
      });
  }

  handicapCheckbox.addEventListener("change", () => {
    collectionRow.classList.toggle("hidden", !handicapCheckbox.checked);
  });
  collectionRow.classList.add("hidden");

  createForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("challenge-name").value.trim();
    const courseId = challengeCourse.value;
    const rowStart = document.getElementById("challenge-row-start").value;
    const rowEnd = document.getElementById("challenge-row-end").value;
    const submitEnd = document.getElementById("challenge-submit-end").value;
    const hasHandicap = handicapCheckbox.checked;
    const collectionId = hasHandicap ? challengeCollection.value || null : null;
    const notes = document.getElementById("challenge-notes").value.trim() || null;

    if (!name || !courseId || !rowStart || !rowEnd || !submitEnd) {
      createResult.textContent = "Please fill required fields.";
      createResult.classList.remove("hidden");
      createResult.classList.add("error");
      return;
    }

    const rowStartISO = rowStart ? new Date(rowStart).toISOString().slice(0, 19) : null;
    const rowEndISO = rowEnd ? new Date(rowEnd).toISOString().slice(0, 19) : null;
    const submitEndISO = submitEnd ? new Date(submitEnd).toISOString().slice(0, 19) : null;

    createResult.classList.add("hidden");
    fetch(API_BASE + "/organiser/challenges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        courseId,
        rowStart: rowStartISO,
        rowEnd: rowEndISO,
        submitEnd: submitEndISO,
        hasHandicap,
        collectionId,
        notes,
        isPublic: true,
      }),
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          createResult.textContent = data.error;
          createResult.classList.add("error");
        } else {
          createResult.innerHTML = "Challenge created: <a href='challenge.html?id=" + encodeURIComponent(data.id) + "'>" + escapeHtml(data.challenge?.name || data.id) + "</a>";
          createResult.classList.remove("error");
          createForm.reset();
          loadMyChallenges();
        }
        createResult.classList.remove("hidden");
      })
      .catch((err) => {
        createResult.textContent = "Error: " + (err.message || "Create failed");
        createResult.classList.add("error");
        createResult.classList.remove("hidden");
      });
  });

  moderateSelect.addEventListener("change", () => {
    const chId = moderateSelect.value;
    if (!chId) {
      moderationResults.classList.add("hidden");
      moderationResults.innerHTML = "";
      return;
    }
    fetch(API_BASE + "/organiser/challenges/" + encodeURIComponent(chId) + "/results", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const results = data.results || [];
        const needsModeration = results.filter((r) => (r.validationStatus || "").match(/pending|invalid/));
        const allModeratable = results.filter((r) => (r.validationStatus || "") !== "dq");
        const toShow = needsModeration.length > 0 ? needsModeration : allModeratable;
        if (toShow.length === 0) {
          moderationResults.innerHTML = "<p class='empty'>No results to moderate.</p>";
        } else {
          moderationResults.innerHTML = toShow
            .map(
              (r) =>
                "<div class='moderation-item " + (r.validationStatus || "") + "'>" +
                "<strong>" + escapeHtml(r.displayName || "Anonymous") + "</strong> — " +
                fmtTime(r.rawTimeS) +
                (r.validationNote ? "<br><em>" + escapeHtml(r.validationNote) + "</em>" : "") +
                "<br>" +
                (needsModeration.includes(r) ? "<button type='button' class='btn approve-btn' data-result-id='" + escapeHtml(r.id) + "'>Approve</button> " : "") +
                "<button type='button' class='btn btn-secondary dq-btn' data-result-id='" + escapeHtml(r.id) + "'>Disqualify</button> " +
                "<button type='button' class='btn btn-secondary view-track-btn' data-result-id='" + escapeHtml(r.id) + "'>View track</button>" +
                "</div>"
            )
            .join("");
          moderationResults.querySelectorAll(".approve-btn").forEach((btn) => {
            btn.addEventListener("click", () => overrideResult(btn.dataset.resultId, "manual_ok"));
          });
          moderationResults.querySelectorAll(".dq-btn").forEach((btn) => {
            btn.addEventListener("click", () => overrideResult(btn.dataset.resultId, "dq"));
          });
          moderationResults.querySelectorAll(".view-track-btn").forEach((btn) => {
            btn.addEventListener("click", () => showTrackOverlay(btn.dataset.resultId));
          });
        }
        moderationResults.classList.remove("hidden");
      })
      .catch(() => {
        moderationResults.innerHTML = "<p class='error'>Failed to load results.</p>";
        moderationResults.classList.remove("hidden");
      });
  });

  let trackMap = null;

  function showTrackOverlay(resultId) {
    const modal = document.getElementById("track-modal");
    const mapEl = document.getElementById("track-map");
    if (!modal || !mapEl) return;
    modal.classList.remove("hidden");
    mapEl.innerHTML = "";
    fetch(API_BASE + "/organiser/results/" + encodeURIComponent(resultId) + "/track", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load track");
        return r.json();
      })
      .then((data) => {
        const latlng = data.latlng || [];
        if (latlng.length < 2) {
          mapEl.innerHTML = "<p>No track data</p>";
          return;
        }
        const bounds = latlng.map((p) => [p[0], p[1]]);
        trackMap = L.map("track-map").fitBounds(bounds, { padding: [20, 20] });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(trackMap);
        L.polyline(bounds, { color: "#1a3a4a", weight: 4 }).addTo(trackMap);
      })
      .catch((err) => {
        mapEl.innerHTML = "<p class='error'>" + escapeHtml(err.message || "Failed to load track") + "</p>";
      });
  }

  document.getElementById("track-modal-close")?.addEventListener("click", () => {
    document.getElementById("track-modal")?.classList.add("hidden");
    if (trackMap) {
      trackMap.remove();
      trackMap = null;
    }
  });

  function overrideResult(resultId, status) {
    const note = status === "dq" ? prompt("Reason for disqualification:") : "";
    if (status === "dq" && note === null) return;
    fetch(API_BASE + "/organiser/results/" + encodeURIComponent(resultId) + "/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note: note || "" }),
      credentials: "include",
    })
      .then((r) => r.json())
      .then(() => {
        moderateSelect.dispatchEvent(new Event("change"));
      })
      .catch(() => alert("Override failed"));
  }

  checkAuth();
})();
