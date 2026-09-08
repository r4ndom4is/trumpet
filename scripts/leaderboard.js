/* The cabinet's score screen. Local flights survive without Firebase or a network. */
(() => {
  "use strict";
  const key = "trumpet-flight-top10";
  const $ = id => document.getElementById(id);
  const api = () => window.TRUMPET_GLOBAL_SCORES;
  const boards = ["daily", "allTime", "local"];
  const today = () => Math.floor(Date.now() / 86400000) * 86400000;
  let records = [], writable = true, localStatus = "Saved in this browser. Clearing browser data clears this list.";
  let mode = api()?.enabled ? "daily" : "local", remote = null, remoteStatus = "", busy = false;
  let candidate = null, request = 0, publishing = false, savedTag = "";
  let lastReadAttempt = 0;
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
  function row(score, text, local = false, you = false) {
    const item = document.createElement("li");
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
      ? records.map(record => row(record.score, record.at === null ? "Personal best" :
        new Date(record.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), true))
      : (scores?.[mode].order || []).map(uid => {
        const record = scores[mode].entries[uid];
        return row(record.score, record.name, false, uid === scores.uid);
      });
    $("leaderboard-list").replaceChildren(...items);
    $("leaderboard-empty").hidden = items.length > 0;
    $("leaderboard-note").textContent = mode === "local"
      ? "The best flights on this device. No accounts, no uploads."
      : mode === "daily" ? "Worldwide. One best per guest. Resets at 00:00 UTC."
      : "Worldwide. One best per guest. Earlier scores win ties.";
    $("leaderboard-empty").textContent = mode === "local" ? "Your first flight starts the list. Let's make it a good one."
      : !api()?.enabled ? "The global boards are not connected yet."
      : busy ? "Fetching the high scores..." : !scores ? "Global scores are unavailable right now."
      : "A fresh board. Your next flight could be first.";
    $("leaderboard-status").textContent = mode === "local" ? localStatus : remoteStatus;
    $("leaderboard-refresh").hidden = mode === "local" || !api()?.enabled;
    $("leaderboard-refresh").disabled = busy || publishing || !navigator.onLine;
    const qualifying = eligible();
    $("leaderboard-enter").hidden = mode === "local" || qualifying.length === 0;
    $("leaderboard-enter").textContent = candidate ? `Enter your ${candidate.score} points` : "Enter your score";
    $("score-submit-open").hidden = !api()?.enabled || !candidate ||
      document.querySelector(".cabinet").dataset.flightState !== "over";
    $("score-submit-open").textContent = qualifying.length ? "Enter global Top 10" : "Check global ranking";
  }

  async function refresh(force = false) {
    if (mode === "local") { render(); return; }
    if (!api()?.enabled) { remoteStatus = "Local scores are ready. Firebase setup can be completed later."; render(); return; }
    if (!navigator.onLine) { remoteStatus = "Offline. Showing saved scores if available; flights stay on this device."; render(); return; }
    if (busy || publishing) return;
    // The explicit refresh button is bounded too; repeated taps must not become polling.
    if (force && Date.now() - lastReadAttempt < 10000) {
      remoteStatus = "Please wait a moment before refreshing again."; render(); return;
    }
    const token = ++request;
    busy = true; lastReadAttempt = Date.now(); remoteStatus = "Fetching scores...";
    render();
    try {
      const result = await api().read({ force });
      if (token !== request) return;
      remote = result;
      remoteStatus = window.TRUMPET_FIREBASE?.emulators ? "Local Firebase emulator. These are not live scores." :
        "Global Top 10. Your tag is highlighted when you rank.";
    } catch (error) {
      if (token !== request) return;
      remoteStatus = error.message || "Could not load global scores. Your local scores are safe.";
      console.warn("Global scores could not load:", error);
    } finally {
      if (token === request) { busy = false; render(); }
    }
  }
  function closeEntry() {
    $("leaderboard-entry").hidden = true;
    $("leaderboard-results").hidden = false;
    document.querySelector(".score-tabs").hidden = false;
  }
  function choose(kind, focus = false) {
    if (publishing) return;
    mode = kind; closeEntry(); render();
    if (focus) $("scores-" + mode).focus({ preventScroll: true });
    refresh();
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
  $("leaderboard-refresh").addEventListener("click", () => refresh(true));
  document.addEventListener("scoreboardopen", () => { if (!publishing) closeEntry(); render(); refresh(); });
  $("score-submit-open").addEventListener("click", () => {
    mode = eligible().includes("daily") || !remote ? "daily" : "allTime";
    $("leaderboard-open").click();
  });
  $("leaderboard-enter").addEventListener("click", () => {
    if (!eligible().length) { render(); return; }
    $("leaderboard-results").hidden = true;
    document.querySelector(".score-tabs").hidden = true;
    $("leaderboard-entry").hidden = false;
    $("leaderboard-entry-score").textContent = String(candidate.score);
    $("leaderboard-name").value = savedTag;
    $("leaderboard-submit-status").textContent = eligible().length === 2
      ? "This run qualifies for both boards." : `This run qualifies for the ${eligible()[0] === "daily" ? "daily" : "all-time"} board.`;
    $("leaderboard-name").focus({ preventScroll: true });
  });
  $("leaderboard-cancel").addEventListener("click", () => {
    if (publishing) return;
    closeEntry(); render(); $("leaderboard-enter").focus({ preventScroll: true });
  });
  $("leaderboard-entry").addEventListener("submit", async event => {
    event.preventDefault();
    if (publishing || !candidate) return;
    let name;
    try { name = api().normalizeName($("leaderboard-name").value); }
    catch (error) { $("leaderboard-submit-status").textContent = error.message; return; }
    const submitted = candidate, flight = { ...candidate, name };
    publishing = true;
    $("leaderboard-publish").disabled = true;
    $("leaderboard-cancel").disabled = true;
    $("leaderboard-name").disabled = true;
    $("leaderboard-submit-status").textContent = "Saving your place...";
    try {
      const result = await api().submit(flight);
      remote = result;
      savedTag = name;
      try { localStorage.setItem("trumpet-flight-arcade-tag", name); }
      catch (error) { console.warn("Arcade tag cannot be remembered:", error); }
      if (result.accepted.length) {
        mode = result.accepted.includes("daily") ? "daily" : "allTime";
        remoteStatus = result.accepted.length === 2 ? "You're on both boards. Nicely flown." : "Your place is saved. Nicely flown.";
      } else remoteStatus = "The board moved ahead before this score was saved. Your local score is kept.";
      if (candidate === submitted) candidate = null;
      closeEntry();
      if ($("leaderboard").open) $("leaderboard-close").focus({ preventScroll: true });
    } catch (error) {
      $("leaderboard-submit-status").textContent = error.message || "Could not save your global score. Your local score is safe.";
      console.warn("Global score submission failed:", error);
    } finally {
      publishing = false;
      $("leaderboard-publish").disabled = false;
      $("leaderboard-cancel").disabled = false;
      $("leaderboard-name").disabled = false;
      render();
    }
  });

  document.addEventListener("flightcomplete", event => {
    const at = Date.now();
    records.push({ score: event.detail.score, at });
    if (event.detail.score > 0 && (!candidate || Math.floor(candidate.completedAt / 86400000) * 86400000 !== today() ||
      event.detail.score > candidate.score)) candidate = { score: event.detail.score, completedAt: at };
    records.sort((a, b) => b.score - a.score || (b.at ?? 0) - (a.at ?? 0));
    records = records.slice(0, 10);
    if (writable) {
      try {
        localStorage.setItem(key, JSON.stringify(records));
        localStatus = "Saved in this browser. Clearing browser data clears this list.";
      } catch (error) { unavailable(error); }
    }
    render();
  });
  document.addEventListener("flightstate", render);
  window.addEventListener("offline", () => {
    if (mode !== "local") remoteStatus = "Offline. Showing saved scores if available; flights stay on this device.";
    render();
  });
  window.addEventListener("online", () => { if ($("leaderboard").open) refresh(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && $("leaderboard").open) { render(); refresh(); }
  });
  // Clear yesterday's display at midnight without polling Firestore.
  let midnight;
  function scheduleMidnight() {
    clearTimeout(midnight);
    midnight = setTimeout(() => {
      render();
      if (!$("leaderboard-entry").hidden && !eligible().length && !publishing) closeEntry();
      scheduleMidnight();
    }, Math.max(1000, today() + 86400000 - Date.now() + 50));
  }
  scheduleMidnight();
  render();
})();
