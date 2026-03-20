/**
 * Speed Orders — challenges list page
 */
(function () {
  "use strict";

  const API_BASE = (typeof window.ROWNATIVE_API !== "undefined" && window.ROWNATIVE_API)
    ? window.ROWNATIVE_API
    : "/api";

  const ORGANISER_ISSUE_URL = "https://github.com/rownative/courses/issues/new?title=Request+to+become+challenge+organiser";

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
        signInLink.classList.remove("hidden");
        signInOrganiserLink.classList.add("hidden");
        organiserLink?.classList.add("hidden");
      });
  }

  function loadChallenges(status) {
    currentStatus = status;
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
              emptyCta.innerHTML = '<a href="' + ORGANISER_ISSUE_URL + '" target="_blank" rel="noopener" class="btn">Request to become challenge organiser</a>';
            }
          } else {
            emptyCta.innerHTML = '<a href="/oauth/authorize" class="btn">Sign in</a> to set up or join challenges.';
          }
        } else {
          emptyState.classList.add("hidden");
          listEl.innerHTML = challenges
            .map((c) => {
              const courseLink = '<a href="index.html#course-' + escapeHtml(c.courseId) + '">' + escapeHtml(c.courseName || "Course " + c.courseId) + "</a>";
              const badge = c.hasHandicap
                ? '<span class="badge handicap">Handicap scoring</span>'
                : '<span class="badge raw">Raw times only</span>';
              return (
                '<div class="challenge-card">' +
                '<div class="course-name">' + courseLink + "</div>" +
                '<h3>' + escapeHtml(c.name) + "</h3>" +
                '<div class="meta">' +
                "Row between " + fmtDateRange(c.rowStart, c.rowEnd) + "<br>" +
                "Submit by " + fmtDate(c.submitEnd) + " · " + (c.resultsCount || 0) + " results" +
                "</div>" +
                '<div class="meta">' + badge + "</div>" +
                '<div class="actions">' +
                '<a href="challenge.html?id=' + encodeURIComponent(c.id) + '" class="btn">View leaderboard</a>' +
                "</div>" +
                "</div>"
              );
            })
            .join("");
        }

        if (isSignedIn) {
          organiserCta.classList.remove("hidden");
          if (isOrganizer) {
            organiserCtaText.innerHTML = '<a href="organiser.html">Set up a Challenge</a> — create and manage your own Speed Orders.';
          } else {
            organiserCtaText.innerHTML = 'Want to run your own? <a href="' + ORGANISER_ISSUE_URL + '" target="_blank" rel="noopener">Request to become challenge organiser</a>.';
          }
        } else {
          organiserCta.classList.add("hidden");
        }
      })
      .catch(() => {
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
