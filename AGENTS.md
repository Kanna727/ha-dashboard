# AGENTS.md

Guide for AI agents (and humans) working on this repo. Read this before changing anything.

**Owner-specific facts** (the HA instance, household, device quirks, local paths) live in `CLAUDE.local.md`, which is gitignored. Read it if it exists. Never copy anything from it, or from `config/dashboard.config.ts`, into tracked files.

**Keep this file current.** Any PR that changes behaviour, architecture, the build/deploy workflow, or uncovers a gotcha updates AGENTS.md in the same PR. Facts about the owner's own setup go in `CLAUDE.local.md` instead.

## What this is

A custom Home Assistant dashboard written in React. It is **not** Lovelace. It builds to a single self-contained `index.html`, served from HA's `/config/www/dashboard/` (URL `/local/dashboard/index.html`). The per-home config is stored in HA behind its login (see Config below). It talks to HA over the WebSocket API using `home-assistant-js-websocket`.

The idea came from a Reddit post about a custom HTML dashboard with kiosk self-update, sun-following themes and a separate phone layout. The owner asked for React specifically, so unlike that post this project uses npm.

Targets:
- **iPad kiosk** (Kiosker app), `?layout=tablet`
- **Android phone**, `?layout=phone`
- **Desktop browser**, `?layout=desktop`

## Privacy rules (the repo may become public)

- **No personal data in tracked files**: no names, emails, account or device IDs, addresses, coordinates, IPs, local paths, or details about the owner's HA setup. That applies to code, comments, docs, fixtures, screenshots and commit messages.
- Every entity ID and name lives in `config/dashboard.config.ts` (gitignored). The committed `config/dashboard.config.example.ts` describes a fictional home, and `mock/fixtures.ts` matches the example.
- `scripts/privacy-check.sh` greps tracked files for private patterns (`.privacy-patterns` locally, the `PRIVACY_PATTERNS` secret in CI). Enable the hook once per clone: `git config core.hooksPath .githooks`.
- README screenshots come from the mock build only.

## Stack and constraints

- **Vite is pinned to 5.x**, so the project still builds on Node 18. CI uses Node 22.
- React 18, TypeScript (strict), `@mdi/js` icons, `vite-plugin-singlefile`, esbuild (evaluates the TS config at build time). `ws` is a dev dependency only so `scripts/push-config.mjs` runs on Node < 22 (no global `WebSocket`).
- No UI library and no CSS framework. Plain CSS with custom properties lives in `src/styles/app.css`.
- `.npmrc` in the repo pins the public npm registry on purpose. Don't delete it.

## Layout

```
index.html                 Vite entry
vite.config.ts             singlefile plugin; dashboard-config plugin (virtual:dashboard-config, dist/dashboard-config.json);
                           defines __BUILD_HASH__ (the release version) from env BUILD_HASH
config/dashboard.config.example.ts   committed example (fictional home)
config/dashboard.config.ts           the real config, gitignored
src/main.tsx               boot: gets the config (embedded, device cache, or HA), then picks HaProvider or MockProvider
src/App.tsx                layout detection (?layout= or viewport), theme, self-update
src/config/types.ts        DashboardConfig schema (rooms, controls, energy, climate, car, media, meals, ...)
src/config/load.ts         config storage: CONFIG_DASHBOARD, device cache (dashConfig), fetchConfig
src/config/entities.ts     reads window.__DASHBOARD_CONFIG__ (EMPTY fallback) and re-exports ROOMS, ENERGY, ...; RECOVERY rules
src/ha/api.ts              HassApi interface + context (callService, fetchHistory, fetchLastStates, subscribeForecast, ...)
src/ha/HaProvider.tsx      real connection: OAuth via getAuth, subscribeEntities, history/forecast/todo WS calls;
                           exports haApi so main.tsx can fetch the config before React renders
src/ha/store.ts            external store; useEntity(id) / useEntities(ids) via useSyncExternalStore
src/ha/format.ts           isOn / num / fmtWatts / stateLabel helpers
src/panels/*               the dashboard panels: TopBar, EnergyPanel (flow diagram), WeatherPanel,
                           RoomsPanel, CommutePanel, CarPanel (+ car detail modal), MealsPanel, MusicPlayer (popup), useIssues
src/components/*           building blocks: Modal (ModalProvider + PanelHead), Sheet (long-press level), EntityTile, Icon,
                           and cards reused inside modals: ClimateCard, EnergyCard, AppliancesCard, MediaCard, Sparkline
src/commute/*              commute routes + Google Maps loader + full map (CommuteMap), used by CommutePanel's modal
src/styles/fonts.css       Plus Jakarta Sans (latin subset only), inlined into the bundle
src/layout/Layouts.tsx     TabletLayout (3 columns, each scrolls), DesktopLayout (4 columns), PhoneLayout (4 bottom tabs)
src/theme/useSunTheme.ts   auto (sun.sun) / dark / light; ?theme= override; localStorage persistence
src/update/useSelfUpdate.ts reloads when input_text.dashboard_build != "<version>/<config hash>"
mock/fixtures.ts           state snapshot matching the example config
mock/MockProvider.tsx      fake HassApi that applies service calls locally and jitters power sensors
src/lib/fanSpeed.ts        fan percentage snapping / what to send to HA (unit-tested)
scripts/deploy.py          manual deploy: build, copy index.html to the share, push config, set helper
scripts/push-config.mjs    saves dist/dashboard-config.json into HA and updates the helper (HA_URL + HA_TOKEN)
scripts/privacy-check.sh   blocks personal data in tracked files
.github/workflows/         ci.yml (PRs), release.yml (semantic-release + deploy over Tailscale)
docs/home-assistant.md     HA-side setup for automatic deploys
```

## Commands

```sh
npm install
npm run mock        # offline preview on :5173 with fake data (service calls logged to console)
npm run dev         # live; set VITE_HA_URL=http://homeassistant.local when running off-box
npm run typecheck
npm test            # vitest unit tests (src/**/*.test.ts)
npm run build       # tsc + vite build -> dist/index.html + dist/dashboard-config.json
python3 scripts/deploy.py                # manual deploy: app + config
python3 scripts/deploy.py --config-only  # after editing config/dashboard.config.ts
python3 scripts/deploy.py --build-only   # build with the real version, no copy
```

## Config (stored in HA)

