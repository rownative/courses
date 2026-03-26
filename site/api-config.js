/**
 * API config for local dev: ?debug=1&api=http://localhost:8787/api (port must match wrangler dev, e.g. 8788)
 * You may pass ?api=http://localhost:8788 — the /api suffix is added automatically for http(s) origin URLs.
 * Persists api/debug in sessionStorage and rewrites nav/OAuth links so they work across all pages.
 */
(function () {
  "use strict";

  /** Worker routes live under /api; treat bare http(s) origins as .../api so /me becomes .../api/me. */
  function normalizeWorkerApiBase(raw) {
    if (!raw || typeof raw !== "string") return raw;
    var s = raw.trim();
    if (!/^https?:\/\//i.test(s)) return s;
    try {
      var u = new URL(s);
      var path = u.pathname.replace(/\/+$/, "") || "/";
      if (path === "/api") return u.origin + "/api";
      if (path === "/") return u.origin + "/api";
    } catch (e) {}
    return s;
  }

  var params = typeof URLSearchParams !== "undefined" ? new URLSearchParams(location.search) : null;
  var api = params && params.get("api");
  var debug = params && (params.get("debug") === "1" || params.get("debug") === "true");

  if (!api) {
    try { api = sessionStorage.getItem("rownative_api"); } catch (e) {}
  }
  if (api) {
    api = normalizeWorkerApiBase(api);
    try { sessionStorage.setItem("rownative_api", api); } catch (e) {}
  }
  if (debug) {
    try { sessionStorage.setItem("rownative_debug", "1"); } catch (e) {}
  } else {
    try { debug = sessionStorage.getItem("rownative_debug") === "1"; } catch (e) {}
  }

  window.ROWNATIVE_API = api || undefined;
  window.ROWNATIVE_DEBUG = !!debug;

  function devParams() {
    if (!api) return "";
    var q = "api=" + encodeURIComponent(api);
    if (debug) q += "&debug=1";
    return q;
  }

  function appendDevParams(href) {
    if (!api) return href;
    var q = devParams();
    var sep = href.indexOf("?") >= 0 ? "&" : "?";
    var hash = "";
    var i = href.indexOf("#");
    if (i >= 0) {
      hash = href.slice(i);
      href = href.slice(0, i);
    }
    return href + (href.indexOf("?") >= 0 ? "&" + q : "?" + q) + hash;
  }

  function oauthHref(path) {
    if (!api || !api.startsWith("http")) return path;
    var base = api.replace(/\/api\/?$/, "");
    var returnTo = encodeURIComponent(location.origin + location.pathname + location.search);
    var joiner = path.indexOf("?") >= 0 ? "&" : "?";
    return base + path + joiner + "local=1&return_to=" + returnTo;
  }

  function rewriteLinks() {
    var q = devParams();
    if (!q) return;

    document.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("http")) return;
      if (href.startsWith("/oauth/")) {
        a.href = oauthHref(href);
      } else if (href.match(/\.html(\?|#|$)/) || (href.indexOf(".html") < 0 && href.indexOf("/") < 0)) {
        a.href = appendDevParams(href);
      }
    });
  }

  function handleClick(e) {
    if (!api) return;
    var a = e.target;
    while (a && a.tagName !== "A") a = a.parentElement;
    if (!a || !a.href) return;
    var href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("http")) return;
    if (href.indexOf("api=") >= 0) return;
    if (href.match(/\.html(\?|#|$)/) || (href.indexOf(".html") < 0 && href.indexOf("/") < 0)) {
      e.preventDefault();
      location.href = appendDevParams(href);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      rewriteLinks();
      document.addEventListener("click", handleClick, true);
    });
  } else {
    rewriteLinks();
    document.addEventListener("click", handleClick, true);
  }

  window.rownativeAppendToHref = api ? appendDevParams : function (h) { return h; };

  /** Same preference as the main map "High contrast" checkbox (style.css + app.js). */
  window.rownativeMapHighContrastEnabled = function () {
    try {
      return localStorage.getItem("rownative-high-contrast") === "1";
    } catch (e) {
      return false;
    }
  };

  /** Leaflet polygon style matching app.js getPolygonOptions (cyan vs orange). */
  window.rownativeLeafletPolygonStyle = function () {
    return window.rownativeMapHighContrastEnabled()
      ? { color: "#e65c00", fillColor: "#e65c00", fillOpacity: 0.45, weight: 4 }
      : { color: "#0af", fillColor: "#0af", fillOpacity: 0.2, weight: 2 };
  };

  /**
   * GitHub "new issue" URL with title + body for organiser access requests.
   * When athleteId is null (not signed in), body asks user to sign in and add ID manually.
   */
  window.rownativeOrganiserRequestIssueUrl = function (athleteId, athleteDisplayName) {
    var base = "https://github.com/rownative/courses/issues/new";
    var title = "Request to become challenge organiser";
    var body;
    if (athleteId) {
      var name =
        athleteDisplayName && String(athleteDisplayName).trim()
          ? String(athleteDisplayName).trim()
          : "(not available)";
      body =
        "Please grant challenge organiser access.\r\n\r\n" +
        "- intervals.icu athlete ID: " +
        String(athleteId) +
        "\r\n" +
        "- Display name (intervals.icu): " +
        name +
        "\r\n";
    } else {
      body =
        "Please grant challenge organiser access.\r\n\r\n" +
        "Sign in to rownative.icu first, then open the request link again so your athlete ID is pre-filled — or add your intervals.icu athlete ID below.\r\n\r\n";
    }
    return base + "?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body);
  };
})();
