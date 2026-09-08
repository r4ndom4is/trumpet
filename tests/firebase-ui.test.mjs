import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { serve } from "../scripts/serve.mjs";

test("Generated cabinet UI publishes through the real Firebase adapter and emulator rules", { timeout: 120000 }, async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(host, "Run through npm run test:firebase; this test never uses a real project.");
  const emulator = new URL(`http://${host}`);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(emulator.hostname));
  const projectId = "demo-trumpet-flight";
  const cleared = await fetch(`${emulator.origin}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: "DELETE"
  });
  assert.ok(cleared.ok, "The local Firestore emulator must be available.");

  let enabled = false;
  const server = serve({ transform(file, content) {
    if (file !== "index.html") return content;
    let html = content.toString().replace('data-cabinet-entry="auto"', 'data-cabinet-entry="direct"')
      .replace(/  requestAnimationFrame\(frame\);\r?\n\}\)\(\);/,
        "  window.__finishScore = value => { score = value; state = 'playing'; die(); finishDeath(); };\n})();");
    if (enabled) html = html.replace(/\/\/ BEGIN GENERATED FIREBASE CONFIG[\s\S]*?\/\/ END GENERATED FIREBASE CONFIG/,
      () => "// BEGIN GENERATED FIREBASE CONFIG\nwindow.TRUMPET_FIREBASE = " + JSON.stringify({
        enabled: true, apiKey: "demo-key", authDomain: `${projectId}.firebaseapp.com`,
        projectId, appId: projectId, emulators: true
      }) + ";\n// END GENERATED FIREBASE CONFIG");
    return html;
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  const errors = [], requests = [], external = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      external.push(url.href);
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}/trumpet/`;
  try {
    await page.goto(url);
    assert.equal(await page.evaluate(() => window.TRUMPET_GLOBAL_SCORES.enabled), false);
    await page.evaluate(() => window.__finishScore(7));
    await page.locator("#leaderboard-open").click();
    assert.deepEqual(await page.locator("#leaderboard-list strong").allTextContents(), ["7"]);
    await page.locator("#scores-daily").click();
    assert.match(await page.locator("#leaderboard-empty").textContent(), /not connected/);
    assert.equal(requests.some(value => /:8080|:9099|googleapis|firebaseio/.test(value)), false,
      "The generated disabled SDK does not initialize Firebase or send score requests.");

    enabled = true;
    await page.reload();
    await page.evaluate(() => window.__finishScore(25));
    assert.equal(requests.some(value => /:8080|:9099/.test(value)), false,
      "Completing a flight does not automatically read or publish global scores.");
    await page.locator("#score-submit-open").click();
    await page.locator("#leaderboard-enter").click();
    assert.equal(requests.some(value => /accounts:signUp/.test(value)), false,
      "A guest identity is created only by deliberate publication.");
    await page.locator("#leaderboard-name").fill("ace");
    await page.locator("#leaderboard-publish").click();
    await page.waitForFunction(() => document.querySelector("#leaderboard-entry").hidden &&
      document.querySelector("#leaderboard-status").textContent.includes("both boards"));
    assert.deepEqual(await page.locator("#leaderboard-list strong").allTextContents(), ["25"]);
    assert.equal(await page.locator("#leaderboard-list li").getAttribute("data-you"), "true");
    const first = await page.evaluate(() => window.TRUMPET_GLOBAL_SCORES.read());
    assert.ok(first.uid);
    assert.deepEqual(first.daily.order, [first.uid]);
    assert.deepEqual(first.allTime.order, [first.uid]);
    assert.equal(first.daily.entries[first.uid].name, "ACE");
    assert.equal(first.allTime.entries[first.uid].score, 25);

    await page.reload();
    await page.locator("#leaderboard-open").click();
    await page.waitForFunction(() => document.querySelector("#leaderboard-list li")?.dataset.you === "true");
    assert.equal((await page.evaluate(() => window.TRUMPET_GLOBAL_SCORES.read())).uid, first.uid,
      "The same anonymous identity is restored after reloading.");
    await page.locator("#leaderboard-close").click();
    await page.evaluate(() => window.__finishScore(9));
    await page.locator("#score-submit-open").click();
    await page.waitForFunction(() => document.querySelector("#leaderboard-results").getAttribute("aria-busy") === "false");
    assert.equal(await page.locator("#leaderboard-enter").isVisible(), false,
      "A lower score cannot occupy a second place for the same player.");
    await page.locator("#leaderboard-close").click();
    await page.evaluate(() => window.__finishScore(34));
    await page.locator("#score-submit-open").click();
    await page.locator("#leaderboard-enter").click();
    assert.equal(await page.locator("#leaderboard-name").inputValue(), "ACE");
    await page.locator("#leaderboard-publish").click();
    await page.waitForFunction(() => document.querySelector("#leaderboard-entry").hidden &&
      document.querySelector("#leaderboard-status").textContent.includes("both boards"));
    const improved = await page.evaluate(() => window.TRUMPET_GLOBAL_SCORES.read());
    for (const kind of ["daily", "allTime"]) {
      assert.deepEqual(improved[kind].order, [first.uid]);
      assert.equal(improved[kind].entries[first.uid].score, 34);
    }
    assert.deepEqual(external, [], "The complete flow only contacts this machine.");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
