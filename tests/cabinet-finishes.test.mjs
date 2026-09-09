// Local asset test: render the cabinet finishes before running this file.
import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const gallery = new URL("../tools/cabinet-mockups/rendered/finish-comparison.html", import.meta.url);
const finishes = ["crimson", "seafoam", "timber", "black-amber", "airmail", "gilt"];

test("overview shows all 24 renders with identical finishes side by side in both settings", { timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  const overview = new URL("finish-candidates.html", gallery);
  await mkdir(new URL("../test-results/cabinet-finishes/", import.meta.url), { recursive: true });
  const errors = [];
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      page.on("pageerror", error => errors.push(error.message));
      page.on("requestfailed", request => errors.push(request.url()));
      await page.goto(overview.href);
      for (const view of ["front", "angle"]) {
        await page.locator(`[data-view='${view}']`).click();
        await page.waitForFunction(() => {
          const images = [...document.images];
          return images.length === 72 && images.every(image => image.complete && image.naturalWidth > 0);
        });
        assert.equal(await page.locator(".cabinet-row").count(), 12);
        assert.equal(await page.locator(".hardware").count(), 24);
        assert.equal(await page.locator(".status:visible").count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        for (const finish of finishes) {
          for (const material of ["light", "dark"]) {
            const row = page.locator(`#${finish}-${material}`);
            assert.equal(await row.isVisible(), true);
            const left = await row.locator("[data-environment='light'] .composition").boundingBox();
            const right = await row.locator("[data-environment='dark'] .composition").boundingBox();
            assert.ok(Math.abs(left.y - right.y) < 1, "settings must remain side by side, even on mobile");
            assert.ok(left.x + left.width <= right.x, "settings do not overlap");
            for (const environment of ["light", "dark"]) {
              const figure = row.locator(`[data-environment='${environment}']`);
              const stem = `thin-bezel/finish-${finish}-${material}-${environment}`;
              assert.equal(await figure.locator(".hardware").getAttribute("src"), `${stem}-${view}.png`);
              const paths = await figure.locator(".downloads a").evaluateAll(links => links.map(link => link.getAttribute("href")));
              for (const path of paths) await access(new URL(path, overview));
            }
          }
        }
        await page.screenshot({ path: fileURLToPath(new URL(`../test-results/cabinet-finishes/overview-${view}-${width}.png`, import.meta.url)) });
      }
      await page.locator(".jump a[href='#gilt-light']").click();
      assert.match(page.url(), /#gilt-light$/);
      await page.locator("#gilt-light details").first().locator("summary").click();
      assert.equal(await page.locator("#gilt-light .downloads").first().isVisible(), true);
      await page.close();
    }
    const page = await browser.newPage();
    await page.route("**/thin-bezel/finish-crimson-light-light-front.png", route => route.abort());
    await page.goto(overview.href);
    await page.locator("#crimson-light .status[data-error='true']").waitFor();
    assert.match(await page.locator("#crimson-light .status[data-error='true']").textContent(), /Missing cabinet/);
    await page.close();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

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
