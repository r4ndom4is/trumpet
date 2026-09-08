/* Local-only completed flights. A historical personal best remains eligible. */
(() => {
  "use strict";
  const key = "trumpet-flight-top10";
  const $ = id => document.getElementById(id);
  let records = [], writable = true;
  function unavailable(error, corrupt = false) {
    writable = corrupt;
    const message = corrupt
      ? "Your saved Top 10 could not be read. A fresh list will start with your next flight; your personal best is kept."
      : "Browser storage is unavailable. Your Top 10 will last for this visit only.";
    $("leaderboard-status").textContent = message;
    $("notice").textContent = message;
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
  function render() {
    records.sort((a, b) => b.score - a.score || (b.at ?? 0) - (a.at ?? 0));
    records = records.slice(0, 10);
    $("leaderboard-empty").hidden = records.length > 0;
    $("leaderboard-list").replaceChildren(...records.map(row => {
      const item = document.createElement("li");
      const score = document.createElement("strong"), date = document.createElement("span");
      score.textContent = String(row.score);
      date.textContent = row.at === null ? "Personal best" : new Date(row.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      item.append(score, date);
      return item;
    }));
  }
  render();
  document.addEventListener("flightcomplete", event => {
    records.push({ score: event.detail.score, at: Date.now() });
    render();
    if (writable) {
      try {
        localStorage.setItem(key, JSON.stringify(records));
        $("leaderboard-status").textContent = "Saved in this browser. Clearing browser data clears this list.";
      } catch (error) { unavailable(error); }
    }
  });
})();
