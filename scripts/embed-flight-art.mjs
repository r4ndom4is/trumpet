import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
function replaceBlock(text, label, content) {
  const begin = `// BEGIN GENERATED ${label}`, end = `// END GENERATED ${label}`;
  if (text.split(begin).length !== 2 || text.split(end).length !== 2 ||
      text.indexOf(end) < text.indexOf(begin)) throw new Error(`Invalid ${label} embedding markers`);
  return text.slice(0, text.indexOf(begin) + begin.length) + "\n" + content + "\n" + text.slice(text.indexOf(end));
}
let html = await readFile(new URL("index.html", root), "utf8");
const modules = await Promise.all(["pixel-rider.js", "pixel-scenery.js", "flight-art.js"]
  .map(file => readFile(new URL("scripts/" + file, root), "utf8")));
if (modules.some(source => /<\/script/i.test(source))) throw new Error("Art modules must be inline-safe");
html = replaceBlock(html, "FLIGHT ART", modules.map(source => source.trimEnd()).join("\n"));
let worker = await readFile(new URL("sw.js", root), "utf8");
const files = ["rider.png", ...["day", "night"].flatMap(theme =>
  ["far", "mid", "near"].map(layer => `palace-${layer}-${theme}.png`))];
await Promise.all(files.map(file => readFile(new URL("assets/flight/" + file, root))));
worker = replaceBlock(worker, "FLIGHT ASSETS", files.map(file => `  "./assets/flight/${file}",`).join("\n"));
await writeFile(new URL("index.html", root), html);
await writeFile(new URL("sw.js", root), worker);
console.log("Embedded approved pixel art renderers and verified offline artwork manifest.");
