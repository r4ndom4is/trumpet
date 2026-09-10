/* The cabinet's score screen. Local flights survive without Firebase or a network. */
(() => {
  "use strict";
  const key = "trumpet-flight-top10";
  const $ = id => document.getElementById(id);
  const api = () => window.TRUMPET_GLOBAL_SCORES;
  const scopes = ["global", "local"], periods = ["daily", "allTime"];
  const today = () => Math.floor(Date.now() / 86400000) * 86400000;
  let records = [], writable = true, localStatus = "SAVED ON THIS DEVICE";
  let mode = api()?.enabled ? "daily" : "local", remote = null, remoteStatus = "", busy = false;
  let globalPeriod = "daily";
  let candidate = null, entryFlight = null, reading = null, publishing = false, savedTag = "";
  let openingEntry = false, editingTag = false, publishingFlight = null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const characters = [...document.querySelectorAll(".initial-character")];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const wheels = characters.map(node => {
    const reel = document.createElement("span");
    reel.className = "initial-reel";
    reel.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i++) reel.append(document.createElement("span"));
    node.replaceChildren(reel);
    node.setAttribute("aria-description", "Scroll, drag vertically, or use arrow keys to choose a character.");
    return { reel, animation: null, drag: null, remainder: 0, lastWheel: 0 };
  });
  function resetWheel(index) {
    const wheel = wheels[index], node = characters[index];
    wheel.animation?.cancel();
    wheel.animation = null;
    const pointer = wheel.drag?.id;
    wheel.drag = null; wheel.remainder = 0; wheel.lastWheel = 0;
    wheel.reel.style.transform = "";
    delete node.dataset.dragging;
    if (pointer !== undefined && node.hasPointerCapture(pointer)) node.releasePointerCapture(pointer);
  }
  function resetWheels() { wheels.forEach((_, index) => resetWheel(index)); }
  function snapWheel(index, offset) {
    const wheel = wheels[index], height = characters[index].offsetHeight;
    wheel.animation?.cancel();
    wheel.reel.style.transform = "";
    wheel.animation = reducedMotion.matches ? null : wheel.reel.animate([
      { transform: `translateY(${-height + offset}px)` },
      { transform: `translateY(${-height}px)` }
    ], { duration: 100, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  }
  function unavailable(error, corrupt = false) {
    writable = corrupt;
    localStatus = corrupt
      ? "Your saved Top 10 could not be read. A fresh list will start with your next flight; your personal best is kept."
      : "Browser storage is unavailable. Your Top 10 will last for this visit only.";
    $("notice").textContent = localStatus;
    $("notice").hidden = false;
    console.warn("Top 10 storage:", error);
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > 10 || parsed.some(row =>
        !row || !Number.isSafeInteger(row.score) || row.score < 0 ||
        (row.at !== null && (!Number.isSafeInteger(row.at) || row.at < 0 || row.at > 8640000000000000)))) {
        unavailable("Invalid saved flight records", true);
      } else records = parsed.map(({ score, at }) => ({ score, at }));
    }
  } catch (error) { unavailable(error, error instanceof SyntaxError); }
  const historicalBest = Number($("best").textContent);
  if (historicalBest > 0 && !records.some(row => row.score >= historicalBest)) {
    records.push({ score: historicalBest, at: null });
  }
  try { savedTag = localStorage.getItem("trumpet-flight-arcade-tag") || ""; }
  catch (error) { console.warn("Arcade tag cannot be remembered:", error); }
  if (!/^[A-Z0-9]{3}$/.test(savedTag)) savedTag = "";

  function currentBoards() {
    if (!remote) return null;
    return {
      ...remote,
      daily: remote.daily.day === today() ? remote.daily : { day: today(), entries: {}, order: [] }
    };
  }
  function eligible() {
    const scores = currentBoards();
    if (!candidate || !scores || !api()?.enabled || !navigator.onLine || busy || publishing) return [];
    const day = Math.floor(candidate.completedAt / 86400000) * 86400000;
    return ["daily", "allTime"].filter(kind =>
      (kind !== "daily" || day === today()) && api().qualifies(scores[kind], scores.uid, candidate.score));
  }
  function row(score, text, rank, local = false, you = false) {
    const item = document.createElement("li");
    item.dataset.rank = String(rank).padStart(2, "0");
    const value = document.createElement("strong"), name = document.createElement("span");
    value.textContent = String(score);
    name.textContent = text;
    if (local) name.className = "local-date";
    if (you) { item.dataset.you = "true"; item.setAttribute("aria-label", `${text}, you, ${score} points`); }
    item.append(value, name);
    return item;
  }
  function boardLabel(kinds) {
    return kinds.length === 2 ? "DAILY + ALL-TIME" : kinds[0] === "daily" ? "DAILY" : "ALL-TIME";
  }
  function renderRanking() {
    const visible = candidate?.offered && savedTag &&
      document.querySelector(".cabinet").dataset.flightState === "over";
    $("run-ranking").hidden = !visible;
    if (!visible) return;
    const saving = publishingFlight === candidate;
    const qualifying = eligible();
    $("run-ranking-status").textContent = saving ? "Saving your score..."
      : candidate.feedback || (!navigator.onLine ? "Offline / saved on this device"
      : qualifying.length ? `TOP 10 QUALIFIER / ${boardLabel(qualifying)}` : "Saved on this device");
    $("run-ranking-actions").hidden = Boolean(candidate.finished) || (!saving && qualifying.length === 0);
    $("run-save").textContent = saving ? "Saving..." : `Save as ${savedTag}`;
    $("run-save").disabled = publishing;
    $("run-change").disabled = publishing;
  }
  function render() {
    records.sort((a, b) => b.score - a.score || (b.at ?? 0) - (a.at ?? 0));
    records = records.slice(0, 10);
    if (mode !== "local") globalPeriod = mode;
    for (const kind of [...scopes, ...periods]) {
      const selected = kind === "global" ? mode !== "local"
        : kind === "local" ? mode === "local" : globalPeriod === kind;
      $("scores-" + kind).setAttribute("aria-checked", String(selected));
      $("scores-" + kind).tabIndex = selected ? 0 : -1;
    }
    document.querySelector(".score-tabs").hidden = mode === "local" || !$("leaderboard-entry").hidden;
    $("scores-local-context").hidden = mode !== "local" || !$("leaderboard-entry").hidden;
    $("scores-name-column").textContent = mode === "local" ? "DATE" : "PLAYER";
    $("leaderboard-results").setAttribute("aria-labelledby",
      mode === "local" ? "leaderboard-title scores-local" : "leaderboard-title scores-global scores-" + mode);
    $("leaderboard-results").setAttribute("aria-busy", String(busy));
    const scores = currentBoards();
    const items = mode === "local"
      ? records.map((record, index) => row(record.score, record.at === null ? "Personal best" :
        new Date(record.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), index + 1, true))
      : (scores?.[mode].order || []).map((uid, index) => {
        const record = scores[mode].entries[uid];
        return row(record.score, record.name, index + 1, false, uid === scores.uid);
      });
    $("leaderboard-list").replaceChildren(...items);
    $("leaderboard-empty").hidden = items.length > 0;
    $("leaderboard-empty").textContent = mode === "local" ? "Your first flight starts the list. Let's make it a good one."
      : !api()?.enabled ? "The global boards are not connected yet."
      : busy ? "Fetching the high scores..." : !scores ? "Global scores are unavailable right now."
      : "A fresh board. Your next flight could be first.";
    $("leaderboard-status").textContent = mode === "local" ? localStatus : remoteStatus ||
      (window.TRUMPET_FIREBASE?.emulators ? "LOCAL PREVIEW / NOT LIVE" :
        mode === "daily" ? "RESETS 00:00 UTC" : "ONE BEST PER PLAYER");
    renderRanking();
  }

  function loadBoards() {
    if (!api()?.enabled) { remoteStatus = "Global scores are not connected."; render(); return Promise.resolve(null); }
    if (!navigator.onLine) { remoteStatus = "Offline. Your scores stay on this device."; render(); return Promise.resolve(null); }
    if (reading) return reading;
    busy = true; remoteStatus = "Loading...";
    render();
    reading = (async () => {
      try {
        remote = await api().read();
        remoteStatus = "";
        return remote;
      } catch (error) {
        remoteStatus = "Could not load scores. Try again later.";
        console.warn("Global scores could not load:", error);
        return null;
      } finally { reading = null; busy = false; render(); }
    })();
    return reading;
  }
  function closeEntry() {
    resetWheels();
    entryFlight = null;
    editingTag = false;
    $("leaderboard-entry").hidden = true;
    $("leaderboard-results").hidden = false;
    document.querySelector(".score-tabs").hidden = mode === "local";
    $("scores-local-context").hidden = mode !== "local";
    delete $("leaderboard").dataset.view;
    $("leaderboard").setAttribute("aria-labelledby", "leaderboard-title");
  }
  function choose(kind, focus = false) {
    if (publishing && entryFlight) return;
    mode = kind === "global" ? globalPeriod : kind;
    closeEntry(); render();
    if (focus) $("scores-" + kind).focus({ preventScroll: true });
    if (mode !== "local" && !publishing) loadBoards();
  }
  for (const group of [scopes, periods]) for (const kind of group) {
    $("scores-" + kind).addEventListener("click", () => choose(kind));
    $("scores-" + kind).addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === "Home" ? 0 : event.key === "End" ? group.length - 1
        : (group.indexOf(kind) + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + group.length) % group.length;
      choose(group[index], true);
    });
  }
  document.addEventListener("scoreboardopen", () => {
    if (openingEntry || (publishing && entryFlight)) return;
    closeEntry(); render();
    if (mode !== "local" && !publishing) loadBoards();
  });
  $("leaderboard").addEventListener("close", () => {
    if (!publishing && entryFlight) {
      if (!editingTag) candidate = null;
      closeEntry(); renderRanking();
    }
  });
  function setTag(value) {
    $("leaderboard-name").value = value;
    characters.forEach((node, index) => {
      const position = alphabet.indexOf(value[index]);
      [...wheels[index].reel.children].forEach((glyph, row) => {
        glyph.textContent = alphabet[(position + row - 1 + alphabet.length) % alphabet.length];
      });
      node.setAttribute("aria-valuenow", String(position));
      node.setAttribute("aria-valuetext", value[index]);
    });
  }
  function step(slot, direction, animate = true) {
    if (publishing || !entryFlight || $("leaderboard-entry").hidden) return;
    const value = [...$("leaderboard-name").value];
    const position = alphabet.indexOf(value[slot]) + direction;
    value[slot] = alphabet[((position % alphabet.length) + alphabet.length) % alphabet.length];
    setTag(value.join(""));
    if (animate) snapWheel(slot, Math.sign(direction) * characters[slot].offsetHeight);
    document.dispatchEvent(new CustomEvent("initialsstep"));
  }
  for (const button of document.querySelectorAll("[data-step]")) {
    button.addEventListener("click", () => {
      if (publishing) return;
      const slot = Number(button.dataset.slot);
      resetWheel(slot);
      step(slot, Number(button.dataset.step));
    });
  }
  characters.forEach((node, index) => {
    const wheel = wheels[index];
    node.parentElement.addEventListener("wheel", event => {
      if (event.ctrlKey || event.metaKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
          !entryFlight || $("leaderboard-entry").hidden) return;
      event.preventDefault(); event.stopPropagation();
      if (publishing || wheel.drag) return;
      const now = performance.now();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 48 : 1;
      const delta = Math.max(-48, Math.min(48, event.deltaY * unit));
      if (now - wheel.lastWheel > 180 || Math.sign(delta) !== Math.sign(wheel.remainder)) wheel.remainder = 0;
      wheel.lastWheel = now;
      wheel.remainder += delta;
      // One coarse mouse notch is one detent; fine trackpad deltas accumulate.
      if (Math.abs(wheel.remainder) >= 48) {
        const direction = Math.sign(wheel.remainder);
        wheel.remainder -= direction * 48;
        node.focus({ preventScroll: true });
        step(index, direction);
      }
    }, { passive: false });
    node.addEventListener("pointerdown", event => {
      if (publishing || !entryFlight || wheel.drag || !event.isPrimary || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      resetWheel(index);
      node.focus({ preventScroll: true });
      node.setPointerCapture(event.pointerId);
      wheel.drag = { id: event.pointerId, y: event.clientY, remainder: 0,
        height: node.offsetHeight, scale: node.offsetHeight / node.getBoundingClientRect().height };
      node.dataset.dragging = "true";
    });
    node.addEventListener("pointermove", event => {
      const drag = wheel.drag;
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault(); event.stopPropagation();
      drag.remainder += (drag.y - event.clientY) * drag.scale;
      drag.y = event.clientY;
      const count = Math.trunc(drag.remainder / drag.height);
      if (count) { drag.remainder -= count * drag.height; step(index, count, false); }
      if (!reducedMotion.matches) wheel.reel.style.transform = `translateY(${-drag.height - drag.remainder}px)`;
    });
    node.addEventListener("pointerup", event => {
      const drag = wheel.drag;
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault(); event.stopPropagation();
      const count = Math.sign(drag.remainder) * Math.round(Math.abs(drag.remainder) / drag.height);
      if (count) { step(index, count, false); drag.remainder -= count * drag.height; }
      const offset = -drag.remainder;
      resetWheel(index);
      snapWheel(index, offset);
    });
    for (const type of ["pointercancel", "lostpointercapture"]) node.addEventListener(type, event => {
      if (wheel.drag?.id === event.pointerId) resetWheel(index);
    });
  });
  window.addEventListener("blur", resetWheels);
  window.addEventListener("resize", resetWheels);
  reducedMotion.addEventListener("change", resetWheels);
  document.addEventListener("visibilitychange", () => { if (document.hidden) resetWheels(); });
  characters.forEach((node, index) => node.addEventListener("keydown", event => {
    if (publishing || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toUpperCase();
    if (/^[A-Z0-9]$/.test(key)) {
      resetWheel(index);
      const value = [...$("leaderboard-name").value];
      value[index] = key; setTag(value.join(""));
      characters[Math.min(2, index + 1)].focus({ preventScroll: true });
    } else if (key === "ARROWUP" || key === "ARROWDOWN") {
      resetWheel(index); step(index, key === "ARROWUP" ? 1 : -1);
    }
    else if (key === "ARROWLEFT" || key === "BACKSPACE") characters[Math.max(0, index - 1)].focus({ preventScroll: true });
    else if (key === "ARROWRIGHT") characters[Math.min(2, index + 1)].focus({ preventScroll: true });
    else if (key === "ENTER") $("leaderboard-entry").requestSubmit();
    else return;
    event.preventDefault(); event.stopPropagation();
  }));
  function openEntry(qualifying, editing = false) {
    resetWheels();
    editingTag = editing;
    entryFlight = candidate;
    openingEntry = true;
    $("leaderboard-open").click();
    openingEntry = false;
    $("leaderboard").dataset.view = "entry";
    $("leaderboard").setAttribute("aria-labelledby", "leaderboard-entry-title");
    $("leaderboard-results").hidden = true;
    document.querySelector(".score-tabs").hidden = true;
    $("leaderboard-entry").hidden = false;
    $("leaderboard-entry-title").textContent = editing ? "YOUR INITIALS" : "TOP 10 QUALIFIER";
    $("leaderboard-entry-score").textContent = `${candidate.score} POINTS / ${boardLabel(qualifying)}`;
    setTag(savedTag || "AAA");
    $("leaderboard-submit-status").textContent = "";
    $("leaderboard-submit-status").hidden = true;
    $("leaderboard-publish").hidden = false;
    $("leaderboard-cancel").textContent = editing ? "Cancel" : "Skip";
    characters[0].focus({ preventScroll: true });
  }
  function maybeOffer() {
    const qualifying = eligible();
    if (!candidate?.checked || candidate.offered || candidate.suppressOffer || !qualifying.length || document.querySelector("dialog[open]") ||
        document.querySelector(".cabinet").dataset.flightState !== "over" || $("overlay").hidden || document.hidden ||
        document.documentElement.dataset.cabinetView === "intro") return;
    candidate.offered = true;
    if (savedTag) renderRanking();
    else openEntry(qualifying);
  }
  async function checkFlight(flight) {
    const result = await loadBoards();
    if (result && candidate === flight) { flight.checked = true; maybeOffer(); }
  }
  $("leaderboard-cancel").addEventListener("click", () => {
    if (publishing) return;
    if (!editingTag) candidate = null;
    closeEntry(); renderRanking(); $("leaderboard").close("retry");
  });
  async function publishScore(submitted, name) {
    if (publishing || !submitted) return;
    const flight = { score: submitted.score, completedAt: submitted.completedAt, name };
    const focusRetry = document.activeElement === $("run-save");
    publishing = true;
    resetWheels();
    publishingFlight = submitted;
    submitted.feedback = "";
    for (const button of $("leaderboard-entry").querySelectorAll("button")) button.disabled = true;
    characters.forEach(node => node.setAttribute("aria-disabled", "true"));
    $("leaderboard-publish").textContent = "Saving...";
    renderRanking();
    if (focusRetry) $("play").focus({ preventScroll: true });
    try {
      const result = await api().submit(flight);
      remote = result;
      savedTag = name;
      try { localStorage.setItem("trumpet-flight-arcade-tag", name); }
      catch (error) { console.warn("Arcade tag cannot be remembered:", error); }
      if (result.accepted.length) {
        if (!$("leaderboard").open || entryFlight === submitted) {
          mode = result.accepted.includes("daily") ? "daily" : "allTime";
        }
        remoteStatus = "";
        submitted.feedback = `Saved as ${name} / ${boardLabel(result.accepted)}`;
      } else submitted.feedback = "The board moved ahead. Kept on this device.";
      submitted.finished = true;
      if (entryFlight === submitted) {
        closeEntry();
        if ($("leaderboard").open) {
          $("leaderboard").close("retry");
        }
      }
    } catch (error) {
      submitted.feedback = error.code === "global/submission-unconfirmed"
        ? "Not confirmed. Check Top 10 before saving again."
        : error.code === "global/permission" ? "Could not save. Check your clock and try again."
        : error.code === "global/quota" ? "Daily service limit reached. Try later."
        : "Saving is unavailable. Your score is kept on this device.";
      if (entryFlight === submitted) {
        $("leaderboard-submit-status").hidden = false;
        $("leaderboard-submit-status").textContent = submitted.feedback;
      }
      console.warn("Global score submission failed:", error);
    } finally {
      publishing = false;
      publishingFlight = null;
      for (const button of $("leaderboard-entry").querySelectorAll("button")) button.disabled = false;
      characters.forEach(node => node.removeAttribute("aria-disabled"));
      $("leaderboard-publish").textContent = "Save";
      render(); maybeOffer();
    }
  }
  $("leaderboard-entry").addEventListener("submit", event => {
    event.preventDefault();
    if (publishing || !entryFlight) return;
    let name;
    try { name = api().normalizeName($("leaderboard-name").value); }
    catch (error) { $("leaderboard-submit-status").hidden = false; $("leaderboard-submit-status").textContent = error.message; return; }
    publishScore(entryFlight, name);
  });
  $("run-save").addEventListener("click", () => {
    if (!publishing && savedTag && eligible().length) publishScore(candidate, savedTag);
  });
  $("run-change").addEventListener("click", () => {
    const qualifying = eligible();
    if (qualifying.length && !publishing) openEntry(qualifying, true);
  });

  document.addEventListener("flightcomplete", event => {
    const at = Date.now();
    records.push({ score: event.detail.score, at });
    candidate = event.detail.score > 0 ? { score: event.detail.score, completedAt: at } : null;
    records.sort((a, b) => b.score - a.score || (b.at ?? 0) - (a.at ?? 0));
    records = records.slice(0, 10);
    if (writable) {
      try {
        localStorage.setItem(key, JSON.stringify(records));
        localStatus = "SAVED ON THIS DEVICE";
      } catch (error) { unavailable(error); }
    }
    render();
    if (candidate && api()?.enabled && navigator.onLine) checkFlight(candidate);
  });
  document.addEventListener("flightstate", event => {
    if (event.detail === "playing") candidate = null;
    render(); maybeOffer();
  });
  document.addEventListener("flightretryready", () => { renderRanking(); maybeOffer(); });
  document.addEventListener("cabinetleave", () => { candidate = null; renderRanking(); });
  document.addEventListener("flightmanualopen", () => {
    if (!openingEntry && candidate) candidate.suppressOffer = true;
  }, { capture: true });
  window.addEventListener("offline", () => {
    if (mode !== "local") remoteStatus = "Offline. Your scores stay on this device.";
    render();
  });
  window.addEventListener("online", () => {
    renderRanking();
    if ($("leaderboard").open && !entryFlight && mode !== "local") loadBoards();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && $("leaderboard").open && !entryFlight) {
      render(); if (mode !== "local") loadBoards();
    }
  });
  // Clear yesterday's display at midnight without polling Firestore.
  let midnight;
  function scheduleMidnight() {
    clearTimeout(midnight);
    midnight = setTimeout(() => {
      render();
      if (entryFlight && !eligible().length && !publishing) {
        candidate = null; closeEntry(); $("leaderboard").close("retry");
      }
      scheduleMidnight();
    }, Math.max(1000, today() + 86400000 - Date.now() + 50));
  }
  scheduleMidnight();
  render();
})();
