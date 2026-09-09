import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { serve } from "./serve-test.mjs";
import { resultPreview } from "../scripts/serve-result-preview.mjs";

test("local result alternatives preserve scores and keep retry in place", { timeout: 60000 }, async () => {
  const server = serve({ transform: resultPreview });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  await mkdir("test-results/result-options", { recursive: true });
  const errors = [];
  try {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 },
      { width: 667, height: 375 }, { width: 1440, height: 1000 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: "block", reducedMotion: "reduce" });
      try {
        await context.addInitScript(() => localStorage.setItem("trumpet-flight-best", "3"));
        const page = await context.newPage();
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/trumpet/?entry=direct&sample=1&result=world`);
        await page.waitForFunction(() => document.querySelector(".cabinet").dataset.art === "ready");
        assert.equal(await page.locator("#run-score").textContent(), "8");
        const button = await page.locator("#play").boundingBox();
        for (const variant of ["portrait", "world", "both"]) {
          await page.locator("#result-variant").selectOption(variant);
          assert.equal(await page.locator("#result-reaction").isVisible(), variant !== "world");
          assert.equal(await page.locator("#overlay").evaluate(node => getComputedStyle(node).backgroundColor),
            variant === "portrait" ? "rgb(20, 37, 44)" : "rgba(0, 0, 0, 0.64)");
          const fits = await page.locator(".run-screen").evaluate(node => {
            const bounds = node.getBoundingClientRect();
            return node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1 &&
              [...node.querySelectorAll("canvas, h2, #run-score, #run-best, #play")].filter(child => child.getClientRects().length)
                .every(child => {
                  const box = child.getBoundingClientRect();
                  return box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1 &&
                    box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
                });
          });
          assert.ok(fits, `${variant} fits at ${viewport.width}`);
          assert.ok(Math.abs((await page.locator("#play").boundingBox()).y - button.y) < 1);
          assert.equal(await page.evaluate(() => localStorage.getItem("trumpet-flight-best")), "3");
          assert.equal(await page.evaluate(() => localStorage.getItem("trumpet-flight-top10")), null);
          if (viewport.width === 390 || viewport.width === 1440) {
            await page.screenshot({ path: `test-results/result-options/${variant}-${viewport.width}.png` });
          }
        }
        assert.equal(await page.locator("#result-reaction").evaluate(canvas =>
          canvas.getContext("2d").getImageData(0, 0, 280, 208).data.some(value => value > 0)), true);
        let fixedScore;
        const scenePixels = new Map();
        for (const variant of ["zoom", "zoom-dark"]) {
          await page.locator("#result-variant").selectOption(variant);
          if (variant === "zoom-dark") {
            assert.deepEqual(await page.locator("#overlay").evaluate(node => {
              const style = getComputedStyle(node);
              return { color: style.backgroundColor, image: style.backgroundImage };
            }), { color: "rgba(0, 0, 0, 0.64)", image: "none" }, "the entire crash is dimmed evenly");
          }
          for (const position of ["middle", "sky", "ground"]) {
            await page.locator("#result-sample").selectOption(position);
            const scoreBox = await page.locator("#run-score").boundingBox();
            fixedScore ||= scoreBox;
            assert.deepEqual(scoreBox, fixedScore, "the score never moves with the crash position or darkening");
            const screenBox = await page.locator("#screen").boundingBox();
            assert.ok(scoreBox.x >= screenBox.x + screenBox.width * .52, "score is anchored on the right");
            assert.ok(scoreBox.x + scoreBox.width <= screenBox.x + screenBox.width &&
              scoreBox.y >= screenBox.y && scoreBox.y + scoreBox.height <= button.y, "score stays inside the screen above retry");
            assert.equal(await page.locator(".run-screen").evaluate(node =>
              node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1), true);
            assert.ok(Math.abs((await page.locator("#play").boundingBox()).y - button.y) < 1);
            assert.equal(await page.locator("#result-reaction").isVisible(), false);
            assert.equal(await page.locator("#result-zoom-scene").isVisible(), true);
            const snapshot = await page.locator("#result-zoom-scene").evaluate(canvas => {
              const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
              return { opaque: pixels.every((value, index) => index % 4 !== 3 || value === 255), image: canvas.toDataURL() };
            });
            assert.equal(snapshot.opaque, true, "edge-clamped camera never exposes empty pixels");
            if (variant === "zoom") scenePixels.set(position, snapshot.image);
            else assert.equal(snapshot.image, scenePixels.get(position), "darkening affects only the scrim, not the crash");
            await page.waitForTimeout(60);
            assert.equal(await page.locator("#result-zoom-scene").evaluate(canvas => canvas.toDataURL()), snapshot.image);
            assert.equal(await page.evaluate(() => localStorage.getItem("trumpet-flight-best")), "3");
            assert.equal(await page.evaluate(() => localStorage.getItem("trumpet-flight-top10")), null);
            if (viewport.width === 390 || viewport.width === 1440) {
              await page.screenshot({ path: `test-results/result-options/${variant}-${position}-${viewport.width}.png` });
            }
          }
        }
        assert.equal(new Set(scenePixels.values()).size, 3, "sky, midair and floor have distinct impact framing");
        await page.locator("#play").click();
        assert.equal(await page.locator("#overlay").isHidden(), true);
        assert.equal(await page.locator("#result-zoom-scene").isHidden(), true);
        await page.waitForFunction(() => document.querySelector(".cabinet").dataset.flightState === "over");
        assert.equal(await page.locator("#result-zoom-scene").isVisible(), true);
        assert.equal(await page.locator("#run-score").textContent(), "0");
        assert.equal(await page.evaluate(() => localStorage.getItem("trumpet-flight-best")), "3");
      } finally { await context.close(); }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
