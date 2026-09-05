import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";

export const root = fileURLToPath(new URL("../", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const allowed = /^(index\.html|pwa\.js|sw\.js|manifest\.webmanifest|icons\/[a-z0-9-]+\.png)$/;

export function serve({ transform = (_, content) => content } = {}) {
  return createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/trumpet") { res.writeHead(301, { Location: "/trumpet/" }); res.end(); return; }
    const file = path.slice("/trumpet/".length) || "index.html";
    if (!path.startsWith("/trumpet/") || !allowed.test(file)) {
      res.writeHead(404); res.end("Not found"); return;
    }
    try {
      const content = await readFile(resolve(root, ...file.split("/")));
      res.writeHead(200, { "Content-Type": types[extname(file)], "Cache-Control": "no-store" });
      res.end(transform(file, content));
    } catch (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500);
      res.end("Unable to serve asset");
      if (error.code !== "ENOENT") console.error(error);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  serve().listen(port, "127.0.0.1", () => console.log(`Trumpet Flight: http://localhost:${port}/trumpet/`));
}
