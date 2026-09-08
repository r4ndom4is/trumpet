import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { serve } from "../scripts/serve.mjs";
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
          await page.locator(`[data-option="${variant}"]`).click();
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
        await page.locator("#play").click();
        assert.equal(await page.locator("#overlay").isHidden(), true);
        await page.waitForFunction(() => document.querySelector(".cabinet").dataset.flightState === "over");
        assert.equal(await page.locator("#result-reaction").isVisible(), true);
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
