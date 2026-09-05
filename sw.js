"use strict";

// Bump for every published app change. Installation is atomic: incomplete builds never activate.
const VERSION = "v2";
const PREFIX = `trumpet-flight:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;
const local = path => new URL(path, self.registration.scope).href;
const ASSETS = [
  "./", "./index.html", "./pwa.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/maskable-192.png", "./icons/maskable-512.png",
  "./icons/favicon-32.png", "./icons/apple-touch-180.png"
].map(local);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll(ASSETS.map(url => new Request(url, { cache: "reload" })))
  ));
  // Do not skipWaiting: an update waits until every old game window closes.
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const canonical = url.origin + url.pathname;
  // Only the app shell and its explicit local assets belong in this cache.
  if (!ASSETS.includes(canonical)) return;
  event.respondWith(caches.open(CACHE).then(async cache =>
    (await cache.match(canonical)) || fetch(event.request)
  ));
});
