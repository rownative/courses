/**
 * Hamburger menu toggle for mobile nav
 */
(function () {
  "use strict";

  const toggle = document.getElementById("nav-toggle");
  const overlay = document.getElementById("nav-overlay");
  const backdrop = document.querySelector("[data-dismiss='nav']");

  function openNav() {
    if (toggle) {
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Close menu");
    }
    if (overlay) {
      overlay.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }
  }

  function closeNav() {
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Menu");
    }
    if (overlay) {
      overlay.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }
  }

  function toggleNav() {
    const isOpen = overlay && overlay.getAttribute("aria-hidden") === "false";
    if (isOpen) {
      closeNav();
    } else {
      openNav();
    }
  }

  if (toggle && overlay) {
    toggle.addEventListener("click", toggleNav);
    if (backdrop) {
      backdrop.addEventListener("click", closeNav);
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeNav();
    });
    overlay.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", closeNav);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay.getAttribute("aria-hidden") === "false") {
        closeNav();
      }
    });
  }
})();
