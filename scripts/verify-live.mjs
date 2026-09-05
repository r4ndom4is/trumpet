import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const url = "https://r4ndom4is.github.io/trumpet/";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const response = await page.goto(url);
  assert.equal(response.status(), 200);
  const published = (await response.text()).replace(/\r\n/g, "\n");
  const source = (await readFile(new URL("../index.html", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.equal(published, source, "Published HTML must match the checkout, ignoring Git line-ending normalization");
  await page.waitForFunction(() => navigator.serviceWorker.controller && document.getElementById("app-status").textContent === "Ready for offline play.");
  const registration = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope);
  assert.equal(registration, url);
  const manifestResponse = await context.request.get(url + "manifest.webmanifest");
  assert.equal(manifestResponse.status(), 200);
  const manifest = await manifestResponse.json();
  assert.equal(new URL(manifest.start_url, url).href, url);
  assert.equal(new URL(manifest.scope, url).href, url);
  assert.equal(new URL(manifest.id, url).href, url);
  const cdp = await context.newCDPSession(page);
  assert.deepEqual((await cdp.send("Page.getInstallabilityErrors")).installabilityErrors, []);
  await cdp.detach();
  for (const icon of manifest.icons) {
    const image = await context.request.get(new URL(icon.src, url).href);
    assert.equal(image.status(), 200);
    const png = await image.body();
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
  await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
  await page.screenshot({ path: "test-results/live-mobile.png", fullPage: true });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.getElementById("app-status").textContent === "Offline. Ready to fly.");
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  await page.locator("#play").tap();
  assert.equal(await page.locator("#overlay").isHidden(), true);
  await page.waitForFunction(() => document.getElementById("title").textContent === "ONE MORE TRY?");
  assert.equal(await page.locator("#crash-shot").isVisible(), true);
  await page.screenshot({ path: "test-results/live-offline-retry.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`Live HTTPS app, matching source, manifest/icons, installability and offline gameplay verified: ${url}`);
} finally { await browser.close(); }