- The release bundle is generic. All per-home data is in `config/dashboard.config.ts`, typed by `DashboardConfig` in `src/config/types.ts`. Keep it plain data: it travels as JSON.
- The `dashboard-config` Vite plugin evaluates it to `{ hash, config }` (hash = sha256 of the JSON, 8 chars). Dev and mock builds embed that via `virtual:dashboard-config` (mock always uses the example). Production builds embed `null` and write `dist/dashboard-config.json`. `DASHBOARD_CONFIG=<path>` overrides the source.
- In HA the `{ hash, config }` object is the whole config of a hidden storage-mode Lovelace dashboard, `dashboard-config` (not in the sidebar, `require_admin: false`). Unlike `/local/`, `lovelace/config` needs a logged-in user. `scripts/push-config.mjs` creates the dashboard if missing.
- Boot (`main.tsx`): use the embedded config, else the device cache (`localStorage.dashConfig`). With one, set `window.__DASHBOARD_CONFIG__` **synchronously, before any `await`**, then render. Without one (a device's first visit), connect (OAuth if needed), fetch with `lovelace/config`, cache it, and **reload**; the next load starts from the cache. If caching fails (storage blocked) it shows a message instead of looping.
- **Why the reload:** `vite-plugin-singlefile` inlines dynamic imports, so `import('./App')` is not lazy. Every app module runs as soon as `main.tsx` yields (its first `await`), whether or not the config has arrived. `entities.ts` therefore falls back to a complete `EMPTY` config so that module-level code (`TopBar`'s `LEAVE_ROOMS`, `MealsPanel`'s destructure) can't crash, and the app is never rendered with it. Don't add module-level code that assumes real config values, and don't move the window assignment after an `await`. The mock can't catch this (its config is embedded and set synchronously), so test the production boot as described under Verifying UI changes.
- When the helper's config half changes, `useSelfUpdate` fetches the new config into the cache before reloading.
- When adding a config key: update `types.ts`, both config files, the export list in `entities.ts`, and `mock/fixtures.ts` if it needs states. **New keys must be optional with defaults in `entities.ts`** (e.g. `ALERTS = { chime: true, doorOpenMinutes: 3, ...cfg.ALERTS }`): the config stored in HA can be older than the deployed app, and a required key it lacks would crash every screen. Push the real config to HA afterwards so its copy matches the file.

## Releases and deploys

- **Conventional Commits.** PRs are squash-merged and the PR title becomes the commit message, so the title must be `feat: …`, `fix: …`, `perf: …`, `docs: …`, `chore: …` and so on (CI checks it). `feat!:` or a `BREAKING CHANGE:` footer bumps the major version.
- On every merge to `main`, `release.yml` runs semantic-release. If there are `feat`/`fix`/`perf` commits since the last tag, it bumps the version, tags `vX.Y.Z`, commits `CHANGELOG.md` and `package.json` back (`chore(release)`, `[skip ci]`), and publishes a GitHub Release with `index.html` built from the example config. `docs`/`chore`-only merges make no release and deploy nothing.
- The deploy job joins the owner's tailnet (`tailscale/github-action`, OAuth client, `tag:ci`) and POSTs `{version, url}` to an HA webhook. `url` is a ~5-minute signed download link for the release asset (the repo is private). An HA automation checks the URL belongs to this repo, downloads it with the Downloader integration into `www/dashboard/`, and sets the helper. See `docs/home-assistant.md`.
- The release attaches `index.html` plus the app-install files from `public/` (`manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`), and the deploy job sends `{version, url, files: [{name, url}]}` with `index.html` last (`url` = index.html, for older automations). The automation only accepts those five names and this repo's asset URLs, downloads each in turn, and sets the helper only if every file arrived (a `failed` variable updated from inside the loop; else a persistent notification).
- In that automation the wait for `downloader_download_completed` runs **in parallel** with the download: `downloader.download_file` can block until the file is saved, so a wait started afterwards misses the event and times out.
- Running the Release workflow by hand (Actions → Release → Run workflow) redeploys the latest release when there is nothing new to release.
- **Helper format:** `input_text.dashboard_build` holds `"<app version>/<config hash>"`. The release automation replaces the first half; `deploy.py --config-only` replaces the second. Open pages reload when it differs from what they run. The `'dev'` version turns self-update off.
- The config is never deployed by CI (CI doesn't have it). Push it with `deploy.py --config-only` (needs `HA_URL` + an admin `HA_TOKEN`), or, as an agent with the HA MCP server, save `dist/dashboard-config.json` as the `dashboard-config` dashboard's config and update the helper's second half.
- Secrets/vars in GitHub: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `HA_WEBHOOK_ID`, `PRIVACY_PATTERNS`; variable `HA_TAILNET_HOST`. The deploy job skips with a warning if they are missing.

## Design

The visual design follows a reference screenshot the owner supplied: dark "panel" cards with uppercase letter-spaced labels, a greeting top bar with status pills and a big clock, tinted active states, and a chevron in each panel header that opens a detail modal.
- Panels (`.panel` + `PanelHead`) are the top-level cards. `.card` is the older, smaller card style, now only used inside modals.
- Detail views open through `useModal().open({ title, icon, accent, wide, subtitle, aside, body })`. The long-press level sheet (`Sheet.tsx`) sits above modals (z-index 60 vs 45).
- **Card → detail zoom:** `ModalProvider` remembers the `.room-row`/`.panel` under the last `pointerdown`. When the View Transitions API exists (and reduced motion is off), opening gives that card `view-transition-name: modal-origin`, then inside `document.startViewTransition(() => flushSync(...))` moves the name to the `.modal` (class `morph`, which skips the `pop` animation), so the card morphs into the modal; closing does the reverse and clears the name when the transition finishes. Otherwise the modal pops in as before. Only one element may carry the name at a time.
- **There is no quick-actions panel**; the owner removed it. The AC card is in a room modal (`detailCards: ['climate']`), and TV/media in another (`detailCards: ['media']`). There is no Goodnight button.
- **Leaving home** (`LeaveHomeButton` in `TopBar.tsx`, house-with-arrow icon) turns off every light and fan that is on in rooms with no presence sensor `on`. Rooms with no sensors always count as empty; read-only controls are skipped. The first tap shows "Turn off N?" (or "All off" when there is nothing to do), and a second tap within 4 s runs it. It only touches unoccupied rooms, so it never trips `*_fan_manual_off` trackers, which fire only when a fan goes off while its room is occupied.
- A room can have **appliances** (`washer`, `dishwasher`, `purifier`), shown in the room modal's Appliances card (only that room's, `AppliancesCard kinds=…`, fixed order dishwasher → washer → purifier). The washer and dishwasher also get **status buttons** on the room card that light up while a cycle runs; tapping one opens the room modal. They deliberately **never toggle power**: a washer on a smart plug could have its cycle cut by a stray tap. The purifier has **no button** (the owner removed it); it only adds "Purifier: <fault>" to the card's subtitle. A lone last card in the 2-column grid spans both columns. A half-width card with three buttons hides its room icon, since icon + three 46 px buttons don't fit, and `.row-buttons` keeps `margin-left: auto` so buttons stay right-aligned without the icon. A room with the washer shows "Off" rather than "Washer on" in its subtitle; other rooms with appliances still show "<control> on".
- **Fan speed slide:** a room whose `quick` is a fan draws that fan's speed as a blue fill behind its card (`.room-row-progress.fan`, empty when off), like the dishwasher's progress fill on Utility. Sliding horizontally across the card sets the speed via `hooks/useSlide.ts`: relative to the speed when the drag began (no jump to the finger), snapped to the fan's `percentage_step`, all the way left = `fan.turn_off`. The percentage sent is **floored** (16/33/50/66/83/100 for 6 speeds): HA maps percentage to speed with `ceil(pct * speeds / 100)`, so rounding 16.67 up to 17 selected speed 2 (and 67 selected 5); the subtitle shows "<fan> · speed n/N" while dragging, and ArrowLeft/Right adjust it when the card has focus. Taps still open the room or toggle a button, vertical drags still scroll (`touch-action: pan-y` on `.room-row.slidable`), and the click that ends a slide is swallowed so a slide never also toggles. The committed value is shown until HA reports it (or 4 s).
- **Ambient room-card motion** (`RoomsPanel.tsx` + the "Living room cards" block in `app.css`): lights on → `.room-glow` warm radial glow that breathes; quick fan on → a sheer curtain stirring in the draught, inside the fan fill. `.curtain` is card-wide (`10000 / value` % of the fill, which clips it, so raising the speed draws more of it into view) and holds 18 overlapping pleats (`<i>`, `--i` = −1…16; 16 across plus a spare at each edge so the hem never gaps). Everything pivots from the top edge with `skewX`, on three periods: `.curtain` leans and eases back (billow), each pleat swings about it with pleats further right lagging (a ripple runs across; every third swings more or less via `--m`), and `i::before` (the fold shading) flutters fast and small. `--sway` = 1.5 + 1.2 × speed degrees scales all three and `--fan-dur` = 3.6 − 0.3 × speed seconds sets the pace; the curtain is keyed by speed so the animations restart with the new `--sway` (it is read through `var()` inside the keyframes). History: the owner disliked rigid skewed stripes ("barber pole"), then straight streaks, then wavy air currents with motes; they asked for curtains waving with the fan speed. Keep the fabric soft and sheer so the card text stays readable. Hidden under reduced motion (`display: none` in the reduced-motion block); quick geyser on → `.room-heat` boiling water: a warm wash from the bottom that swells unevenly (`::before`, `heat-simmer`) and eight `<i>` bubbles rising from the bottom edge, growing and speeding up, then popping (swell and vanish); each bubble's `::before` wobbles and squashes. The climb is a multiple of the bubble's size (`translateY` in %), so bigger bubbles rise higher; columns, sizes and paces differ per `nth-child` (`--x/--s/--t/--d`). The owner found the earlier rising stripes unnatural. Bubbles rest at opacity 0; occupied → a ping ring on `.presence-dot`. Layers sit at `z-index: -1` inside the card's `isolation: isolate`, animate only `transform`/`opacity`, and stop under `prefers-reduced-motion`. Keep new card effects to those properties: the iPad runs this all day.
- Each room row shows temperature · humidity (where sensors exist) and up to two one-tap buttons. The **lights** button toggles every light in the room together. The second button comes from `quick` on the room: a fan, or a geyser. Tapping the row opens the room modal with every control. All rooms show at once in a 2-column grid of compact cards (icon and buttons on top, name and status below), in `ROOMS` order.
- The car-detail unlock button needs a second tap within 4 s. Locking is immediate.
- The car image is `CAR_DETAIL.image`, a path relative to `/local/dashboard/` (so not in the bundle). It falls back to an icon.
- The commute summary polls the Routes API only on mount, on manual refresh, and every 2 min inside the commute window. That keeps Google API usage low. The full map loads only when the modal opens.
- **Status dialog** (`panels/StatusDialog.tsx`, `useOfflineDevices.ts`): lists offline devices with a recovery button for each. A device counts as offline when all its primary (non-config, non-diagnostic) entities are `unavailable`. The device and entity registries come from `config/device_registry/list` and `config/entity_registry/list_for_display`, fetched once and cached for 30 min. Recovery is picked in this order:
  1. the device's own `button.*_restart` / `_reboot` / `_force_refresh`, if that button is available;
  2. Matter devices: restart the Matter Server app (`hassio.addon_restart`, `core_matter_server`);
  3. otherwise `homeassistant.reload_config_entry` targeted at the device.

  Every action needs a second tap within 4 s. Hints warn when a reload is account-wide (Alexa, Kia, Home Connect) or when the device is usually just switched off (TV, PCs). This lives in `RECOVERY` in `src/config/entities.ts`.
- Theme tokens are in `:root` / `[data-theme]` at the top of `app.css`. Grid tracks use `minmax(0, …)`, and `.col > *` has `min-width: 0`, so wide images can't blow out a column. Keep those.

## Loading, caching and connection status

- `src/ha/snapshot.ts` saves all entity states to `localStorage` (`dashSnapshot`, max age 24 h). It saves every 20 s when something changed, on `pagehide`/hidden, and right before a self-update reload. `HaProvider` hydrates the store from it before the first paint, so reloads draw the full dashboard immediately (about 80 ms) instead of a "Connecting…" screen. The spinner splash appears only on a device's very first load.
- The `HassApi` object in `HaProvider` is a **module-level constant**: its methods `await getConnection()`. Never put changing values on it. Connection status and user name come from `useHassStatus()` (`HassStatusContext`), with values `connecting` | `live` | `reconnecting`. An earlier version rebuilt the API object on every status change, which re-ran every `[hass]` effect (re-fetches, commute map rebuild) on each reconnect and caused flicker.
- The connection is a page-wide singleton that retries with backoff (2 s doubling up to 30 s). Only `ERR_INVALID_AUTH` clears tokens.
- `SyncIndicator` in the top bar shows "Syncing" or "Reconnecting" until live data arrives, then flashes "Synced" and hides.
- `useSelfUpdate` acts only when the status is `live`. The cached snapshot can hold an older helper value, and acting on it would loop reloads.
- `index.html` has a tiny pre-paint script that applies the last resolved theme (`dashThemeResolved`), so light mode doesn't flash dark. The font uses `font-display: block`, which is fine because it's inlined.
- In the mock, `?mockSync=1500` simulates a slow connect and `?mockSync=reconnect` stays in the reconnecting state. `?mockFreeze=1` makes it deterministic for screenshot tests: no power jitter and no artificial delays; fake history is always seeded (mulberry32), aligned to 10-minute slots. `window.__mockPatch(entityId, { state })` changes a mock state from puppeteer. It exists only in mock builds.

## Weather icons

`src/components/WeatherIcon.tsx` uses full-colour **Meteocons** art (`@bybas/weather-icons`, MIT, https://meteocons.com), imported with `?raw`.
- Each icon renders as an `<img>` data URI. Don't inline them as SVG: they reuse gradient ids (`a`, `b`, …) that collide in the DOM.
- Only the big "now" icon animates. The hourly/daily strips and the top pill get static copies (`<animate*>` tags stripped), to keep CPU low on the kiosk.
- Tweaks: raindrops are thickened (they almost vanish at 36–44 px); `cloudy` uses grey-recoloured overcast art; `pouring` gets a grey cloud with fatter drops, to tell it apart from `rainy`.
- The URI cache is keyed by the **full SVG string**. Recoloured variants share length and suffix with their source, and an earlier shorter key made them collide.
- On the light theme, `.wx-img` gets a soft drop shadow so white clouds stay visible.

## 3D car model

The car modal can show a 3D model of the owner's car instead of the photo (`CAR_DETAIL.model`, optional; without it, or when WebGL or the file fails, the photo stays).

- **Never commit model files.** Downloaded models (e.g. Sketchfab "Standard"/"Free Standard") may be used in the app but not redistributed. `.gitignore` covers `model-src/` (where the owner drops downloads), `*.glb` and `*.gltf`. The optimised `.glb` is copied by hand to HA's `/config/www/` (next to the car photo), so it is served from `/local/` but never in a release or the repo. Don't name the owner's car model in tracked files (the privacy check blocks it).
- **Optimising** (`scripts/car-model/`, its own `package.json`, not part of the app build or CI): `cd scripts/car-model && npm install && node optimize.mjs <scene.gltf> <out.glb> [--ratio 0.45] [--texture 1024]`. It runs dedup → prune (`keepLeaves`, so empty hinge/pivot nodes survive) → weld → meshopt simplify → resample (drops constant keyframes) → WebP textures ≤ 1024 px → meshopt compression; node names and animations are kept because the viewer finds doors, wheels and lamps by name. On Windows run it in the local build dir (`BUILD_DIR`; node_modules can't live on Google Drive). Keep its `sharp` on the same version that `@gltf-transform/functions` pulls in through `ndarray-pixels` (`npm ls sharp` must show one copy): two libvips copies in one process fail every encode with "colourspace: parameter space not set". The current model came out at ~308k triangles, 7.6 MB (from 500k, 35 MB).
- **Viewer** (`src/car3d/`): `viewer.ts` is an imperative three.js class (`CarViewer`); `CarScene.tsx` owns the canvas and React state. three.js is bundled into the single file (~+180 KB gzip). It uses `GLTFLoader` + `MeshoptDecoder` (inline, so no decoder files to deploy), `RoomEnvironment` reflections (`environmentIntensity` 0.8, or the ceiling lights bleach the roof), ACES tone mapping, a canvas-gradient contact shadow (no shadow maps) and `OrbitControls`.
  - **Loading:** the photo (`CAR_DETAIL.image`) shows first and crossfades to the canvas once loaded; a progress bar shows during the download. On any failure (no WebGL, 404, parse error) the stage stays on the photo (`.car-stage-view.failed`, shorter).
  - **Model cache:** the parsed model is cached per URL for the session. `dispose()` frees only GPU copies (geometry/material/texture `dispose`, `forceContextLoss`) and `stopAllAction()` puts animated parts back, so reopening the modal is instant.
  - **Rendering:** on demand. `setAnimationLoop` ticks, but only renders when the controls, a camera fly, a door animation or `invalidate()` changed something; it stops while the page is hidden.
  - **Framing:** the model is normalised to ~4.3 m long with wheels on y = 0. Its own axes come from the tyre node positions (`tire_FL/FR/RL/RR`): `frame.forward`, `frame.left`, and `frame.cabin` (eye point at 0.42 of the wheelbase from the rear, 0.7 × height). The camera starts at a front-left three-quarter view like the photo (`setViewOffset` nudges the car below/right of centre, clear of the fuel numbers). `fitDistance` uses the real aspect so phones fit the whole car.
  - **Turntable:** 1 turn/min. Dragging stops it, and it resumes 8 s after the last drag. Reduced motion: no turntable, instant camera moves.
  - **Inside:** the button flies the camera to `frame.cabin` and switches the controls to look-around (target 1 cm ahead, fixed distance, `rotateSpeed` −0.35, FOV 72°). Outside flies back and restores the limits. The fuel overlay is hidden while inside (`:has(.inside)`).
  - **Paint:** materials matching `CAR_DETAIL.model.paintMaterial` (default `carpaint`) get `color` = `paint`, metalness 0.6, roughness 0.35, plus clearcoat on physical materials. The owner's colour is in the private config; dark olives need a darker albedo than the photo's lit panels, because the environment adds a lot.
  - **Doors:** the model's single "Doors_Open" clip is split per door, by the tracks under each `door_XX_<n>` hinge node (`setDoor(corner, open)`).
  - **Mock builds** expose `window.__carViewer` for console poking. The example config points at `../car.glb`; drop a model at the mock site root to see it, and without one the photo fallback shows (so the visual baselines don't depend on a model).
- **Right-hand drive** (`model.rhd`, `CarViewer.rhd()`, baked once into the cached model via `root.userData.rhdDone`):
  - **What moves:** the front-interior module is reflected across the car's centre plane (normal `frame.left`), the way a real RHD car differs. Exterior, doors and seats stay put, so badges read normally.
    - Selection is a region symmetric left/right, so paired parts swap together: from 0.37 of the wheelbase ahead of the rear axle to 0.08 short of the front axle, within 45% of the width, 10–92% of the height.
    - Excluded: door subtrees and paint/glass materials.
    - Meshes fully inside the region move whole (only the top-most picked node, so children aren't reflected twice).
    - Meshes that straddle it are split by triangle: the inside triangles become a `<name>_rhd` mesh that moves. Needed because the low-detail body shell (`Object_37`) carries a hidden copy of the dashboard and steering wheel, which showed as a ghost on the passenger side.
  - **Keeping text readable:**
    - `split` (default `display`): the screen texture with each half flipped in place, so the cluster lands in front of the driver and both halves read correctly.
    - `keep` (default the steering-wheel logo): reflected again about its own centre, so it moves but isn't mirrored.
    - `flip`: materials whose texture text must be un-mirrored (u → 1 − u).
    - `include` / `exclude`: overrides for the selection.
  - **Passenger-side opening:** the model leaves the passenger kick area open (the wheel shows through). It was hidden on the right before; after mirroring it's covered, because the shell triangles move too.
- **Paint finish:** `model.gloss` (0 satin to 1 wet, default 0.4) maps to clearcoat 0.15→1, clearcoat roughness 0.4→0.06, roughness 0.6→0.3, metalness 0.25→0.6. `environmentIntensity` is 0.6. The owner found the earlier full clearcoat (metal 0.6) read white at some angles.
- **Number plates** (`model.plate`, `CarViewer.plates()`):
  - **Finding them:** the front plate is found by shape (thin textured panel ~0.35–0.7 × 0.07–0.22 m, centred, ahead of the front axle). The rear plate is any other mesh with that material.
  - **Broken rear plate:** in this model it's squashed flat (the source glTF has a stray vertex at x = 509503), so it is hidden and a copy of the front plate geometry (`rear_plate_copy`, added once) is placed at its centre, turned 180°.
  - **Texture:** the plate material gets a canvas texture in Indian high-security plate style (white, black border, hologram disc and "IND", bold condensed number; `flipY` false for glTF UVs). Its `emissiveMap` is dropped, because the model's plate also glows its placeholder text (the model name) through it.
  - **Privacy:** the owner's number lives only in the private config and HA. `.privacy-patterns` and the CI secret block it.
- **Car status on the model** (`src/lib/carVisual.ts`, pure and unit-tested → `CarViewer.setVisual` + `setFocus`): `useCarVisual` in `CarPanel.tsx` reads the openings (`CAR.doors`), the per-corner tyre states (last known while offline), the lock, `CAR.warnings`, the engine and the optional `CAR_DETAIL.status` entities (headlamps, turn signals, lamp faults, A/C, defrost, rear window heater, steering heater, seats).
  - **Doors:** the model's door clips open and close (instant on first sync and under reduced motion).
  - **Lamps:** headlamps swap each lamp's lit/unlit twin nodes (`<lamp>_Lights_On_<n>` next to `<lamp>_<n>`); any turn signal blinks the `_Turn_Signal_` twins (400 ms).
  - **Glass and heaters:** defrost tints the front/rear glass orange (the original colour is kept in `material.userData.baseColor`, because the parsed model is reused). Seat heaters, the steering heater and A/C are additive sprite glows, placed from the axle positions (seats) or the `steering_wheel` node.
  - **Callouts:** each sits at an `Anchor` (`tyre:XX`, `door:XX`, `hood`, `trunk`, `lampFront/Rear`, `fuel`, `cabin`), a point and outward normal from `CarViewer.anchor()`. The HTML labels are moved each rendered frame through `viewer.onFrame` (no React re-render), hidden when their normal faces away (dot < 0.25) or inside, and flipped left near the right edge. Placement: unlock and key battery at the driver's door (`model.driverSide`), washer/brake fluid and "engine running" at the bonnet, low fuel at the fuel flap, lamp faults front or rear by name. The all-tyres flag shows only if no corner does. While offline there are no door, lock, lamp or heater states, only last-known tyres.
  - **Auto-focus:** the anchors of warning callouts (`focusAnchors`) are visited in turn: a 1.6 s eased turn (shortest way round), a 3.5 s dwell, then 15 s of free turntable and repeat. A drag pauses it all for 8 s (`userHold`). Reduced motion jumps once to the first issue. `schedule()` owns `controls.autoRotate`.
  - **Inside view:** chips list the seat heat levels, steering heat, defrost and climate.
  - **Mock:** has the `CAR_DETAIL.status` entities (all off); turn them on with `__mockPatch`.
- **Remote actions** (`src/panels/CarActions.tsx`, optional `CAR_DETAIL.actions`):
  - **Climate:** with `actions.climate` (a `climate.*` entity), Comfort becomes a tile plus a target-temperature stepper (min/max/step from the entity, 14–30 °C in 0.5 steps for Kia). The stepper is local until a tap sends it, so stepping doesn't wake the car each time. Start = `climate.set_temperature` with `hvac_mode: auto`; while running, a changed temperature sends `set_temperature` alone and an unchanged tap stops it (`set_hvac_mode: off`). Without `actions.climate` the old `switch.*` toggle stays.
  - **Refresh / Hazards / Horn:** `button.press`. Hazards and Horn need a second tap within 4 s (like Unlock). Refresh shows "Waking car…" until `CAR_DETAIL.lastUpdated` changes (or 90 s). Buttons sit at `unknown` until first pressed; that counts as available.
  - **Find car** shows how old the location is (`status.locationUpdated`).
  - The mock simulates the refresh (the timestamp updates after 3 s) and `set_temperature` with a mode. Never press the real car's buttons to test without the owner's say-so.
- **CI bundle check:** three.js contains `light.color`/`light.direction`/`light.visible`, which match the entity-ID regex, so `ci.yml` filters those exact three.js property names. Real IDs like `light.kitchen_light` still fail the build.


## Phone app install

`public/manifest.webmanifest` (start URL `./index.html?layout=phone`, standalone) and icons, linked from `index.html`; Vite copies `public/` into `dist/` next to the single-file bundle. Chrome only offers "Install app" on HTTPS, so install from the Funnel/HTTPS address; on plain `http://homeassistant.local` it can only add a home-screen shortcut. iOS uses `apple-touch-icon.png` and the `apple-mobile-web-app-*` meta tags. The icons were rendered from the `homePower` MDI glyph on the dark tile (maskable-safe padding); re-render with headless Chrome if the look changes.

## Night mode

`components/NightMode.tsx` (mounted in `App.tsx`) fades to a black night screen after `NIGHT_MODE.idleMinutes` (default 5) without pointer/key/wheel input, only on `NIGHT_MODE.layouts` (default tablet) and, with `nightOnly` (default true), only while `sun.sun` is below the horizon. It shows a big dim clock, date, temperature and condition, the `SkyArc`, and `useIssues()`. The block drifts a few px per minute (`driftAt` in `src/lib/night.ts`, unit-tested with `nightActive`) against burn-in. A touch wakes it; that pointerdown and the following click are swallowed so nothing underneath gets pressed. While it's up, `html.night` pauses every other animation; toasts (z-index 90) still show above it (z-index 80). `?nightTest=1` makes it kick in after 5 s at any time, for checking. Kiosker's own screensaver should be off so the two don't overlap.

## Done and door alerts

`components/Alerts.tsx` (mounted in `App.tsx` inside `ToastProvider`) watches live data only, never the cached snapshot: the washer `running` flag going on → off, the dishwasher going from running (progress 0–100 %) to not, and any room or fridge door open longer than `ALERTS.doorOpenMinutes` (default 3, once per open episode). Decisions are in `src/lib/alerts.ts` (unit-tested; the first reading after load never counts). `components/Toasts.tsx` shows stacked banners top-right (full width on phones) for 15 s; tap to dismiss. `src/lib/chime.ts` plays a soft two-tone chime via Web Audio when `ALERTS.chime` (default true); the audio context is created/resumed on the first touch because iOS blocks audio until then, so the chime is silent before any interaction. To test in the mock: `__mockPatch('input_boolean.washing_machine_running', { state: 'off' })` after it was on; for doors, shift `Date` forward past the limit.

## Water purifier

Optional `APPLIANCES.purifier` (an Atomberg-style RO purifier with TDS sensors), shown in the room that lists `'purifier'` in `appliances`.
- `components/usePurifier.ts` reads the entities; the maths is in `src/lib/purifier.ts` (unit-tested): `% removed` = 1 − tank/input TDS, and "In/Above/Below target" against the range in the mode's name (`TasteTune 50-100 ppm`; RO only, Adaptive and Vacation have none).
- Room card: no button (removed at the owner's request); while any `faults` entity is on, the subtitle shows "Purifier: <fault>".
- Modal (`components/PurifierRow.tsx`): fault banners, drinking-water TDS, input TDS and % removed, tank full / not full, a 7-day TDS sparkline, mode chips, "Updated Xh ago" from `lastReported`, and Refresh (`button.press`; "Refreshing…" until `lastReported` changes or 60 s).
- **TDS chart:** `fetchHistory`; the `Sparkline` takes a `color` and uses a `useId` gradient id so two can share a page. A purifier that reports rarely may have a single reading in the recorder, so the chart starts at the first reading (`chartStart`, captioned "since 1:05 AM", plus "· no change yet" for one point) instead of drawing nothing, and is hidden when there are no readings at all.
- **Mode changes need two taps** (the first arms the chip as "Tap again", the second within 4 s calls `select.select_option`), so a stray tap can't put it in Vacation mode. While the mode is Adaptive, the fallback mode is shown.
- `useIssues` adds a `warn` issue "Purifier: <fault>" per active fault, so faults reach the top bar and the night screen.
- Mock: `__mockPatch('binary_sensor.water_purifier_no_water', { state: 'on' })` shows a fault; the mock handles `select_option` and simulates the refresh (new report after 3 s); TDS history is seeded readings every 3 h over the last 2 days (so the chart shows "since …").

## Forecast sharing and the rain nudge

Forecasts come from `useForecast(hass, entity, 'daily'|'hourly')` in `src/ha/forecast.ts`: one HA subscription per entity and type for the whole page, started by the first user and stopped with the last, so the Weather card, the rain nudge and night mode don't each subscribe. `src/lib/rain.ts` (unit-tested) flags the first hourly slot in the next 3 hours that is rainy (or has > 0.2 mm, or ≥ 60 % probability) while the weather entity isn't already rainy; `useIssues` adds it as an `info` issue: "Rain likely soon" (current hour) or "Rain likely around 4 PM". Hourly forecasts only resolve to the hour, so never word it in minutes.

## Sun and moon arc

`src/components/SkyArc.tsx` (in the Weather card, under the current conditions; it replaced the sunrise/sunset chip) draws the sun's arc from sunrise to sunset by day and the moon's from sunset to sunrise by night, with a dot for "now" that glides between once-a-minute positions. The maths is in `src/lib/sky.ts` (unit-tested): `sun.sun` only gives the *next* rising/setting, so today's sunrise is `next_rising − 24 h` by day and the last sunset `next_setting − 24 h` by night. HA has no moon sensor, so the phase is computed from the synodic month against a reference new moon, and `moonLitPath` draws the lit part (right while waxing, left while waning). Night mode reuses the component.

## Weather backdrop

`src/components/WeatherBackdrop.tsx` animates the Weather card's background from the weather entity's state plus `sun.sun` (day or night). Scenes: clear (sun rays, or stars and a moon glow), partly cloudy, cloudy, rain (heavy for `pouring`), storm (rain plus flashes), fog, snow and wind.
- Transform/opacity animations only, no blur filters. Particle counts are capped (38 drops, 70 for heavy rain) so the kiosk can run it all day.
- Clouds and fog are a 200%-wide repeating background tile slid by −50% for a seamless loop.
- Particle positions are deterministic (seeded), so re-renders don't make them jump.
- The panel needs `position: relative; overflow: hidden; isolation: isolate`. Its content sits at z-index 1, and the forecast tiles are semi-transparent so the sky shows through.
- `prefers-reduced-motion` stops everything via the global rule.
- To preview a scene in the mock: `__mockPatch('weather.forecast_home', { state: 'rainy' })` and `__mockPatch('sun.sun', { state: 'below_horizon' })`.

## Home energy panel

The panel shows a tree: Home total on the left, with a branch to each of the top 4 live consumers (≥ 5 W) stacked on the right. Each consumer row has its watts and a share-of-total bar. The card height is computed from the row count (`ROW_H`/`ROW_GAP`/`MIN_H` in `EnergyPanel.tsx`), so it never leaves gaps. No grid/solar node and no AC kWh tiles. The 24h peak sits in the panel header. `HOME_X`/`ROWS_X` in the TSX must match `.ef-home` `left` and `.ef-rows` `left` in the CSS.

Each branch is a faint `.flow-track` plus `.flow-particles`: zero-length dashes with round caps flowing home → consumer. `src/lib/energyFlow.ts` (unit-tested) maps each plug's **own** watts (never its share of the biggest consumer: relative speeds made a 500 W and a 600 W plug look identical, and a lone plug always raced) to a level 0–8 on a log scale (each level doubles the watts from 10 W; speed 10 × 1.35^level px/s, ~10–110 px/s). Levels are whole steps with hysteresis (a reading must move 0.75 of a level past the current one; `EnergyPanel` keeps each plug's level in a ref), because changing `animation-duration` mid-run makes the dots jump. Density buckets come from the level too (light ≤ 4 < medium ≤ 6 < heavy, about 230 W and 900 W; gap 26/18/12 px, each with its own `@keyframes` shifting exactly one gap so the loop is seamless). Branches are short on the tablet (~40 px), so the speed spread is deliberately wide. Watt values render through the `Watts` component with `useTweenedNumber` (ease-out glide, rAF only while changing, skipped under reduced motion), kept as a leaf so per-frame re-renders stay small.

**Smart plugs are discovered automatically; there is no plug list to maintain.** A plug is a power sensor (`device_class: power`, `state_class: measurement`, W or kW) on a device that also has a `switch.*` entity. That takes in smart sockets and leaves out bulbs' power sensors (no switch), sensors without a state_class, and totals (no device). New plugs must show up with no setup, so keep both sides of the rule in sync:
- **HA:** `ENERGY.total` is a template helper that sums every reporting plug by looping over `states.sensor` with this rule; its availability template uses the same loop. (A `min_max` sum goes `unknown` as soon as one plug is unavailable, which blanked the circle, the peak and the chart.)
- **Dashboard:** `usePowerPlugs()` in `components/useHomePower.ts` applies the rule to the shared registry (`ha/registry.ts`, refreshed every 30 min, also used by the status dialog) and caches the list in `localStorage` (`dashPowerPlugs`) so reloads draw the rows at once. `ENERGY.plugs` only gives known plugs short names and fixed colours. A new plug is named from its HA friendly name minus " Power", with an icon and colour guessed from that name (`PLUG_GUESSES`), so renaming it in HA controls its label. `useHomePower()` adds the offline list for the "X offline · total excludes them" note, and sums the plugs itself if the total sensor is missing. `fetchHomePowerHistory()` fills the start of the 24h window from `ENERGY.legacyTotal`. The Power popup lists every plug drawing ≥ 1 W.
- **30-day history** (Power popup, `EnergyHistory` in `components/EnergyCard.tsx`): `HassApi.fetchStatistics` → `recorder/statistics_during_period` (daily `mean`, long-term statistics, so beyond the recorder's ~10 days). `src/lib/energyHistory.ts` (unit-tested) turns mean W into kWh (× 24 h ÷ 1000; today × hours elapsed), splices `ENERGY.total` over `ENERGY.legacyTotal` per day, and averages complete days only. Bars grow in (transform `scaleY`, staggered); today's is hatched; tap a bar to read its day.
- Mock: the fixtures include an unlisted `sensor.bedroom_heater_power` plug and a bulb power sensor, to check discovery. `__mockPatch('sensor.bedroom_heater_power', { state: '900' })` puts the heater on the panel.

## Architecture rules

- **Every entity ID lives in the config** (`config/dashboard.config.ts`, mirrored by the example). Components read it through `src/config/entities.ts` and never hardcode IDs. (Exceptions: power plugs are discovered at runtime, and `BUILD_HELPER` is fixed.) To add a device, add it to the right room's `controls`. Anything that isn't a room control (energy, car, and so on) goes in its own section.
- **Read state with `useEntity` / `useEntities`**, never with a React context of all states. Power sensors tick every few seconds, and the per-entity store keeps re-renders local. `useEntities` returns a stable array reference when nothing has changed, so keep it that way.
- **Write through `useHass().callService`**. Both providers implement `HassApi`. If you add a new HA capability (a new WS command), add it to the interface in `api.ts` and implement it in **both** `HaProvider.tsx` and `mock/MockProvider.tsx`.
- `readOnly: true` on a control shows its state but blocks toggling. Don't remove it from a control without asking the owner.
- Lights and fans: tap toggles, long-press (450 ms) opens the level sheet. `useLongPress` cancels when the pointer moves, so scrolling on a phone never toggles anything. On the room cards, a horizontal slide sets the quick fan's speed (`useSlide`); keep both gestures' thresholds so taps, scrolls and slides never overlap.
- The mock provider must never end up in the production bundle. `main.tsx` only lazy-imports it when `import.meta.env.VITE_MOCK` is set. CI checks `grep -c MockProvider dist/index.html` is `0`, and that no entity IDs are in the bundle.

## Auth and security

- HA serves `/local/` **without authentication**. Never put tokens, API keys, secrets or personal data in the bundle.
- The live provider uses HA's OAuth flow (`getAuth`). Each device logs in once, and tokens are stored in that device's `localStorage` under `hassTokens`. `cleanAuthParams()` strips `auth_callback/code/state` after login.
- `deploy.py` reads `HA_TOKEN` from the environment only. It never writes the token to disk or into the build.
- Whoever can write `www/dashboard/index.html` can run code next to every device's HA tokens. That's why the deploy webhook only accepts download URLs of this repo's release assets, and its ID is a secret.
- Any public HA URL (Nabu Casa remote UI, Tailscale Funnel) exposes `/local/` to the internet, and such hostnames show up in certificate-transparency logs. That is why the per-home config lives behind the login and not in `/local/`.
- HA's HTTP server settings (port, reverse proxy, IP ban) are UI-managed since 2026.8 (Settings → System → Network → HTTP server), not `configuration.yaml`. Behind a reverse proxy such as Funnel, "Trust X-Forwarded-For" must be on with the proxy's address trusted; a request carrying `X-Forwarded-For` from any other address gets HTTP 400.

## Verifying UI changes

- Always run `npm run typecheck`, `npm test` and `npm run build`. CI and the Release workflow run all three.
- **Unit tests** (`vitest`, config in `vitest.config.ts`) cover pure logic: fan-speed snapping (`src/lib/fanSpeed.ts`), meal "Next up", plug discovery, `relTime`/`num`, weather hours/night, car distance, commute card extraction. They run in plain Node; `src/test/setup.ts` sets `window` to the global object and loads the example config, as `main.tsx` does. Put new pure helpers somewhere importable without React rendering and add a test beside them (`*.test.ts`, never imported by the app, so never bundled). vitest stays on 3.x: 4.x needs Vite 6+ and Node 20+.
- Take visual checks against a **production-mode mock build**, not the dev server. The dev server loads `@mdi/js` slowly, and headless screenshots then capture half-loaded pages.
  ```sh
  VITE_MOCK=1 npx vite build --outDir <scratch>/dist-mock --emptyOutDir
  ```
  Serve it (`python -m http.server`) and use `puppeteer-core` with the local Chrome, installed in the **scratch dir, not the repo**. Wait for the forecast (`.wx-img`) before capturing. Chrome's `--screenshot` flag fires before async data lands, and `--virtual-time-budget` hangs (clock and jitter intervals).
- `page.setViewport` gives exact phone sizes; or wrap the page in an HTML file with a 412×915 iframe.
- Sizes checked so far: 1180×820 (iPad landscape), 412/600 wide (phone), 1920×1080 (desktop), in both themes.
- **Visual checks in CI** (`npm run test:visual`, Playwright, `playwright.config.ts`, `tests/visual/`): the `visual` CI job builds the mock, serves it with `vite preview` on :4173 and screenshots tablet (1180×820), phone (412×915) and desktop (1920×1080) in both themes with `?mockFreeze=1`, a fixed clock (`page.clock.setFixedTime`), UTC, en-US and reduced motion, comparing against `tests/visual/__screenshots__` (1 % pixel tolerance). Diffs are uploaded as the `visual-diffs` artifact on failure. Baselines must come from Linux: after an intended visual change, add the `update-baselines` label to the PR (or run the **Update visual baselines** workflow on its branch: `gh workflow run visual-baselines.yml --ref <branch>`), which commits new baselines there, then re-run CI on the branch (`gh workflow run ci.yml --ref <branch>`). Locally, `PW_CHANNEL=chrome npx playwright test` runs against an installed Chrome; don't commit baselines made on Windows/macOS.
- README screenshots live in `docs/screenshots/` and come from the mock build only.
- **Test the production boot before releasing** anything that touches `main.tsx`, `config/load.ts`, `entities.ts`, `HaProvider` or `useSelfUpdate`: build with `BUILD_HASH=dev` (turns self-update off), copy `dist/index.html` to `www/dashboard-test/index.html` on the share, and have the owner open `/local/dashboard-test/index.html?layout=phone&v=<anything>` while logged in. Delete the folder afterwards. An agent can't log in, so the owner has to check it; an agent can still read the console in its own browser for errors before the login redirect.
- HA serves `/local/` with `Cache-Control: public, max-age=2678400` (31 days). A re-copied test page needs a fresh `?v=` or the browser keeps the old file. Kiosks are covered: self-update reloads with `?v=<helper value>`.

## HA MCP notes (for agents with the home-assistant MCP server)

- Write tools such as `ha_config_set_helper` run in strict best-practices mode. Read `ha_get_skill_guide(skill="home-assistant-best-practices", file=...)`, then pass the `BestPracticeKey` it gives you. The key rotates hourly, so don't reuse an old one.
- Use `ha_search` with `domain_filter` to find entity IDs, and `ha_get_state` for attributes (e.g. `hvac_modes`, a fan's `percentage_step`).
- Ask the owner before changing existing automations, dashboards or entity IDs.

## Commute card (`src/commute/`)

- A React port of the owner's inline Lovelace resource `custom:commute-traffic-map`. Same features: Google Maps with a traffic layer, Routes API v2 alternates coloured by live speed, car/two-wheeler toggle, swap direction, Places search with a 5-minute override and recents, compact map, a leave-later comparison (+15/30/45 min), a heavy-traffic banner and a stale-data indicator.
- **The API key and coordinates are not in this repo.** At runtime `CommuteCard` calls `lovelace/config` for `COMMUTE.dashboard` over the authenticated WebSocket, then `extractCommuteConfig()` finds the card (nested stacks included). Never hardcode the key; `/local/` is public. CI checks `grep -c AIza dist/index.html` is `0`.
- The commute window (days and hours) is `COMMUTE` in the config. Auto-refresh (every 2 min), the leave-later comparison and the traffic alert only run inside that window, or while a searched destination is active.
- Browser notifications are left out: the iPad WebView doesn't support them, and a permission prompt on a kiosk is noise.
- The map is rebuilt when the theme flips, because Maps `colorScheme` can only be set at creation.
- The mock returns no Lovelace config, so the card shows its "not configured" message. The real map can only be tested on the deployed page after login.
- If the Routes API returns a bare 403 ("caller does not have permission"), check billing on the key's Google Cloud project first; `computeRouteMatrix` or the legacy Directions endpoint name the billing problem.

## Gotchas

- **Car offline:** when the car's lock and fuel entities are both `unavailable` (the Kia Connect integration isn't returning data, typically an expired login; HA raises no repair or reauth flow for it), `CarPanel` treats the car as offline. It fetches the last numeric fuel/range/odometer/12V-battery readings from 14 days of history and shows them dimmed with "Offline · <age>", in the card and the detail modal. That query takes seconds on the Pi, so `loadLastKnown` keeps **one module-level result shared by the card and the modal** (in-flight request deduped, reused for 10 min, dropped when the car is back); a per-component fetch left the modal blank until it returned. Tyre warnings are back-filled too, via `fetchLastStates` (newest non-unavailable state per entity; `fetchHistory` keeps only numbers): dimmed, with a "Tyre pressure: last known, from <age>" note, and a last-known low tyre shows a "Low tyre (last known)" chip. Doors and lock are deliberately **not** back-filled: a stale "closed"/"locked" would mislead, so they stay unknown; the panel gets a "Kia Connect not responding" chip instead of the lock chip, and the detail modal a `.notice-banner` telling the owner to reconfigure the integration in HA. Lock is disabled and lock/door state reads "unknown"; never present an unavailable lock as "Unlocked". In the mock, `__mockPatch` the lock, fuel, range and odometer to `unavailable` to see it (mock history returns fixed car readings from 3 h ago, after a 1.5 s delay to mimic the Pi).
- `relTime()` returns '' for missing or unparseable times, so an unavailable timestamp sensor never renders as "NaNd ago". A sleeping dishwasher shows "Asleep".
- `app.css` has a global `.stale` class (red, bold; the commute card's stale-data indicator). Don't reuse that name for other states; the car's dimmed last-known tyres use `.last-known`.
- The theme is applied in a layout effect. The body background transition only switches on after the first second (`html.theme-anim`), to avoid a dark flash on load.
- The AC setpoint is clamped to 16–30 °C in the UI, even though devices may report a wider range.
- Fan tile icons (`mdiCeilingFan`, a side view) spin around the vertical axis (`spin-y`), not in a flat circle. That's what the owner asked for.

## Fan manual-override indicator

Fans can have an `input_boolean.*_fan_manual_off` flag (map: `FAN_MANUAL_OFF` in the config). While it's on, the fan's automations won't turn the fan on. `useHeldFans(room)` in `RoomsPanel.tsx` finds the held fans. A room with one shows a red edge and tint on its card (`.room-row.fan-held`), a "<fan> on manual override" note, a red lock badge on the fan button when it's the card's quick fan, and a banner in the room popup. Display only; the dashboard never changes the flag. The mock fixtures set the bedroom flag on.

## Top bar now-playing pill

`NowPlayingPill` in `TopBar.tsx` shows the first `MUSIC_PLAYERS` entity that is `playing`, else the first `paused` one (`activePlayers` in `MusicPlayer.tsx` lists playing then paused players; with several, swipe the pill or the popup sideways to cycle them, via `hooks/useSwipe.ts`, with dots as the indicator; paused shows a pause icon, "Paused ·" and dimmed art). It shows art or a note icon, title, artist · room and an animated equalizer, and renders nothing when all are idle. Tapping it opens the Music player (`panels/MusicPlayer.tsx`) in a modal; there is no Music panel. On the tablet it is capped at 200 px with the equalizer hidden, so the greeting still fits next to the clock. `conditionLabel` stays exported from `TopBar.tsx` because `WeatherPanel` uses it.

## Meals panel

`panels/MealsPanel.tsx` shows the day's delivered meals per person from `MEALS` in the config (days without a plan show "No delivery planned"). Today/Tomorrow toggle, and the next meal is highlighted with a "Next up" tag: the first slot whose `end` (HH:MM) hasn't passed, else tomorrow's first slot, at which point the panel defaults to the Tomorrow tab. Each row shows the eating window (`time`); `delivery` is informational. The chevron opens the week: only the days that have a plan (Monday first, Sunday last; `plannedDays`), plus the kitchen notes when `notes` isn't empty. It sits last in tablet column 3, column 3 on desktop, and the phone's More tab. `fetchTodo` in the API is left unused.

## Building on Windows

A repo on Google Drive can't hold `node_modules` (`npm install` fails with EBADF). Set `BUILD_DIR` to a local folder and `deploy.py` mirrors the sources there, installs and builds. The default share target on Windows is `\\homeassistant.local\config\www\dashboard`. The `npm run mock` script uses POSIX env syntax; on Windows run `VITE_MOCK=1 npx vite build` from Git Bash in the build dir and serve with `python -m http.server`.

## Ideas not built yet

- An iPad screensaver or dim mode driven by the kiosk app's screensaver sensor.
- Presence-based room highlighting on the phone.
- Camera cards, since no cameras exist yet.
- An energy history view (daily kWh) using the long-term statistics WS API.
