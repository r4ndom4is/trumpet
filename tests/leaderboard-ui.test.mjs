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
        "  window.__finishScore = value => { score = value; state = 'playing'; die(); finishDeath(); };\n})();");
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
          assert.equal(await page.locator("#overlay").evaluate(node => node.inert), false);
          await page.locator("#manual-open").click();
          assert.equal(await page.locator("#manual").evaluate(node => node.matches(":modal")), true);
          assert.match(await page.locator("#manual").innerText(), /FLIGHT MANUAL/);
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `manual-${viewport.width}.png`) });
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
        assert.equal(await page.locator("#leaderboard-enter").isVisible(), false);
        assert.equal(await page.evaluate(() => window.__scoreCalls.reads), 0);
        assert.deepEqual(await page.evaluate(() => window.__scoreCalls.submits), []);
      } finally { await context.close(); }
    });
    await t.test("a qualifying run asks for a tag only on demand and publishes once", async () => {
      const { context, page } = await open({ delaySubmit: true });
      try {
        await page.evaluate(() => window.__finishScore(24));
        assert.equal(await page.locator("#leaderboard").isVisible(), false);
        assert.equal(await page.evaluate(() => window.__scoreCalls.reads), 0);
        await page.locator("#score-submit-open").click();
        await page.locator("#leaderboard-enter").click();
        assert.equal(await page.locator("#leaderboard-name").getAttribute("maxlength"), "3");
        await page.locator("#leaderboard-name").fill("ab7");
        if (artifacts) await page.screenshot({ path: resolve(artifacts, "score-entry.png") });
        await page.locator("#leaderboard-publish").click();
        await page.waitForFunction(() => window.__scoreCalls.submits.length === 1);
        assert.equal(await page.locator("#leaderboard-publish").isDisabled(), true);
        await page.locator("#leaderboard-entry").dispatchEvent("submit");
        assert.equal(await page.evaluate(() => window.__scoreCalls.submits.length), 1);
        assert.equal(await page.evaluate(() => window.__scoreCalls.submits[0].name), "AB7");
        await page.evaluate(() => window.__releaseSubmit());
        await page.waitForFunction(() => document.getElementById("leaderboard-entry").hidden);
        assert.match(await page.locator("#leaderboard-status").textContent(), /both boards/);
        assert.equal(await page.evaluate(() => localStorage.getItem("trumpet-flight-arcade-tag")), "AB7");
        assert.equal(await page.locator("#leaderboard-enter").isVisible(), false);
      } finally { await context.close(); }
    });
    await t.test("nonqualifying and offline scores never ask for a name", async () => {
      const { context, page } = await open({ qualifies: false });
      try {
        await page.evaluate(() => window.__finishScore(2));
        await page.locator("#leaderboard-open").click();
        await page.waitForFunction(() => document.querySelectorAll("#leaderboard-list li").length === 10);
        assert.equal(await page.locator("#leaderboard-enter").isVisible(), false);
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
        await page.waitForFunction(() => document.getElementById("leaderboard-status").textContent.includes("could not load"));
        assert.match(await page.locator("#leaderboard-empty").textContent(), /unavailable/);
        assert.equal(await page.locator("#leaderboard-enter").isVisible(), false);
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
        await page.locator("#leaderboard-open").click();
        await page.locator("#leaderboard-enter").click();
        await page.locator("#leaderboard-name").fill("ACE");
        await page.locator("#leaderboard-publish").click();
        await page.waitForFunction(() => document.getElementById("leaderboard-submit-status").textContent.includes("unavailable"));
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "ACE");
        assert.equal(await page.locator("#leaderboard-publish").isEnabled(), true);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("trumpet-flight-top10"))[0].score), 24);
      } finally { await context.close(); }
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
