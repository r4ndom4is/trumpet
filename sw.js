"use strict";

// The runtime is entirely inline in index.html, so each navigation gets one coherent release.
const VERSION = "v12";
const PREFIX = `trumpet-flight:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;
const local = path => new URL(path, self.registration.scope).href;
const SHELL = local("./");
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/maskable-192.png", "./icons/maskable-512.png",
  "./icons/favicon-32.png", "./icons/apple-touch-180.png"
].map(local);
const isShell = url => url === SHELL || url === local("./index.html");

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    // Existing games keep their already-loaded code and state; nobody is told to reload.
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const canonical = url.origin + url.pathname;
  if (!ASSETS.includes(canonical)) return;
  if (event.request.mode === "navigate" && isShell(canonical)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(new Request(event.request, { cache: "no-cache" }));
        const finalURL = new URL(response.url);
        if (!response.ok || !isShell(finalURL.origin + finalURL.pathname) ||
            !response.headers.get("content-type")?.includes("text/html")) {
          throw new Error("The game server did not return the app shell.");
        }
        await cache.put(SHELL, response.clone());
        return response;
      } catch (error) {
        const saved = await cache.match(SHELL);
        if (saved) return saved;
        console.error("No offline game is available:", error);
        return new Response("Trumpet Flight is unavailable offline. Reconnect and refresh to try again.", {
          status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }
    })());
    return;
  }
  event.respondWith(caches.open(CACHE).then(async cache =>
    (await cache.match(canonical)) || fetch(event.request)
  ));
});
