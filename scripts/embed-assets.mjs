import { readFile, readdir, writeFile } from "node:fs/promises";

const target = new URL("../index.html", import.meta.url);

async function embedJs(html, { name, file, begin, end }) {
  const source = (await readFile(new URL(file, import.meta.url), "utf8")).replace(/\r\n/g, "\n").trimEnd();
  // Drop the file's own header comment and top-level `window.X = {...};` wrapper is kept as-is;
  // index.html embeds the same assignment verbatim so both copies stay byte-identical in content.
  const body = source.replace(/^\/\*[\s\S]*?\*\/\s*/, "").trimEnd();
  if (html.split(begin).length !== 2 || html.split(end).length !== 2 || html.indexOf(end) < html.indexOf(begin)) {
    throw new Error(`Expected exactly one ordered ${name} embedding marker pair.`);
  }
  if (/<\/script/i.test(body)) throw new Error(`${name} source cannot contain an HTML script closing tag.`);
  const indented = body.split("\n").map(line => line ? "  " + line : line).join("\n");
  return html.slice(0, html.indexOf(begin) + begin.length) + "\n" + indented + "\n  " + html.slice(html.indexOf(end));
}

async function embedCss(html, { name, file, begin, end }) {
  const source = (await readFile(new URL(file, import.meta.url), "utf8")).replace(/\r\n/g, "\n").trimEnd();
  const body = source.replace(/^\/\*[\s\S]*?\*\/\s*/, "").trimEnd();
  if (html.split(begin).length !== 2 || html.split(end).length !== 2 || html.indexOf(end) < html.indexOf(begin)) {
    throw new Error(`Expected exactly one ordered ${name} embedding marker pair.`);
  }
  return html.slice(0, html.indexOf(begin) + begin.length) + "\n" + body + "\n" + html.slice(html.indexOf(end));
}

let html = (await readFile(target, "utf8")).replace(/\r\n/g, "\n");
html = await embedJs(html, { name: "sprite", file: "./sprite.js", begin: "// BEGIN GENERATED SPRITE", end: "// END GENERATED SPRITE" });
html = await embedJs(html, { name: "sounds", file: "./sounds.js", begin: "// BEGIN GENERATED SOUNDS", end: "// END GENERATED SOUNDS" });
html = await embedCss(html, { name: "theme", file: "./theme.css", begin: "/* BEGIN GENERATED THEME */", end: "/* END GENERATED THEME */" });
html = await embedCss(html, { name: "cabinet", file: "./cabinet.css", begin: "/* BEGIN GENERATED CABINET */", end: "/* END GENERATED CABINET */" });
html = await embedJs(html, { name: "atmosphere", file: "./atmosphere.js", begin: "// BEGIN GENERATED ATMOSPHERE", end: "// END GENERATED ATMOSPHERE" });
html = await embedJs(html, { name: "hitbox", file: "./hitbox.js", begin: "// BEGIN GENERATED HITBOX", end: "// END GENERATED HITBOX" });
html = await embedJs(html, { name: "leaderboard", file: "./leaderboard.js", begin: "// BEGIN GENERATED LEADERBOARD", end: "// END GENERATED LEADERBOARD" });
html = await embedJs(html, { name: "cabinet stage", file: "./cabinet-stage.js", begin: "// BEGIN GENERATED CABINET STAGE", end: "// END GENERATED CABINET STAGE" });
const geometry = JSON.parse(await readFile(new URL("../assets/cabinet/v2/geometry.json", import.meta.url), "utf8"));
const opening = geometry.screen;
if (!opening || !["leftPercent", "topPercent", "widthPercent", "heightPercent"].every(key =>
  Number.isFinite(opening[key]) && opening[key] >= 0 && opening[key] <= 100) ||
  opening.widthPercent === 0 || opening.heightPercent === 0 ||
  opening.leftPercent + opening.widthPercent > 100 || opening.topPercent + opening.heightPercent > 100 ||
  typeof opening.clipPath !== "string" || !opening.clipPath.startsWith("polygon(")) {
  throw new Error("Cabinet screen geometry must describe a valid opening within the frame.");
}
const geometryBegin = "// BEGIN GENERATED CABINET GEOMETRY", geometryEnd = "// END GENERATED CABINET GEOMETRY";
if (html.split(geometryBegin).length !== 2 || html.split(geometryEnd).length !== 2 ||
    html.indexOf(geometryEnd) < html.indexOf(geometryBegin)) throw new Error("Expected one ordered cabinet geometry embedding marker pair.");
const geometryJson = JSON.stringify(geometry).replace(/</g, "\\u003c");
html = html.slice(0, html.indexOf(geometryBegin) + geometryBegin.length) +
  "\nwindow.TRUMPET_CABINET = " + geometryJson + ";\n" + html.slice(html.indexOf(geometryEnd));
const swTarget = new URL("../sw.js", import.meta.url);
let worker = (await readFile(swTarget, "utf8")).replace(/\r\n/g, "\n");
const assetsBegin = "// BEGIN GENERATED CABINET ASSETS", assetsEnd = "// END GENERATED CABINET ASSETS";
if (worker.split(assetsBegin).length !== 2 || worker.split(assetsEnd).length !== 2 ||
    worker.indexOf(assetsEnd) < worker.indexOf(assetsBegin)) throw new Error("Expected one ordered cabinet asset embedding marker pair.");
const cabinetFiles = (await readdir(new URL("../assets/cabinet/v2/", import.meta.url))).filter(file => /^[a-z0-9-]+\.webp$/.test(file)).sort();
const required = ["hood", "frame", "bezel", "deck", "apron", "manual", "intro", "intro-shadow"]
  .flatMap(part => ["light", "dark"].map(mode => `${part}-${mode}.webp`));
if (required.some(file => !cabinetFiles.includes(file))) throw new Error("Cabinet v2 requires both front, bezel, arrival and shadow layers.");
for (const sequence of Object.values(geometry.approach?.frames ?? {})) {
  if (!Array.isArray(sequence) || sequence.some(frame => !cabinetFiles.includes(frame.file))) throw new Error("Camera sequence references missing cabinet frames.");
}
worker = worker.slice(0, worker.indexOf(assetsBegin) + assetsBegin.length) + "\n" +
  cabinetFiles.map(file => '  "./assets/cabinet/v2/' + file + '",').join("\n") + "\n" + worker.slice(worker.indexOf(assetsEnd));
await writeFile(target, html);
await writeFile(swTarget, worker);
console.log("Embedded canonical game assets, cabinet geometry and arrival; updated offline artwork manifest.");
