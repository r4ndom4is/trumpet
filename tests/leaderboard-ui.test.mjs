import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { serve } from "./serve-test.mjs";

const uiSource = await readFile(new URL("../scripts/leaderboard.js", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../scripts/cabinet.css", import.meta.url), "utf8");
const mock = `
(() => {
  const scenario = window.__scoreScenario;
  window.TRUMPET_FIREBASE = { enabled: scenario.enabled !== false, emulators: true };
  window.__scoreCalls = { reads: 0, submits: [], completed: 0 };
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
      window.__scoreCalls.completed++;
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
        "  window.__finishScore = (value, finish = true) => { score = value; state = 'playing'; die(); if (finish) finishDeath(); };\n  window.__finishDeath = finishDeath; window.__startRun = start; window.__drawScreen = draw;\n})();");
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/trumpet/`;
  const browser = await chromium.launch();
  let touchBrowser = browser;
  const errors = [];
  const artifacts = process.env.GLOBAL_SCORES_ARTIFACT_DIR;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  async function open(scenario = {}, options = {}, engine = browser) {
    const context = await engine.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", ...options });
    await context.addInitScript(scenario => {
      window.__scoreScenario = scenario;
      if (scenario.records) localStorage.setItem("trumpet-flight-top10", JSON.stringify(scenario.records));
      if (scenario.savedTag) localStorage.setItem("trumpet-flight-arcade-tag", scenario.savedTag);
      if (scenario.best !== undefined) localStorage.setItem("trumpet-flight-best", String(scenario.best));
    }, scenario);
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    if (scenario.time) await page.clock.install({ time: new Date(scenario.time) });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector(".cabinet").dataset.art === "ready");
    await page.evaluate(() => window.__drawScreen());
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
  const localRecords = Array.from({ length: 10 }, (_, index) => ({ score: 40 - index, at: Date.now() - index * 86400000 }));
  async function rankedListFits(page) {
    await page.waitForFunction(() => {
      const rows = document.querySelector(".score-rows").getBoundingClientRect();
      const items = [...document.querySelectorAll("#leaderboard-list li")];
      return items.length === 10 && items.every((node, index) => {
        const box = node.getBoundingClientRect();
        const previous = items[index - 1]?.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.top >= rows.top - 1 && box.bottom <= rows.bottom + 1 &&
          Math.abs(box.left - rows.left) < 1 && Math.abs(box.right - rows.right) < 1 &&
          (!previous || box.top >= previous.bottom - .5) &&
          [...node.children].every(child => {
            const bounds = child.getBoundingClientRect();
            return bounds.left >= box.left - 1 && bounds.right <= box.right + 1 &&
              bounds.top >= box.top - 1 && bounds.bottom <= box.bottom + 1;
          }) && parseFloat(getComputedStyle(node.querySelector("strong")).fontSize) >= 14;
      });
    });
    assert.equal(await page.locator("#leaderboard-list li:visible").count(), 10);
    assert.equal(await page.locator("#scores-next, #scores-previous, #scores-page").count(), 0);
    await fits(page, "#leaderboard");
    assert.equal(await page.locator("#leaderboard button:visible").evaluateAll(nodes =>
      nodes.every(node => {
        const box = node.getBoundingClientRect();
        return box.width >= 44 && box.height >= 44;
      })), true, "filters and close control retain touch-sized targets");
    assert.equal(await page.locator("#leaderboard button:visible, #leaderboard-title").evaluateAll(nodes =>
      nodes.every((node, index) => {
        const box = node.getBoundingClientRect();
        return nodes.slice(index + 1).every(other => {
          const next = other.getBoundingClientRect();
          return Math.min(box.right, next.right) - Math.max(box.left, next.left) <= 1 ||
            Math.min(box.bottom, next.bottom) - Math.max(box.top, next.top) <= 1;
        });
      })), true, "title and filter hit targets do not overlap");
  }
  try {
    if (process.env.GLOBAL_SCORES_TOUCH_BROWSER === "webkit") touchBrowser = await webkit.launch();
    await t.test("both scopes keep one complete ranked column through small-screen rotations", async () => {
      const { context, page } = await open({ records: localRecords }, {
        viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true
      }, touchBrowser);
      try {
        await page.locator("#leaderboard-open").tap();
        for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport);
          await rankedListFits(page);
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `scores-touch-${viewport.width}.png`) });
          await page.locator("#scores-local").tap();
          assert.equal(await page.locator(".score-tabs").isVisible(), false);
          await rankedListFits(page);
          assert.deepEqual(await page.locator("#leaderboard-list strong").allTextContents(), localRecords.map(record => String(record.score)));
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `scores-touch-local-${viewport.width}.png`) });
          await page.locator("#scores-global").tap();
        }
        await page.locator("#leaderboard-close").tap();
        await page.waitForFunction(() => !document.getElementById("leaderboard").open);
        assert.equal(await page.locator(".shell > header").isVisible(), true);
      } finally { await context.close(); }
    });
    await t.test("touch-closing scores clears the deck focus decoration without losing keyboard focus", async () => {
      const { context, page } = await open({}, {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true
      }, touchBrowser);
      try {
        const opener = page.locator("#leaderboard-open");
        await opener.focus();
        await page.keyboard.press("Enter");
        await page.locator("#leaderboard-close").tap();
        await page.waitForFunction(() => !document.getElementById("leaderboard").open &&
          document.activeElement.id === "leaderboard-open");
        assert.equal(await opener.evaluate(node => getComputedStyle(node).outlineStyle), "none");
        await page.waitForFunction(() =>
          getComputedStyle(document.getElementById("leaderboard-open"), "::before").opacity === "0");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.getElementById("leaderboard").open &&
          document.activeElement.id === "leaderboard-open");
        assert.equal(await opener.evaluate(node => getComputedStyle(node).outlineStyle), "solid");
        assert.equal(await opener.evaluate(node => getComputedStyle(node).outlineWidth), "2px");
        await opener.tap();
        await page.locator("#leaderboard-close").tap();
        await page.waitForFunction(() => !document.getElementById("leaderboard").open);
        assert.equal(await opener.evaluate(node => getComputedStyle(node).outlineStyle), "none");
        await page.locator("#manual-open").tap();
        await page.locator("#manual-close").tap();
        await page.waitForFunction(() => document.activeElement.id === "manual-open");
        assert.equal(await page.locator("#manual-open").evaluate(node => getComputedStyle(node).outlineStyle), "none");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.getElementById("manual").open);
        assert.equal(await page.locator("#manual-open").evaluate(node => getComputedStyle(node).outlineStyle), "solid");
      } finally { await context.close(); }
    });
    await t.test("game and surrounding space reject selection while the manual stays selectable", async () => {
      const { context, page } = await open({}, {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true
      }, touchBrowser);
      try {
        const tapHighlightSupported = await page.evaluate(() => CSS.supports("-webkit-tap-highlight-color", "transparent"));
        for (const selector of [".shell > main", ".cabinet", "#screen", "#game"]) {
          assert.deepEqual(await page.locator(selector).evaluate(node => ({
            selection: getComputedStyle(node).webkitUserSelect,
            highlight: getComputedStyle(node).getPropertyValue("-webkit-tap-highlight-color"),
            canceled: !node.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true }))
          })), { selection: "none", highlight: tapHighlightSupported ? "rgba(0, 0, 0, 0)" : "", canceled: true });
        }
        await page.locator("#leaderboard-open").tap();
        assert.equal(await page.locator("#leaderboard-title").evaluate(node =>
          node.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true }))), false);
        assert.equal(await page.locator("#leaderboard-title").evaluate(node =>
          node.firstChild.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true }))), false);
        const close = await page.locator("#leaderboard-close").boundingBox();
        assert.ok(close.width >= 48 && close.height >= 48);
        assert.equal(await page.locator("#leaderboard-close svg").evaluate(node =>
          node.getBoundingClientRect().width), 24);
        await fits(page, "#leaderboard");
        if (artifacts) await page.screenshot({ path: resolve(artifacts, "scores-touch.png") });
        await page.locator("#leaderboard-close").tap();
        await page.locator("#manual-open").tap();
        assert.deepEqual(await page.locator(".manual-content p").first().evaluate(node => ({
          selection: getComputedStyle(node).webkitUserSelect,
          canceled: !node.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true }))
        })), { selection: "text", canceled: false });
      } finally { await context.close(); }
    });
    for (const viewport of [
      { width: 320, height: 568 }, { width: 390, height: 844 },
      { width: 667, height: 375 }, { width: 1440, height: 1000 }
    ]) {
      await t.test(`scores stay inside the live screen at ${viewport.width}x${viewport.height}`, async () => {
        const { context, page } = await open({ records: localRecords }, { viewport, colorScheme: viewport.width > 1000 ? "dark" : "light" });
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
          await rankedListFits(page);
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `scores-${viewport.width}.png`) });
          await page.locator("#scores-allTime").click();
          assert.equal(await page.locator("#scores-allTime").getAttribute("aria-checked"), "true");
          await page.locator("#scores-global").focus();
          await page.keyboard.press("ArrowRight");
          assert.equal(await page.locator("#scores-local").getAttribute("aria-checked"), "true");
          assert.equal(await page.locator(".score-tabs").isVisible(), false);
          assert.equal(await page.locator("#scores-local-context").isVisible(), true);
          await rankedListFits(page);
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `scores-local-${viewport.width}.png`) });
          await page.keyboard.press("ArrowLeft");
          assert.equal(await page.locator("#scores-global").getAttribute("aria-checked"), "true");
          assert.equal(await page.locator(".score-tabs").isVisible(), true);
          assert.equal(await page.locator("#scores-allTime").getAttribute("aria-checked"), "true");
          await page.locator("#scores-allTime").focus();
          await page.keyboard.press("Home");
          assert.equal(await page.locator("#scores-daily").getAttribute("aria-checked"), "true");
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
      await t.test(`one screen language and stable primary action at ${viewport.width}x${viewport.height}`, async () => {
        const { context, page } = await open({ enabled: false, best: 12 }, { viewport });
        try {
          const primary = await page.locator("#play").boundingBox();
          assert.equal(await page.locator("#run-best").innerText(), "YOUR BEST 12");
          assert.equal(await page.locator("#message").isVisible(), false);
          assert.equal(await page.locator(".scorebar").isVisible(), false);
          for (const state of ["ready", "paused", "result", "record"]) {
            if (state === "paused") {
              await page.locator("#play").click();
              assert.equal(await page.locator(".scorebar").isVisible(), true);
              assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("score")).fontSize) >
                parseFloat(getComputedStyle(document.getElementById("best")).fontSize)), true);
              await page.keyboard.press("KeyP");
              assert.equal(await page.locator("#title").innerText(), "PAUSED");
              assert.equal(await page.locator("#play").innerText(), "RESUME");
              assert.equal(await page.locator("#game").isVisible(), true);
              assert.equal(await page.locator("#overlay").evaluate(node => getComputedStyle(node).backgroundColor), "rgba(20, 37, 44, 0.78)");
            }
            if (state === "result" || state === "record") {
              await page.evaluate(value => window.__finishScore(value), state === "record" ? 24 : 8);
              assert.equal(await page.locator("#title").innerText(), state === "record" ? "PERSONAL BEST" : "YOUR SCORE");
              assert.equal(await page.locator("#run-score").innerText(), state === "record" ? "24" : "8");
              assert.equal(await page.locator("#play").innerText(), "FLY AGAIN");
              assert.equal(await page.locator("#crash-shot").isVisible(), false);
            }
            await fits(page, ".run-screen");
            const current = await page.locator("#play").boundingBox();
            assert.ok(Math.abs(current.y - primary.y) < 1 && Math.abs(current.height - primary.height) < 1,
              "Play, Resume and Fly again retain the same position and target size.");
            assert.equal(await page.locator(".run-screen").evaluate(node => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
            await page.evaluate(() => window.__drawScreen());
            if (artifacts) await page.screenshot({ path: resolve(artifacts, `${state}-${viewport.width}.png`) });
          }
        } finally { await context.close(); }
      });
      await t.test(`returning qualifiers keep retry live at ${viewport.width}x${viewport.height}`, async () => {
        const { context, page } = await open({ savedTag: "RMA", delaySubmit: true }, { viewport, hasTouch: true });
        try {
          const primary = await page.locator("#play").boundingBox();
          await page.evaluate(() => window.__finishScore(24));
          await page.locator("#run-save").waitFor({ state: "visible" });
          assert.equal(await page.locator("#leaderboard").isVisible(), false);
          assert.equal(await page.locator("#run-save").innerText(), "Save as RMA");
          assert.equal(await page.evaluate(() => window.__scoreCalls.submits.length), 0);
          assert.ok(Math.abs((await page.locator("#play").boundingBox()).y - primary.y) < 1);
          await fits(page, ".run-screen");
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `returning-qualifier-${viewport.width}.png`) });
          await page.locator("#run-change").tap();
          assert.equal(await page.locator("#leaderboard-name").inputValue(), "RMA");
          assert.equal(await page.locator("#leaderboard-cancel").innerText(), "Cancel");
          await page.locator("#leaderboard-cancel").tap();
          await page.locator("#run-save").tap();
          await page.waitForFunction(() => window.__scoreCalls.submits.length === 1);
          assert.equal(await page.locator("#run-save").isDisabled(), true);
          assert.equal(await page.locator("#play").isEnabled(), true);
          await page.waitForTimeout(460);
          await page.locator("#play").tap();
          assert.equal(await page.locator(".cabinet").getAttribute("data-flight-state"), "playing");
          await page.evaluate(() => window.__releaseSubmit());
          await page.waitForFunction(() => window.__scoreCalls.completed === 1);
          assert.equal(await page.locator("#leaderboard").isVisible(), false);
          assert.equal(await page.locator("#run-ranking").isVisible(), false);
          assert.equal(await page.locator(".cabinet").getAttribute("data-flight-state"), "playing");
        } finally { await context.close(); }
      });
    }
    await t.test("initials wheels have crisp mouse detents, accumulate trackpad motion and preserve zoom", async () => {
      const { context, page } = await open({ delaySubmit: true });
      try {
        await page.evaluate(() => window.__finishScore(24));
        const first = page.locator(".initial-character").first();
        await first.waitFor({ state: "visible" });
        await first.hover();
        await page.mouse.wheel(0, 120);
        await page.waitForFunction(() => document.getElementById("leaderboard-name").value === "BAA");
        assert.equal(await first.getAttribute("aria-valuetext"), "B");
        await page.mouse.wheel(0, -120);
        await page.waitForFunction(() => document.getElementById("leaderboard-name").value === "AAA");
        const wheel = async options => first.evaluate((node, options) => {
          const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...options });
          node.dispatchEvent(event);
          return event.defaultPrevented;
        }, options);
        for (let i = 0; i < 3; i++) assert.equal(await wheel({ deltaY: 12 }), true);
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "AAA");
        await wheel({ deltaY: 12 });
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "BAA");
        assert.equal(await wheel({ deltaY: 120, ctrlKey: true }), false);
        assert.equal(await wheel({ deltaX: 100, deltaY: 12 }), false);
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "BAA");
        await wheel({ deltaY: -3, deltaMode: 1 });
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "AAA");
        await wheel({ deltaY: -1, deltaMode: 2 });
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "9AA");
        await wheel({ deltaY: 120 });
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "AAA");
        assert.equal(await first.getAttribute("aria-valuenow"), "0");
        await page.emulateMedia({ reducedMotion: "reduce" });
        await wheel({ deltaY: 120 });
        assert.equal(await first.locator(".initial-reel").evaluate(node => node.getAnimations().length), 0);
        await page.locator("#leaderboard-publish").click();
        assert.equal(await first.getAttribute("aria-disabled"), "true");
        const saved = await page.locator("#leaderboard-name").inputValue();
        await wheel({ deltaY: 120 });
        await first.press("ArrowUp");
        assert.equal(await page.locator("#leaderboard-name").inputValue(), saved);
        assert.equal(await page.evaluate(() => window.__scoreCalls.submits.length), 1);
        await page.evaluate(() => window.__releaseSubmit());
      } finally { await context.close(); }
    });
    await t.test("touch wheels follow the finger and snap without scrolling the cabinet or spilling into another slot", async () => {
      const { context, page } = await open({}, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      try {
        await page.evaluate(() => window.__finishScore(24));
        const first = page.locator(".initial-character").first();
        await first.waitFor({ state: "visible" });
        const box = await first.boundingBox(), second = await page.locator(".initial-character").nth(1).boundingBox();
        const x = box.x + box.width/2, y = box.y + box.height/2;
        const cdp = await context.newCDPSession(page);
        const touch = (type, xx = x, yy = y) => cdp.send("Input.dispatchTouchEvent", {
          type, touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x: xx, y: yy, id: 1 }]
        });
        await touch("touchStart");
        await touch("touchMove", x, y - box.height * .3);
        assert.equal(await first.getAttribute("data-dragging"), "true");
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "AAA");
        await touch("touchMove", second.x + second.width/2, y - box.height * 1.2);
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "BAA");
        await touch("touchEnd");
        assert.equal(await first.getAttribute("data-dragging"), null);
        const duration = await first.locator(".initial-reel").evaluate(node => node.getAnimations()[0]?.effect.getTiming().duration);
        assert.equal(duration, 100);
        await first.locator(".initial-reel").evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
        assert.equal(await page.evaluate(() => scrollY), 0);
        await fits(page, "#leaderboard-entry");
        await touch("touchStart");
        await touch("touchMove", x, y + box.height * .7);
        await touch("touchEnd");
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "AAA", "release chooses the nearest letter");
        await touch("touchStart");
        await touch("touchMove", x, y - box.height * .3);
        await touch("touchCancel");
        assert.equal(await first.getAttribute("data-dragging"), null);
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "AAA");
        await enterTag(page, "Z09");
        assert.equal(await page.locator("#leaderboard-name").inputValue(), "Z09");
        if (artifacts) await page.screenshot({ path: resolve(artifacts, "scrollable-initials-phone.png") });
        await cdp.detach();
      } finally { await context.close(); }
    });
    await t.test("initial detents click quietly only when sound is enabled", async () => {
      for (const muted of [false, true]) {
        const { context, page } = await open();
        try {
          if (muted) await page.locator("#sound").click();
          await page.evaluate(() => {
            window.__detentTones = 0;
            const create = AudioContext.prototype.createOscillator;
            AudioContext.prototype.createOscillator = function() {
              const oscillator = create.call(this), set = oscillator.frequency.setValueAtTime;
              oscillator.frequency.setValueAtTime = function(value, ...args) {
                if (value === 1200) window.__detentTones++;
                return set.call(this, value, ...args);
              };
              return oscillator;
            };
            window.__finishScore(24);
          });
          await page.getByRole("button", { name: "Next first initial", exact: true }).click();
          if (!muted) await page.waitForFunction(() => window.__detentTones === 1);
          else await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.equal(await page.evaluate(() => window.__detentTones), muted ? 0 : 1);
        } finally { await context.close(); }
      }
    });
    await t.test("first-time ready shows a painted rider and one instruction, without empty counters", async () => {
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
        const { context, page } = await open({ enabled: false }, { viewport, colorScheme: viewport.width > 1000 ? "dark" : "light" });
        try {
          assert.equal(await page.locator("#message").innerText(), "Tap or Space to flap.");
          assert.equal(await page.locator("#run-best").isVisible(), false);
          assert.equal(await page.locator(".scorebar").isVisible(), false);
          assert.equal(await page.locator("#rider-preview").isVisible(), true);
          assert.equal(await page.locator("#rider-preview").evaluate(canvas =>
            canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0)), true);
          await fits(page, ".run-screen");
          if (artifacts) await page.screenshot({ path: resolve(artifacts, `first-ready-${viewport.width}.png`) });
        } finally { await context.close(); }
      }
    });
    await t.test("returning save confirmation moves keyboard focus to retry without an interstitial", async () => {
      const { context, page } = await open({ savedTag: "ACE" });
      try {
        await page.evaluate(() => window.__finishScore(24));
        await page.locator("#run-save").click();
        await page.waitForFunction(() => document.getElementById("run-ranking-status").textContent.includes("Saved as ACE"));
        assert.equal(await page.locator("#run-ranking-actions").isVisible(), false);
        assert.equal(await page.evaluate(() => document.activeElement.id), "play");
        assert.equal(await page.locator("#leaderboard").isVisible(), false);
      } finally { await context.close(); }
    });
    await t.test("browsing scores during an inline save preserves the selected board", async () => {
      const { context, page } = await open({ savedTag: "ACE", delaySubmit: true });
      try {
        await page.evaluate(() => window.__finishScore(24));
        await page.locator("#run-save").click();
        await page.locator("#leaderboard-open").click();
        await page.locator("#scores-allTime").click();
        assert.equal(await page.locator("#scores-allTime").getAttribute("aria-checked"), "true");
        assert.equal(await page.evaluate(() => window.__scoreCalls.reads), 1);
        await page.evaluate(() => window.__releaseSubmit());
        await page.waitForFunction(() => window.__scoreCalls.completed === 1);
        assert.equal(await page.locator("#leaderboard").isVisible(), true);
        assert.equal(await page.locator("#scores-allTime").getAttribute("aria-checked"), "true");
      } finally { await context.close(); }
    });
    await t.test("unconfigured Firebase sends no requests and leaves local scores usable", async () => {
      const { context, page } = await open({ enabled: false });
      try {
        await page.evaluate(() => window.__finishScore(12));
        await page.locator("#leaderboard-open").click();
        assert.deepEqual(await page.locator("#leaderboard-list strong").allTextContents(), ["12"]);
        await page.locator("#scores-global").click();
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
        await page.locator("#run-save").waitFor({ state: "visible" });
        assert.equal(await page.locator("#leaderboard").isVisible(), false);
        await page.locator("#run-change").click();
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
        await page.waitForFunction(() => !document.getElementById("leaderboard").open);
        assert.match(await page.locator("#run-ranking-status").innerText(), /board moved ahead/);
        assert.equal(await page.locator("#play").isEnabled(), true);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("trumpet-flight-top10"))[0].score), 24);
      } finally { await context.close(); }
    });
    await t.test("a returning player's failed save stays inline and retains their initials", async () => {
      const { context, page } = await open({ savedTag: "ACE", submitFails: true });
      try {
        await page.evaluate(() => window.__finishScore(24));
        await page.locator("#run-save").click();
        await page.waitForFunction(() => document.getElementById("run-ranking-status").textContent.includes("unavailable"));
        assert.equal(await page.locator("#leaderboard").isVisible(), false);
        assert.equal(await page.locator("#play").isEnabled(), true);
        assert.equal(await page.locator("#run-save").innerText(), "Save as ACE");
        assert.equal(await page.locator("#run-save").isEnabled(), true);
        for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 },
          { width: 667, height: 375 }, { width: 1440, height: 1000 }]) {
          await page.setViewportSize(viewport);
          await fits(page, ".run-screen");
        }
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
    if (touchBrowser !== browser) await touchBrowser.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
