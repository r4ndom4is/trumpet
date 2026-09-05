import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { serve } from "../scripts/serve.mjs";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const hooks = `
  window.__flight = {
    start, pause, step, draw, flap, die, tone, scoreSound, crashSound, silence,
    sound() { return { muted, count: voices.size, fading: fadingVoices.size, state: audio?.state, types: [...voices].map(v => v.kind || v.oscillator.type) }; },
    suspendAudio() { return audio.suspend(); },
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
async function waitForAsync(page, predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await page.waitForTimeout(50);
  }
  throw new Error("Timed out waiting for asynchronous service-worker state");
}

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
      assert.doesNotMatch(html, /<script\s+src=/);
      assert.doesNotMatch(html, /id="update"/);
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
        await page.waitForTimeout(60);
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

    await t.test("screen-fitting mobile arcade, modal focus and orientation preserve the full game", async () => {
      for (const installed of [false, true]) {
        const context = await browser.newContext({ serviceWorkers: "block", hasTouch: true });
        await context.addInitScript(installed => {
          window.requestAnimationFrame = () => 1;
          if (installed) Object.defineProperty(navigator, "standalone", { value: true });
        }, installed);
        const page = await context.newPage();
        for (const viewport of [
          { width: 320, height: 568 }, { width: 375, height: 667 },
          { width: 390, height: 844 }, { width: 667, height: 375 }
        ]) {
          await page.setViewportSize(viewport);
          await page.goto(fixture);
          for (const state of ["ready", "playing", "paused", "over"]) {
            await page.evaluate(state => {
              const game = window.__flight;
              if (state === "playing") game.start();
              if (state === "paused") game.pause();
              if (state === "over") { game.start(); game.scenario(464); game.die(); }
              game.draw();
            }, state);
            await page.waitForTimeout(60);
            const geometry = await page.evaluate(state => {
              const inside = selector => {
                const box = document.querySelector(selector).getBoundingClientRect();
                return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 &&
                  box.right <= innerWidth + .5 && box.bottom <= innerHeight + .5;
              };
              const selectors = ["#game", "#score", "#best", "#pause", "#sound", "#manual-open", "#theme-switch",
                ".brand", ".edition", ".compact-tagline .eyebrow"];
              if (state !== "playing") selectors.push("#play", "#title");
              if (state === "over") selectors.push("#crash-image");
              const canvas = document.getElementById("game").getBoundingClientRect();
              const brand = document.querySelector(".brand").getBoundingClientRect();
              const edition = document.querySelector(".edition").getBoundingClientRect();
              const buttons = ["sound", "theme-switch", "pause"].map(id => document.getElementById(id).getBoundingClientRect());
              const dialog = document.querySelector(".dialog");
              const button = document.getElementById("play").getBoundingClientRect();
              const dialogBox = dialog.getBoundingClientRect();
              const fontSize = selector => Number.parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
              return {
                overflow: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
                outside: selectors.filter(selector => !inside(selector)),
                ratio: canvas.width / canvas.height,
                headerSides: brand.right <= edition.left && Math.abs((brand.top + brand.height / 2) - (edition.top + edition.height / 2)) < 2,
                toolbarFits: buttons.every((box, index) => box.width >= 44 && box.height >= 44 && (index === 0 || buttons[index - 1].right <= box.left)),
                clipped: state !== "playing" && (button.bottom > dialogBox.bottom + .5 || dialog.scrollHeight > dialog.clientHeight + 1),
                intrinsic: [document.getElementById("game").width, document.getElementById("game").height],
                typography: {
                  brand: fontSize(".brand"),
                  edition: fontSize(".edition"),
                  tagline: fontSize(".compact-tagline .eyebrow"),
                  score: fontSize(".stat-number"),
                  footer: fontSize(".cabinet-footer")
                }
              };
            }, state);
            assert.equal(geometry.overflow, false, JSON.stringify({ viewport, state, installed, geometry }));
            assert.deepEqual(geometry.outside, [], JSON.stringify({ viewport, state, installed, geometry }));
            assert.equal(geometry.clipped, false, JSON.stringify({ viewport, state, installed, geometry }));
            assert.equal(geometry.headerSides, true, JSON.stringify({ viewport, geometry }));
            assert.equal(geometry.toolbarFits, true, JSON.stringify({ viewport, geometry }));
            assert.ok(geometry.typography.brand >= 18, JSON.stringify({ viewport, geometry }));
            assert.ok(geometry.typography.edition >= 9, JSON.stringify({ viewport, geometry }));
            assert.ok(geometry.typography.tagline >= 10, JSON.stringify({ viewport, geometry }));
            assert.ok(geometry.typography.score >= 26, JSON.stringify({ viewport, geometry }));
            assert.ok(geometry.typography.footer >= 9, JSON.stringify({ viewport, geometry }));
            assert.ok(Math.abs(geometry.ratio - 448 / 512) < .002);
            assert.deepEqual(geometry.intrinsic, [448, 512]);
            if (!installed && state !== "playing") await page.screenshot({ path: `test-results/fit-${viewport.width}-${state}.png` });
          }
          assert.equal(await page.locator("header #theme-switch").count(), 0);
          assert.equal(await page.locator(".tools #theme-switch").count(), 1);
          assert.equal(await page.locator("#theme-switch").innerText(), "");
          await page.evaluate(() => { window.__flight.start(); window.__flight.scenario(230); });
          const beforeControls = await page.evaluate(() => window.__flight.snapshot);
          const oldIcon = await page.locator("#theme-symbol").getAttribute("d");
          await page.locator("#theme-switch").click();
          assert.notEqual(await page.locator("#theme-symbol").getAttribute("d"), oldIcon);
          assert.equal(await page.locator("#sound").getAttribute("aria-pressed"), "false");
          assert.deepEqual(await page.evaluate(() => window.__flight.snapshot), beforeControls);
          await page.locator("#sound").click();
          await page.waitForFunction(() => document.getElementById("sound").getAttribute("aria-pressed") === "true", null, { polling: 25 });
          assert.deepEqual(await page.evaluate(() => window.__flight.snapshot), beforeControls);
          await page.locator("#sound").click();
          await page.evaluate(() => window.__flight.start());
          assert.equal(await page.locator(".edition").innerText(), "POCKET ARCADE / NO. 001");
          assert.equal(await page.locator(".compact-tagline").innerText(), "SMALL GAME. BIG ONE-MORE-TRY ENERGY.");
          await page.locator("#manual-open").click();
          assert.equal(await page.evaluate(() => window.__flight.snapshot.state), "paused");
          assert.equal(await page.locator("#manual").evaluate(dialog => dialog.open), true);
          const copy = await page.locator("#manual").innerText();
          for (const text of ["Big brass.", "Big dreams.", "A very different kind of air solo.", "take a breather",
            "Less panic. More rhythm.", "BUILT FOR THE JOY", "NO ACCOUNTS. NO QUARTERS."]) {
            assert.ok(copy.includes(text), `Manual lost ${text}`);
          }
          for (let i = 0; i < 12; i++) {
            await page.keyboard.press("Tab");
            assert.equal(await page.evaluate(() => document.getElementById("manual").contains(document.activeElement)), true);
          }
          assert.equal(await page.locator("#install").isVisible(), !installed);
          if (!installed) {
            await page.locator("#install").click();
            assert.equal(await page.locator("#install-help").isVisible(), true);
          }
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#manual").evaluate(dialog => dialog.open), false);
          assert.equal(await page.evaluate(() => document.activeElement.id), "manual-open");
          assert.equal(await page.evaluate(() => window.__flight.snapshot.state), "paused");
          await page.locator("#manual-open").click();
          await page.mouse.click(1, 1);
          assert.equal(await page.locator("#manual").evaluate(dialog => dialog.open), false);
          await page.locator("#manual-open").click();
          await page.locator("#manual-close").click();
          await page.locator("#play").click();
          assert.equal(await page.evaluate(() => window.__flight.snapshot.state), "playing");
          const before = await page.evaluate(() => window.__flight.snapshot);
          await page.setViewportSize({ width: viewport.height, height: viewport.width });
          await page.waitForTimeout(60);
          assert.deepEqual(await page.evaluate(() => window.__flight.snapshot), before);
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForTimeout(60);
        assert.equal(await page.locator(".intro-panel").isVisible(), true);
        await page.locator("#manual-open").click();
        await page.locator("#manual-close").click();
        await page.waitForFunction(() => document.querySelector("main > .intro-panel"), null, { polling: 50 });
        assert.equal(await page.locator("main > .intro-panel").isVisible(), true);
        assert.equal(await page.locator("main > .intro-panel > .eyebrow").isVisible(), true);
        assert.equal(await page.evaluate(() => {
          const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
          return ids.length === new Set(ids).size;
        }), true);
        await context.close();
      }
    });

    await t.test("explicit theme wins on reload and offline, updates canvas, and handles storage denial", async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForFunction(() => navigator.serviceWorker.controller);
      assert.equal(await page.locator("#theme-switch").getAttribute("aria-label"), "Switch to light theme");
      const darkPixel = await page.locator("#game").evaluate(canvas => [...canvas.getContext("2d").getImageData(0, 0, 1, 1).data]);
      await page.locator("#theme-switch").click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      await page.waitForTimeout(60);
      const lightPixel = await page.locator("#game").evaluate(canvas => [...canvas.getContext("2d").getImageData(0, 0, 1, 1).data]);
      assert.notDeepEqual(lightPixel, darkPixel);
      assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), "#f7f4ef");
      await page.goto(url + "?scoutTheme=dark");
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
      assert.equal(await page.locator("#theme-switch").getAttribute("aria-label"), "Switch to dark theme");
      assert.equal(await page.locator("#theme-switch").getAttribute("title"), "Switch to dark theme");
      assert.equal(await page.locator("#theme-switch").getAttribute("data-theme"), "light");
      await context.setOffline(true);
      await page.reload();
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
      await page.locator("#theme-switch").click();
      await page.reload();
      assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
      assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), "#3d3b3a");
      await context.close();
      const blocked = await browser.newContext({ colorScheme: "dark" });
      await blocked.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } }));
      const denied = await blocked.newPage();
      await denied.goto(url);
      await denied.locator("#theme-switch").click();
      assert.equal(await denied.locator("html").getAttribute("data-theme"), "light");
      assert.equal(await denied.locator("#theme-notice").isVisible(), true);
      assert.match(await denied.locator("#theme-notice").innerText(), /visit only/);
      await blocked.close();
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
      assert.equal(cacheInfo.urls.length, 9);
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

      // Refresh obtains the new coherent shell; another loaded flight never reloads.
      const second = await context.newPage();
      await second.goto(url);
      await second.locator("#play").click();
      await second.keyboard.press("KeyP");
      await second.evaluate(() => { window.keepFlight = "untouched"; });
      revision = "v2";
      failInstall = false;
      await page.evaluate(() => localStorage.setItem("trumpet-flight-best", "9"));
      await page.reload();
      await waitForAsync(page, async () => (await caches.keys()).some(key => key.endsWith(":v2")));
      await waitForAsync(page, async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg.active?.state === "activated" && !reg.waiting;
      });
      assert.equal(await second.locator("#title").innerText(), "TAKE A BREATHER");
      assert.equal(await second.evaluate(() => window.keepFlight), "untouched");
      await waitForAsync(page, async () => {
        const keys = await caches.keys();
        return keys.some(key => key.endsWith(":v2")) && !keys.some(key => key.endsWith(":v1") || key.endsWith(":broken"));
      });
      assert.equal(Number(await page.locator("#best").innerText()), 9);
      await context.setOffline(true);
      await page.reload();
      assert.equal(await page.locator("#title").innerText(), "TRUMPET FLIGHT");
      assert.equal(await page.locator("#update").count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
    });

    await t.test("real deployed v3 migrates without closing other games; future refreshes update atomically", async () => {
      const oldFiles = Object.fromEntries(["index.html", "ui.js", "pwa.js", "sw.js"].map(file =>
        [file, execFileSync("git", ["show", `440cfd9:${file}`], { encoding: "utf8" })]));
      let legacy = true, release = "v4", failNavigation = false;
      const migrationServer = serve({
        load: file => {
          if (failNavigation && file === "index.html") {
            return Promise.reject(Object.assign(new Error("Simulated missing navigation"), { code: "ENOENT" }));
          }
          return legacy && oldFiles[file] ? oldFiles[file] : readFile(new URL("../" + file, import.meta.url));
        },
        transform(file, content) {
          if (legacy) return content;
          if (file === "sw.js") return content.toString().replace(/const VERSION = "[^"]+"/, `const VERSION = "${release}"`);
          if (file === "index.html") {
            return content.toString().replace("<body>", `<body data-release="${release}">`);
          }
          return content;
        }
      });
      const migrationURL = await listen(migrationServer);
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        const page = await context.newPage();
        await page.goto(migrationURL);
        await page.waitForFunction(() => navigator.serviceWorker.controller);
        await page.evaluate(() => {
          localStorage.setItem("trumpet-flight-best", "17");
          localStorage.setItem("trumpet-flight-theme", "light");
          window.oldPage = true;
          window.oldController = navigator.serviceWorker.controller;
        });
        const other = await context.newPage();
        await other.goto(migrationURL);
        await other.locator("#play").click();
        await other.keyboard.press("KeyP");
        await other.evaluate(() => { window.preservedFlight = true; });
        legacy = false;
        // What the v3 startup registration check does on an online visit.
        await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
        await waitForAsync(page, async () => {
          const keys = await caches.keys();
          return keys.some(key => key.endsWith(":v4")) && !keys.some(key => key.endsWith(":v3")) &&
            navigator.serviceWorker.controller !== window.oldController &&
            (await navigator.serviceWorker.getRegistration()).active?.state === "activated";
        });
        assert.equal(await page.evaluate(() => window.oldPage), true);
        assert.equal(await other.evaluate(() => window.preservedFlight), true);
        assert.equal(await other.locator("#title").innerText(), "TAKE A BREATHER");
        const migrated = await page.reload();
        assert.equal(await page.locator("body").getAttribute("data-release"), "v4", JSON.stringify({
          body: (await migrated.text()).match(/<body[^>]*>/)?.[0],
          cache: await page.evaluate(async () => {
            const keys = await caches.keys();
            return Promise.all(keys.map(async key => [key, (await (await (await caches.open(key)).match(location.href))?.text())?.match(/<body[^>]*>/)?.[0]]));
          })
        }));
        assert.equal(await page.locator("#update").count(), 0);
        assert.equal(Number(await page.locator("#best").innerText()), 17);
        assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
        await page.locator("#manual-open").click();
        assert.equal(await page.locator("#manual").evaluate(dialog => dialog.open), true);
        release = "v5";
        await page.reload();
        assert.equal(await page.locator("body").getAttribute("data-release"), "v5");
        assert.equal(await page.locator("#manual").evaluate(dialog => dialog.open), false);
        await waitForAsync(page, async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          return !reg.installing && !reg.waiting && reg.active?.state === "activated";
        });
        assert.equal(await other.evaluate(() => window.preservedFlight), true);
        assert.equal(await other.locator("#title").innerText(), "TAKE A BREATHER");
        // No external runtime scripts can be served from an older cache.
        assert.equal(await page.locator("script[src]").count(), 0);
        await context.setOffline(true);
        await page.reload();
        assert.equal(await page.locator("body").getAttribute("data-release"), "v5");
        assert.equal(Number(await page.locator("#best").innerText()), 17);
        await page.locator("#play").click();
        await page.waitForFunction(() => document.getElementById("title").textContent === "ONE MORE TRY?");
        await context.setOffline(false);
        // A failed online navigation must not replace a healthy offline shell with an error page.
        failNavigation = true;
        await page.reload();
        assert.equal(await page.locator("body").getAttribute("data-release"), "v5");
      } finally { await context.close(); await close(migrationServer); }
    });

    await t.test("retro brass synthesis is gesture-gated, quiet, bounded and silenced on pause/mute", async () => {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addInitScript(() => {
        window.requestAnimationFrame = () => 1;
        const NativeAudio = window.AudioContext;
        window.audioCreated = 0;
        window.AudioContext = class extends NativeAudio {
          constructor(...args) { super(...args); window.audioCreated++; }
        };
      });
      const page = await context.newPage();
      await page.goto(fixture);
      assert.equal(await page.evaluate(() => window.audioCreated), 0);
      await page.locator("#play").click();
      assert.equal(await page.evaluate(() => window.audioCreated), 0);
      await page.locator("#sound").click();
      assert.equal(await page.evaluate(() => window.audioCreated), 1);
      assert.equal(await page.evaluate(() => window.__flight.sound().state), "running");
      const rapid = await page.evaluate(() => {
        for (let i = 0; i < 100; i++) window.__flight.flap();
        return window.__flight.sound();
      });
      assert.equal(rapid.count, 1);
      assert.ok(rapid.fading <= 1);
      assert.deepEqual(rapid.types, ["noise"]);
      await page.evaluate(() => window.__flight.scoreSound());
      assert.deepEqual(await page.evaluate(() => {
        const sound = window.__flight.sound();
        return [sound.count, sound.types];
      }), [1, ["sine"]]);
      await page.waitForFunction(() => window.__flight.sound().count === 0, null, { polling: 25, timeout: 3000 });
      assert.equal(await page.evaluate(() => window.__flight.sound().count), 0);
      await page.evaluate(() => { window.__flight.crashSound(); window.__flight.pause(); });
      assert.equal(await page.evaluate(() => window.__flight.sound().count), 0);
      await page.evaluate(() => window.__flight.start());
      await page.evaluate(() => window.__flight.suspendAudio());
      await page.locator("#screen").focus();
      await page.keyboard.press("ArrowUp");
      await page.waitForFunction(() => window.__flight.sound().state === "running", null, { polling: 25 });
      await page.locator("#sound").click();
      assert.deepEqual(await page.evaluate(() => {
        window.__flight.scoreSound(); window.__flight.crashSound();
        return [window.__flight.sound().muted, window.__flight.sound().count];
      }), [true, 0]);
      await page.locator("#sound").click();
      await page.evaluate(() => { window.__flight.crashSound(); window.dispatchEvent(new Event("blur")); });
      assert.equal(await page.evaluate(() => window.__flight.sound().count), 0);
      const synthesis = html.slice(html.indexOf("  function silence()"), html.indexOf("  async function flapSound()"));
      const rendered = await page.evaluate(async synthesis => {
        const audio = new OfflineAudioContext(1, 9600, 48000);
        Object.defineProperty(audio, "state", { get: () => "running" });
        new Function("audio", `let muted = false, brassWave = null; const voices = new Set(), fadingVoices = new Set(); ${synthesis}; tone(392, .16);`)(audio);
        const pcm = (await audio.startRendering()).getChannelData(0);
        return {
          peak: Math.max(...pcm.map(Math.abs)),
          nonzero: pcm.slice(200, 4500).some(sample => Math.abs(sample) > .001),
          silentTail: pcm.slice(8500).every(sample => Math.abs(sample) < .00001)
        };
      }, synthesis);
      assert.ok(rendered.peak > .005 && rendered.peak < .04, JSON.stringify(rendered));
      assert.equal(rendered.nonzero, true);
      assert.equal(rendered.silentTail, true);
      await context.close();
    });
  } finally {
    await browser.close();
    await close(server);
    await close(instrumented);
  }
});
