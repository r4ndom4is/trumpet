# Trumpet Flight

**Play: https://r4ndom4is.github.io/trumpet/**

A small, polished, installable arcade game: a miniature Trump-inspired rider, a golden backward-facing trumpet, a windswept comb-over, and a fluttering tie. Dodge pipes, find your rhythm, and chase your personal best. Original pixel artwork and synthesized sound; no accounts, analytics, external assets, or runtime dependencies.

This is an original, unofficial caricature game. It is not affiliated with or endorsed by Donald Trump, any campaign, or any organization. No license is asserted by this repository.

## Play

| Control | Action |
| --- | --- |
| Space / Arrow Up / click or tap the game | Start, flap, or retry |
| P / Escape / pause button | Pause or resume |
| M / sound button | Toggle synthesized sound (initially muted) |

One point per pipe pair. The personal best is saved in this browser, not synced between devices. If browser storage is blocked, the game explains that the best lasts only for the current visit. Switching windows or hiding the page pauses a flight. Reduced-motion preferences suppress decorative animation. Light/dark styling follows the system; `?scoutTheme=light` or `?scoutTheme=dark` can override it.

The retry panel keeps the exact collision frame: a 2x, nearest-neighbor crop centered on the rider with bounds clamped to the game canvas.

## Install and play offline

Open the live HTTPS URL and wait for **Ready for offline play**. The app shell, manifest, and all icons are then cached locally. Subsequent visits and installed launches can work offline.

- On supported desktop or Android browsers, use **Install game** or the browser's install menu.
- On iPhone/iPad, open in Safari, tap **Share > Add to Home Screen**, and enable **Open as Web App** if offered.
- Installation support varies by browser. The game remains playable in a normal tab; clicking an install button does not mean installation succeeded.

Offline data and scores belong to this origin/browser profile. Private browsing, storage eviction, or clearing site data may remove them. An initial connection is required. No arbitrary third-party resources are cached.

## Updates

Updates are downloaded in a separate, versioned, scope-specific cache. Incomplete downloads never replace a working version. A waiting update shows an in-app notice; **Update game** explains how to apply it and is disabled during playing or paused flights.

**Finish your flight, close every Trumpet Flight tab/app window, then reopen.** The browser activates the waiting version once no old window is using it. There is no forced reload or `skipWaiting`, so a second window cannot interrupt your active game. Personal bests survive app updates.

For every release that changes app assets, bump `VERSION` in `sw.js`. Keep the manifest, service-worker asset list, and generated icons consistent. Pages may take a few minutes to publish; existing clients may need another online visit to discover the update.

## Local development

Requires Node.js 22+ for the helper scripts. The game itself is plain HTML, CSS, and JavaScript, served directly from the repository root by GitHub Pages (`main`, `/`). No build step.

```powershell
npm run serve
```

Open **http://localhost:4173/trumpet/** in an external browser. The helper intentionally serves the same project subpath as Pages. HTTPS or localhost is required for service workers; opening `index.html` as a `file:` URL is not an offline-install test.

Development-only browser checks and icon generation:

```powershell
npm ci
npx playwright install chromium
npm test
npm run icons
npm run test:live
```

Playwright is only a development dependency; nothing from `node_modules` is requested by the app. Icons are real PNGs rendered from the same `drawTrumpet` function used in the game, including separate padded maskable variants.
