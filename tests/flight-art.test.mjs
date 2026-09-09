import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { chromium } from "playwright";
import { serve } from "./serve-test.mjs";

const hooks = `
  window.__art = {
    ready: flightArtReady, renderer: () => flightArt,
    start, step, pause, draw, stageTitleOpacity,
    titleAge: () => stageTime,
    stage(n) { score = n * 10; syncEnvironment(); environmentTransition = null; },
    age(n) { stageTime = n; },
    position() { bird = { y: 240, vy: 0 }; spawn = 100; },
    title(theme) { drawStageTitle(theme); },
    character(tilt) { start(); bird.vy = tilt * 1400; drawCharacter(240); },
    get state() { return state; }
  };
`;
let browser, server, url;
before(async () => {
  server = serve({ transform(file, content) {
    return file === "index.html" ? content.toString()
      .replace('data-cabinet-entry="auto"', 'data-cabinet-entry="direct"')
      .replace(/  requestAnimationFrame\(frame\);\r?\n\}\)\(\);/, hooks + "\n})();") : content;
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/trumpet/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
});
async function open(options = {}) {
  const page = await browser.newPage({ serviceWorkers: "block", ...options });
  await page.goto(url);
  await page.evaluate(() => window.__art.ready);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.flightArt), "ready");
  return page;
}

test("production embeds canonical renderers, ships all seven assets, and has no study dependency", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const block = html.split("// BEGIN GENERATED FLIGHT ART\n")[1].split("// END GENERATED FLIGHT ART")[0].trim();
  const sources = await Promise.all(["pixel-rider.js", "pixel-scenery.js", "flight-art.js"]
    .map(file => readFile(new URL("../scripts/" + file, import.meta.url), "utf8")));
  assert.equal(block, sources.map(source => source.trimEnd()).join("\n"));
  assert.doesNotMatch(block, /tools\/|tools\\|TRUMPET_PLAYABLE|testMode|\btour\b|dayRelit|TRUMPET_BACKING/);
  const worker = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const files = await readdir(new URL("../assets/flight/", import.meta.url));
  assert.equal(files.filter(file => file.endsWith(".png")).length, 7);
  for (const file of files.filter(file => file.endsWith(".png"))) {
    assert.ok(worker.includes(`"./assets/flight/${file}"`));
    const response = await fetch(url + "assets/flight/" + file);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /image\/png/);
  }
});

test("fourteen authored backgrounds are opaque, fixed-lit, reduced-motion safe, and parallax-layered", async () => {
  const page = await open();
  try {
    const result = await page.evaluate(() => {
      const { scenery } = __art.renderer(), E = TRUMPET_ENVIRONMENTS;
      const c = Object.assign(document.createElement("canvas"), { width: 448, height: 512 });
      const ctx = c.getContext("2d"), images = [], failures = [];
      for (const env of E.list) for (const theme of ["day", "night"]) {
        const options = { envId: env.id, theme, time: 0, scroll: 0, reduced: true };
        scenery.drawBackground(ctx, options);
        const original = c.toDataURL(), p = ctx.getImageData(0, 0, 448, 512).data;
        images.push(original);
        if (p.some((v, i) => i % 4 === 3 && v !== 255)) failures.push("alpha " + env.id);
        const light = [...ctx.getImageData(352, 50, 28, 28).data];
        scenery.drawBackground(ctx, { ...options, time: 150, scroll: 27000 });
        if (c.toDataURL() !== original) failures.push("reduced " + env.id);
        scenery.drawBackground(ctx, { ...options, reduced: false, time: 150, scroll: 27000 });
        const movedLight = ctx.getImageData(352, 50, 28, 28).data;
        if (light.some((v, i) => v !== movedLight[i]))
          failures.push("light " + env.id);
        if (c.toDataURL() === original) failures.push("static " + env.id);
        const offsets = [], draw = ctx.drawImage;
        ctx.drawImage = function(image, x, ...args) { offsets.push(x); return draw.call(this, image, x, ...args); };
        scenery.drawBackground(ctx, { ...options, reduced: false, scroll: 100 });
        ctx.drawImage = draw;
        for (const offset of [-6, -16, -34, -100]) if (!offsets.includes(offset)) failures.push("layer " + env.id);
        ctx.save(); ctx.translate(3, 7); ctx.globalAlpha = .42; ctx.filter = "blur(2px)";
        ctx.shadowBlur = 5; ctx.globalCompositeOperation = "xor"; ctx.imageSmoothingEnabled = true;
        for (const method of ["drawBackground", "drawObstacle", "drawForeground"]) {
          scenery[method](ctx, { ...options, x: 250, top: 150, gap: 160 });
          if (ctx.globalAlpha !== .42 || ctx.getTransform().e !== 3 || ctx.filter !== "blur(2px)" ||
              ctx.shadowBlur !== 5 || ctx.globalCompositeOperation !== "xor" || !ctx.imageSmoothingEnabled)
            failures.push("state " + method);
        }
        ctx.restore();
      }
      return { unique: new Set(images).size, failures };
    });
    assert.equal(result.unique, 14);
    assert.deepEqual(result.failures, []);
  } finally { await page.close(); }
});

