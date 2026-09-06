# Trumpet Flight

**Play: https://r4ndom4is.github.io/trumpet/**

A small, polished, installable arcade game: a miniature Trump-inspired rider, a golden backward-facing trumpet, a windswept comb-over, and a fluttering tie. Dodge pipes, find your rhythm, and chase your personal best. Original pixel artwork and synthesized sound; no accounts, analytics, external assets, or runtime dependencies.

The sound stays proudly 8-bit: rounded pulse-wave trumpet toots, stepped pitch and brass-like filtering, a little major-key score fanfare, and a descending arcade wah-wah. Soft note endings and a tiny crossfade between taps avoid sharp clicks. Low-volume voices replace previous notes during rapid tapping; mute, pause, and backgrounding silence them. Audio starts only after you enable sound and resumes on a fresh gesture when required by mobile browsers.

This is an original, unofficial caricature game. It is not affiliated with or endorsed by Donald Trump, any campaign, or any organization. No license is asserted by this repository.

## Play

| Control | Action |
| --- | --- |
| Space / Arrow Up / click or tap the game | Start, flap, or retry |
| P / Escape / pause button | Pause or resume |
| M / sound button | Toggle synthesized sound (initially muted) |

One point per pipe pair. The personal best is saved in this browser, not synced between devices. If browser storage is blocked, the game explains that the best lasts only for the current visit. Switching windows or hiding the page pauses a flight. Reduced-motion preferences suppress decorative animation.

The rider uses two independently fitted capsule hitboxes, rotating with the artwork: a body capsule (21px centreline, 18px diameter, 90 degrees) and a trumpet capsule (27px centreline, 10px diameter, -25 degrees). Their centres relative to the live rider anchor are (-2, -8) and (3, 3). The imported studio fit is translated up 8px before rotation because the studio centres the sprite at y=-21 while the live renderer starts it at y=-29; the fit against the artwork is preserved. Rounded ends determine contact with pipes, ceiling, and floor; scoring waits until both capsules clear a pipe. Flight physics, artwork, and sounds are unchanged.

## Six environments

| Cleared obstacles | Environment |
| --- | --- |
| 0-9 | The Gilded Mile |
| 10-19 | Marble Forum |
| 20-29 | Executive Atrium |
| 30-39 | Links & Lightning |
| 40-49 | Penthouse Row |
| 50 onward | Gantry Nine |

Scenery crossfades for one second at each threshold; reduced-motion mode switches instantly. Obstacles already in flight retain their spawn-time environment, while subsequent spawns use the new one. Their 66px caps and narrower shafts have matching collision rectangles; decorative outliers are non-lethal. Light/dark mode selects each environment's day/night palette. Speed and gap difficulty continue on the same score-based curve, and pausing freezes the transition. Gantry Nine stays indefinitely; retry starts again at The Gilded Mile.

The single **sun/moon icon beside mute** switches light/dark appearance and remembers your choice, including offline. Its icon and accessible label describe the theme you can switch to. Your saved choice takes precedence over system appearance and the optional `?scoutTheme=light` / `?scoutTheme=dark` preview parameter. Until you choose, the parameter or system appearance sets the initial theme. If storage is denied, the palette still switches and an explicit notice explains that it cannot be remembered.

## A pocket-sized, screen-fitting arcade

On phones and short landscape screens, the complete game canvas fits the available viewport, including browser chrome and safe-area insets. Scores, sound, pause, start, and retry stay within reach without scrolling the page. Landscape moves score and sound/pause controls beside the game; resizing preserves its aspect ratio, physics, and collision shapes. Installed standalone windows use their extra available height automatically. This does not request native fullscreen or assume iOS supports the Fullscreen API.

The header keeps **trumpet flight.** on the left and **POCKET ARCADE / NO. 001** on the right. **SMALL GAME. BIG ONE-MORE-TRY ENERGY.** stays visible below it on mobile. The Flight manual button sits beneath the game, separate from the mute, theme, and pause controls.

**Flight manual** keeps every line of the original introduction, tips, controls, installation details, and footer in an accessible, scrollable dialog. Opening it pauses an active flight. Close it with **Close**, Escape, or the backdrop; keyboard focus returns to the opener, and the game stays paused until you resume. Desktop keeps the spacious original layout.

The retry panel keeps the exact collision frame: a 2x, nearest-neighbor crop centered on the rider with bounds clamped to the game canvas.

## Install and play offline

Open the live HTTPS URL and wait for **Ready for offline play**. The app shell, manifest, and all icons are then cached locally. Subsequent visits and installed launches can work offline.

- On supported desktop or Android browsers, use **Install game** or the browser's install menu.
- On iPhone/iPad, open in Safari, tap **Share > Add to Home Screen**, and enable **Open as Web App** if offered.
- Installation support varies by browser. The game remains playable in a normal tab; clicking an install button does not mean installation succeeded.

Offline data and scores belong to this origin/browser profile. Private browsing, storage eviction, or clearing site data may remove them. An initial connection is required. No arbitrary third-party resources are cached.

## Updates

**Just open or refresh the game online. There is no Update game button.** Each navigation requests the latest published HTML, then saves it for offline play. The complete runtime is inline in that HTML, so a new page cannot mix new markup with old cached JavaScript. When the network is unavailable or the server returns an error, the saved game loads instead.

Background updates activate only after their offline assets have downloaded successfully. They never reload an open game, even if another tab or installed window is playing. Your current run keeps its loaded code; a refresh or new launch gets the new version. Personal bests and theme choices survive.

**Migrating from the original v3 app:** its cache-first worker may show the old page on your first online visit while the replacement downloads. Wait a moment and refresh once more if the old update button is still visible. There is no need to close other games, clear site data, or reinstall.

For every release that changes app assets, bump `VERSION` in `sw.js`. Keep the manifest, service-worker asset list, and generated icons consistent. Pages may take a few minutes to publish; refreshing cannot fetch a deployment that the server has not published yet.

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

Environment artwork lives in `scripts/environments.js`. After editing it, run `npm run embed:environments` and commit the regenerated `index.html` as well. The published file already contains the complete environment module, so hosting and offline launches still require no build or external runtime scripts.

The migration regression reads the actual v3 release (`440cfd9`) from Git history; use a full clone rather than a shallow checkout when running it.
