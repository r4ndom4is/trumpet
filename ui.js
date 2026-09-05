(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const compact = matchMedia("(max-width: 900px), (max-width: 1100px) and (max-height: 560px)");
  const manual = $("manual");
  const content = manual.querySelector(".manual-content");
  // Move the originals, not copies: IDs, install state, links and all of the copy remain intact.
  const sections = [".edition", ".intro-panel", "footer", ".unofficial"].map(selector => {
    const node = document.querySelector(selector);
    const anchor = document.createComment("Flight manual content position");
    node.before(anchor);
    return { node, anchor };
  });
  function placeCopy() {
    for (const { node, anchor } of sections) {
      if (compact.matches || manual.open) content.append(node);
      else anchor.after(node);
    }
  }
  $("manual-open").addEventListener("click", () => {
    document.dispatchEvent(new Event("flightmanualopen"));
    manual.showModal();
    placeCopy();
    manual.scrollTop = 0;
    $("manual-close").focus({ preventScroll: true });
  });
  $("manual-close").addEventListener("click", () => manual.close());
  manual.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const controls = [...manual.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')]
      .filter(node => node.getClientRects().length > 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  manual.addEventListener("close", () => {
    placeCopy();
    $("manual-open").focus({ preventScroll: true });
  });
  let backdropDown = false;
  const outside = event => {
    const box = manual.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  };
  manual.addEventListener("pointerdown", event => { backdropDown = event.target === manual && outside(event); });
  manual.addEventListener("click", event => {
    if (backdropDown && event.target === manual && outside(event)) manual.close();
    backdropDown = false;
  });

  function themeButton() {
    const dark = document.documentElement.dataset.theme === "dark";
    $("theme-switch").textContent = dark ? "Dark" : "Light";
    $("theme-switch").setAttribute("aria-pressed", String(dark));
    $("theme-switch").title = dark ? "Switch to light theme" : "Switch to dark theme";
  }
  let noticeTimer;
  function themeNotice() {
    $("theme-notice").textContent = "Theme changes last for this visit only. Browser storage is unavailable.";
    $("theme-notice").hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { $("theme-notice").hidden = true; }, 8000);
  }
  $("theme-switch").addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("themechoice", {
      detail: document.documentElement.dataset.theme === "dark" ? "light" : "dark"
    }));
  });
  new MutationObserver(themeButton).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  document.addEventListener("themestorageerror", themeNotice);
  if (document.documentElement.dataset.themeStorage === "unavailable") themeNotice();
  themeButton();
  function updateHint() {
    const available = !$("update").hidden;
    $("manual-open").textContent = available ? "Flight manual !" : "Flight manual";
    $("manual-open").setAttribute("aria-label", available ? "Flight manual and about. Game update available." : "Flight manual and about");
  }
  new MutationObserver(updateHint).observe($("update"), { attributes: true, attributeFilter: ["hidden"] });
  updateHint();

  const field = document.querySelector(".playfield");
  function fitGame() {
    const screen = $("screen");
    if (!compact.matches) {
      screen.style.removeProperty("width");
      screen.style.removeProperty("height");
      return;
    }
    const width = Math.max(0, Math.min(field.clientWidth - 4, (field.clientHeight - 4) * 448 / 512));
    screen.style.width = `${width + 4}px`;
    screen.style.height = `${width * 512 / 448 + 4}px`;
  }
  function viewportHeight() {
    if (!window.visualViewport || window.visualViewport.scale === 1) {
      document.documentElement.style.setProperty("--app-height", `${window.visualViewport?.height ?? innerHeight}px`);
    }
  }
  new ResizeObserver(fitGame).observe(field);
  compact.addEventListener("change", () => { placeCopy(); fitGame(); });
  window.visualViewport?.addEventListener("resize", viewportHeight);
  window.addEventListener("resize", viewportHeight);
  viewportHeight();
  placeCopy();
  fitGame();
})();
