import { readFile, writeFile } from "node:fs/promises";

const target = new URL("../index.html", import.meta.url);
const source = (await readFile(new URL("./environments.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n").trimEnd();
const html = (await readFile(target, "utf8")).replace(/\r\n/g, "\n");
const begin = "// BEGIN GENERATED ENVIRONMENTS";
const end = "// END GENERATED ENVIRONMENTS";
if (html.split(begin).length !== 2 || html.split(end).length !== 2 || html.indexOf(end) < html.indexOf(begin)) {
  throw new Error("Expected exactly one ordered environment embedding marker pair.");
}
if (/<\/script/i.test(source)) throw new Error("Environment source cannot contain an HTML script closing tag.");
await writeFile(target, html.slice(0, html.indexOf(begin) + begin.length) + "\n" + source + "\n" + html.slice(html.indexOf(end)));
console.log("Embedded six environments into index.html.");