test("background LRU retains four scene/theme pairs without rebuilding transition frames", async () => {
  const page = await open();
  try {
    const result = await page.evaluate(() => {
      const scenery = TRUMPET_PIXEL_SCENERY.createRenderer();
      const c = Object.assign(document.createElement("canvas"), { width: 448, height: 512 });
      const ctx = c.getContext("2d"), ids = TRUMPET_ENVIRONMENTS.list.map(env => env.id);
      const create = document.createElement;
      let canvases = 0;
      document.createElement = function(name, ...args) {
        if (name === "canvas") canvases++;
        return create.call(this, name, ...args);
      };
      const draw = (scene, theme) => scenery.drawBackground(ctx, {
        envId: ids[scene], theme, time: 0, scroll: 100
      });
      const counts = [];
      try {
        draw(0, "day"); draw(1, "day"); draw(0, "night"); draw(1, "night");
        counts.push(canvases);
        draw(0, "day"); counts.push(canvases);
        draw(2, "day"); counts.push(canvases);
        draw(0, "day"); draw(0, "night"); draw(1, "night"); counts.push(canvases);
        draw(1, "day"); counts.push(canvases);
        for (let frame = 0; frame < 100; frame++) {
          draw(0, "day"); draw(1, "day"); draw(0, "night"); draw(1, "night");
        }
        counts.push(canvases);
      } finally { document.createElement = create; }
      return counts;
    });
    assert.deepEqual(result, [24, 24, 30, 30, 36, 36]);
  } finally { await page.close(); }
});

test("all seven obstacle pairs match canonical capsules' rectangles and cast shadows only down-left", async () => {
  const page = await open();
  try {
    const result = await page.evaluate(() => {
      const { scenery } = __art.renderer(), E = TRUMPET_ENVIRONMENTS, failures = [], pictures = [];
      const c = Object.assign(document.createElement("canvas"), { width: 448, height: 512 }), ctx = c.getContext("2d");
      for (const env of E.list) for (const theme of ["day", "night"]) {
        ctx.clearRect(0, 0, 448, 512);
        scenery.drawObstacle(ctx, { envId: env.id, theme, x: 250, top: 151, gap: 158 });
        pictures.push(c.toDataURL());
        const p = ctx.getImageData(0, 0, 448, 512).data, boxes = E.hitboxes(env.obstacleId, 250, 151, 158, 468);
        let shadow = 0, shadowX = 0, left = 0, right = 0;
        for (let y = 0; y < 512; y++) for (let x = 0; x < 448; x++) {
          const alpha = p[(y * 448 + x) * 4 + 3];
          const lethal = boxes.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
          if (lethal ? alpha !== 255 : y < 468 && alpha !== 0) {
            failures.push("silhouette " + env.id); y = 512; break;
          }
          if (alpha > 0 && alpha < 255) {
            shadow++; shadowX += x;
            if (y < 476 || x > 311) failures.push("shadow " + env.id);
          }
        }
        const shaft = boxes[0];
        const luma = i => p[i] * .2126 + p[i + 1] * .7152 + p[i + 2] * .0722;
        for (let y = 4; y < 120; y++) {
          left += luma((y * 448 + shaft.x + 3) * 4);
          right += luma((y * 448 + shaft.x + shaft.w - 3) * 4);
        }
        if (right < left + 18 * 116) failures.push("lighting " + env.id);
        if (shadow < 100 || shadowX / shadow >= 283) failures.push("ground " + env.id);
      }
      return { failures, unique: new Set(pictures).size };
    });
    assert.deepEqual(result.failures, []);
    assert.equal(result.unique, 14);
  } finally { await page.close(); }
});

