import { build } from "esbuild";
import { fileURLToPath } from "node:url";

export async function bundleFirebase() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./firebase-leaderboard.js", import.meta.url))],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    write: false,
    charset: "ascii",
    legalComments: "inline",
    supported: { "inline-script": true }
  });
  const source = result.outputFiles[0].text;
  if (/<\/script/i.test(source)) throw new Error("Firebase bundle is not safe to embed in an inline script.");
  return source;
}
