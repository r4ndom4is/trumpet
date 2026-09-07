// Dev-only server for tools/character-lab: serves the lab and the repo's
// scripts/ folder over plain HTTP (so the lab can `fetch` a health check and
// POST tuning changes back to disk), and re-runs the relevant embed script
// after every save so index.html never falls behind scripts/*.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, normalize, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const root = fileURLToPath(new URL("../", import.meta.url));

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};

// Only these repo-relative paths may be read as static files - the lab
// directory itself plus the canonical scripts/ modules it loads directly.
const staticAllowed = /^(tools\/character-lab\/.*|scripts\/(environments|sprite|sounds|atmosphere|hitbox)\.js|scripts\/theme\.css)$/;

// Only these logical modules may be written by /api/save, each mapped to its
// canonical file and (if any) the embed script that must run afterward to
// keep index.html in sync.
const modules = {
  sprite: { file: "scripts/sprite.js", embed: "scripts/embed-assets.mjs" },
  sounds: { file: "scripts/sounds.js", embed: "scripts/embed-assets.mjs" },
  theme: { file: "scripts/theme.css", embed: "scripts/embed-assets.mjs" },
  atmosphere: { file: "scripts/atmosphere.js", embed: "scripts/embed-assets.mjs" },
  hitbox: { file: "scripts/hitbox.js", embed: "scripts/embed-assets.mjs" },
  environments: { file: "scripts/environments.js", embed: "scripts/embed-environments.mjs" }
};

function safeJoin(relative) {
  const cleaned = normalize(relative).replace(/^([.]{2}[/\\])+/, "");
  const full = resolve(root, cleaned);
  if (full !== resolve(root) && !full.startsWith(resolve(root) + sep)) return null;
  return full;
}

async function readJsonBody(req, limit = 2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(body);
}

export function serve() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/health") {
      send(res, 200, JSON.stringify({ ok: true, time: new Date().toISOString() }));
      return;
    }

    if (url.pathname === "/api/save" && req.method === "POST") {
      try {
        const { module: name, content } = await readJsonBody(req);
        const target = modules[name];
        if (!target || typeof content !== "string" || !content.trim()) {
          send(res, 400, JSON.stringify({ ok: false, error: "Unknown module or empty content." }));
          return;
        }
        const filePath = resolve(root, target.file);
        await mkdir(resolve(filePath, ".."), { recursive: true });
        await writeFile(filePath, content.endsWith("\n") ? content : content + "\n", "utf8");
        let embedOutput = "";
        if (target.embed) {
          const { stdout } = await run(process.execPath, [resolve(root, target.embed)], { cwd: root });
          embedOutput = stdout.trim();
        }
        send(res, 200, JSON.stringify({ ok: true, file: target.file, embed: embedOutput }));
      } catch (error) {
        send(res, 500, JSON.stringify({ ok: false, error: String(error && error.message || error) }));
      }
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, JSON.stringify({ ok: false, error: "Method not allowed" }));
      return;
    }

    let relative = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (relative === "" || relative === "lab") relative = "tools/character-lab/index.html";
    else if (relative === "tools/character-lab" || relative === "tools/character-lab/") relative = "tools/character-lab/index.html";

    if (!staticAllowed.test(relative)) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    const filePath = safeJoin(relative);
    if (!filePath) {
      send(res, 400, "Bad path", "text/plain; charset=utf-8");
      return;
    }
    try {
      const content = await readFile(filePath);
      send(res, 200, content, types[extname(filePath)] || "application/octet-stream");
    } catch (error) {
      send(res, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "Not found" : "Server error", "text/plain; charset=utf-8");
      if (error.code !== "ENOENT") console.error(error);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8878);
  serve().listen(port, "127.0.0.1", () => {
    console.log(`Trumpet Flight character lab: http://localhost:${port}/`);
    console.log(`Health check:                http://localhost:${port}/api/health`);
  });
}
