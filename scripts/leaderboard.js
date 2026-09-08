/* The cabinet's score screen. Local flights survive without Firebase or a network. */
(() => {
  "use strict";
  const key = "trumpet-flight-top10";
  const $ = id => document.getElementById(id);
  const api = () => window.TRUMPET_GLOBAL_SCORES;
  const boards = ["daily", "allTime", "local"];
  const today = () => Math.floor(Date.now() / 86400000) * 86400000;
  let records = [], writable = true, localStatus = "SAVED ON THIS DEVICE";
  let mode = api()?.enabled ? "daily" : "local", remote = null, remoteStatus = "", busy = false;
  let candidate = null, entryFlight = null, reading = null, publishing = false, savedTag = "";
  let openingEntry = false, page = 0, compact = false;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const characters = [...document.querySelectorAll(".initial-character")];
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
    item.hidden = compact && Math.floor((rank - 1) / 5) !== page;
    const value = document.createElement("strong"), name = document.createElement("span");
    value.textContent = String(score);
    name.textContent = text;
    if (local) name.className = "local-date";
    if (you) { item.dataset.you = "true"; item.setAttribute("aria-label", `${text}, you, ${score} points`); }
    item.append(value, name);
    return item;
  }
  function render() {
    records.sort((a, b) => b.score - a.score || (b.at ?? 0) - (a.at ?? 0));
    records = records.slice(0, 10);
    for (const kind of boards) {
      $("scores-" + kind).setAttribute("aria-selected", String(mode === kind));
      $("scores-" + kind).tabIndex = mode === kind ? 0 : -1;
    }
    $("leaderboard-results").setAttribute("aria-labelledby", "scores-" + mode);
    $("leaderboard-results").setAttribute("aria-busy", String(busy));
    const scores = currentBoards();
    const items = mode === "local"
      ? records.map((record, index) => row(record.score, record.at === null ? "Personal best" :
        new Date(record.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), index + 1, true))
      : (scores?.[mode].order || []).map((uid, index) => {
        const record = scores[mode].entries[uid];
        return row(record.score, record.name, index + 1, false, uid === scores.uid);
      });
    if (items.length <= 5 || !compact) {
      page = 0;
      items.forEach((item, index) => { item.hidden = compact && index >= 5; });
    }
    $("leaderboard-list").replaceChildren(...items);
    $("leaderboard-empty").hidden = items.length > 0;
    document.querySelector(".score-page-controls").hidden = !compact || items.length <= 5;
    $("scores-previous").disabled = page === 0;
    $("scores-next").disabled = page === 1;
    $("scores-page").textContent = `${page + 1}/2`;
    $("leaderboard-empty").textContent = mode === "local" ? "Your first flight starts the list. Let's make it a good one."
      : !api()?.enabled ? "The global boards are not connected yet."
      : busy ? "Fetching the high scores..." : !scores ? "Global scores are unavailable right now."
      : "A fresh board. Your next flight could be first.";
    $("leaderboard-status").textContent = mode === "local" ? localStatus : remoteStatus ||
      (window.TRUMPET_FIREBASE?.emulators ? "LOCAL PREVIEW / NOT LIVE" :
        mode === "daily" ? "RESETS 00:00 UTC" : "ONE BEST PER PLAYER");
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
    entryFlight = null;
    $("leaderboard-entry").hidden = true;
    $("leaderboard-results").hidden = false;
    document.querySelector(".score-tabs").hidden = false;
    delete $("leaderboard").dataset.view;
    $("leaderboard").setAttribute("aria-labelledby", "leaderboard-title");
  }
  function choose(kind, focus = false) {
    if (publishing) return;
    mode = kind; page = 0; closeEntry(); render();
    if (focus) $("scores-" + mode).focus({ preventScroll: true });
    if (mode !== "local") loadBoards();
  }
  for (const kind of boards) {
    $("scores-" + kind).addEventListener("click", () => choose(kind));
    $("scores-" + kind).addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === "Home" ? 0 : event.key === "End" ? boards.length - 1
        : (boards.indexOf(kind) + (event.key === "ArrowRight" ? 1 : -1) + boards.length) % boards.length;
      choose(boards[index], true);
    });
  }
  for (const [id, value] of [["scores-previous", 0], ["scores-next", 1]]) {
    $(id).addEventListener("click", () => {
      page = value; render();
      $(value ? "scores-previous" : "scores-next").focus({ preventScroll: true });
    });
  }
  new ResizeObserver(entries => {
    const next = entries[0].contentRect.height < 360;
    if (next !== compact) { compact = next; page = 0; render(); }
  }).observe($("screen"));
  document.addEventListener("scoreboardopen", () => {
    if (openingEntry || publishing) return;
    closeEntry(); page = 0; render();
    if (mode !== "local") loadBoards();
  });
  $("leaderboard").addEventListener("close", () => {
    if (!publishing && entryFlight) { candidate = null; closeEntry(); }
  });
  function setTag(value) {
    $("leaderboard-name").value = value;
    characters.forEach((node, index) => {
      node.textContent = value[index];
      node.setAttribute("aria-valuenow", String(alphabet.indexOf(value[index])));
      node.setAttribute("aria-valuetext", value[index]);
    });
  }
  function step(slot, direction) {
    const value = [...$("leaderboard-name").value];
    value[slot] = alphabet[(alphabet.indexOf(value[slot]) + direction + alphabet.length) % alphabet.length];
    setTag(value.join(""));
  }
  for (const button of document.querySelectorAll("[data-step]")) {
    button.addEventListener("click", () => {
      if (!publishing) step(Number(button.dataset.slot), Number(button.dataset.step));
    });
  }
  characters.forEach((node, index) => node.addEventListener("keydown", event => {
    if (publishing || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toUpperCase();
    if (/^[A-Z0-9]$/.test(key)) {
      const value = [...$("leaderboard-name").value];
      value[index] = key; setTag(value.join(""));
      characters[Math.min(2, index + 1)].focus({ preventScroll: true });
    } else if (key === "ARROWUP" || key === "ARROWDOWN") step(index, key === "ARROWUP" ? 1 : -1);
    else if (key === "ARROWLEFT" || key === "BACKSPACE") characters[Math.max(0, index - 1)].focus({ preventScroll: true });
    else if (key === "ARROWRIGHT") characters[Math.min(2, index + 1)].focus({ preventScroll: true });
    else if (key === "ENTER") $("leaderboard-entry").requestSubmit();
    else return;
    event.preventDefault(); event.stopPropagation();
  }));
  function maybeOffer() {
    const qualifying = eligible();
    if (!candidate?.checked || candidate.offered || !qualifying.length || document.querySelector("dialog[open]") ||
        document.querySelector(".cabinet").dataset.flightState !== "over" || $("overlay").hidden || document.hidden ||
        document.documentElement.dataset.cabinetView === "intro") return;
    candidate.offered = true;
    entryFlight = candidate;
    openingEntry = true;
    $("leaderboard-open").click();
    openingEntry = false;
    $("leaderboard").dataset.view = "entry";
    $("leaderboard").setAttribute("aria-labelledby", "leaderboard-entry-title");
    $("leaderboard-results").hidden = true;
    document.querySelector(".score-tabs").hidden = true;
    $("leaderboard-entry").hidden = false;
    $("leaderboard-entry-score").textContent = `${candidate.score} POINTS / ${qualifying.length === 2 ? "DAILY + ALL-TIME" : qualifying[0] === "daily" ? "DAILY" : "ALL-TIME"}`;
    setTag(savedTag || "AAA");
    $("leaderboard-submit-status").textContent = "";
    $("leaderboard-submit-status").hidden = true;
    $("leaderboard-publish").hidden = false;
    $("leaderboard-cancel").textContent = "Skip";
    characters[0].focus({ preventScroll: true });
  }
  async function checkFlight(flight) {
    const result = await loadBoards();
    if (result && candidate === flight) { flight.checked = true; maybeOffer(); }
  }
  $("leaderboard-cancel").addEventListener("click", () => {
    if (publishing) return;
    candidate = null; closeEntry(); $("leaderboard").close("retry");
  });
  $("leaderboard-entry").addEventListener("submit", async event => {
    event.preventDefault();
    if (publishing || !entryFlight) return;
    let name;
    try { name = api().normalizeName($("leaderboard-name").value); }
    catch (error) { $("leaderboard-submit-status").hidden = false; $("leaderboard-submit-status").textContent = error.message; return; }
    const submitted = entryFlight, flight = { score: submitted.score, completedAt: submitted.completedAt, name };
    publishing = true;
    for (const button of $("leaderboard-entry").querySelectorAll("button")) button.disabled = true;
    characters.forEach(node => node.setAttribute("aria-disabled", "true"));
    $("leaderboard-publish").textContent = "Saving...";
    try {
      const result = await api().submit(flight);
      remote = result;
      savedTag = name;
      try { localStorage.setItem("trumpet-flight-arcade-tag", name); }
      catch (error) { console.warn("Arcade tag cannot be remembered:", error); }
      if (result.accepted.length) {
        mode = result.accepted.includes("daily") ? "daily" : "allTime";
        remoteStatus = "";
      } else {
        $("leaderboard-submit-status").hidden = false;
        $("leaderboard-submit-status").textContent = "The board moved ahead. Your score is saved on this device.";
        $("leaderboard-publish").hidden = true;
        $("leaderboard-cancel").textContent = "Continue";
        return;
      }
      if (candidate === submitted) candidate = null;
      if (entryFlight === submitted) {
        closeEntry();
        if ($("leaderboard").open) {
          $("leaderboard").close("retry");
        }
      }
    } catch (error) {
      $("leaderboard-submit-status").hidden = false;
      $("leaderboard-submit-status").textContent = error.code === "global/submission-unconfirmed"
        ? "Not confirmed. Check Top 10 before saving again."
        : error.code === "global/permission" ? "Could not save. Check your clock and try again."
        : error.code === "global/quota" ? "Daily service limit reached. Try later."
        : "Saving is unavailable. Your score is kept on this device.";
      console.warn("Global score submission failed:", error);
    } finally {
      publishing = false;
      for (const button of $("leaderboard-entry").querySelectorAll("button")) button.disabled = false;
      characters.forEach(node => node.removeAttribute("aria-disabled"));
      $("leaderboard-publish").textContent = "Save";
      render();
    }
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
  document.addEventListener("flightretryready", maybeOffer);
  document.addEventListener("cabinetleave", () => { candidate = null; });
  document.addEventListener("flightmanualopen", () => {
    if (!openingEntry) candidate = null;
  }, { capture: true });
  window.addEventListener("offline", () => {
    if (mode !== "local") remoteStatus = "Offline. Your scores stay on this device.";
    render();
  });
  window.addEventListener("online", () => { if ($("leaderboard").open && !entryFlight && mode !== "local") loadBoards(); });
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
