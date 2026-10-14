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
- When adding a config key: update `types.ts`, both config files, the export list in `entities.ts`, and `mock/fixtures.ts` if it needs states.

## Releases and deploys

- **Conventional Commits.** PRs are squash-merged and the PR title becomes the commit message, so the title must be `feat: …`, `fix: …`, `perf: …`, `docs: …`, `chore: …` and so on (CI checks it). `feat!:` or a `BREAKING CHANGE:` footer bumps the major version.
- On every merge to `main`, `release.yml` runs semantic-release. If there are `feat`/`fix`/`perf` commits since the last tag, it bumps the version, tags `vX.Y.Z`, commits `CHANGELOG.md` and `package.json` back (`chore(release)`, `[skip ci]`), and publishes a GitHub Release with `index.html` built from the example config. `docs`/`chore`-only merges make no release and deploy nothing.
- The deploy job joins the owner's tailnet (`tailscale/github-action`, OAuth client, `tag:ci`) and POSTs `{version, url}` to an HA webhook. `url` is a ~5-minute signed download link for the release asset (the repo is private). An HA automation checks the URL belongs to this repo, downloads it with the Downloader integration into `www/dashboard/`, and sets the helper. See `docs/home-assistant.md`.
- In that automation the wait for `downloader_download_completed` runs **in parallel** with the download: `downloader.download_file` can block until the file is saved, so a wait started afterwards misses the event and times out.
- Running the Release workflow by hand (Actions → Release → Run workflow) redeploys the latest release when there is nothing new to release.
- **Helper format:** `input_text.dashboard_build` holds `"<app version>/<config hash>"`. The release automation replaces the first half; `deploy.py --config-only` replaces the second. Open pages reload when it differs from what they run. The `'dev'` version turns self-update off.
- The config is never deployed by CI (CI doesn't have it). Push it with `deploy.py --config-only` (needs `HA_URL` + an admin `HA_TOKEN`), or, as an agent with the HA MCP server, save `dist/dashboard-config.json` as the `dashboard-config` dashboard's config and update the helper's second half.
- Secrets/vars in GitHub: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `HA_WEBHOOK_ID`, `PRIVACY_PATTERNS`; variable `HA_TAILNET_HOST`. The deploy job skips with a warning if they are missing.

## Design

The visual design follows a reference screenshot the owner supplied: dark "panel" cards with uppercase letter-spaced labels, a greeting top bar with status pills and a big clock, tinted active states, and a chevron in each panel header that opens a detail modal.
- Panels (`.panel` + `PanelHead`) are the top-level cards. `.card` is the older, smaller card style, now only used inside modals.
- Detail views open through `useModal().open({ title, icon, accent, wide, subtitle, aside, body })`. The long-press level sheet (`Sheet.tsx`) sits above modals (z-index 60 vs 45).
- **There is no quick-actions panel**; the owner removed it. The AC card is in a room modal (`detailCards: ['climate']`), and TV/media in another (`detailCards: ['media']`). There is no Goodnight button.
- **Leaving home** (`LeaveHomeButton` in `TopBar.tsx`, house-with-arrow icon) turns off every light and fan that is on in rooms with no presence sensor `on`. Rooms with no sensors always count as empty; read-only controls are skipped. The first tap shows "Turn off N?" (or "All off" when there is nothing to do), and a second tap within 4 s runs it. It only touches unoccupied rooms, so it never trips `*_fan_manual_off` trackers, which fire only when a fan goes off while its room is occupied.
- A room can have **washer and dishwasher status buttons** (`appliances`). They light up while a cycle runs, and tapping one opens the room modal with the Appliances card. They deliberately **never toggle power**: a washer on a smart plug could have its cycle cut by a stray tap. A lone last card in the 2-column grid spans both columns.
- **Fan speed slide:** a room whose `quick` is a fan draws that fan's speed as a blue fill behind its card (`.room-row-progress.fan`, empty when off), like the dishwasher's progress fill on Utility. Sliding horizontally across the card sets the speed via `hooks/useSlide.ts`: relative to the speed when the drag began (no jump to the finger), snapped to the fan's `percentage_step`, all the way left = `fan.turn_off`. The percentage sent is **floored** (16/33/50/66/83/100 for 6 speeds): HA maps percentage to speed with `ceil(pct * speeds / 100)`, so rounding 16.67 up to 17 selected speed 2 (and 67 selected 5); the subtitle shows "<fan> · speed n/N" while dragging, and ArrowLeft/Right adjust it when the card has focus. Taps still open the room or toggle a button, vertical drags still scroll (`touch-action: pan-y` on `.room-row.slidable`), and the click that ends a slide is swallowed so a slide never also toggles. The committed value is shown until HA reports it (or 4 s).
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

**Smart plugs are discovered automatically; there is no plug list to maintain.** A plug is a power sensor (`device_class: power`, `state_class: measurement`, W or kW) on a device that also has a `switch.*` entity. That takes in smart sockets and leaves out bulbs' power sensors (no switch), sensors without a state_class, and totals (no device). New plugs must show up with no setup, so keep both sides of the rule in sync:
- **HA:** `ENERGY.total` is a template helper that sums every reporting plug by looping over `states.sensor` with this rule; its availability template uses the same loop. (A `min_max` sum goes `unknown` as soon as one plug is unavailable, which blanked the circle, the peak and the chart.)
- **Dashboard:** `usePowerPlugs()` in `components/useHomePower.ts` applies the rule to the shared registry (`ha/registry.ts`, refreshed every 30 min, also used by the status dialog) and caches the list in `localStorage` (`dashPowerPlugs`) so reloads draw the rows at once. `ENERGY.plugs` only gives known plugs short names and fixed colours. A new plug is named from its HA friendly name minus " Power", with an icon and colour guessed from that name (`PLUG_GUESSES`), so renaming it in HA controls its label. `useHomePower()` adds the offline list for the "X offline · total excludes them" note, and sums the plugs itself if the total sensor is missing. `fetchHomePowerHistory()` fills the start of the 24h window from `ENERGY.legacyTotal`. The Power popup lists every plug drawing ≥ 1 W.
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

`panels/MealsPanel.tsx` shows the day's delivered meals per person from `MEALS` in the config (days without a plan show "No delivery planned"). Today/Tomorrow toggle, and the next meal is highlighted with a "Next up" tag: the first slot whose `end` (HH:MM) hasn't passed, else tomorrow's first slot, at which point the panel defaults to the Tomorrow tab. Each row shows the eating window (`time`); `delivery` is informational. The chevron opens the whole week plus the kitchen notes. It sits last in tablet column 3, column 3 on desktop, and the phone's More tab. `fetchTodo` in the API is left unused.

## Building on Windows

A repo on Google Drive can't hold `node_modules` (`npm install` fails with EBADF). Set `BUILD_DIR` to a local folder and `deploy.py` mirrors the sources there, installs and builds. The default share target on Windows is `\\homeassistant.local\config\www\dashboard`. The `npm run mock` script uses POSIX env syntax; on Windows run `VITE_MOCK=1 npx vite build` from Git Bash in the build dir and serve with `python -m http.server`.

## Ideas not built yet

- An iPad screensaver or dim mode driven by the kiosk app's screensaver sensor.
- Presence-based room highlighting on the phone.
- Camera cards, since no cameras exist yet.
- An energy history view (daily kWh) using the long-term statistics WS API.
