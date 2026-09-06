import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { serve } from "../scripts/serve.mjs";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const hooks = `
  window.__flight = {
    start, pause, step, draw, flap, die, tone, scoreSound, crashSound, silence, action, frame,
    death() { return structuredClone(death); },
    deathPixels() {
      const saved = ctx.getImageData(0, 0, W, H);
      ctx.clearRect(0, 0, W, H);
      drawCharacter(death.y);
      const pixels = ctx.getImageData(0, 0, W, H).data;
      let bottom = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (pixels[(y * W + x) * 4 + 3]) bottom = y;
      }
      const image = canvas.toDataURL();
      ctx.putImageData(saved, 0, 0);
      return { bottom, image };
    },
    facePixels(reaction) {
      const copy = document.createElement("canvas");
      copy.width = 42; copy.height = 42;
      const painter = copy.getContext("2d");
      drawTrumpet(painter, 21, 29, 1, 0, reaction);
      return { pixels: [...painter.getImageData(0, 0, 42, 42).data], layers: [...riderLayers] };
    },
    sourceSprite() { return JSON.stringify(riderSprite); },
    dustPixels() {
      const calls = [], original = ctx.fillRect;
      ctx.fillRect = function(x, y, w, h) { calls.push({ x, y, w, h, alpha: this.globalAlpha }); };
      try { drawLandingDust(); } finally { ctx.fillRect = original; }
      return calls;
    },
    riderCapsules, riderTilt, capsuleHitsRect, pipeHitboxes,
    environment() {
      return { id: currentEnvironment().id, transition: structuredClone(environmentTransition), time, stageTime, distance, spawn };
    },
    spawnIn(seconds) { spawn = seconds; },
    stageSigns() {
      const signs = [], original = environments.drawScene;
      environments.drawScene = (painter, options) => {
        const result = original(painter, options);
        signs.push({ stageTime: options.stageTime, sign: result.sign });
        return result;
      };
      try { draw(); } finally { environments.drawScene = original; }
      return signs;
    },
    position(y, vy = 0) { bird = { y, vy }; },
    renderTrace() {
      const calls = [];
      const scene = environments.drawScene, pair = environments.drawPair, image = ctx.drawImage;
      environments.drawScene = (painter, options) => {
        calls.push({ kind: "scene", env: typeof options.env === "string" ? options.env : options.env.id,
          gaps: options.gaps, theme: options.theme, main: painter === ctx });
        return scene(painter, options);
      };
      environments.drawPair = (painter, options) => {
        calls.push({ kind: "pair", ...options, alpha: painter.globalAlpha });
        return pair(painter, options);
      };
      ctx.drawImage = function(...args) {
        if (args[0] === environmentLayer) calls.push({ kind: "blend", alpha: this.globalAlpha });
        return image.apply(this, args);
      };
      try { draw(); } finally {
        environments.drawScene = scene; environments.drawPair = pair; ctx.drawImage = image;
      }
      return calls;
    },
    collisionConfig() { return structuredClone(riderCollision); },
    riderScale() { return RIDER_SCALE; },
    notes() { return structuredClone(musicalNotes); },
    renderedRiderScales() {
      const scales = [], original = ctx.scale;
      ctx.scale = function(x, y) { scales.push([x, y]); return original.call(this, x, y); };
      try { drawCharacter(bird.y); } finally { ctx.scale = original; }
      return scales;
    },
    sound() { return { muted, count: voices.size, fading: fadingVoices.size, state: audio?.state, types: [...voices].map(v => v.kind || v.oscillator.type) }; },
    sprite() {
      return {
        id: riderSprite.id, animationId: riderSprite.animationId, width: riderSprite.w, height: riderSprite.h,
        hairPixels: riderLayers.filter(layer => layer === 1).length
      };
    },
    spriteFrame(t) {
      const previous = time;
      time = t;
      const copy = document.createElement("canvas");
      copy.width = 42; copy.height = 42;
      const painter = copy.getContext("2d");
      drawTrumpet(painter, 21, 29, 1, 0);
      time = previous;
      return copy.toDataURL();
    },
    suspendAudio() { return audio.suspend(); },
    get snapshot() { return { state, bird: {...bird}, score, best, pipes: pipes.map(p => ({...p})) }; },
    scenario(y, obstacles = [], points = 0, vy = 0) {
      bird = {y, vy}; score = points;
      syncEnvironment(); environmentTransition = null; stageTime = 0;
      pipes = obstacles.map(pipe => ({ environmentId: currentEnvironment().id, ...pipe }));
    },
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
      assert.match(html, /id: "char-e-legacy-42"/);
      assert.match(html, /animationId: "hair-wind-front-to-back"/);
      assert.match(html, /-webkit-touch-callout:\s*none/);
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
      assert.equal(await page.locator("#sound").getAttribute("aria-pressed"), "false");
      await page.keyboard.press("Space");
      await page.locator("#screen").click({ position: { x: 50, y: 250 } });
      await page.waitForFunction(() => document.getElementById("title").textContent === "ONE MORE TRY?" &&
        !document.getElementById("overlay").hidden);
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
      assert.deepEqual(await page.evaluate(() => window.__flight.sprite()), {
        id: "char-e-legacy-42",
        animationId: "hair-wind-front-to-back",
        width: 42,
        height: 42,
        hairPixels: 188
      });
      assert.equal(await page.evaluate(() => window.__flight.spriteFrame(0) === window.__flight.spriteFrame(.2)), true);
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
          const image = document.getElementById("crash-closeup").getBoundingClientRect();
          const dialog = document.querySelector(".dialog").getBoundingClientRect();
          const title = document.getElementById("title").getBoundingClientRect();
          const retry = document.getElementById("play").getBoundingClientRect();
          return document.documentElement.scrollWidth <= innerWidth && image.left >= dialog.left && image.right <= dialog.right &&
            title.top >= dialog.top && retry.bottom <= dialog.bottom &&
            document.querySelector(".dialog").scrollHeight <= document.querySelector(".dialog").clientHeight;
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

    await t.test("post-impact fall preserves the original crop and freezes gameplay until a grounded retry", async () => {
      const context = await browser.newContext({ serviceWorkers: "block", reducedMotion: "no-preference" });
      await context.addInitScript(() => {
        window.requestAnimationFrame = () => 1;
        let now = 1000;
        performance.now = () => now;
        window.advanceClock = ms => { now += ms; return now; };
      });
      const page = await context.newPage();
      await page.goto(fixture);
      for (const y of [27, 210, 455]) {
        const result = await page.evaluate(y => {
          const g = window.__flight;
          g.start();
          g.scenario(240, [{ x: 29, top: 160, gap: 158, passed: false }], 9);
          g.step(0); // Start the real 9 -> 10 scenery transition before impact.
          g.position(240); g.step(.125);
          g.position(y, 470);
          const expected = g.crop(), capsules = g.riderCapsules();
          g.die();
          const frozen = { ...g.snapshot, ...g.environment() };
          const impact = document.getElementById("crash-image").toDataURL();
          const initial = g.death(), hidden = document.getElementById("overlay").hidden;
          const samples = [];
          g.frame(performance.now());
          for (let i = 1; i <= 16; i++) {
            g.frame(window.advanceClock(50));
            samples.push({
              pose: g.death(), pixels: g.deathPixels(), frozen: { ...g.snapshot, ...g.environment() },
              image: document.getElementById("crash-image").toDataURL(),
              hidden: document.getElementById("overlay").hidden
            });
            g.die(); // Repeated collision reports must not recapture or restart the fall.
          }
          const settled = document.getElementById("game").toDataURL();
          g.frame(window.advanceClock(50));
          return {
            expected, impact, initial, hidden, frozen, samples,
            capsules, afterCapsules: g.riderCapsules(),
            settled, later: document.getElementById("game").toDataURL(),
            title: document.getElementById("title").textContent,
            saved: localStorage.getItem("trumpet-flight-best")
          };
        }, y);
        assert.equal(result.impact, result.expected, `exact impact at y=${y}`);
        assert.equal(result.hidden, true);
        assert.equal(result.initial.fromY, y);
        assert.ok(result.initial.y <= y);
        assert.equal(result.initial.tilt, .3);
        assert.equal(result.frozen.state, "over");
        assert.equal(result.frozen.score, 10);
        assert.equal(result.saved, "10");
        assert.deepEqual(result.frozen.transition, { from: "env-a-gilded-mile-16", to: "env-b-marble-forum-16", elapsed: .125, fromStageTime: .125 });
        for (const sample of result.samples) {
          assert.equal(sample.image, result.impact);
          assert.deepEqual(sample.frozen, result.frozen);
        }
        assert.ok(result.samples[4].pose.tilt > result.initial.tilt);
        assert.notEqual(result.samples[4].pose.y, result.initial.y);
        assert.ok(result.samples[8].hidden, "fall remains visible for at least 0.5 seconds");
        assert.equal(result.samples[14].hidden, false, "retry appears within 0.75 seconds");
        assert.equal(result.samples.at(-1).pose.tilt, Math.PI / 2);
        assert.equal(result.samples.at(-1).pose.y, 444, "rotated 48px sprite rests on floor 468");
        assert.equal(result.samples.at(-1).pixels.bottom, 467, "the actual sprite touches the ground without sinking");
        assert.notEqual(result.samples[4].pixels.image, result.samples.at(-1).pixels.image, "the rendered rider actually moves");
        assert.ok(result.samples.every(sample => sample.pixels.bottom < 468), "visual fall stays above ground");
        assert.deepEqual(result.afterCapsules, result.capsules, "contact snapshot never follows the visual tumble");
        assert.equal(result.settled, result.later, "landing is stationary");
        assert.equal(result.title, y === 27 ? "NEW HIGH SCORE!" : "ONE MORE TRY?");
      }
      await context.close();
    });

    await t.test("the first collision step captures before falling and commits score, record and crash audio exactly once", async () => {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addInitScript(() => { window.requestAnimationFrame = () => 1; });
      const page = await context.newPage();
      await page.goto(fixture);
      await page.locator("#play").click();
      await page.waitForFunction(() => window.__flight.sound().state === "running");
      const result = await page.evaluate(() => {
        const g = window.__flight;
        g.start(); g.scenario(26, [], 7, -310);
        const dt = 1 / 120, vy = -310 + 940 * dt, y = 26 + vy * dt;
        g.position(y, vy);
        const expected = g.crop();
        g.position(26, -310);
        let oscillators = 0, writes = 0;
        const create = AudioContext.prototype.createOscillator, set = Storage.prototype.setItem;
        AudioContext.prototype.createOscillator = function() { oscillators++; return create.call(this); };
        Storage.prototype.setItem = function(...args) {
          if (args[0] === "trumpet-flight-best") writes++;
          return set.apply(this, args);
        };
        try {
          g.step(dt);
          const impact = document.getElementById("crash-image").toDataURL();
          const atImpact = { ...g.snapshot, death: g.death(), oscillators, writes };
          for (let i = 0; i < 100; i++) { g.die(); g.step(dt); }
          g.pause(); g.draw();
          return { expected, impact, atImpact, oscillators, writes,
            after: g.snapshot, saved: localStorage.getItem("trumpet-flight-best"),
            later: document.getElementById("crash-image").toDataURL() };
        } finally {
          AudioContext.prototype.createOscillator = create;
          Storage.prototype.setItem = set;
        }
      });
      assert.equal(result.impact, result.expected, "capture uses the collision step, not the previous painted frame");
      assert.equal(result.later, result.impact);
      assert.equal(result.atImpact.state, "over");
      assert.equal(result.atImpact.death.elapsed, 0);
      assert.equal(result.atImpact.best, 7);
      assert.equal(result.saved, "7");
      assert.equal(result.atImpact.oscillators, 3, "one original three-note crash phrase");
      assert.equal(result.atImpact.writes, 1);
      assert.equal(result.oscillators, 3, "landing adds no audio or scoring sound");
      assert.equal(result.writes, 1);
      assert.deepEqual(result.after, {
        state: result.atImpact.state, bird: result.atImpact.bird, score: 7, best: 7, pipes: []
      });
      await context.close();
    });

    await t.test("comic reaction only touches face pixels; one bounded landing puff settles inside the existing hold", async () => {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addInitScript(() => { window.requestAnimationFrame = () => 1; });
      const page = await context.newPage();
      await page.goto(fixture);
      const result = await page.evaluate(() => {
        const g = window.__flight, normal = g.facePixels(false), reaction = g.facePixels(true);
        g.start(); g.scenario(210);
        const flight = g.spriteFrame(0), expected = g.crop();
        g.die();
        const raw = document.getElementById("crash-image").toDataURL();
        const styled = document.getElementById("crash-closeup").toDataURL();
        g.step(.54);
        const before = { pose: g.death(), dust: g.dustPixels() };
        g.step(.015);
        const contact = { pose: g.death(), dust: g.dustPixels() };
        g.step(.02);
        const compressed = { pose: g.death(), dust: g.dustPixels(), pixels: g.deathPixels() };
        g.die();
        g.step(.05);
        const rebound = { pose: g.death(), dust: g.dustPixels(), pixels: g.deathPixels() };
        g.step(.025); g.draw();
        const settled = { pose: g.death(), dust: g.dustPixels(), pixels: g.deathPixels() };
        const rawLater = document.getElementById("crash-image").toDataURL();
        const styledLater = document.getElementById("crash-closeup").toDataURL();
        g.start();
        return { normal, reaction, expected, raw, styled, rawLater, styledLater, before, contact, compressed, rebound,
          settled, flight, nextFlight: g.spriteFrame(0), reset: g.death(), source: g.sourceSprite(),
          closeupCleared: ![...document.getElementById("crash-closeup").getContext("2d").getImageData(0, 0, 280, 208).data].some(Boolean) };
      });
      let changed = 0, whites = 0;
      for (let i = 0; i < 42 * 42; i++) {
        const before = result.normal.pixels.slice(i * 4, i * 4 + 4);
        const after = result.reaction.pixels.slice(i * 4, i * 4 + 4);
        if (before.some((value, channel) => value !== after[channel])) {
          changed++;
          assert.equal(result.normal.layers[i], 2, "expression is confined to actual source face pixels");
          assert.equal(after[3], before[3], "reaction never adds silhouette pixels");
        }
        if (after.join() === "235,239,232,255" && i % 42 >= 21 && i % 42 <= 26 && Math.floor(i / 42) >= 12 && Math.floor(i / 42) <= 14) whites++;
      }
      assert.ok(changed >= 20 && changed <= 30, "small but legible pixel reaction, not a face replacement");
      assert.equal(whites, 13, "3x3 and 2x3 whites retain one pupil each");
      assert.equal(result.raw, result.expected);
      assert.equal(result.rawLater, result.raw);
      assert.equal(result.styledLater, result.styled);
      assert.equal(result.before.pose.landed, false);
      assert.deepEqual(result.before.dust, []);
      assert.equal(result.contact.pose.landed, true);
      assert.equal(result.contact.dust.length, 4);
      assert.deepEqual(result.compressed.pose.dust, result.contact.pose.dust, "contact emits only once");
      assert.deepEqual(result.rebound.pose.dust, result.contact.pose.dust, "repeated die does not emit again");
      assert.ok(result.compressed.pose.squash > .079 && result.compressed.pose.squash <= .08);
      assert.ok(result.rebound.pose.rebound > 1.24 && result.rebound.pose.rebound <= 1.25);
      assert.ok(result.compressed.dust[0].alpha > result.rebound.dust[0].alpha);
      assert.notEqual(result.compressed.dust[0].x, result.rebound.dust[0].x);
      for (const sample of [result.contact, result.compressed, result.rebound]) {
        assert.ok(sample.dust.every(p => p.y + p.h < 468 && p.alpha > 0 && p.alpha <= .65));
      }
      assert.ok(result.compressed.pixels.bottom < 468 && result.rebound.pixels.bottom < 467);
      assert.equal(result.settled.pose.elapsed, .65);
      assert.equal(result.settled.pose.squash, 0);
      assert.equal(result.settled.pose.rebound, 0);
      assert.deepEqual(result.settled.pose.dust, []);
      assert.deepEqual(result.settled.dust, []);
      assert.equal(result.settled.pixels.bottom, 467);
      assert.equal(result.flight, result.nextFlight);
      assert.equal(result.reset, null);
      assert.equal(result.closeupCleared, true);
      assert.equal(createHash("sha256").update(result.source).digest("hex"),
        "46b0e1e3c5298f7fcd8f91d34dcdf30668f06d5f5573088bb1bb5bcada8319dc",
        "original sprite pixels, layers, palette and animation definition remain unchanged");
      const bounds = await page.evaluate(() => {
        const g = window.__flight, samples = [];
        for (const y of [27, 210, 464]) for (const vy of [-310, 0, 470]) {
          g.start(); g.scenario(y, [], 0, vy); g.die();
          for (let i = 0; i <= 80; i++) {
            samples.push(g.deathPixels().bottom);
            g.step(1 / 120);
          }
        }
        return samples;
      });
      assert.ok(bounds.every(bottom => bottom < 468), "all tumble angles, including the first floor-impact frame, stay above ground");
      await context.close();
    });

    await t.test("larger decorative retry stays readable without scrolling on portrait and short landscape phones", async () => {
      const context = await browser.newContext({ serviceWorkers: "block", reducedMotion: "reduce" });
      await context.addInitScript(() => { window.requestAnimationFrame = () => 1; });
      const page = await context.newPage();
      await page.goto(fixture);
      await page.evaluate(() => { const g = window.__flight; g.start(); g.scenario(210, [], 100); g.die(); g.draw(); });
      for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 844 },
        { width: 568, height: 320 }, { width: 667, height: 375 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        // This fixture disables animation frames; invoke the layout's resize listener normally.
        await page.waitForTimeout(60);
        const layout = await page.evaluate(() => {
          const dialog = document.querySelector(".dialog"), image = document.getElementById("crash-closeup");
          const box = image.getBoundingClientRect(), retry = document.getElementById("play").getBoundingClientRect();
          const bounds = dialog.getBoundingClientRect();
          return { width: box.width, height: box.height, overflow: dialog.scrollHeight > dialog.clientHeight,
            fits: bounds.top >= 0 && bounds.bottom <= innerHeight && box.left >= bounds.left && box.right <= bounds.right &&
              retry.bottom <= bounds.bottom && retry.right <= bounds.right,
            pose: window.__flight.death(), dust: window.__flight.dustPixels() };
        });
        assert.equal(layout.overflow, false, JSON.stringify(viewport));
        assert.equal(layout.fits, true, JSON.stringify(viewport));
        if (viewport.width === 360 || viewport.width === 390) {
          assert.ok(layout.width >= 175 && layout.height >= 128, `enlarged close-up: ${JSON.stringify(layout)}`);
        }
        assert.equal(layout.pose.squash, 0);
        assert.equal(layout.pose.rebound, 0);
        assert.deepEqual(layout.dust, []);
      }
      await context.close();
    });

    await t.test("fall skip consumes input, guards retry, and resets all death presentation on the next run", async () => {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addInitScript(() => {
        window.requestAnimationFrame = () => 1;
        let now = 1000;
        performance.now = () => now;
        window.advanceClock = ms => { now += ms; };
      });
      const page = await context.newPage();
      await page.goto(fixture);
      for (const input of ["keyboard", "pointer"]) {
        await page.evaluate(() => { const g = window.__flight; g.start(); g.scenario(210); g.die(); window.advanceClock(600); });
        const impact = await page.locator("#crash-image").evaluate(canvas => canvas.toDataURL());
        if (input === "keyboard") await page.keyboard.press("Space");
        else await page.locator("#screen").click({ position: { x: 20, y: 20 } });
        assert.equal(await page.evaluate(() => window.__flight.snapshot.state), "over");
        assert.equal(await page.locator("#overlay").isVisible(), true);
        assert.equal(await page.locator("#crash-image").evaluate(canvas => canvas.toDataURL()), impact);
        await page.keyboard.press("Space");
        assert.equal(await page.evaluate(() => window.__flight.snapshot.state), "over");
        await page.evaluate(() => window.advanceClock(451));
        await page.locator("#play").click();
        const reset = await page.evaluate(() => ({
          death: window.__flight.death(), state: window.__flight.snapshot.state,
          pixels: [...document.getElementById("crash-image").getContext("2d").getImageData(0, 0, 280, 180).data].some(Boolean)
        }));
        assert.deepEqual(reset, { death: null, state: "playing", pixels: false });
        assert.equal(await page.locator("#overlay").isHidden(), true);
      }
      await context.close();
    });

    await t.test("reduced motion and interrupted falls go directly to a stable retry without resuming hidden motion", async () => {
      for (const reducedMotion of ["reduce", "no-preference"]) {
        const context = await browser.newContext({ serviceWorkers: "block", reducedMotion });
        await context.addInitScript(() => { window.requestAnimationFrame = () => 1; });
        const page = await context.newPage();
        await page.goto(fixture);
        for (const interrupt of ["pause", "blur", "hidden", "manual"]) {
          await page.evaluate(() => { const g = window.__flight; g.start(); g.scenario(210); g.die(); g.step(.2); g.draw(); });
          const impact = await page.locator("#crash-image").evaluate(canvas => canvas.toDataURL());
          if (reducedMotion === "reduce") assert.equal(await page.locator("#overlay").isVisible(), true);
          if (interrupt === "pause") await page.keyboard.press("KeyP");
          if (interrupt === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
          if (interrupt === "hidden") await page.evaluate(() => {
            Object.defineProperty(document, "hidden", { configurable: true, value: true });
            document.dispatchEvent(new Event("visibilitychange"));
          });
          if (interrupt === "manual") await page.locator("#manual-open").click();
          const before = await page.evaluate(() => ({
            snapshot: window.__flight.snapshot, death: window.__flight.death(),
            canvas: document.getElementById("game").toDataURL()
          }));
          await page.evaluate(() => { window.__flight.frame(1000); window.__flight.frame(6000); window.__flight.step(2); window.__flight.draw(); });
          if (interrupt === "hidden") await page.evaluate(() => {
            Object.defineProperty(document, "hidden", { configurable: true, value: false });
            document.dispatchEvent(new Event("visibilitychange"));
          });
          if (interrupt === "manual") await page.locator("#manual-close").click();
          const after = await page.evaluate(() => ({
            snapshot: window.__flight.snapshot, death: window.__flight.death(),
            canvas: document.getElementById("game").toDataURL()
          }));
          assert.deepEqual(after, before, `${reducedMotion}: ${interrupt} never resumes motion`);
          assert.equal(after.snapshot.state, "over");
          assert.equal(await page.locator("#overlay").isVisible(), true);
          assert.equal(await page.locator("#crash-image").evaluate(canvas => canvas.toDataURL()), impact);
        }
        await context.close();
      }
    });

    await t.test("approved dual capsules rotate exactly with the rider and use rounded contacts", async () => {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addInitScript(() => { window.requestAnimationFrame = () => 1; });
      const page = await context.newPage();
      await page.goto(fixture);
      const config = await page.evaluate(() => window.__flight.collisionConfig());
      const scale = await page.evaluate(() => window.__flight.riderScale());
      assert.equal(scale * 42, 48, "nominal gameplay rider width increases to 48px");
      assert.deepEqual(await page.evaluate(() => window.__flight.renderedRiderScales()), [[48 / 42, 48 / 42]],
        "actual gameplay painter uses the enlarged scale, not just the collision model");
      assert.deepEqual(config, {
        localCentre: { x: 0, y: -1 },
        capsules: [
          { x: -2, y: 1, length: 21, angle: 90, thickness: 18 },
          { x: 3, y: 12, length: 27, angle: -25, thickness: 10 }
        ]
      });
      const local = [
        { a: [-2, -10.5], b: [-2, 10.5], r: 9 },
        { a: [-9.235155124994774, 16.705346533499444], b: [15.235155124994774, 5.294653466500558], r: 5 }
      ];
      for (const [vy, tilt] of [[-310, -.16], [0, 0], [210, .15], [470, .3]]) {
        const result = await page.evaluate(vy => {
          const g = window.__flight;
          g.start(); g.scenario(210.4, [], 0, vy);
          return { tilt: g.riderTilt(), capsules: g.riderCapsules() };
        }, vy);
        assert.equal(result.tilt, tilt);
        for (let i = 0; i < 2; i++) {
          assert.equal(result.capsules[i].r, local[i].r * scale);
          for (const endpoint of ["a", "b"]) {
            const [x, studioY] = local[i][endpoint];
            // The approved fit uses the studio's -21 sprite origin; live artwork uses -29.
            const y = studioY - 8;
            assert.ok(Math.abs(result.capsules[i][endpoint].x - (108 + scale * (x * Math.cos(tilt) - y * Math.sin(tilt)))) < 1e-9);
            assert.ok(Math.abs(result.capsules[i][endpoint].y - (210 + scale * (x * Math.sin(tilt) + y * Math.cos(tilt)))) < 1e-9);
          }
        }
      }
      const frozen = await page.evaluate(() => {
        const g = window.__flight;
        g.start(); g.scenario(210, [], 0, 470);
        const playing = g.riderCapsules();
        g.pause(); const paused = g.riderCapsules();
        g.pause(); g.die();
        return { playing, paused, dead: g.riderCapsules() };
      });
      assert.deepEqual(frozen.paused, frozen.playing);
      assert.deepEqual(frozen.dead, frozen.playing);
      const contacts = await page.evaluate(() => {
        const hit = window.__flight.capsuleHitsRect;
        const box = { left: 0, right: 10, top: 0, bottom: 10 };
        return [
          hit({ a: { x: -5, y: 5 }, b: { x: 15, y: 5 }, r: 1 }, box),
          hit({ a: { x: 5, y: -5 }, b: { x: 5, y: 15 }, r: 1 }, box),
          hit({ a: { x: -5, y: -5 }, b: { x: 15, y: 15 }, r: 1 }, box),
          hit({ a: { x: -5, y: -2 }, b: { x: 15, y: -2 }, r: 1 }, box),
          hit({ a: { x: -5, y: -1 }, b: { x: 15, y: -1 }, r: 1 }, box),
          hit({ a: { x: -.8, y: -.8 }, b: { x: -.8, y: -.8 }, r: 1 }, box),
          hit({ a: { x: -.6, y: -.6 }, b: { x: -.6, y: -.6 }, r: 1 }, box),
          hit({ a: { x: 5, y: 5 }, b: { x: 5, y: 5 }, r: 1 }, box)
        ];
      });
      assert.deepEqual(contacts, [true, true, true, false, true, false, true, true]);
      await context.close();
    });

    await t.test("capsules govern ceiling, floor, pipe contact and full-clear scoring", async () => {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addInitScript(() => { window.requestAnimationFrame = () => 1; });
      const page = await context.newPage();
      await page.goto(fixture);
      const results = await page.evaluate(() => {
        const g = window.__flight;
        const run = (y, pipes = []) => {
          g.start(); g.scenario(y, pipes); g.step(0);
          return { state: g.snapshot.state, score: g.snapshot.score };
        };
        return {
          ceilingSafe: run(32), ceilingHit: run(31),
          floorSafe: run(452), floorHit: run(453),
          bodyClearance: run(192, [{ x: 100, top: 160, gap: 158, passed: false }]),
          bodyHit: run(175, [{ x: 100, top: 160, gap: 158, passed: false }]),
          trumpetHit: run(200, [{ x: 70, top: 54, gap: 158, passed: false }]),
          trumpetSafe: run(200, [{ x: 70, top: 58, gap: 158, passed: false }]),
          notFullyClear: run(200, [{ x: 30, top: 100, gap: 158, passed: false }]),
          fullyClear: run(200, [{ x: 29, top: 100, gap: 158, passed: false }])
        };
      });
      for (const key of ["ceilingSafe", "floorSafe", "bodyClearance", "trumpetSafe", "notFullyClear"]) {
        assert.deepEqual(results[key], { state: "playing", score: 0 }, key);
      }
      for (const key of ["ceilingHit", "floorHit", "bodyHit", "trumpetHit"]) {
        assert.deepEqual(results[key], { state: "over", score: 0 }, key);
      }
      assert.deepEqual(results.fullyClear, { state: "playing", score: 1 });
      await page.evaluate(() => window.__flight.step(0));
      assert.equal(await page.evaluate(() => window.__flight.snapshot.score), 1);
      await context.close();
    });

    await t.test("six production environments are embedded exactly and clamp every score threshold", async () => {
      const source = (await readFile(new URL("../scripts/environments.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n").trimEnd();
      const begin = "// BEGIN GENERATED ENVIRONMENTS", end = "// END GENERATED ENVIRONMENTS";
      const normalized = html.replace(/\r\n/g, "\n");
      assert.equal(normalized.split(begin).length, 2);
      assert.equal(normalized.split(end).length, 2);
      assert.equal(normalized.slice(normalized.indexOf(begin) + begin.length, normalized.indexOf(end)).trim(), source.trim());
      assert.doesNotMatch(html, /<script\s+[^>]*src=/i);
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addInitScript(() => { window.requestAnimationFrame = () => 1; });
      const page = await context.newPage();
      await page.goto(fixture);
      const stages = await page.evaluate(() => window.TRUMPET_ENVIRONMENTS.list.map(env => ({ id: env.id, name: env.name })));
      assert.deepEqual(stages.map(env => env.name), [
        "The Gilded Mile", "Marble Forum", "Records Room", "Links & Lightning", "Penthouse Row", "Gantry Nine"
      ]);
      assert.equal(new Set(stages.map(env => env.id)).size, 6);
      for (const [score, index] of [
        [0, 0], [9, 0], [10, 1], [19, 1], [20, 2], [29, 2], [30, 3],
        [39, 3], [40, 4], [49, 4], [50, 5], [59, 5], [60, 5], [999, 5]
      ]) {
        const result = await page.evaluate(score => {
          const api = window.TRUMPET_ENVIRONMENTS, g = window.__flight;
          g.start(); g.scenario(200, [{ x: 300, top: 100, gap: 158, passed: false }], score);
          const level = api.levelAt(score);
          return { mapped: level.environmentId, indexed: api.byId[level.environmentId].id,
            current: g.environment().id, pipe: g.snapshot.pipes[0].environmentId,
            label: document.getElementById("environment-name").textContent };
        }, score);
        assert.deepEqual(result, { mapped: stages[index].id, indexed: stages[index].id,
          current: stages[index].id, pipe: stages[index].id, label: stages[index].name }, `score ${score}`);
      }
      await context.close();
    });

    await t.test("all environment hitboxes match rounded caps and transparent pairs render distinctly in both themes", async () => {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addInitScript(() => { window.requestAnimationFrame = () => 1; });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(fixture);
      const result = await page.evaluate(() => {
        const api = window.TRUMPET_ENVIRONMENTS, g = window.__flight;
        const surface = document.createElement("canvas");
        surface.width = 448; surface.height = 512;
        const painter = surface.getContext("2d");
        const entries = api.list.map((env, index) => {
          const obstacle = { x: 200.6, top: 160.6, gap: 158, environmentId: env.id };
          g.start(); g.scenario(240, [obstacle], index * 10);
          const boxes = g.pipeHitboxes(obstacle);
          const expected = api.hitboxes(env.obstacleId, 197, 161, 158, 468);
          const renders = ["day", "night"].map(theme => {
            painter.clearRect(0, 0, 448, 512);
            api.drawPair(painter, { env, theme, x: 197, top: 161, gap: 158, reduced: true });
            const pairImage = surface.toDataURL();
            const alpha = (x, y) => painter.getImageData(x, y, 1, 1).data[3];
            const transparent = [[0, 0], [196, 150], [263, 150], [225, 240], [225, 470]].map(([x, y]) => alpha(x, y));
            const solid = [[197, 160], [262, 160], [197, 319], [262, 319], [225, 50]].map(([x, y]) => alpha(x, y));
            api.drawScene(painter, { env, theme, time: 0, scroll: 0, reduced: true, gaps: [] });
            const backgroundImage = surface.toDataURL();
            document.documentElement.dataset.theme = theme === "day" ? "light" : "dark";
            const trace = g.renderTrace();
            return { theme, pairImage, backgroundImage, transparent, solid, trace,
              gameImage: document.getElementById("game").toDataURL() };
          });
          return { id: env.id, boxes, expected, renders };
        });
        return { world: { W: api.world.W, H: api.world.H, FLOOR: api.world.FLOOR, COLLIDE: api.world.COLLIDE }, entries };
      });
      assert.deepEqual(result.world, { W: 448, H: 512, FLOOR: 468, COLLIDE: 66 });
      for (const [index, entry] of result.entries.entries()) {
        const shaft = [56, 56, 54, 56, 56, 54][index], cap = [20, 20, 18, 20, 22, 16][index];
        assert.deepEqual(entry.boxes, entry.expected, entry.id);
        assert.deepEqual(entry.boxes, [
          { x: 197 + (66 - shaft) / 2, y: 0, w: shaft, h: 161 - cap, part: "ceiling-shaft" },
          { x: 197, y: 161 - cap, w: 66, h: cap, part: "ceiling-cap" },
          { x: 197, y: 319, w: 66, h: cap, part: "floor-cap" },
          { x: 197 + (66 - shaft) / 2, y: 319 + cap, w: shaft, h: 149 - cap, part: "floor-shaft" }
        ], entry.id);
        for (const render of entry.renders) {
          assert.deepEqual(render.transparent, [0, 0, 0, 0, 0], `${entry.id} ${render.theme} transparency`);
          assert.deepEqual(render.solid, [255, 255, 255, 255, 255], `${entry.id} ${render.theme} cap footprint`);
          assert.deepEqual(render.trace.map(call => call.kind), ["scene", "pair"]);
          assert.deepEqual(render.trace[0], { kind: "scene", env: entry.id, gaps: [], theme: render.theme, main: true });
          assert.equal(render.trace[1].env, entry.id);
          assert.equal(render.trace[1].x, 197);
          assert.equal(render.trace[1].top, 161);
          assert.equal(render.trace[1].gap, 158);
          assert.equal(render.trace[1].alpha, 1);
        }
      }
      for (const key of ["pairImage", "backgroundImage", "gameImage"]) {
        assert.equal(new Set(result.entries.flatMap(entry => entry.renders.map(render => render[key]))).size, 12, key);
      }
      const contacts = await page.evaluate(() => {
        const g = window.__flight;
        return window.TRUMPET_ENVIRONMENTS.list.map((env, index) => {
          const run = (x, top) => {
            g.start(); g.scenario(200, [{ x, top, gap: 100, passed: false, environmentId: env.id }], index * 10);
            g.step(0); return g.snapshot.state;
          };
          return { id: env.id, besideShaft: run(132, 300), shaftContact: run(124, 300), capContact: run(132, 210) };
        });
      });
      for (const contact of contacts) {
        assert.equal(contact.besideShaft, "playing", `${contact.id} narrow shaft forgiveness`);
        assert.equal(contact.shaftContact, "over", `${contact.id} shaft collision`);
        assert.equal(contact.capContact, "over", `${contact.id} full-width cap collision`);
      }
      assert.deepEqual(errors, []);
      await context.close();
    });

    await t.test("real scoring changes only scenery; spawn ownership, one-second fades, pause, crash and reset stay deterministic", async () => {
      for (const reducedMotion of ["no-preference", "reduce"]) {
        const context = await browser.newContext({ serviceWorkers: "block", reducedMotion });
        await context.addInitScript(() => { Math.random = () => .5; window.requestAnimationFrame = () => 1; });
        const page = await context.newPage();
        await page.goto(fixture);
        for (const points of [9, 19, 29, 39, 49, 59, 999]) {
          const result = await page.evaluate(points => {
            const g = window.__flight, api = window.TRUMPET_ENVIRONMENTS;
            g.start();
            g.scenario(240, [
              { x: 29, top: 160, gap: 158, passed: false },
              { x: 300.6, top: 160.6, gap: 158, passed: false }
            ], points);
            const before = g.environment(), oldBoxes = g.pipeHitboxes(g.snapshot.pipes[1]);
            g.step(0);
            const scored = { ...g.snapshot, ...g.environment(), label: document.getElementById("environment-name").textContent,
              announcement: document.getElementById("announcement").textContent, trace: g.renderTrace() };
            g.tickTime(100); g.draw();
            const afterDrawing = g.environment().transition;
            g.pause(); const paused = { ...g.snapshot, ...g.environment() };
            g.step(3); g.draw();
            const afterPause = { ...g.snapshot, ...g.environment() };
            g.pause(); g.position(200); g.step(.25);
            const quarter = { ...g.environment(), trace: g.renderTrace() };
            g.spawnIn(0); g.position(240); g.step(0);
            const spawned = g.snapshot.pipes.at(-1);
            const preservedBoxes = g.pipeHitboxes({ ...g.snapshot.pipes[1], x: 300.6 });
            for (let i = 0; i < 3; i++) { g.position(200); g.step(.25); }
            const finished = g.environment().transition;
            g.start(); g.scenario(240, [{ x: 29, top: 160, gap: 158, passed: false }], points); g.step(0);
            g.position(240); g.step(.125); g.die();
            const crashed = g.environment().transition;
            g.step(2); g.draw();
            const afterCrash = g.environment().transition;
            g.start();
            return { before, scored, afterDrawing, paused, afterPause, quarter, spawned, oldBoxes, preservedBoxes,
              finished, crashed, afterCrash, reset: { ...g.snapshot, ...g.environment(), label: document.getElementById("environment-name").textContent },
              stages: api.list.map(env => ({ id: env.id, name: env.name })) };
          }, points);
          const old = result.stages[Math.min(5, Math.floor(points / 10))];
          const next = result.stages[Math.min(5, Math.floor((points + 1) / 10))];
          const transition = reducedMotion === "reduce" || old.id === next.id ? null : { from: old.id, to: next.id, elapsed: 0, fromStageTime: 0 };
          const label = `${points} -> ${points + 1} (${reducedMotion})`;
          assert.equal(result.scored.score, points + 1, label);
          assert.equal(result.scored.state, "playing", label);
          assert.equal(result.scored.id, next.id, label);
          assert.equal(result.scored.label, next.name, label);
          if (old.id !== next.id) assert.match(result.scored.announcement, new RegExp(next.name), label);
          assert.deepEqual(result.scored.pipes.map(pipe => pipe.environmentId), [old.id, old.id], label);
          assert.deepEqual(result.scored.transition, transition, label);
          assert.deepEqual(result.afterDrawing, transition, label);
          assert.deepEqual(result.afterPause, result.paused, label);
          assert.deepEqual(result.quarter.transition, transition && { ...transition, elapsed: .25, fromStageTime: .25 }, label);
          const trace = result.quarter.trace;
          assert.deepEqual(trace.filter(call => call.kind === "scene").map(call => [call.env, call.gaps]),
            transition ? [[old.id, []], [next.id, []]] : [[next.id, []]], label);
          assert.deepEqual(trace.filter(call => call.kind === "blend").map(call => call.alpha), transition ? [.25] : [], label);
          assert.ok(trace.filter(call => call.kind === "pair").every(call => call.env === old.id && call.alpha === 1), label);
          assert.equal(result.spawned.environmentId, next.id, label);
          assert.equal(result.spawned.gap, 158 - Math.min(points + 1, 24), label);
          assert.deepEqual(result.preservedBoxes, result.oldBoxes, label);
          assert.equal(result.finished, null, label);
          assert.deepEqual(result.afterCrash, result.crashed, label);
          assert.deepEqual(result.crashed, transition && { ...transition, elapsed: .125, fromStageTime: .125 }, label);
          assert.equal(result.reset.score, 0, label);
          assert.equal(result.reset.id, result.stages[0].id, label);
          assert.equal(result.reset.label, result.stages[0].name, label);
          assert.equal(result.reset.transition, null, label);
          assert.deepEqual(result.reset.pipes, [], label);
        }
        await context.close();
      }
    });

    await t.test("stage sign clocks reset at entry, retain outgoing age, and freeze on pause and impact", async () => {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addInitScript(() => { window.requestAnimationFrame = () => 1; Math.random = () => .5; });
      const page = await context.newPage();
      await page.goto(fixture);
      const result = await page.evaluate(() => {
        const g = window.__flight;
        g.start(); g.scenario(240, [], 9); g.spawnIn(100);
        for (let i = 0; i < 40; i++) { g.position(240); g.step(.25); }
        const aged = g.stageSigns();
        // Preserve the old stage age while staging a real score crossing.
        g.position(240);
        g.spawnIn(0); g.step(0);
        while (g.snapshot.score === 9 && g.snapshot.state === "playing") {
          g.position(240); g.step(1 / 120);
        }
        const entered = g.environment(), layers = g.stageSigns();
        g.pause(); g.step(.5);
        const paused = g.environment();
        g.pause(); g.die(); g.step(.75);
        const dead = g.environment();
        g.start();
        return { aged, entered, layers, paused, dead, reset: g.environment() };
      });
      assert.equal(result.aged[0].stageTime, 10);
      assert.equal(result.entered.stageTime, 0);
      assert.ok(result.entered.transition.fromStageTime > 10);
      assert.equal(result.layers[0].stageTime, result.entered.transition.fromStageTime);
      assert.equal(result.layers[1].stageTime, 0);
      assert.equal(result.layers[1].sign.text, "The Art of the Column");
      assert.deepEqual(result.paused, result.entered);
      assert.deepEqual(result.dead, result.entered);
      assert.equal(result.reset.stageTime, 0);
      await context.close();
    });

    await t.test("environment changes preserve the original speed, gap and spawn progression", async () => {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addInitScript(() => { Math.random = () => .5; window.requestAnimationFrame = () => 1; });
      const page = await context.newPage();
      await page.goto(fixture);
      for (const score of [0, 9, 10, 20, 24, 27, 30, 40, 50, 60, 999]) {
        const result = await page.evaluate(score => {
          const g = window.__flight;
          g.start(); g.scenario(240, [{ x: 350, top: 100, gap: 158, passed: false }], score);
          const distance = g.environment().distance;
          g.spawnIn(.01); g.step(.02);
          return { state: g.snapshot.state, pipes: g.snapshot.pipes, ...g.environment(), traveled: g.environment().distance - distance };
        }, score);
        const speed = 142 + Math.min(score * 2, 54);
        assert.equal(result.state, "playing");
        assert.equal(result.pipes.length, 2);
        assert.ok(Math.abs(result.pipes[0].x - (350 - speed * .02)) < 1e-9, `speed at ${score}`);
        assert.ok(Math.abs(result.traveled - speed * .02) < 1e-9);
        assert.ok(Math.abs(result.spawn - 1.64) < 1e-9, `spawn interval at ${score}`);
        assert.equal(result.pipes[1].gap, 158 - Math.min(score, 24));
        assert.equal(result.pipes[1].environmentId, result.id);
      }
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
      const selectionGuard = await page.locator(".cabinet").evaluate(cabinet => {
        const style = getComputedStyle(cabinet);
        const event = new Event("selectstart", { bubbles: true, cancelable: true });
        return {
          userSelect: style.userSelect,
          webkitUserSelect: style.webkitUserSelect,
          canceled: !cabinet.dispatchEvent(event)
        };
      });
      assert.deepEqual(selectionGuard, {
        userSelect: "none",
        webkitUserSelect: "none",
        canceled: true
      });
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
              if (state === "over") { game.start(); game.scenario(464); game.die(); game.step(.75); }
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
              if (state === "over") selectors.push("#crash-closeup");
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
          assert.equal(await page.locator("#sound").getAttribute("aria-pressed"), "true");
          assert.deepEqual(await page.evaluate(() => window.__flight.snapshot), beforeControls);
          await page.locator("#sound").click();
          await page.waitForFunction(() => document.getElementById("sound").getAttribute("aria-pressed") === "false", null, { polling: 25 });
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
      const offlineResponse = await page.goto(url + "?scoutTheme=dark");
      assert.equal((await offlineResponse.text()).replace(/\r\n/g, "\n"), html.replace(/\r\n/g, "\n"));
      await page.waitForFunction(() => document.getElementById("app-status").textContent === "Offline. Ready to fly.");
      assert.equal(await page.evaluate(() => {
        const api = window.TRUMPET_ENVIRONMENTS;
        const surface = document.createElement("canvas");
        surface.width = api.world.W; surface.height = api.world.H;
        const painter = surface.getContext("2d");
        const images = api.list.flatMap(env => ["day", "night"].map(theme => {
          api.drawScene(painter, { env, theme, time: 0, scroll: 0, reduced: true, gaps: [] });
          api.drawPair(painter, { env, theme, x: 200, top: 160, gap: 158, reduced: true });
          return surface.toDataURL();
        }));
        return new Set(images).size;
      }), 12, "all six environment backgrounds and obstacles remain usable offline");
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

    await t.test("musical notes leave the bell, drift independently, and freeze with gameplay", async () => {
      for (const reducedMotion of ["no-preference", "reduce"]) {
        const context = await browser.newContext({ serviceWorkers: "block", reducedMotion });
        await context.addInitScript(() => { window.requestAnimationFrame = () => 1; });
        const page = await context.newPage();
        await page.goto(fixture);
        const result = await page.evaluate(() => {
          const g = window.__flight;
          g.start(); g.scenario(210);
          for (let i = 0; i < 30; i++) { g.position(210); g.step(1 / 120); }
          const emitted = g.notes();
          g.position(290); g.step(1 / 120);
          const moved = g.notes();
          g.pause(); g.step(.1); g.draw(); const paused = g.notes();
          g.pause(); g.die(); g.step(.3); g.draw(); const crashed = g.notes();
          g.start(); const reset = g.notes();
          let maxCount = 0;
          for (let i = 0; i < 1200; i++) {
            g.position(210); g.scenario(210); g.step(1 / 120);
            maxCount = Math.max(maxCount, g.notes().length);
          }
          return { emitted, moved, paused, crashed, reset, maxCount, aged: g.notes() };
        });
        if (reducedMotion === "reduce") {
          assert.deepEqual(result.emitted, []);
          assert.equal(result.maxCount, 0);
        } else {
          assert.equal(result.emitted.length, 1);
          const a = result.emitted[0], b = result.moved[0];
          assert.ok(a.x > 108 + 21 * 48 / 42, "note is emitted outside the trumpet bell");
          assert.ok(Math.abs(b.x - a.x - a.vx / 120) < 1e-9);
          assert.ok(Math.abs(b.y - a.y - a.vy / 120) < 1e-9, "note does not jump with the rider");
          assert.deepEqual(result.paused, result.moved);
          assert.deepEqual(result.crashed, result.moved);
          assert.ok(result.maxCount <= 4, "short trail remains bounded");
          assert.ok(result.aged.every(note => note.age < .72), "old notes expire rather than wrap");
        }
        assert.deepEqual(result.reset, []);
        await context.close();
      }
    });

    await t.test("default-on sound can be muted before play and audio failures do not block gameplay", async () => {
      for (const mode of ["muted", "unsupported", "resume-fails"]) {
        const context = await browser.newContext({ serviceWorkers: "block" });
        await context.addInitScript(mode => {
          window.requestAnimationFrame = () => 1;
          const NativeAudio = window.AudioContext;
          window.audioCreated = 0;
          if (mode === "unsupported") {
            window.AudioContext = undefined; window.webkitAudioContext = undefined;
          } else {
            window.AudioContext = class extends NativeAudio {
              constructor(...args) { super(...args); window.audioCreated++; }
              get state() { return mode === "resume-fails" ? "suspended" : super.state; }
              resume() { return mode === "resume-fails" ? Promise.reject(new Error("Audio unavailable in test")) : super.resume(); }
            };
          }
        }, mode);
        const page = await context.newPage();
        await page.goto(fixture);
        if (mode === "muted") await page.locator("#sound").click();
        await page.locator("#play").click();
        assert.equal(await page.evaluate(() => window.__flight.snapshot.state), "playing");
        if (mode === "muted") {
          assert.equal(await page.evaluate(() => window.audioCreated), 0);
          assert.equal(await page.locator("#sound").getAttribute("aria-pressed"), "false");
          await page.locator("#sound").click();
          await page.waitForFunction(() => window.__flight.sound().state === "running");
          assert.equal(await page.evaluate(() => window.audioCreated), 1);
        } else {
          await page.waitForFunction(() => !document.getElementById("notice").hidden);
          assert.match(await page.locator("#notice").innerText(), mode === "unsupported" ? /does not support/ : /could not start/);
        }
        await context.close();
      }
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
      assert.equal(await page.evaluate(() => window.__flight.spriteFrame(0) === window.__flight.spriteFrame(.2)), false);
      assert.equal(await page.evaluate(() => window.audioCreated), 0);
      assert.equal(await page.locator("#sound").getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator("#sound").getAttribute("aria-label"), "Mute sound");
      await page.locator("#play").click();
      await page.waitForFunction(() => window.__flight.sound().state === "running");
      assert.equal(await page.evaluate(() => window.audioCreated), 1);
      assert.equal(await page.evaluate(() => window.__flight.sound().state), "running");
      const scoringSounds = await page.evaluate(() => [8, 9, 19, 29, 39, 49, 59].map(points => {
        const g = window.__flight;
        g.start(); g.scenario(240, [{ x: 29, top: 160, gap: 158, passed: false }], points); g.step(0);
        return { count: g.sound().count, types: g.sound().types };
      }));
      assert.deepEqual(scoringSounds, Array.from({ length: 7 }, () => ({ count: 2, types: ["sine", "sine"] })),
        "stage unlocks must not add sounds to the original two-note score cue");
      const rapid = await page.evaluate(() => {
        for (let i = 0; i < 100; i++) window.__flight.flap();
        return window.__flight.sound();
      });
      assert.equal(rapid.count, 2);
      assert.ok(rapid.fading <= 2);
      assert.deepEqual(rapid.types, ["custom", "custom"]);
      await page.evaluate(() => window.__flight.scoreSound());
      assert.deepEqual(await page.evaluate(() => {
        const sound = window.__flight.sound();
        return [sound.count, sound.types];
      }), [2, ["sine", "sine"]]);
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
