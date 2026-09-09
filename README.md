# Trumpet Flight

**Play: https://r4ndom4is.github.io/trumpet/**

A small, polished, installable arcade game inside an original Crimson coin-op cabinet: a miniature Trump-inspired rider, a golden backward-facing trumpet, a windswept comb-over, and a fluttering tie. Dodge pipes, find your rhythm, and chase your personal best. Original pixel artwork, rendered hardware and synthesized sound; no accounts, analytics, third-party assets, or runtime dependencies.

The sound stays proudly 8-bit: rounded pulse-wave trumpet toots, stepped pitch and brass-like filtering, a little major-key score fanfare, and a descending arcade wah-wah. Soft note endings and a tiny crossfade between taps avoid sharp clicks. Low-volume voices replace previous notes during rapid tapping; mute, pause, and backgrounding silence them. Sound is on by default, but audio is created only on the first play/flap gesture and resumes on a fresh gesture when required by mobile browsers. You can mute before starting. A crossed-out speaker between SCORE and BEST stays visible while muted; the physical sound button remains the control, without an indicator light.

This is an original, unofficial caricature game. It is not affiliated with or endorsed by Donald Trump, any campaign, or any organization. No license is asserted by this repository.

## Play

| Control | Action |
| --- | --- |
| Space / Arrow Up / click or tap the game | Start, flap, or retry |
| P / Escape / pause button | Pause or resume |
| M / sound button | Toggle synthesized sound (on by default) |
| Sun button | Switch light/dark appearance |
| 10 button | Open your local Top 10 |
| Flight manual magazine | Instructions, installation and about |

One point per pipe pair. The personal best and ten highest completed flights are saved in this browser, not uploaded or synced between devices. Existing personal bests remain eligible for the list. If browser storage is blocked, the game explains that scores last only for the current visit. Switching windows or hiding the page pauses a flight. Reduced-motion preferences suppress decorative animation.

The detailed pixel rider uses the approved registered 96px artwork at 48 logical pixels, with the original capsule collision fit unchanged (scale 48/42). In source pixels these are a body capsule (21px centreline, 18px diameter, 90 degrees) and a trumpet capsule (27px centreline, 10px diameter, -25 degrees), centred at (-2, -8) and (3, 3) relative to the live anchor. The imported studio fit is translated up 8 source pixels, then scaled and rotated with the artwork. Rounded ends determine contact with obstacles, ceiling, and floor; scoring waits until both capsules clear a pair. The crash fall uses the approved rider's opaque lower edge. Gravity, flap strength, speed, gaps, scoring and sound phrases are unchanged.

## Seven environments

| Cleared obstacles | Environment |
| --- | --- |
| 0-9 | West Wing It |
| 10-19 | File Another Day |
| 20-29 | Fore More Years |
| 30-39 | Gilt Trip |
| 40-49 | Roofless Ambition |
| 50-59 | Space Force One |
| 60 onward | Strait to the Point |

Scenery crossfades for one second at each threshold; reduced-motion mode switches instantly. Obstacles already in flight retain their spawn-time environment, while subsequent spawns use the new one. Their 66px caps and narrower shafts have matching collision rectangles. Light/dark mode selects each environment's day/night art. Speed and gap difficulty continue on the same score-based curve, and pausing freezes the transition. Each fresh run rerolls a random starting stage, then advances through the seven-stage order; the final slot lasts indefinitely. The table shows the unrotated order.

Each stage has a borderless title, such as `03 / Fore More Years`, below the existing score HUD. It holds for 1.8 seconds, fades for 0.6 seconds, and never repeats within the same stage. Reduced-motion mode removes the fade. Titles use theme-aware outlined text at a minimum 12 CSS pixels; their clock freezes on pause and resets on entry or restart.

Obstacle vines, leaf clumps, brackets and frost use a fixed decoration seed, not their moving screen position. Their patterns stay attached as they scroll and clip at the screen edges; collision shapes and non-lethal decorative margins remain unchanged.

All seven places use quiet authored pixel scenery, including palace grounds, an archive, a Florida golf resort, colonnades, rooftops, a spaceport, and Strait of Hormuz-inspired headlands, tankers and beacons. The strait has unique maritime visuals with the canonical gantry collision shape. Independent cached far, middle, near and ground planes scroll at 0.06, 0.16, 0.34 and 1 times world speed; tiles wrap seamlessly. The archive window, sky and upper-right sun/moon stay fixed. Reduced motion freezes decorative scenery. Light always comes from 315 degrees: the rider's soft #2d3c51 backing has strength 0.65, distance 3.5 and blur 1.5 logical pixels, projecting down-left even while rotating. Obstacle shadows use #27333b by day and #0b1424 by night at depth 0.30.

