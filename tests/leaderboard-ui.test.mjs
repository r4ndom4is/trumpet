import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { serve } from "../scripts/serve.mjs";

const uiSource = await readFile(new URL("../scripts/leaderboard.js", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../scripts/cabinet.css", import.meta.url), "utf8");
const mock = `
(() => {
  const scenario = window.__scoreScenario;
  window.TRUMPET_FIREBASE = { enabled: scenario.enabled !== false, emulators: true };
  window.__scoreCalls = { reads: 0, submits: [] };
  const day = Math.floor(Date.now() / 86400000) * 86400000;
  const entries = Object.fromEntries(Array.from({ length: 10 }, (_, i) =>
    ["player" + i, { name: ["ACE", "JET", "SKY", "FLY", "BOP", "ZIP", "POP", "SUN", "TOP", "TEN"][i], score: 20 - i, at: day + i }]));
  const state = { daily: { day, entries, order: Object.keys(entries) }, allTime: { day: null, entries, order: Object.keys(entries) }, uid: "guest", fetchedAt: Date.now() };
  window.TRUMPET_GLOBAL_SCORES = {
    get enabled() { return window.TRUMPET_FIREBASE.enabled; },
    qualifies() { return scenario.qualifies !== false; },
    normalizeName(value) {
      const name = value.trim().toUpperCase();
      if (!/^[A-Z0-9]{3}$/.test(name)) throw new Error("Use three letters or numbers.");
      return name;
    },
    async read() {
      window.__scoreCalls.reads++;
      if (scenario.delayRead) await new Promise(resolve => { window.__releaseRead = resolve; });
      if (scenario.readFails) throw new Error("Global scores could not load. Try again when online.");
      return structuredClone(state);
    },
    async submit(flight) {
      window.__scoreCalls.submits.push(flight);
      if (scenario.delaySubmit) await new Promise(resolve => { window.__releaseSubmit = resolve; });
      if (scenario.submitFails) throw new Error("Global submission unavailable. Your local score is safe.");
      return { ...structuredClone(state), accepted: scenario.noLongerQualifies ? [] : ["daily", "allTime"] };
    }
  };
})();`;

test("Cabinet score screen: local fallback, global ranking and optional arcade-tag entry", { timeout: 120000 }, async t => {
  const server = serve({ transform(file, content) {
    if (file !== "index.html") return content;
    return content.toString().replace('data-cabinet-entry="auto"', 'data-cabinet-entry="direct"')
      .replace(/\/\/ BEGIN GENERATED LEADERBOARD[\s\S]*?\/\/ END GENERATED LEADERBOARD/,
        () => `// BEGIN GENERATED LEADERBOARD\n${uiSource}\n// END GENERATED LEADERBOARD`)
      .replace(/\/\* BEGIN GENERATED CABINET \*\/[\s\S]*?\/\* END GENERATED CABINET \*\//,
        () => `/* BEGIN GENERATED CABINET */\n${cssSource}\n/* END GENERATED CABINET */`)
      .replace(/\/\/ BEGIN GENERATED FIREBASE SDK[\s\S]*?\/\/ END GENERATED FIREBASE SDK/,
        () => `// BEGIN GENERATED FIREBASE SDK\n${mock}\n// END GENERATED FIREBASE SDK`)
      .replace(/  requestAnimationFrame\(frame\);\r?\n\}\)\(\);/,
        "  window.__finishScore = (value, finish = true) => { score = value; state = 'playing'; die(); if (finish) finishDeath(); };\n  window.__finishDeath = finishDeath; window.__startRun = start;\n})();");
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/trumpet/`;
  const browser = await chromium.launch();
  const errors = [];
  const artifacts = process.env.GLOBAL_SCORES_ARTIFACT_DIR;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  async function open(scenario = {}, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", ...options });
    await context.addInitScript(scenario => { window.__scoreScenario = scenario; }, scenario);
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    if (scenario.time) await page.clock.install({ time: new Date(scenario.time) });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector(".cabinet").dataset.art === "ready");
    return { context, page };
  }
  async function enterTag(page, value) {
    await page.locator(".initial-character").first().focus();
    await page.keyboard.type(value);
  }
  async function fits(page, selector) {
    const result = await page.locator(selector).evaluate(node => {
      const bounds = node.getBoundingClientRect();
      const screen = document.getElementById("screen").getBoundingClientRect();
      const children = [...node.querySelectorAll("button, .initial-character, canvas:not([hidden]), p, h2")]
        .filter(child => child.getClientRects().length && getComputedStyle(child).display !== "none");
      return {
        width: node.clientWidth, height: node.clientHeight,
        scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight,
        contained: bounds.top >= screen.top - 1 && bounds.bottom <= screen.bottom + 1 &&
          children.every(child => {
            const box = child.getBoundingClientRect();
            return box.left >= bounds.left - 1 && box.right <= bounds.right + 1 &&
              box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
          })
      };
    });
    assert.ok(result.scrollHeight <= result.height + 1 && result.scrollWidth <= result.width + 1 &&
      result.contained, `${selector} fits without scrolling or clipped controls: ${JSON.stringify(result)}`);
  }
  try {
    for (const viewport of [
      { width: 320, height: 568 }, { width: 390, height: 844 },
      { width: 667, height: 375 }, { width: 1440, height: 1000 }
    ]) {
      await t.test(`scores stay inside the live screen at ${viewport.width}x${viewport.height}`, async () => {
        const { context, page } = await open({}, { viewport, colorScheme: viewport.width > 1000 ? "dark" : "light" });
        try {
          assert.equal(await page.evaluate(() => window.__scoreCalls.reads), 0);
          await page.locator("#play").click();
          await page.locator("#leaderboard-open").click();
          await page.waitForFunction(() => document.querySelectorAll("#leaderboard-list li").length === 10);
          assert.equal(await page.locator(".cabinet").getAttribute("data-flight-state"), "paused");
          assert.equal(await page.locator("#leaderboard").evaluate(node => node.matches(":modal")), false);
          assert.equal(await page.evaluate(() => {
            const screen = document.getElementById("screen").getBoundingClientRect();
            const board = document.getElementById("leaderboard").getBoundingClientRect();
            const tabs = document.querySelector(".score-tabs").getBoundingClientRect();
            const back = document.getElementById("leaderboard-close").getBoundingClientRect();
            return board.left >= screen.left - 1 && board.right <= screen.right + 1 &&
              board.top >= screen.top - 1 && board.bottom <= screen.bottom + 1 &&
              tabs.left >= board.left && tabs.right <= board.right && back.bottom <= board.bottom &&
              document.documentElement.scrollHeight <= innerHeight;
          }), true);
          assert.equal(await page.locator("#game").isVisible(), false);
          assert.equal(await page.locator("#leaderboard-refresh, #leaderboard-enter, #score-submit-open").count(), 0);
          const paged = await page.locator(".score-page-controls").isVisible();
          assert.equal(await page.locator("#leaderboard-list li:visible").count(), paged ? 5 : 10);
          if (paged) {
            await page.locator("#scores-next").click();
            assert.deepEqual(await page.locator("#leaderboard-list li:visible").evaluateAll(nodes =>
              nodes.map(node => node.dataset.rank)), ["06", "07", "08", "09", "10"]);
            await page.locator("#scores-previous").click();
          }
          await fits(page, "#leaderboard");
          if (viewport.width === 390 || viewport.width === 1440) {
            assert.equal(await page.evaluate(() => {
              const last = document.querySelector("#leaderboard-list li:last-child").getBoundingClientRect();
              const rows = document.querySelector(".score-rows").getBoundingClientRect();
              return last.bottom <= rows.bottom + 1;
            }), true, "all ten entries fit without scrolling on the standard phone and desktop");
          }
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `scores-${viewport.width}.png`) });
          await page.locator("#scores-allTime").click();
          assert.equal(await page.locator("#scores-allTime").getAttribute("aria-selected"), "true");
          await page.keyboard.press("ArrowRight");
          assert.equal(await page.locator("#scores-local").getAttribute("aria-selected"), "true");
          await page.keyboard.press("Home");
          assert.equal(await page.locator("#scores-daily").getAttribute("aria-selected"), "true");
          await page.locator("#leaderboard-list li").first().click();
          assert.equal(await page.locator(".cabinet").getAttribute("data-flight-state"), "paused");
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#leaderboard").isVisible(), false);
          assert.equal(await page.locator("#game").isVisible(), true);
          await page.waitForFunction(() => !document.getElementById("overlay").inert);
          await page.locator("#manual-open").click();
          assert.equal(await page.locator("#manual").evaluate(node => node.matches(":modal")), true);
          assert.match(await page.locator("#manual").innerText(), /FLIGHT MANUAL/);
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `manual-${viewport.width}.png`) });
        } finally { await context.close(); }
      });
      await t.test(`qualifying initials and retry screens do not scroll at ${viewport.width}x${viewport.height}`, async () => {
        const { context, page } = await open({ submitFails: true }, { viewport, hasTouch: true });
        try {
          await page.evaluate(() => window.__finishScore(24));
          await page.locator(".initial-character").first().waitFor({ state: "visible" });
          await fits(page, "#leaderboard-entry");
          assert.equal(await page.locator("#leaderboard input:not([type=hidden])").count(), 0,
            "Initials do not summon a phone keyboard or resize the cabinet.");
          await page.getByRole("button", { name: "Next first initial", exact: true }).tap();
          assert.equal(await page.locator("#leaderboard-name").inputValue(), "BAA");
          await page.getByRole("button", { name: "Previous first initial", exact: true }).tap();
          await enterTag(page, "ab7");
          assert.equal(await page.locator("#leaderboard-name").inputValue(), "AB7");
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `initials-${viewport.width}.png`) });
          await page.locator("#leaderboard-publish").tap();
          await page.waitForFunction(() => !document.getElementById("leaderboard-submit-status").hidden);
          await fits(page, "#leaderboard-entry");
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `initials-error-${viewport.width}.png`) });
          await page.locator("#leaderboard-cancel").tap();
          await page.waitForFunction(() => document.activeElement.id === "play");
          await fits(page, ".dialog.crashed");
          assert.equal(await page.locator("#leaderboard").isVisible(), false);
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `retry-${viewport.width}.png`) });
        } finally { await context.close(); }
      });
    }
    await t.test("unconfigured Firebase sends no requests and leaves local scores usable", async () => {
      const { context, page } = await open({ enabled: false });
      try {
        await page.evaluate(() => window.__finishScore(12));
        await page.locator("#leaderboard-open").click();
        assert.deepEqual(await page.locator("#leaderboard-list strong").allTextContents(), ["12"]);
        await page.locator("#scores-daily").click();
        assert.match(await page.locator("#leaderboard-empty").textContent(), /not connected/);
        assert.equal(await page.locator("#leaderboard-entry").isVisible(), false);
        assert.equal(await page.evaluate(() => window.__scoreCalls.reads), 0);
        assert.deepEqual(await page.evaluate(() => window.__scoreCalls.submits), []);
      } finally { await context.close(); }
    });
    await t.test("a qualifying run opens initials directly but publishes only on Save", async () => {
      const { context, page } = await open({ delaySubmit: true });
      try {
        await page.evaluate(() => window.__finishScore(24));
        await page.locator(".initial-character").first().waitFor({ state: "visible" });
        assert.equal(await page.evaluate(() => window.__scoreCalls.reads), 1);
        assert.deepEqual(await page.evaluate(() => window.__scoreCalls.submits), []);
        assert.equal(await page.locator(".score-heading").isVisible(), false);
        assert.equal(await page.locator(".score-tabs").isVisible(), false);
        await enterTag(page, "ab7");
        if (artifacts) await page.screenshot({ path: resolve(artifacts, "score-entry.png") });
        await page.locator("#leaderboard-publish").click();
        await page.waitForFunction(() => window.__scoreCalls.submits.length === 1);
        assert.equal(await page.locator("#leaderboard-publish").isDisabled(), true);
        await page.locator("#leaderboard-entry").dispatchEvent("submit");
        assert.equal(await page.evaluate(() => window.__scoreCalls.submits.length), 1);
        assert.equal(await page.evaluate(() => window.__scoreCalls.submits[0].name), "AB7");
        await page.evaluate(() => window.__releaseSubmit());
        await page.waitForFunction(() => document.getElementById("leaderboard-entry").hidden);
        assert.equal(await page.locator("#leaderboard").isVisible(), false);
        assert.equal(await page.evaluate(() => localStorage.getItem("trumpet-flight-arcade-tag")), "AB7");
        await page.evaluate(() => window.__finishScore(25));
        await page.locator(".initial-character").first().waitFor({ state: "visible" });
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "AB7");
        await page.locator("#leaderboard-cancel").click();
        assert.equal(await page.evaluate(() => window.__scoreCalls.submits.length), 1);
      } finally { await context.close(); }
    });
    await t.test("nonqualifying and offline scores never ask for a name", async () => {
      const { context, page } = await open({ qualifies: false });
      try {
        await page.evaluate(() => window.__finishScore(2));
        await page.locator("#leaderboard-open").click();
        await page.waitForFunction(() => document.querySelectorAll("#leaderboard-list li").length === 10);
        assert.equal(await page.locator("#leaderboard-entry").isVisible(), false);
        await context.setOffline(true);
        await page.waitForFunction(() => !navigator.onLine);
        assert.match(await page.locator("#leaderboard-status").textContent(), /Offline/);
        await page.locator("#scores-local").click();
        assert.deepEqual(await page.locator("#leaderboard-list strong").allTextContents(), ["2"]);
      } finally { await context.close(); }
    });
    await t.test("load failures are not shown as an empty global board", async () => {
      const { context, page } = await open({ readFails: true });
      try {
        await page.locator("#leaderboard-open").click();
        await page.waitForFunction(() => document.getElementById("leaderboard-status").textContent.includes("Could not load"));
        assert.match(await page.locator("#leaderboard-empty").textContent(), /unavailable/);
        assert.equal(await page.locator("#leaderboard-entry").isVisible(), false);
      } finally { await context.close(); }
    });
    await t.test("switching to local while a read is pending does not replace the local table", async () => {
      const { context, page } = await open({ delayRead: true });
      try {
        await page.evaluate(() => window.__finishScore(5));
        await page.locator("#leaderboard-open").click();
        await page.waitForFunction(() => typeof window.__releaseRead === "function");
        await page.locator("#scores-local").click();
        await page.evaluate(() => window.__releaseRead());
        await page.waitForFunction(() => document.getElementById("leaderboard-results").getAttribute("aria-busy") === "false");
        assert.deepEqual(await page.locator("#leaderboard-list strong").allTextContents(), ["5"]);
      } finally { await context.close(); }
    });
    await t.test("failed submission keeps the entered tag and local result", async () => {
      const { context, page } = await open({ submitFails: true });
      try {
        await page.evaluate(() => window.__finishScore(24));
        await page.locator(".initial-character").first().waitFor({ state: "visible" });
        await enterTag(page, "ACE");
        await page.locator("#leaderboard-publish").click();
        await page.waitForFunction(() => document.getElementById("leaderboard-submit-status").textContent.includes("unavailable"));
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "ACE");
        assert.equal(await page.locator("#leaderboard-publish").isEnabled(), true);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("trumpet-flight-top10"))[0].score), 24);
      } finally { await context.close(); }
    });
    await t.test("qualification waits for the crash animation and never interrupts a new flight", async () => {
      const { context, page } = await open({ delayRead: true });
      try {
        await page.evaluate(() => window.__finishScore(24, false));
        await page.waitForFunction(() => typeof window.__releaseRead === "function");
        await page.evaluate(() => window.__releaseRead());
        await page.waitForFunction(() => document.getElementById("leaderboard-results").getAttribute("aria-busy") === "false");
        assert.equal(await page.locator("#leaderboard").isVisible(), false);
        await page.evaluate(() => window.__finishDeath());
        await page.locator(".initial-character").first().waitFor({ state: "visible" });
        await page.locator("#leaderboard-cancel").click();
        await page.evaluate(() => { window.__releaseRead = null; window.__finishScore(26); });
        await page.waitForFunction(() => typeof window.__releaseRead === "function");
        await page.evaluate(() => { window.__startRun(); window.__releaseRead(); });
        await page.waitForFunction(() => document.getElementById("leaderboard-results").getAttribute("aria-busy") === "false");
        assert.equal(await page.locator(".cabinet").getAttribute("data-flight-state"), "playing");
        assert.equal(await page.locator("#leaderboard").isVisible(), false);
      } finally { await context.close(); }
    });
    await t.test("a run overtaken during Save has one clear exit and keeps its local score", async () => {
      const { context, page } = await open({ noLongerQualifies: true });
      try {
        await page.evaluate(() => window.__finishScore(24));
        await page.locator(".initial-character").first().waitFor({ state: "visible" });
        await page.locator("#leaderboard-publish").click();
        await page.waitForFunction(() => document.getElementById("leaderboard-cancel").textContent === "Continue");
        assert.equal(await page.locator("#leaderboard-publish").isVisible(), false);
        await page.locator("#leaderboard-cancel").click();
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("trumpet-flight-top10"))[0].score), 24);
      } finally { await context.close(); }
    });
    await t.test("zero and offline runs stay on retry without fetching or offering initials", async () => {
      const { context, page } = await open();
      try {
        await page.evaluate(() => window.__finishScore(0));
        assert.equal(await page.evaluate(() => window.__scoreCalls.reads), 0);
        await context.setOffline(true);
        await page.waitForFunction(() => !navigator.onLine);
        await page.evaluate(() => window.__finishScore(24));
        assert.equal(await page.evaluate(() => window.__scoreCalls.reads), 0);
        assert.equal(await page.locator("#leaderboard").isVisible(), false);
      } finally { await context.close(); }
    });
    await t.test("opening the manual or leaving the cabinet cancels a delayed initials offer", async () => {
      for (const leave of [false, true]) {
        const { context, page } = await open({ delayRead: true });
        try {
          await page.evaluate(() => window.__finishScore(24, false));
          await page.waitForFunction(() => typeof window.__releaseRead === "function");
          if (leave) await page.evaluate(() => document.dispatchEvent(new Event("cabinetleave")));
          else await page.locator("#manual-open").click();
          await page.evaluate(() => { window.__releaseRead(); window.__finishDeath(); });
          await page.waitForFunction(() => document.getElementById("leaderboard-results").getAttribute("aria-busy") === "false");
          assert.equal(await page.locator("#leaderboard").isVisible(), false);
          if (!leave) assert.equal(await page.locator("#manual").isVisible(), true);
        } finally { await context.close(); }
      }
    });
    await t.test("UTC midnight clears the daily display without polling or erasing all-time scores", async () => {
      const { context, page } = await open({ time: "2026-09-08T23:59:50.000Z" });
      try {
        await page.locator("#leaderboard-open").click();
        await page.waitForFunction(() => document.querySelectorAll("#leaderboard-list li").length === 10);
        const reads = await page.evaluate(() => window.__scoreCalls.reads);
        await page.clock.runFor(11000);
        assert.equal(await page.locator("#leaderboard-list li").count(), 0);
        assert.equal(await page.evaluate(() => window.__scoreCalls.reads), reads);
        await page.locator("#scores-allTime").click();
        assert.equal(await page.locator("#leaderboard-list li").count(), 10);
      } finally { await context.close(); }
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
