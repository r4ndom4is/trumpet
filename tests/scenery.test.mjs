import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { chromium } from "playwright";
import { serve } from "../scripts/serve.mjs";

const source = await readFile(new URL("../scripts/environments.js", import.meta.url), "utf8");
const window = {};
runInNewContext(source, { window });
const art = window.TRUMPET_ENVIRONMENTS;
const names = [
  "The Gilded Mile", "The Art of the Column", "Executive Airspace",
  "The Back Nine", "Penthouse Peril", "The Biggest Launch"
];

function recorder() {
  const calls = [], stack = [];
  return {
    calls, globalAlpha: 1, fillStyle: "", canvas: { width: 448, height: 512 },
    fillRect(x, y, w, h) { calls.push(["rect", x, y, w, h, this.fillStyle, this.globalAlpha]); },
    fillText(text, x, y) { calls.push(["text", text, x, y, this.fillStyle, this.globalAlpha]); },
    save() { stack.push({ globalAlpha: this.globalAlpha, fillStyle: this.fillStyle }); },
    restore() { Object.assign(this, stack.pop()); }
  };
}

const plain = value => JSON.parse(JSON.stringify(value));
const render = (env, options = {}) => {
  const ctx = recorder();
  const result = art.drawScene(ctx, { env, theme: "day", time: 0, scroll: 0, gaps: [], ...options });
  return { calls: ctx.calls, result: plain(result.sign) };
};

test("all six campaign names are mounted signs, not renamed environment identities", () => {
  for (const [i, env] of art.list.entries()) {
    for (const theme of ["day", "night"]) {
      const { calls, result } = render(env, { theme });
      assert.equal(result.text, names[i]);
      assert.equal(calls.filter(c => c[0] === "text").length, 1);
      assert.ok(result.y >= 350 && result.y + result.height < art.world.FLOOR);
      assert.ok(result.x >= 180 && result.x + result.width <= art.world.W);
      assert.ok(calls.filter(c => c[0] === "rect").every(c => Object.values(env.ramps[theme]).includes(c[5])));
    }
  }
  assert.equal(art.list[4].name, "Penthouse Row");
  assert.equal(art.list[3].name, "Links & Lightning");
});

test("entry landmark holds eight seconds, drifts once, and never wraps at 50+", () => {
  for (const env of art.list) {
    const entry = render(env, { stageTime: 0 }).result;
    assert.deepEqual(render(env, { stageTime: 8, scroll: 5000 }).result, entry);
    assert.equal(render(env, { stageTime: 9 }).result.x, entry.x - 12);
    assert.equal(render(env, { stageTime: 20 }).result.x, entry.x - 144);
    assert.equal(render(env, { stageTime: 60 }).result, null);
    assert.equal(render(env, { stageTime: 1000000 }).result, null);
    assert.deepEqual(render(env, { time: 5000, scroll: 90000 }).result, entry);
    assert.deepEqual(render(env, { stageTime: 1000000, reduced: true }).result, entry);
    assert.deepEqual(render(env, { stageTime: 0 }).result, entry);
  }
  for (const stageTime of [-1, Infinity, NaN, null, "4"]) {
    assert.throws(() => render(art.list[0], { stageTime }), /stageTime must be nonnegative elapsed seconds/);
  }
});

test("reduced motion freezes all scenery above the moving ground", () => {
  for (const env of art.list) {
    const scenery = options => render(env, { ...options, reduced: true }).calls
      .filter(c => c[0] === "text" || c[2] < art.world.FLOOR);
    assert.deepEqual(scenery({ time: 0, scroll: 0, stageTime: 0 }),
      scenery({ time: 73, scroll: 10950, stageTime: 73 }), env.id);
  }
  assert.ok(art.rates.clouds < art.rates.far && art.rates.far < art.rates.mid);
  assert.ok(art.rates.far <= .055 && art.rates.mid <= .12);
  assert.equal(art.rates.world, 1);
});

test("signs precede obstacles and rider; crossfade renders have no shared entry state", () => {
  const [from, to] = art.list;
  const outgoing = render(from, { stageTime: 17 }).result;
  const incoming = render(to, { stageTime: .5 }).result;
  render(to, { stageTime: 90 });
  assert.deepEqual(render(from, { stageTime: 17 }).result, outgoing);
  assert.deepEqual(render(to, { stageTime: .5 }).result, incoming);
  for (const env of art.list) {
    const ctx = recorder();
    const result = art.drawScene(ctx, {
      env, stageTime: 0, gaps: [{ x: 280, top: 150, gap: 158 }],
      rider() { ctx.calls.push(["rider"]); }
    });
    const signIndex = ctx.calls.findIndex(c => c[0] === "text");
    const obstacleIndex = ctx.calls.findIndex(c => c[0] === "rect" && c[5] === env.ramps.day["OBST-BASE"]);
    assert.ok(signIndex >= 0 && signIndex < obstacleIndex);
    assert.equal(ctx.calls.at(-1)[0], "rider");
    assert.deepEqual(plain(result.hitboxes), plain(art.hitboxes(env.obstacleId, 280, 150, 158, 468)));
  }
});