The **sun button beside mute** switches light/dark appearance and remembers your choice, including offline. The same light Crimson physical finish is lit for day or night, alongside the game's scenery. Its accessible label describes the theme you can switch to. Your saved choice takes precedence over system appearance and the optional `?scoutTheme=light` / `?scoutTheme=dark` preview parameter. Until you choose, the parameter or system appearance sets the initial theme. If storage is denied, the palette still switches and an explicit notice explains that it cannot be remembered.

## A pocket-sized, screen-fitting arcade

The straight-on cabinet contains the real, undistorted 448 x 512 game, not a perspective-skewed screenshot. The wider opening uses a thin, separately modelled and rendered bezel rather than the original chunky CRT surround. Its hood, low button deck, coin slot and magazine tray remain rendered hardware; gameplay, scores, front-facing marquee lettering and accessible controls remain live HTML/canvas. Button symbols are rendered into the physical caps, with no flat SVG overlays or tiny legends underneath. The exported screen geometry drives both CSS placement and aspect-ratio fitting.

Desktop and tablets scale the full cabinet to the available height below the header, bounded by viewport width rather than a fixed desktop size. Phones retain their compact sizing and crop the lower apron while keeping the magazine within reach. On short landscape screens, a compact control bank sits beside the CRT. Scores, four controls, start, and retry fit the viewport, including browser chrome and safe-area insets, without scrolling the page. Resizing preserves the game's aspect ratio, physics and collision shapes. Installed standalone windows use their extra available height automatically; no Fullscreen API is required.

The header keeps **pocket arcade.** on the left and **NO. 001** on the right on a shared text baseline. The square-tile mark scales with the wordmark, its final dot stays attached, and **SMALL GAME. BIG ONE-MORE-TRY ENERGY.** aligns with the title beneath it. **trumpet flight.** belongs on the cabinet marquee.

On large screens, an unpowered three-quarter cabinet introduces the arcade in a softly lit setting with separately rendered shadows. Hover or keyboard focus indicates that the cabinet is clickable; only a click, tap or keyboard activation opens the front-facing game. As the camera settles, the marquee backlight warms up and a soft horizontal screen glow opens into the live game over one second. Controls stay inactive until power-on finishes; the sequence never starts a flight or repeats after a crash.

Reduced-motion mode enters without animation. Only localhost and loopback previews expose the reduced-motion explanation, **Preview power-on sequence**, and **Go straight to the game** controls; those helpers are hidden on the live site. Clicking while camera frames are loading waits for decoded frames with a visible loading cue; a five-second timeout or asset failure falls back to the front view.

Phones and portrait tablets open the practical, powered-on play view directly. Desktop refresh preserves the current view: the room stays in the room with the cabinet off, while the close-up replays only the screen and marquee boot without moving the camera. Clicking outside the cabinet returns to the room only before a flight or after its crash animation finishes; active or paused flights, open dialogs, and drags beginning inside the cabinet never trigger an exit. The current view, including a return to the room, is remembered for the current tab; navigating to `?entry=room` explicitly opens the room, while `?entry=direct` bypasses presentation, including on refresh. Missing arrival artwork falls back to the playable game rather than blocking entry.

Button hover highlights follow each rendered cap rather than its larger touch target. The magazine brightens slightly on hover or keyboard focus without moving out of its tray. Hover effects are limited to mouse-like pointers; touch targets remain at least 44px, and reduced-motion settings remove feedback transitions.

While a flight is paused, the pause button itself glows steadily instead of showing a separate indicator light. The glow follows the rendered cap, or the native button in compact landscape and missing-artwork layouts, and turns off when play resumes.

The separate **Flight manual** magazine opens the introduction, tips, controls, installation details, and footer in an accessible, scrollable dialog on all devices. The **10** button opens an arcade high-score screen inside the cabinet, with **Daily**, **All-time**, and **Device** views. Gameplay keeps only **SCORE** and **YOUR BEST** in its HUD; global records stay on the score screen. Opening either pauses an active flight. The manual closes with **Close**, Escape, or its backdrop; scores close with the close icon, Escape, or the **10** button. Short displays show five scores per page rather than a scrolling table. Keyboard focus returns to the opener, and the game stays paused until you resume.

The cabinet uses warm-ivory text and a consistent crimson primary action. Ready and Top 10 use dark teal; ready shows the rider and a single control instruction, or a personal-best target for returning players. Pause dims the frozen world. Results fill the screen with a 3.25x zoom of the exact impact scene beneath a uniform 64% black overlay. The camera keeps the rider on the left and clamps at scene edges for sky and ground crashes; the score remains fixed on the right. Results distinguish **PERSONAL BEST** from global qualification and keep **Fly again** in the same position as Play and Resume. Only gameplay shows the score HUD; the mute indicator remains available between flights. The manual and cabinet hardware retain their existing appearance.

