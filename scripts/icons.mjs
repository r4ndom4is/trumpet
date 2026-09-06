import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Render the actual approved in-game art; keep no second, drifting sprite implementation.
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const drawing = html.slice(html.indexOf("  const riderSprite ="), html.indexOf("  function drawCharacter("));
if (!drawing.startsWith("  const riderSprite =")) throw new Error("Traced rider renderer not found");
const theme = html.match(/:root \{[\s\S]*?\n\}/)[0];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(`<style>${theme}</style><canvas></canvas>`);
  await mkdir(new URL("../icons/", import.meta.url), { recursive: true });
  for (const [name, size, maskable] of [
    ["icon-192", 192, false], ["icon-512", 512, false],
    ["maskable-192", 192, true], ["maskable-512", 512, true],
    ["apple-touch-180", 180, false], ["favicon-32", 32, false]
  ]) {
    const png = await page.evaluate(({ drawing, size, maskable }) => {
      const canvas = document.querySelector("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const style = getComputedStyle(document.documentElement);
      const colors = Object.fromEntries(["bg", "accent-soft", "accent", "accent-hover", "warning", "surface", "text"]
        .map(key => [key, style.getPropertyValue("--cp-" + key).trim()]));
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = colors["accent-soft"];
      ctx.fillRect(size * .08, size * .08, size * .84, size * .84);
      const renderer = new Function("colors", "reducedMotion", "time",
        `${drawing}; return { drawTrumpet, riderSprite };`)(colors, true, 0);
      const scale = size * (maskable ? .58 : .78) / renderer.riderSprite.w;
      ctx.imageSmoothingEnabled = false;
      renderer.drawTrumpet(ctx, size / 2, size / 2 + 8.5 * scale, scale, 0);
      return canvas.toDataURL("image/png").split(",")[1];
    }, { drawing, size, maskable });
    await writeFile(new URL(`../icons/${name}.png`, import.meta.url), Buffer.from(png, "base64"));
  }
} finally { await browser.close(); }
console.log("Rendered six PNG icons from the selected traced rider.");
