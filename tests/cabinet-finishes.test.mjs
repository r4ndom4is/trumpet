// Local asset test: render the cabinet finishes before running this file.
import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const gallery = new URL("../tools/cabinet-mockups/rendered/finish-candidates.html", import.meta.url);
const finishes = ["crimson", "seafoam", "timber", "black-amber", "airmail", "gilt"];

test("wide-screen finish gallery preserves all pairings, views and original models", { timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  await mkdir(new URL("../test-results/cabinet-finishes/", import.meta.url), { recursive: true });
  const errors = [];
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      page.on("pageerror", error => errors.push(error.message));
      page.on("requestfailed", request => errors.push(request.url() + ": " + request.failure().errorText));
      await page.goto(gallery.href);
      async function ready() {
        await page.waitForFunction(() =>
          [...document.querySelectorAll(".asset-status")].every(node => node.textContent.startsWith("720")));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      await ready();
      assert.equal(await page.locator("[data-surround='thin']").getAttribute("aria-pressed"), "true");
      for (const finish of finishes) {
        await page.locator(`[data-finish='${finish}']`).click();
        for (const pairing of ["crossed", "original"]) {
          await page.locator(`[data-pairing='${pairing}']`).click();
          for (const view of ["front", "angle"]) {
            await page.locator(`[data-view='${view}']`).click();
            await ready();
            assert.equal(await page.locator(".composition .controls").count(), 0, "physical symbols must not be overlaid twice");
            for (const environment of ["light", "dark"]) {
              const material = pairing === "original" ? environment : environment === "light" ? "dark" : "light";
              const stem = `thin-bezel/finish-${finish}-${material}-${environment}`;
              assert.equal(await page.locator(`#${environment}-full`).getAttribute("href"), `${stem}-${view}.png`);
              assert.equal(await page.locator(`#${environment}-model`).getAttribute("href"), `${stem}.blend`);
              assert.equal(await page.locator(`#${environment}-skin`).getAttribute("href"), `${stem}-hardware-front.png`);
              await access(new URL(`${stem}.blend`, gallery));
              await access(new URL(`${stem}-hardware-front.png`, gallery));
            }
          }
        }
      }
      await page.locator("[data-finish='seafoam']").click();
      await page.locator("[data-pairing='crossed']").click();
      await page.locator("[data-view='front']").click();
      await ready();
      await page.locator("[data-shortlist='light']").click();
      assert.equal(await page.locator("#shortlist-items li").count(), 1);
      await page.reload();
      await ready();
      assert.match(await page.locator("#shortlist-items").textContent(), /Seafoam.*Dark material \/ light environment/);
      await page.locator("[data-finish='seafoam']").click();
      await ready();
      await page.screenshot({ path: fileURLToPath(new URL(`../test-results/cabinet-finishes/front-${width}.png`, import.meta.url)) });
      await page.locator("[data-view='angle']").click();
      await ready();
      await page.screenshot({ path: fileURLToPath(new URL(`../test-results/cabinet-finishes/angle-${width}.png`, import.meta.url)) });
      await page.locator("[data-surround='original']").click();
      await ready();
      assert.equal(await page.locator(".composition .controls").count(), 2);
      assert.equal(await page.locator("#light-skin").isHidden(), true);
      await page.locator("#paper-toggle").uncheck();
      await page.locator("#marquee-toggle").uncheck();
      assert.equal(await page.locator("#light-composition .paper").isHidden(), true);
      assert.equal(await page.locator("#light-composition .marquee").isHidden(), true);
      await page.locator("[data-surround='thin']").click();
      await ready();
      assert.equal(await page.locator("#light-composition .paper").isHidden(), true);
      await page.locator("#reload-images").click();
      await ready();
      assert.match(await page.locator("#light-full").getAttribute("href"), /\?reload=\d+$/);
      await page.close();
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
