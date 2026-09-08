import { readFile, writeFile } from "node:fs/promises";

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
await writeFile(target, html);
console.log("Embedded sprite, sounds, theme, atmosphere and hitbox assets into index.html.");