The game preserves the exact initial collision frame as an untouched 2x, nearest-neighbor crop in `crash-image`, plus a separate close-up crop; both captures remain hidden rather than becoming a framed result photo. The approved pixel rider keeps its likeness on impact without the old sprite's expression overpaint. The visual fall retains incoming vertical velocity and uses flight's gravity (940px/s squared) and terminal speed (470px/s), rather than a fixed-duration trajectory. Ceiling contact cancels upward motion. Rotation follows downward speed with a 1.8rad/s limit and a 0.65rad maximum; the first floor contact permanently stops translation and rotation, with no squash or rebound. Support comes from the opaque rider pixels, not empty bounding-box corners or its soft shadow. Direct floor crashes land immediately. Four fading dust motes occupy a 100ms grounded hold; the world, horizontal anchor, score, and raw capture stay frozen throughout. Tap or press Space to skip the fall; the existing 450ms guard requires a separate deliberate input to retry. Reduced-motion mode skips the fall and dust, and pausing or leaving the page settles it immediately.

## Global scores: free Firebase setup

Global scores use Firebase project **`trumpet-flight`** on the **Spark/no-billing** plan. Its Standard Firestore `(default)` database is in **`europe-west1` (Belgium)**, and Anonymous Authentication is enabled. No Cloud Functions, billing account, analytics, or background score polling are required. The game stays hosted on GitHub Pages; `r4ndom4is.github.io` is an authorized authentication domain. Local play and the existing on-device Top 10 remain available without Firebase or a network.

`scripts/firebase-config.js` contains public web-app identifiers, not private credentials. To disable global scores, set `enabled: false`, re-embed, and release with a new service-worker version. Keep Firestore rules deployed from `firestore.rules`; never switch the database to open test-mode rules. Spark quotas can make global scores temporarily unavailable rather than incur billing charges.

There are only two score documents, `leaderboards/daily` and `leaderboards/allTime`, with at most ten entries each. Each guest identity has at most one personal best on each board; one flight can qualify for both. Higher scores rank first and earlier tied scores keep their place. The daily window resets at **00:00 UTC**: yesterday's entries disappear from the display immediately, and the first qualifying submission replaces the previous daily document. No daily archive accumulates.

After a positive-score flight and its crash animation, a first-time qualifier goes directly to a **three-character initials screen** (A-Z or 0-9). Three on-screen character selectors avoid opening a phone keyboard; desktop players can also type initials or use arrow keys. **Save** explicitly publishes; **Skip** returns to retry without publishing. With remembered initials, qualifying runs stay on the result screen with **Save as ABC** and **Change initials**. Nothing uploads automatically; inline saves leave **Fly again** available, including while saving or after a failure. Neither results nor initials scroll. A delayed ranking response never interrupts a new flight, a manual/score screen already open, or a return to the room. Tags are remembered locally across daily resets but are not unique accounts. Firebase Anonymous Authentication persists a guest identity in the browser; another browser or clearing site data creates another identity. Public score entries contain only that random identifier, the tag, score and submission timestamp. Firebase also maintains anonymous authentication identities independently of the twenty ranking entries.

Score submissions use Firestore transactions, with security rules enforcing ownership, ranking, schema, the ten-entry limit and server-time daily boundaries. **This is not cheat-proof score verification:** a browser-only free-plan implementation cannot prove that a client-reported score was earned. Rules stop clients editing another guest's record or arbitrarily evicting entries, not determined score forgery or guest-identity resets.

Rankings are checked after positive-score flights and when browsing scores, using a sixty-second memory cache and coalescing concurrent reads. There is no refresh button or polling. Checking qualification does not create a guest identity or publish anything. Offline flights are saved locally, not queued silently for upload. Quota, connectivity and permission failures leave local play available.

### Develop without a Firebase account

After `npm install` and `npm run embed:assets`, run these in separate terminals:

```powershell
npm run firebase:emulators
npm run serve:firebase
```

Open **http://localhost:4184/trumpet/?entry=direct**. This server injects emulator-only configuration without editing the production configuration. It talks only to the `demo-trumpet-flight` Auth and Firestore emulators on this machine. Emulator operation needs Java 21 and no Google login or billing. Run `npm run test:firebase` with those emulator ports free to execute the rules and client integration suites. Automated browser tests use `tests/serve-test.mjs` to strip real Firebase configuration before applying fixture or emulator settings, so test flights never submit to the production boards.

