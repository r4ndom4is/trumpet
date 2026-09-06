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
  "Gilt Trip", "West Wing It", "File Another Day",
  "Fore More Years", "Roofless Ambition", "Space Force One"
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

test("all six approved names match mounted signs and environment display names", () => {
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
  assert.deepEqual(plain(art.list.map(env => env.name)), names);
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

test("four retained obstacle sets keep their approved pixels, decoration and collision", () => {
  // Stages 1, 4, 5, 6 from main 21fc6bd, not a blessing of the replacement artwork.
  const expected = "8fb85e5e0ee1fa0307318d67bbc1d15353bdbc3973b28989d74c90d008c61f3d";
  const snapshots = [];
  for (const env of [art.list[0], ...art.list.slice(3)]) {
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

test("replacement columns and paperwork fill exactly the original stepped collision envelope", () => {
  const inside = (x, y, box) => x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
  for (const index of [1, 2]) for (const theme of ["day", "night"]) {
    const env = art.list[index], sw = index === 1 ? 56 : 54, ch = index === 1 ? 20 : 18;
    for (const [x, top, gap] of [[0, 96, 158], [113, 174, 144], [326, 212, 132], [100, 20, 428]]) {
      const ctx = recorder();
      const result = art.drawPair(ctx, { env, theme, x, top, gap, reduced: true });
      assert.deepEqual(plain(result.decor), [], "no non-lethal paper tabs or stone chips");
      const expected = [
        { x: x + (66 - sw) / 2, y: 0, w: sw, h: top - ch, part: "ceiling-shaft" },
        { x, y: top - ch, w: 66, h: ch, part: "ceiling-cap" },
        { x, y: top + gap, w: 66, h: ch, part: "floor-cap" },
        { x: x + (66 - sw) / 2, y: top + gap + ch, w: sw, h: 468 - top - gap - ch, part: "floor-shaft" }
      ].filter(box => box.h > 0);
      assert.deepEqual(plain(result.hitboxes), expected);
      const coverage = new Uint8Array(448 * 512);
      for (const [, rx, ry, rw, rh, , alpha] of ctx.calls) {
        assert.ok(rx >= x && rx + rw <= x + 66 && ry >= 0 && ry + rh <= 468);
        for (let py = ry; py < ry + rh; py++) for (let px = rx; px < rx + rw; px++) {
          assert.ok(expected.some(box => inside(px, py, box)), `paint outside hitbox: ${env.id} ${px},${py}`);
          if (alpha === 1) coverage[py * 448 + px] = 1;
        }
      }
      for (let py = 0; py < 512; py++) for (let px = x; px < x + 66; px++) {
        assert.equal(coverage[py * 448 + px], Number(expected.some(box => inside(px, py, box))),
          `${env.id} ${theme} pixel ${px},${py}`);
      }
    }
  }
});

test("paperwork has page seams, inset folder tabs and archive-box labels, including the cap", () => {
  const env = art.list[2];
  assert.equal(env.id, "env-c-executive-atrium-16");
  assert.equal(env.obstacleId, "obst-elevator-pylon-66");
  assert.equal(env.obstacleName, "Paperwork stack");
  assert.doesNotMatch([env.name, env.levelName, env.premise, env.obstacleNote].join(" "), /mirrored|machined|pylon|flange|bolt/);
  for (const theme of ["day", "night"]) {
    const ctx = recorder(), P = env.ramps[theme];
    art.drawPair(ctx, { env, theme, x: 100, top: 174, gap: 144 });
    const has = (x, y, w, h, slot) => ctx.calls.some(c =>
      c[1] === x && c[2] === y && c[3] === w && c[4] === h && c[5] === P[slot]);
    assert.ok(has(109, 5, 48, 1, "OBST-SHADE"), "page edges across the paper bundle");
    assert.ok(has(119, 46, 25, 12, "OBST-LIT"), "large label in a cardboard box");
    assert.ok(has(112, 27, 15, 3, "TRIM"), "tab inside shaft, not a lethal protrusion");
    assert.ok(has(100, 159, 66, 13, "OBST-LIT"), "cap is pages, not a stone collar");
    assert.ok(has(108, 157, 17, 4, "TRIM"), "folder tab on the outward cover");
  }
});

test("scene identities live in architecture and grounds, independently of one-pass signs", () => {
  const [dc, records, golf] = art.list.slice(1, 4);
  assert.deepEqual([dc.id, records.id, golf.id], [
    "env-b-marble-forum-16", "env-c-executive-atrium-16", "env-d-links-and-lightning-16"
  ]);
  for (const theme of ["day", "night"]) {
    const rects = env => render(env, { theme, scroll: 0, stageTime: 60 }).calls.filter(c => c[0] === "rect");
    const dcRects = rects(dc), files = rects(records), club = rects(golf);
    const has = (calls, width, height, color) => calls.some(c => c[3] === width && c[4] === height && c[5] === color);
    assert.ok(has(dcRects, 184, 102, dc.ramps[theme]["FAR-1"]), "central residence");
    assert.ok(has(dcRects, 106, 49, dc.ramps[theme]["FAR-1"]), "attached wings");
    assert.ok(has(dcRects, 9, 58, dc.ramps[theme]["SKY-GLOW"]), "columns carry the pediment");
    assert.ok(has(dcRects, 235, 49, dc.ramps[theme]["FAR-1"]), "supporting executive wing between hero views");
    assert.ok(has(dcRects, 2, 30, dc.ramps[theme]["MID-2"]), "iron fence rooted at the lawn");
    assert.ok(has(files, 166, 134, records.ramps[theme]["FAR-2"]), "three-tier archive shelving");
    assert.ok(has(files, 16, 8, records.ramps[theme]["SKY-LO"]), "legible boxed-file labels");
    assert.ok(has(club, 302, 70, golf.ramps[theme]["FAR-1"]), "broad cream clubhouse");
    assert.ok(has(club, 47, 110, golf.ramps[theme]["FAR-1"]), "offset belvedere tower");
    assert.ok(has(club, 23, 32, golf.ramps[theme]["MID-2"]), "shaded arcades");
    assert.ok(has(club, 192, 45, golf.ramps[theme]["FAR-1"]), "guest wing between hero views");
    assert.ok(has(club, 2, 37, golf.ramps[theme]["MID-2"]), "flag on the putting green");
    for (const env of [dc, records, golf]) {
      const speed = 142 + Math.min((env.level - 1) * 20, 54);
      const boundary = env === dc ? 1102 / (speed * .054) :
        env === records ? 398 / (speed * .055) : 1095 / (speed * .055);
      for (const seconds of [0, 15, 45, 60, boundary - .1, boundary + .1, 120]) {
        const frame = render(env, { theme, scroll: seconds * speed, stageTime: seconds });
        if (seconds >= 45) assert.equal(frame.result, null);
        // Long estate loops always retain visible architecture, not just offscreen calls.
        assert.ok(frame.calls.some(c => c[0] === "rect" && c[1] < 448 && c[1] + c[3] > 0 &&
          c[2] >= 250 && c[2] < 400 && c[3] >= 90 && c[4] >= 40 &&
          [env.ramps[theme]["FAR-1"], env.ramps[theme]["FAR-2"]].includes(c[5])), `${env.id} at ${seconds}s`);
      }
    }
  }
});

test("sky transitions are broad tonal bands, not checkerboards", () => {
  for (const env of art.list) {
    const calls = render(env, { scroll: 0, stageTime: 60 }).calls;
    const bands = calls.filter(c => c[0] === "rect" && c[2] >= 168 && c[2] < 204);
    assert.ok(bands.every(c => c[1] === 0 && c[3] === 448));
    assert.ok(calls.length < 2500, "restrained background draw count");
  }
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
          window.__drawSceneryRider(ctx, 108, 250, 48 / 42, 0);
        });
      }, theme);
      if (process.env.SCENERY_ARTIFACT_DIR) {
        await page.screenshot({ path: resolve(process.env.SCENERY_ARTIFACT_DIR, `scenery-gameplay-${theme}.png`), fullPage: true });
      }
      const seams = await page.evaluate(theme => {
        const art = window.TRUMPET_ENVIRONMENTS, canvas = document.createElement("canvas");
        canvas.width = 448; canvas.height = 512;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        return [[1, 1102 / .054], [2, 398 / .055], [3, 1095 / .055]].map(([index, boundary]) => {
          const sample = scroll => {
            art.drawScene(ctx, { env: art.list[index], theme, time: 120, stageTime: 120, scroll, gaps: [] });
            return ctx.getImageData(0, 250, 448, 218).data;
          };
          const before = sample(boundary - 1), after = sample(boundary + 1);
          let changed = 0;
          for (let i = 0; i < before.length; i += 4) {
            if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) changed++;
          }
          return { env: art.list[index].id, fraction: changed / (448 * 218) };
        });
      }, theme);
      for (const seam of seams) assert.ok(seam.fraction < .035,
        `${seam.env} ${theme}: long scenery loop must scroll through, not pop (${seam.fraction})`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
