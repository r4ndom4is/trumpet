import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { serve } from "../scripts/serve.mjs";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const hooks = `
  window.__flight = {
    start, pause, step, draw, flap, die,
    get snapshot() { return { state, bird: {...bird}, score, best, pipes: pipes.map(p => ({...p})) }; },
    scenario(y, obstacles = [], points = 0) { bird = {y, vy: 0}; pipes = obstacles; score = points; },
    tickTime(t) { time = t; },
    crop() {
      draw();
      const copy = document.createElement("canvas");
      copy.width = 280; copy.height = 180;
      const painter = copy.getContext("2d"); painter.imageSmoothingEnabled = false;
      painter.drawImage(canvas, Math.max(0, Math.min(W - 140, X - 70)),
        Math.max(0, Math.min(H - 90, bird.y - 10 - 45)), 140, 90, 0, 0, 280, 180);
      return copy.toDataURL();
    }
  };
`;
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () =>
  resolve(`http://127.0.0.1:${server.address().port}/trumpet/`)));
const close = server => new Promise(resolve => server.close(resolve));

test("Trumpet Flight: gameplay, installation, offline and safe updates", { timeout: 120000 }, async t => {
  let revision = "v1";
  let failInstall = false;
  const server = serve({ transform(file, content) {
    if (file === "sw.js") {
      let source = content.toString().replace(/const VERSION = "[^"]+"/, `const VERSION = "${revision}"`);
      if (failInstall) source = source.replace('"./", "./index.html"', '"./missing.png", "./index.html"');
      return source;
    }
    return content;
  } });
  const instrumented = serve({ transform(file, content) {
    return file === "index.html" ? content.toString().replace(/  requestAnimationFrame\(frame\);\r?\n\}\)\(\);/, hooks + "  requestAnimationFrame(frame);\n})();") : content;
  } });
  const url = await listen(server), fixture = await listen(instrumented);
  const browser = await chromium.launch();
  await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
  try {
    await t.test("local manifest, PNG dimensions and single approved renderer", async () => {
      assert.ok(!html.includes("drawBird") && !html.includes('id="theme"') && !html.includes("PIXEL FLAP"));
      assert.match(html, /D-H1-T1-V2/);
      const manifest = await (await fetch(url + "manifest.webmanifest")).json();
      for (const key of ["id", "start_url", "scope"]) assert.equal(new URL(manifest[key], url).href, url);
      assert.equal(manifest.display, "standalone");
      for (const icon of [...manifest.icons,
        { src: "icons/apple-touch-180.png", sizes: "180x180" },
        { src: "icons/favicon-32.png", sizes: "32x32" }]) {
        const response = await fetch(new URL(icon.src, url));
        assert.equal(response.status, 200);
        const png = Buffer.from(await response.arrayBuffer());
        assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
      }
      assert.equal((await fetch(new URL("../", url))).status, 404);
    });

    await t.test("real keyboard, pointer, sound, pause, theme and install instructions", async () => {
      const context = await browser.newContext({ colorScheme: "dark" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(url + "?scoutTheme=light");
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
      await page.locator("#install").click();
      assert.equal(await page.locator("#install-help").isVisible(), true);
      assert.match(await page.locator("#install-help").innerText(), /Safari/);
      await page.locator("#screen").focus();
      await page.keyboard.press("Space");
      assert.equal(await page.locator("#overlay").isHidden(), true);
      await page.keyboard.press("KeyP");
      assert.equal(await page.locator("#title").innerText(), "TAKE A BREATHER");
      await page.keyboard.press("KeyM");
      assert.equal(await page.locator("#sound").getAttribute("aria-pressed"), "true");
      await page.keyboard.press("Space");
      await page.locator("#screen").click({ position: { x: 50, y: 250 } });
      await page.waitForFunction(() => document.getElementById("title").textContent === "ONE MORE TRY?");
      assert.equal(await page.locator("#crash-shot").isVisible(), true);
      await page.screenshot({ path: "test-results/desktop-retry.png", fullPage: true });
      await page.goto(url + "?scoutTheme=dark");
      assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
      await page.goto(url + "?scoutTheme=invalid");
      assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      assert.deepEqual(errors, []);
      await context.close();
    });

    await t.test("deterministic scoring, persistence, exact frozen 2x crops and responsive retry", async () => {
      const context = await browser.newContext({ serviceWorkers: "block", reducedMotion: "reduce" });
      await context.addInitScript(() => {
        Math.random = () => .5;
        window.requestAnimationFrame = () => 1;
      });
      const page = await context.newPage();
      await page.goto(fixture);
      const score = await page.evaluate(() => {
        const game = window.__flight;
        game.start();
        for (let i = 0; i < 1600; i++) {
          if (game.snapshot.bird.y > 260) game.flap();
          game.step(1 / 120);
          if (game.snapshot.state !== "playing") throw new Error("Autopilot collided");
        }
        const result = game.snapshot.score;
        game.die();
        return result;
      });
      assert.ok(score >= 5, `Expected at least five real pipe passes, got ${score}`);
      assert.equal(await page.evaluate(() => localStorage.getItem("trumpet-flight-best")), String(score));
      await page.reload();
      assert.equal(Number(await page.locator("#best").innerText()), score);
      for (const y of [20, 240, 464]) {
        const result = await page.evaluate(y => {
          const game = window.__flight;
          game.start(); game.scenario(y);
          const expected = game.crop();
          game.die();
          const snapshot = document.getElementById("crash-image").toDataURL();
          game.tickTime(99); game.draw();
          return { expected, snapshot, later: document.getElementById("crash-image").toDataURL() };
        }, y);
        assert.equal(result.snapshot, result.expected);
        assert.equal(result.later, result.snapshot);
      }
      for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        const fits = await page.evaluate(() => {
          document.querySelector(".dialog").scrollTop = 0;
          const image = document.getElementById("crash-image").getBoundingClientRect();
          const dialog = document.querySelector(".dialog").getBoundingClientRect();
          const title = document.getElementById("title").getBoundingClientRect();
          const retry = document.getElementById("play").getBoundingClientRect();
          return document.documentElement.scrollWidth <= innerWidth && image.left >= dialog.left && image.right <= dialog.right &&
            title.top >= dialog.top && retry.bottom <= dialog.bottom;
        });
        assert.equal(fits, true);
        await page.locator("#play").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `test-results/retry-${viewport.width}.png`, fullPage: true });
      }
      await page.evaluate(() => {
        const game = window.__flight;
        game.start(); game.pause();
        const initial = game.snapshot.bird.y;
        game.step(1);
        if (game.snapshot.bird.y !== initial) throw new Error("Pause advanced physics");
        game.start(); game.scenario(100, [{ x: 100, top: 160, gap: 158, passed: false }]);
        game.step(1 / 120);
        if (game.snapshot.state !== "over") throw new Error("Pipe collision missed");
      });
      await context.close();
    });

    await t.test("storage denial stays playable with an explicit notice", async () => {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addInitScript(() => {
        Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
      });
      const page = await context.newPage();
      await page.goto(url);
      assert.match(await page.locator("#notice").innerText(), /storage is unavailable/);
      await page.locator("#play").click();
      assert.equal(await page.locator("#overlay").isHidden(), true);
      await context.close();
    });

    await t.test("touch input and reduced-motion portrait", async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForTimeout(100);
      const portrait = await page.locator("#rider-preview").evaluate(canvas => canvas.toDataURL());
      await page.waitForTimeout(150);
      assert.equal(await page.locator("#rider-preview").evaluate(canvas => canvas.toDataURL()), portrait);
      await page.screenshot({ path: "test-results/mobile-ready.png", fullPage: true });
      await page.locator("#play").tap();
      assert.equal(await page.locator("#overlay").isHidden(), true);
      await page.locator("#screen").tap({ position: { x: 40, y: 230 } });
      await page.locator("#pause").tap();
      assert.equal(await page.locator("#title").innerText(), "TAKE A BREATHER");
      await context.close();
    });

    await t.test("service worker installs all assets, supports offline reload and safe multi-window updates", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => navigator.serviceWorker.controller && document.getElementById("app-status").textContent === "Ready for offline play.");
      const cdp = await context.newCDPSession(page);
      const installability = await cdp.send("Page.getInstallabilityErrors");
      assert.deepEqual(installability.installabilityErrors, []);
      await cdp.detach();
      const cacheInfo = await page.evaluate(async () => {
        const keys = await caches.keys();
        const cache = await caches.open(keys[0]);
        return { keys, urls: (await cache.keys()).map(request => request.url) };
      });
      assert.equal(cacheInfo.urls.length, 10);
      assert.ok(cacheInfo.urls.every(asset => asset.startsWith(url)));
      await context.setOffline(true);
      await page.goto(url + "?scoutTheme=dark");
      await page.waitForFunction(() => document.getElementById("app-status").textContent === "Offline. Ready to fly.");
      await page.locator("#play").click();
      assert.equal(await page.locator("#overlay").isHidden(), true);
      await page.waitForFunction(() => document.getElementById("title").textContent === "ONE MORE TRY?");
      await context.setOffline(false);
      await page.reload();

      // A failed new precache must leave the old offline shell untouched.
      revision = "broken";
      failInstall = true;
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        window.__failedUpdate = new Promise(resolve => {
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            worker.addEventListener("statechange", () => { if (worker.state === "redundant") resolve(true); });
          }, { once: true });
        });
        await registration.update();
      });
      assert.equal(await page.evaluate(() => window.__failedUpdate), true);
      await context.setOffline(true);
      await page.reload();
      await page.waitForFunction(() => navigator.serviceWorker.controller);
      assert.equal(await page.locator("#title").innerText(), "TRUMPET FLIGHT");
      await context.setOffline(false);

      // Keep a second flight paused: no tab is allowed to force an update over it.
      const second = await context.newPage();
      await second.goto(url);
      await second.locator("#play").click();
      await second.keyboard.press("KeyP");
      const controller = await second.evaluate(() => navigator.serviceWorker.controller.scriptURL);
      revision = "v2";
      failInstall = false;
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
      await page.waitForFunction(() => !document.getElementById("update").hidden);
      await page.locator("#update").click();
      assert.match(await page.locator("#app-status").innerText(), /close every/);
      assert.equal(await second.locator("#title").innerText(), "TAKE A BREATHER");
      assert.equal(await second.locator("#update").isDisabled(), true);
      assert.equal(await second.evaluate(() => navigator.serviceWorker.controller.scriptURL), controller);
      assert.ok(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)));
      await page.evaluate(() => localStorage.setItem("trumpet-flight-best", "9"));
      await page.close();
      assert.equal(await second.locator("#title").innerText(), "TAKE A BREATHER");
      await second.goto("about:blank");
      await second.waitForTimeout(250);
      await second.goto(url);
      await second.waitForFunction(async () => {
        const keys = await caches.keys();
        return keys.some(key => key.endsWith(":v2")) && !keys.some(key => key.endsWith(":v1") || key.endsWith(":broken"));
      });
      assert.equal(Number(await second.locator("#best").innerText()), 9);
      await context.setOffline(true);
      await second.reload();
      assert.equal(await second.locator("#title").innerText(), "TRUMPET FLIGHT");
      assert.deepEqual(errors, []);
      await context.close();
    });
  } finally {
    await browser.close();
    await close(server);
    await close(instrumented);
  }
});