### Provision another project

1. Create a Firebase project on **Spark**, without linking billing. Analytics is not needed.
2. Register a Web app, enable **Anonymous** sign-in under Authentication, and create a Cloud Firestore database in your chosen region. Keep database access locked until deploying the repository rules.
3. Run `npx firebase login`, then `npx firebase deploy --only firestore:rules --project YOUR_PROJECT_ID`.
4. Copy the Web app's public `apiKey`, `authDomain`, `projectId`, and `appId` into `scripts/firebase-config.js`; set `enabled: true` and keep `emulators: false`. These are public app identifiers, not Admin SDK credentials. Never put service-account private keys in the game.
5. Run `npm run embed:assets`, the local suites, and a real-project smoke test. Bump the service-worker version before publishing the regenerated game. Until then the live deployment stays unchanged.

## Install and play offline

Open the live HTTPS URL, open the Flight manual and wait for **Ready for offline play**. The app shell, manifest, all icons and both sets of cabinet artwork are then cached locally. Subsequent visits and installed launches can work offline, including switching cabinet lighting.

- On supported desktop or Android browsers, use **Install game** or the browser's install menu.
- On iPhone/iPad, open in Safari, tap **Share > Add to Home Screen**, and enable **Open as Web App** if offered.
- Installation support varies by browser. The game remains playable in a normal tab; clicking an install button does not mean installation succeeded.

Offline data and scores belong to this origin/browser profile. Private browsing, storage eviction, or clearing site data may remove them. An initial connection is required. No arbitrary third-party resources are cached.

## Updates

**Just open or refresh the game online. There is no Update game button.** Each navigation requests the latest published HTML, then saves it for offline play. The complete runtime is inline in that HTML, so a new page cannot mix new markup with old cached JavaScript. When the network is unavailable or the server returns an error, the saved game loads instead.

Background updates activate only after their offline assets have downloaded successfully. They never reload an open game, even if another tab or installed window is playing. Your current run keeps its loaded code; a refresh or new launch gets the new version. Personal bests and theme choices survive.

**Migrating from the original v3 app:** its cache-first worker may show the old page on your first online visit while the replacement downloads. Wait a moment and refresh once more if the old update button is still visible. There is no need to close other games, clear site data, or reinstall.

For every release that changes app assets, bump `VERSION` in `sw.js`. Cabinet artwork uses versioned paths under `assets/cabinet/v2/`; once published, keep those paths immutable. Put future artwork in a new version directory and update the CSS, render metadata and embedding script. `npm run embed:assets` embeds the matching cabinet geometry and generates the offline artwork list. Keep the manifest, service-worker asset list, and generated icons consistent. Pages may take a few minutes to publish; refreshing cannot fetch a deployment that the server has not published yet.

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

The environment catalog, progression and collision shapes live in `scripts/environments.js`; rebuild with `npm run embed:environments`. Production pixel art lives in `scripts/pixel-scenery.js`, `scripts/pixel-rider.js` and `scripts/flight-art.js`; rebuild with `npm run embed:flight-art`. That command embeds the renderers inline and verifies the service-worker manifest for `assets/flight/`: the cleaned registered rider and six separated palace layers. No runtime files reference `tools/`. Loading failures show an explicit notice and preserve playable legacy graphics and saved scores. Ship the regenerated `index.html`, `sw.js` and all seven PNGs together, and bump the worker version for later changes.

The scenery cache retains four recently used scene/theme pairs (about 21 MiB of raw background pixels), enough for both sides of a transition in both themes. Repeated frames reuse their six planes; older stages are rebuilt only when revisited after eviction.

Legacy fallback sprites (`scripts/sprite.js`), sounds (`scripts/sounds.js`), theme colors (`scripts/theme.css`) and legacy atmosphere (`scripts/atmosphere.js`) still use `npm run embed:assets`. The development character lab edits these legacy sources, not the selected production pixel rider. Published modules remain inline, requiring no external runtime scripts or client-side build.

Cabinet layout (`scripts/cabinet.css`), desktop arrival (`scripts/cabinet-stage.js`) and the local leaderboard (`scripts/leaderboard.js`) also use `npm run embed:assets`. Ship only optimized production artwork in `assets/cabinet/`, not the large development render studies or Blender runtime. The current source renderer is `scripts/render-cabinet-stage.py`; the original v1 renderer remains `scripts/render-production-cabinet.py`. Input models are development artifacts, not runtime dependencies.

The migration regression reads the actual v3 release (`440cfd9`) from Git history; use a full clone rather than a shallow checkout when running it.
