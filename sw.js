"use strict";

// The runtime is entirely inline in index.html, so each navigation gets one coherent release.
const VERSION = "v25";
const PREFIX = `trumpet-flight:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;
const local = path => new URL(path, self.registration.scope).href;
const SHELL = local("./");
const CABINET_ASSETS = [
// BEGIN GENERATED CABINET ASSETS
  "./assets/cabinet/v2/approach-dark-00.webp",
  "./assets/cabinet/v2/approach-dark-01.webp",
  "./assets/cabinet/v2/approach-dark-02.webp",
  "./assets/cabinet/v2/approach-dark-03.webp",
  "./assets/cabinet/v2/approach-dark-04.webp",
  "./assets/cabinet/v2/approach-dark-05.webp",
  "./assets/cabinet/v2/approach-dark-06.webp",
  "./assets/cabinet/v2/approach-dark-07.webp",
  "./assets/cabinet/v2/approach-light-00.webp",
  "./assets/cabinet/v2/approach-light-01.webp",
  "./assets/cabinet/v2/approach-light-02.webp",
  "./assets/cabinet/v2/approach-light-03.webp",
  "./assets/cabinet/v2/approach-light-04.webp",
  "./assets/cabinet/v2/approach-light-05.webp",
  "./assets/cabinet/v2/approach-light-06.webp",
  "./assets/cabinet/v2/approach-light-07.webp",
  "./assets/cabinet/v2/apron-dark.webp",
  "./assets/cabinet/v2/apron-light.webp",
  "./assets/cabinet/v2/bezel-dark.webp",
  "./assets/cabinet/v2/bezel-light.webp",
  "./assets/cabinet/v2/deck-dark.webp",
  "./assets/cabinet/v2/deck-light.webp",
  "./assets/cabinet/v2/frame-dark.webp",
  "./assets/cabinet/v2/frame-light.webp",
  "./assets/cabinet/v2/hood-dark.webp",
  "./assets/cabinet/v2/hood-light.webp",
  "./assets/cabinet/v2/intro-dark.webp",
  "./assets/cabinet/v2/intro-light.webp",
  "./assets/cabinet/v2/intro-shadow-dark.webp",
  "./assets/cabinet/v2/intro-shadow-light.webp",
  "./assets/cabinet/v2/manual-dark.webp",
  "./assets/cabinet/v2/manual-light.webp",
// END GENERATED CABINET ASSETS
];
const ASSETS = [
// BEGIN GENERATED FLIGHT ASSETS
  "./assets/flight/rider.png",
  "./assets/flight/palace-far-day.png",
  "./assets/flight/palace-mid-day.png",
  "./assets/flight/palace-near-day.png",
  "./assets/flight/palace-far-night.png",
  "./assets/flight/palace-mid-night.png",
  "./assets/flight/palace-near-night.png",
// END GENERATED FLIGHT ASSETS
  "./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/maskable-192.png", "./icons/maskable-512.png",
  "./icons/favicon-32.png", "./icons/apple-touch-180.png",
  ...CABINET_ASSETS
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