test("campaign still advances by ten cleared obstacles and never wraps stage six", () => {
  for (let score = 0; score <= 1000; score++) {
    const level = art.levelAt(score);
    assert.equal(level.level, Math.min(6, Math.floor(score / 10) + 1));
    assert.equal(level.name, names[level.level - 1]);
  }
  assert.equal(art.campaign[5].unlockAt, 50);
  assert.equal(art.campaign[5].clearAt, null);
});

test("approved obstacle pixels, decoration and collision geometry remain unchanged", () => {
  // Captured from approved main 783091b; independent of the regenerated HTML.
  const expected = "74730f88dff539c461b5c80f026c6c344a63b4901faffe9e6c6e39e6d0d83c20";
  const snapshots = [];
  for (const env of art.list) {
    for (const theme of ["day", "night"]) {
      for (const [x, top, gap] of [[0, 96, 158], [113, 174, 144], [326, 212, 132]]) {
        const ctx = recorder();
        const result = art.drawPair(ctx, { env, theme, x, top, gap, reduced: true });
        snapshots.push({ calls: ctx.calls, result });
      }
    }
  }
  assert.equal(createHash("sha256").update(JSON.stringify(snapshots)).digest("hex"), expected);
});

test("phone-size day/night contact sheets render with readable signs", { timeout: 60000 }, async () => {
  // Exercise the inline runtime without writing generated index.html in this worktree.
  const server = serve({ transform(file, content) {
    if (file !== "index.html") return content;
    return content.toString().replace(
      /\/\/ BEGIN GENERATED ENVIRONMENTS[\s\S]*?\/\/ END GENERATED ENVIRONMENTS/,
      () => `// BEGIN GENERATED ENVIRONMENTS\n${source}\n// END GENERATED ENVIRONMENTS`
    ).replace(/  requestAnimationFrame\(frame\);\r?\n\}\)\(\);/,
      "  window.__drawSceneryRider = drawTrumpet;\n})();");
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1080, height: 880 }, deviceScaleFactor: 1, serviceWorkers: "block"
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/trumpet/`);
    await page.evaluate(() => {
      document.querySelectorAll("style, link[rel=stylesheet]").forEach(node => node.remove());
      document.body.style.cssText = "margin:0;background:#151923";
      const game = document.createElement("div");
      game.hidden = true;
      game.append(...document.body.childNodes);
      const sheet = document.createElement("main");
      sheet.id = "scenery-sheet";
      sheet.style.cssText = "display:grid;grid-template-columns:repeat(3,360px)";
      document.body.append(game, sheet);
    });
    for (const theme of ["day", "night"]) {
      const measurements = await page.evaluate(theme => {
        const art = window.TRUMPET_ENVIRONMENTS, root = document.querySelector("#scenery-sheet");
        root.replaceChildren();
        return art.list.map(env => {
          const tile = document.createElement("section");
          const label = document.createElement("div");
          label.textContent = `${env.level}. ${env.levelName} / ${theme}`;
          label.style.cssText = "height:24px;color:#fff;font:12px monospace;padding-left:8px";
          const canvas = document.createElement("canvas");
          canvas.width = 448; canvas.height = 512;
          canvas.style.cssText = "width:360px;height:auto;image-rendering:pixelated;display:block";
          tile.append(label, canvas); root.append(tile);
          const ctx = canvas.getContext("2d");
          const { sign } = art.drawScene(ctx, { env, theme, time: 3, scroll: 450, stageTime: 3, gaps: [] });
          ctx.font = "bold 16px sans-serif";
          const textWidth = ctx.measureText(sign.text).width;
          return { text: sign.text, textWidth, available: sign.width - 16 };
        });
      }, theme);
      assert.equal(measurements.length, 6);
      for (const result of measurements) assert.ok(result.textWidth <= result.available, result.text);
      if (process.env.SCENERY_ARTIFACT_DIR) {
        await mkdir(process.env.SCENERY_ARTIFACT_DIR, { recursive: true });
        await page.screenshot({ path: resolve(process.env.SCENERY_ARTIFACT_DIR, `scenery-${theme}.png`), fullPage: true });
      }
      await page.evaluate(theme => {
        const art = window.TRUMPET_ENVIRONMENTS;
        document.querySelectorAll("#scenery-sheet canvas").forEach((canvas, i) => {
          const ctx = canvas.getContext("2d");
          art.drawPair(ctx, { env: art.list[i], theme, x: 312, top: 164, gap: 158 });
          window.__drawSceneryRider(ctx, 108, 250, 1, 0);
        });
      }, theme);
      if (process.env.SCENERY_ARTIFACT_DIR) {
        await page.screenshot({ path: resolve(process.env.SCENERY_ARTIFACT_DIR, `scenery-gameplay-${theme}.png`), fullPage: true });
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