test("selected rider keeps its 315-degree world-space shadow, tuning and canonical origin during rotation", async () => {
  const page = await open();
  try {
    const results = await page.evaluate(() => {
      const { rider } = __art.renderer(), c = Object.assign(document.createElement("canvas"), { width: 448, height: 512 });
      const ctx = c.getContext("2d"), results = [];
      for (const tilt of [-.45, 0, .65]) {
        const calls = [], translate = ctx.translate, image = ctx.drawImage;
        ctx.translate = function(x, y) { calls.push({ x, y }); return translate.call(this, x, y); };
        ctx.drawImage = function(...args) {
          calls.push({ alpha: this.globalAlpha, filter: this.filter, transform: [this.getTransform().e, this.getTransform().f] });
          return image.apply(this, args);
        };
        rider.drawMovingRider(ctx, { x: 108, y: 210, tilt });
        ctx.translate = translate; ctx.drawImage = image;
        results.push(calls);
      }
      const origin = [], drawMoving = rider.drawMovingRider;
      rider.drawMovingRider = function(painter, options) {
        origin.push({ transform: [painter.getTransform().e, painter.getTransform().f], options });
      };
      __art.character(.2);
      rider.drawMovingRider = drawMoving;
      return { results, origin, scale: TRUMPET_HITBOX.displayScale };
    });
    for (const calls of results.results) {
      assert.deepEqual(calls[0], { x: 211, y: 425 });
      assert.equal(calls[1].alpha, .65);
      assert.equal(calls[1].filter, "blur(3px)");
      assert.deepEqual(calls[2], { x: 216, y: 420 });
      assert.equal(calls[3].filter, "none");
    }
    const [x, y] = results.origin[0].transform, offset = 8 * results.scale;
    assert.ok(Math.abs(x - (108 + offset * Math.sin(.2))) < 1e-4);
    assert.ok(Math.abs(y - (240 - offset * Math.cos(.2))) < 1e-4);
  } finally { await page.close(); }
});

test("borderless titles hold 1.8s, fade .6s, freeze on pause, and reset only on entry/restart", async () => {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const page = await open({ reducedMotion, viewport: { width: 360, height: 740 } });
    try {
      const result = await page.evaluate(() => {
        const a = __art;
        a.start(); a.stage(2); a.position();
        const opacities = [0, 1.8, 2.1, 2.4].map(age => { a.age(age); return a.stageTitleOpacity(); });
        a.age(1.2); a.pause(); a.step(1);
        const paused = a.titleAge();
        a.pause(); a.stage(2); const same = a.titleAge();
        a.stage(6); const changed = a.titleAge();
        const c = document.getElementById("game"), ctx = c.getContext("2d"), calls = [];
        const text = ctx.fillText, rect = ctx.fillRect;
        ctx.fillText = function(label, x, y) { calls.push({ label, x, y, font: this.font, color: this.fillStyle }); };
        ctx.fillRect = function() { calls.push("rect"); };
        a.title("day"); a.title("night");
        ctx.fillText = text; ctx.fillRect = rect;
        a.age(1); a.start();
        return { opacities, paused, same, changed, reset: a.titleAge(), calls, scale: c.clientWidth / 448,
          hudBottom: (document.querySelector(".scorebar").getBoundingClientRect().bottom - c.getBoundingClientRect().top) * 512 / c.getBoundingClientRect().height };
      });
      assert.deepEqual(result.opacities.map(n => Math.round(n * 10) / 10),
        reducedMotion === "reduce" ? [1, 1, 1, 0] : [1, 1, .5, 0]);
      assert.equal(result.paused, 1.2); assert.equal(result.same, 1.2);
      assert.equal(result.changed, 0); assert.equal(result.reset, 0);
      assert.equal(result.calls.length, 2);
      for (const call of result.calls) {
        assert.equal(call.label, "07 / Strait to the Point");
        assert.equal(call.x, 16); assert.ok(call.y > result.hudBottom);
        assert.ok(parseFloat(call.font.match(/([\d.]+)px/)[1]) * result.scale >= 11.99);
      }
      assert.deepEqual(result.calls.map(call => call.color), ["#243747", "#edf1df"]);
    } finally { await page.close(); }
  }
});

test("missing new art is surfaced and original gameplay remains available without clearing scores", async () => {
  const page = await browser.newPage({ serviceWorkers: "block" });
  try {
    await page.addInitScript(() => localStorage.setItem("trumpet-flight-best", "123"));
    await page.route("**/assets/flight/rider.png", route => route.abort());
    await page.goto(url);
    await page.evaluate(() => window.__art.ready);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.flightArt), "unavailable");
    assert.equal(await page.locator("#flight-art-notice").isVisible(), true);
    await page.evaluate(() => { __art.start(); __art.stage(6); __art.position(); __art.step(.01); __art.draw(); });
    assert.equal(await page.evaluate(() => __art.state), "playing");
    assert.equal(await page.evaluate(() => localStorage.getItem("trumpet-flight-best")), "123");
  } finally { await page.close(); }
});
