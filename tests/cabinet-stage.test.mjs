import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { serve } from "../scripts/serve.mjs";

test("Cabinet arrival: intentional activation, accessible fallback and offline continuity", { timeout: 120000 }, async t => {
  const server = serve();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/trumpet/`;
  const browser = await chromium.launch();
  const errors = [];
  async function open(options = {}, suffix = "") {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", ...options });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url + suffix);
    return { context, page };
  }
  async function ready(page) {
    await page.waitForFunction(() => document.documentElement.dataset.cabinetView === "intro" &&
      !document.getElementById("enter-cabinet").disabled);
  }
  async function entered(page) {
    await page.waitForFunction(() => document.documentElement.dataset.cabinetView === "play");
    assert.equal(await page.locator("#arrival").isHidden(), true);
    assert.equal(await page.locator(".cabinet").evaluate(node => node.inert), false);
    assert.equal(await page.locator(".cabinet").getAttribute("data-power"), "on");
    assert.equal(await page.locator(".screen-content").evaluate(node => getComputedStyle(node).clipPath), "none");
    assert.equal(await page.locator(".screen-content").evaluate(node => node.getAnimations().length), 0);
  }
  try {
    await t.test("hover only invites; clicking approaches without starting a flight", async () => {
      const { context, page } = await open();
      await ready(page);
      assert.equal(await page.locator(".cabinet").evaluate(node => node.inert), true);
      await page.locator("#enter-cabinet").hover();
      await page.waitForTimeout(300);
      assert.equal(await page.locator("html").getAttribute("data-cabinet-view"), "intro");
      await page.locator("#arrival-cue").evaluate(node => { node.tabIndex = -1; node.focus(); });
      for (const key of ["ArrowUp", "KeyP", "KeyM"]) await page.keyboard.press(key);
      assert.equal(await page.locator("#sound").getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator("#status").textContent(), "READY WHEN YOU ARE");
      await page.waitForFunction(() => document.getElementById("arrival-scene").dataset.motion === "ready");
      await page.locator("#enter-cabinet").click();
      assert.equal(await page.locator("html").getAttribute("data-cabinet-view"), "waking");
      assert.match(await page.locator("#arrival-motion").getAttribute("src"), /approach-light-\d{2}\.webp$/);
      await page.waitForFunction(() => document.documentElement.dataset.cabinetView === "powering");
      assert.equal(await page.locator(".cabinet").getAttribute("data-power"), "warming");
      assert.equal(await page.locator(".cabinet").evaluate(node => node.inert), true);
      assert.notEqual(await page.locator(".screen-content").evaluate(node => getComputedStyle(node).clipPath), "none");
      assert.equal(await page.locator(".marquee-light").evaluate(node => node.getAnimations().length), 1);
      assert.equal(await page.locator("#skip-arrival").evaluate(node => {
        const rect = node.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
      }), true, "the power-on skip stays onscreen without scrolling");
      await page.keyboard.press("Space");
      assert.equal(await page.locator("#status").textContent(), "READY WHEN YOU ARE");
      await entered(page);
      assert.equal(await page.evaluate(() => document.activeElement.id), "screen");
      assert.equal(await page.locator("#overlay").isVisible(), true);
      assert.equal(await page.locator("#pause").isDisabled(), true);
      await page.locator("#play").click();
      assert.equal(await page.locator("#overlay").isHidden(), true);
      await page.locator("#pause").click();
      await page.reload();
      await ready(page);
      assert.equal(await page.locator(".cabinet").getAttribute("data-power"), "off");
      await page.locator("#enter-cabinet").click();
      await page.waitForFunction(() => document.documentElement.dataset.cabinetView === "powering");
      await entered(page);
      await page.goto(url + "?entry=direct");
      await entered(page);
      await page.reload();
      await entered(page);
      await context.close();
    });

    await t.test("keyboard activation, skip, reduced motion and explicit replay", async () => {
      const { context, page } = await open({ reducedMotion: "reduce" });
      await ready(page);
      assert.match(await page.locator("#arrival-cue").textContent(), /Reduced motion is on/);
      assert.equal(await page.locator("#preview-arrival-motion").isVisible(), true);
      await page.locator("#enter-cabinet").focus();
      await page.keyboard.press("Enter");
      await entered(page);
      assert.equal(await page.evaluate(() => document.getElementById("arrival").getAnimations().length), 0);
      await page.reload();
      await ready(page);
      assert.match(await page.locator("#arrival-cue").textContent(), /Reduced motion is on/);
      await page.locator("#enter-cabinet").click();
      await entered(page);
      await page.goto(url + "?entry=room");
      await ready(page);
      await page.locator("#skip-arrival").focus();
      await page.keyboard.press("Space");
      await entered(page);
      assert.equal(await page.locator("#status").textContent(), "READY WHEN YOU ARE");
      await context.close();
    });

    await t.test("reduced motion permits a deliberate, one-time camera preview", async () => {
      const { context, page } = await open({ reducedMotion: "reduce" });
      await ready(page);
      await page.locator("#preview-arrival-motion").click();
      await page.waitForFunction(() => document.documentElement.dataset.cabinetView === "waking");
      assert.equal(await page.locator("#arrival-motion").isVisible(), true);
      assert.match(await page.locator("#arrival-motion").getAttribute("src"), /approach-light-\d{2}\.webp$/);
      await page.waitForFunction(() => document.documentElement.dataset.cabinetView === "powering");
      assert.equal(await page.locator(".screen-content").evaluate(node => node.getAnimations().length), 1);
      await entered(page);
      assert.equal(await page.locator("#overlay").isVisible(), true);
      await page.goto(url + "?entry=room");
      await ready(page);
      await page.locator("#enter-cabinet").click();
      await entered(page);
      assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
      await context.close();
    });

    for (const interruption of ["skip", "resize", "reduce-motion"]) {
      await t.test(`power-on cleans up immediately on ${interruption}`, async () => {
        const { context, page } = await open({ reducedMotion: "no-preference" });
        try {
          await ready(page);
          await page.locator("#enter-cabinet").click();
          await page.waitForFunction(() => document.documentElement.dataset.cabinetView === "powering");
          if (interruption === "skip") await page.locator("#skip-arrival").click();
          else if (interruption === "resize") await page.setViewportSize({ width: 390, height: 844 });
          else await page.emulateMedia({ reducedMotion: "reduce" });
          await entered(page);
          for (const selector of [".marquee-light", ".screen-power-glow", ".screen-content"]) {
            assert.equal(await page.locator(selector).evaluate(node => node.getAnimations().length), 0);
          }
          assert.equal(await page.locator(".screen-power-glow").evaluate(node => getComputedStyle(node).opacity), "0");
          await page.locator("#play").click();
          assert.equal(await page.locator("#overlay").isHidden(), true);
          assert.equal(await page.locator(".cabinet").getAttribute("data-power"), "on");
        } finally {
          await context.close();
        }
      });
    }

    for (const action of ["wait", "skip", "timeout"]) {
      await t.test(`clicking before frames load supports ${action} without losing or restarting entry`, async () => {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", reducedMotion: "no-preference"
        });
        const page = await context.newPage();
        page.on("pageerror", error => errors.push(error.message));
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await page.route("**/approach-*.webp", async route => {
          await gate;
          await route.continue();
        });
        try {
          await page.goto(url, { waitUntil: "domcontentloaded" });
          await ready(page);
          await page.waitForFunction(() => document.getElementById("arrival-scene").dataset.motion === "loading");
          await page.locator("#enter-cabinet").click();
          assert.equal(await page.locator("html").getAttribute("data-cabinet-view"), "intro");
          assert.match(await page.locator("#arrival-cue").textContent(), /Loading the camera/);
          assert.equal(await page.locator("#arrival-cabinet").isVisible(), true);
          assert.equal(await page.locator("#enter-cabinet").isDisabled(), true);
          assert.equal(await page.locator("#skip-arrival").isEnabled(), true);
          if (action === "wait") {
            release();
            await page.waitForFunction(() => document.documentElement.dataset.cabinetView === "waking");
            const firstFrame = await page.locator("#arrival-motion").getAttribute("src");
            await page.waitForFunction(src => document.getElementById("arrival-motion").getAttribute("src") !== src, firstFrame);
            assert.equal(await page.locator("#arrival-motion").isVisible(), true);
            await entered(page);
          } else {
            if (action === "skip") await page.locator("#skip-arrival").click();
            await entered(page);
            if (action === "timeout") assert.match(await page.locator("#announcement").textContent(), /camera movement could not load/);
            release();
          }
          await page.waitForLoadState("networkidle");
          await entered(page);
          assert.equal(await page.locator("#overlay").isVisible(), true);
        } finally {
          release();
          await context.close();
        }
      });
    }

    await t.test("failed camera frames report a fallback instead of blocking entry", async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/approach-*.webp", route => route.abort());
      await page.goto(url);
      await ready(page);
      await page.waitForFunction(() => document.getElementById("arrival-scene").dataset.motion === "unavailable");
      await page.locator("#enter-cabinet").click();
      await entered(page);
      assert.match(await page.locator("#announcement").textContent(), /camera movement could not load/);
      await context.close();
    });

    await t.test("phones and portrait tablets enter directly, resizing never reopens the introduction", async () => {
      const { context, page } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await entered(page);
      await page.reload();
      await entered(page);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForTimeout(80);
      await entered(page);
      await context.close();
      const tablet = await open({ viewport: { width: 820, height: 1280 }, hasTouch: true });
      await entered(tablet.page);
      await tablet.context.close();
      const desktop = await open();
      await ready(desktop.page);
      await desktop.page.setViewportSize({ width: 390, height: 844 });
      await entered(desktop.page);
      await desktop.page.setViewportSize({ width: 1440, height: 1000 });
      await entered(desktop.page);
      await desktop.context.close();
    });

    await t.test("touch activation works on large screens without hover", async () => {
      const { context, page } = await open({ hasTouch: true, isMobile: true });
      await ready(page);
      assert.match(await page.locator("#arrival-cue").textContent(), /Tap/);
      await page.locator("#enter-cabinet").tap();
      await entered(page);
      await context.close();
    });

    await t.test("missing introduction art falls back to a playable front view", async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/intro-*.webp", route => route.abort());
      await page.goto(url);
      await entered(page);
      assert.match(await page.locator("#announcement").textContent(), /could not load/);
      await page.locator("#play").click();
      assert.equal(await page.locator("#overlay").isHidden(), true);
      await page.reload();
      await entered(page);
      await context.close();
    });

    await t.test("the unentered cabinet can reload and wake entirely offline", async () => {
      const { context, page } = await open({ serviceWorkers: "allow" });
      await ready(page);
      await page.waitForFunction(() => navigator.serviceWorker.controller &&
        document.getElementById("app-status").textContent === "Ready for offline play.");
      await context.setOffline(true);
      await page.reload();
      await ready(page);
      await page.locator("#enter-cabinet").click();
      await entered(page);
      await page.waitForFunction(() => document.querySelector(".cabinet").dataset.art === "ready");
      await page.locator("#theme-switch").click();
      await page.waitForFunction(() => document.querySelector(".cabinet").dataset.art === "ready");
      await page.locator("#play").click();
      assert.equal(await page.locator("#overlay").isHidden(), true);
      await page.reload();
      await ready(page);
      await page.locator("#enter-cabinet").click();
      await entered(page);
      await context.close();
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
