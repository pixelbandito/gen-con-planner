# Desktop App Feasibility Study & Implementation Plan

**Date:** 2026-05-17
**Branch:** `explore/desktop-app`
**Status:** Planning only — no code changed by this document.

---

## 1. Summary & Verdict

**Verdict: Feasible, low-risk, recommended. Go.**

Gen Con Planner is unusually well-suited to becoming a desktop app. Three facts
make this easy:

1. The renderer is already a self-contained Vite + React SPA with no
   server-side rendering — `npm run build` produces a static `dist/` that runs
   from `file://`-ish contexts today (it is deployed to GitHub Pages).
2. The "backend" is small, dependency-free, and already cleanly separated:
   `server/gencon.mjs` is plain Node ESM that only does `fetch()` against
   `gencon.com` (no auth, no native modules, no database). The proxy
   (`server/gencon-proxy.mjs`) is a thin layer of route handlers + on-disk JSON
   caching on top of it.
3. The client (`src/lib/api.ts`) talks to the backend over plain HTTP at
   `/api/gencon/*`. If the desktop app exposes those same routes on a localhost
   port, **the renderer needs zero changes** to get live search.

The only genuinely hard part is not code — it is **code signing and
notarization**, covered honestly in §6. The recommended path explicitly defers
that: ship an unsigned `.dmg` first, prove the architecture, then decide
whether the signing cost is worth paying.

**Recommended framework: Electron.** Reasoning in §3.

**Smallest viable first milestone:** an unsigned macOS `.dmg` that launches the
existing SPA and performs live Gen Con search via a bundled Node proxy. No
signing, no Windows, no auto-update. See §9.

---

## 2. What we are starting from (codebase facts)

Verified by reading the worktree:

- **`src/`** — React 18 + TypeScript SPA. Entry `src/main.tsx`, root
  `src/App.tsx`. The wishlist persists to `localStorage`; conflict/schedule
  logic is pure and client-side.
- **`src/lib/api.ts`** — typed wrappers that `fetch()` absolute paths
  `/api/gencon/systems`, `/api/gencon/categories`, `/api/gencon/events`,
  `/api/gencon/events-by-id`. `fetchCachedEvents()` already has an **offline
  fallback**: if `/api/gencon/events` fails it loads
  `${BASE_URL}data/events.json` instead.
- **`server/gencon.mjs`** — pure Node ESM: `fetchGameSystems`,
  `fetchCategories`, `fetchEvents`, `fetchCategoryEvents`, `fetchSearchEvents`,
  `fetchEventById`, plus helpers (`cacheSlug`, `isStale`, `normalizeEvent`).
  Uses only the global `fetch` and standard library. **No native deps.**
- **`server/gencon-proxy.mjs`** — a **Vite plugin**. Its `middleware(req, res,
  next)` function implements every `/api/gencon/*` route, with on-disk caching
  under `cache/` (gitignored) and seed-from-bundle logic. The plugin factory
  `genconProxy()` registers that middleware on both `configureServer` (dev) and
  `configurePreviewServer` (preview). The route logic and the Vite-plugin
  wrapper are currently **fused in one file**.
- **`public/data/events.json`** — committed ~6.25 MB dataset (21 collections,
  ~4000 events) in `{ collections: [{ kind, name, fetchedAt, events }] }` shape.
  Serves two roles: the proxy's first-run cache seed, and the SPA's offline
  data source.
- **`vite.config.ts`** — `base: '/gen-con-planner/'` (GitHub Pages subpath),
  dev port 5757, preview 5758.
- **`package.json`** — runtime deps are only `react`/`react-dom`; everything
  else is devDeps. `scripts/scrape.mjs` and `scripts/bundle.mjs` already import
  `server/gencon.mjs` directly, proving that module is reusable outside Vite.

**Two deployment modes exist today** and both must keep working:

| Mode | How | Live search? |
|---|---|---|
| Dev / preview | `npm run dev` / `npm run preview` — Vite plugin proxy | Yes |
| Static / GitHub Pages | `npm run build` → `dist/` | No — offline bundle only |

The desktop app is a **third mode**, not a replacement.

---

## 3. Framework choice

The owner's hard requirement: a non-technical friend installs an app and gets
**live ad-hoc Gen Con search** without Node, npm, or a terminal. So the Node
proxy code (`gencon.mjs` + the route handlers) must ship and run inside the
package.

### 3.1 Options considered

**A. Electron** (current stable: Electron 34.x line, 2026). Bundles Chromium +
Node.js. The Node "main process" can run our route handlers *directly* — it
*is* a Node runtime — so `gencon.mjs` runs as-is with no compilation step.
electron-builder produces `.dmg` / NSIS `.exe` / AppImage.

**B. Tauri 2** (current stable: 2.9.x, Dec 2025). Native OS WebView + a Rust
backend. ~25x smaller bundles than Electron. **But Tauri has no Node runtime.**
Our backend is Node, so we would have to either (a) port `gencon.mjs` and the
route handlers to Rust, or (b) compile the Node code to a standalone binary
(Node SEA or `pkg`) and run it as a Tauri **sidecar**. Option (a) is a rewrite
of working, tested code; option (b) reintroduces exactly the packaged-Node
problem from option C, just wrapped in a smaller shell.

**C. Packaged Node (Node SEA / `pkg`) + a window.** Compile the proxy to a
single executable, then either run a system browser at `localhost` (ugly, not
"an app") or pair it with a minimal window library. This is essentially
"build half of Electron by hand": you own process lifecycle, window
management, the app menu, dock/taskbar integration, and updates yourself. Node
SEA is still maturing for apps with asset trees.

### 3.2 Comparison for *this* app

| Criterion | Electron | Tauri 2 | Packaged Node + window |
|---|---|---|---|
| Reuse `gencon.mjs` as-is | **Yes, directly** | No — port to Rust *or* sidecar-binary | Yes (it's the binary) |
| Reuse route handlers as-is | **Yes** | No / sidecar | Yes |
| Bundle size | ~90–150 MB | ~10–20 MB | ~50–80 MB |
| Renderer compatibility | Chromium — identical to today's testing target | OS WebView — Safari/WebView2/WebKitGTK; minor rendering differences possible | depends on chosen shell |
| Cross-platform packaging maturity | electron-builder — mature, one config | Tauri bundler — good, but sidecar binaries need per-OS cross-compile | you assemble it |
| Rust toolchain required | No | **Yes** (owner + CI) | No |
| Effort for *our* backend | Lowest | Highest | Medium |
| Owner skill match | JS/TS already | new language | JS/TS |

### 3.3 Recommendation: **Electron**

Tauri's headline win is bundle size, and it is real. But it is the wrong
optimization here:

- Our backend is **Node**, tested, and working. Electron runs it unchanged.
  Tauri forces a Rust rewrite or a `pkg`-style binary — i.e. we pay the
  packaged-Node tax *and* adopt Rust.
- The audience is "a handful of non-technical friends," not an app store at
  scale. A 120 MB download once is a non-issue for that audience; a months-long
  Rust port is.
- Electron's renderer is Chromium — the exact engine the SPA is already
  developed and tested against. Tauri's per-OS WebView introduces a new
  cross-browser test surface for zero benefit here.
- electron-builder gives `.dmg` + NSIS + AppImage from one config and has the
  most documented signing/notarization path — and signing is our real risk.

**Choose Electron.** Revisit Tauri only if bundle size or memory ever becomes a
genuine complaint, which for this app and this audience it will not.

---

## 4. Architecture for the Electron build

### 4.1 The shared-route-handler refactor (the one real code change)

Today the `/api/gencon/*` route logic lives **inside** `server/gencon-proxy.mjs`,
fused with the Vite-plugin wrapper. The desktop app needs the same logic. Do
**not** copy-paste it. Extract it.

Proposed structure (all under `server/`, all plain Node ESM):

```
server/gencon.mjs          (unchanged) — pure GenCon fetch + normalize
server/gencon-routes.mjs   (NEW)       — the route handlers + caching,
                                         parameterized by a cache directory
server/gencon-proxy.mjs    (thinned)   — Vite plugin: imports gencon-routes,
                                         wires it as connect middleware
server/gencon-server.mjs   (NEW)       — standalone http.createServer that
                                         mounts the same handler; used by
                                         Electron's main process
```

`server/gencon-routes.mjs` exports a single factory, e.g.:

```js
export function createGenconHandler({ cacheDir, bundlePath }) {
  // returns async (req, res) => { ... }  — the existing middleware body,
  // with CACHE_DIR / EVENTS_CACHE_DIR / etc. derived from cacheDir
  // instead of hardcoded to <repo>/cache.
}
```

Everything currently in `gencon-proxy.mjs` from `readJson` down through
`middleware` moves into `gencon-routes.mjs` and becomes closure state over the
`cacheDir`/`bundlePath` arguments. The only behavioral change is that the cache
directory and bundle path become **injected parameters** instead of constants
computed from `import.meta.url`.

Then:

- `gencon-proxy.mjs` becomes ~15 lines: import `createGenconHandler`, call it
  with the repo's `cache/` and `public/data/events.json`, register the result
  on `configureServer` / `configurePreviewServer`. **Dev/preview behavior is
  unchanged.**
- `gencon-server.mjs` calls `createGenconHandler` with the OS user-data cache
  dir (§5) and the bundled events path, and wraps it in
  `http.createServer(...)`.

This refactor is the *only* change to existing application logic. It is
behavior-preserving and independently testable; it should land (with tests
green) before any Electron code is written.

### 4.2 Communication: localhost HTTP server, not IPC

Two ways for the Chromium renderer to reach the backend:

- **Electron IPC** — `ipcRenderer.invoke()` via a `preload.js` bridge. Means
  rewriting every function in `src/lib/api.ts` from `fetch()` to IPC calls, and
  adding a preload script. The renderer code diverges from the web build.
- **Tiny localhost HTTP server in the main process** — the main process starts
  `gencon-server.mjs` on a port (e.g. 5759, or an OS-assigned free port) and
  loads the SPA. The renderer keeps calling `fetch('/api/gencon/...')`.

**Decision: localhost HTTP server.** Decisive reason: `src/lib/api.ts` requests
**absolute paths** (`/api/gencon/...`). If the renderer is served from
`http://127.0.0.1:<port>/`, those absolute paths resolve to the same origin and
the existing `fetch()` calls work **with zero renderer changes**. The web
build, the GitHub Pages build, and the desktop build all run the *identical*
`src/` code. IPC would fork the codebase for no gain on a localhost-only,
no-auth API.

So in the desktop app, the main process both:

1. Starts `gencon-server.mjs` (the proxy) on a localhost port, and
2. Serves the built SPA (`dist/`) on that **same** port, so `/api/gencon/*`
   and the app share an origin and the offline-fallback `fetch` of
   `data/events.json` also resolves correctly.

`gencon-server.mjs`'s `http.createServer` handler: if the path starts with
`/api/gencon/`, dispatch to the GenCon handler; otherwise serve a static file
from `dist/`. ~30 lines of static-file serving on top of the extracted handler.

### 4.3 Process & window layout

```
Electron main process (Node)
 ├─ on app ready:
 │   ├─ resolve cacheDir = app.getPath('userData')/cache
 │   ├─ resolve bundlePath = <resources>/data/events.json   (read-only)
 │   ├─ start gencon-server.mjs  → http server on 127.0.0.1:<port>
 │   └─ create BrowserWindow → loadURL('http://127.0.0.1:<port>/')
 ├─ app menu (standard Quit / Edit / View / Window)
 └─ on quit: close http server

Renderer process (Chromium)
 └─ the existing built SPA from dist/, unchanged
```

`nodeIntegration: false`, `contextIsolation: true` — the renderer is plain web
content and needs no Node access (the backend is reached over HTTP). This is
the secure default and costs us nothing because we chose the HTTP-server model.

### 4.4 The `base` path wrinkle

`vite.config.ts` sets `base: '/gen-con-planner/'` for GitHub Pages. For the
desktop build the app is served from the **root** of a localhost origin, so
`base` should be `/`. Handle this with a build-time env switch — e.g. a
`VITE_BASE` env var read in `vite.config.ts` (defaulting to
`/gen-con-planner/`), set to `/` for the desktop build's Vite step. This keeps
`base` correct per target without branching the config logic. (`api.ts` already
uses absolute `/api/gencon/...` paths, so only the asset/bundle `BASE_URL`
needs this.)

---

## 5. Cache & data location

**Problem:** a packaged/installed app's resources directory is read-only (and
on macOS, inside a signed `.app`, writing there breaks the signature). Today
the proxy writes to `<repo>/cache/`. That cannot ship as-is.

**Plan:**

1. **Bundled, read-only seed.** `public/data/events.json` ships inside the app
   as a packaged resource (electron-builder `extraResources`, landing under
   `process.resourcesPath`). The main process passes that path to
   `createGenconHandler` as `bundlePath`. It is only ever **read** — used to
   seed the cache and as the offline source. Unchanged in role from today.

2. **Writable cache in OS user-data dir.** `createGenconHandler` receives
   `cacheDir = app.getPath('userData')/cache`. Electron's `userData` resolves
   to the correct per-OS, per-user, writable location:
   - macOS: `~/Library/Application Support/Gen Con Planner/cache`
   - Windows: `%APPDATA%\Gen Con Planner\cache`
   - Linux: `~/.config/Gen Con Planner/cache`
   The existing atomic-write logic (`writeJson` → temp file + `rename`) and
   the seed-once latch (`ensureSeeded`) work unchanged; they just operate on a
   different root.

3. **First-run seeding.** On first launch the user-data `cache/` is empty.
   `handleAllEvents` already calls `ensureSeeded()` when the cache is empty,
   which copies the bundled collections into the cache. So a fresh install
   shows the bundled ~4000 events immediately; live searches then add fresh
   collections to the user-data cache over time.

4. **Offline fallback stays.** `fetchCachedEvents()` in `api.ts` keeps its
   `try/catch` fallback to `data/events.json`. In the desktop app the proxy is
   always running, so the primary path normally succeeds — but the fallback
   remains a correct safety net (e.g. proxy mid-startup) and, importantly,
   means **`src/` still needs no changes**. No edit to `api.ts` is required.

5. **No migration needed.** The repo's `cache/` is gitignored and dev-only; the
   desktop app's cache is a separate, fresh directory. They never interact.

---

## 6. Build & packaging

### 6.1 Tooling

Add **electron** and **electron-builder** as devDependencies. electron-builder
produces all three targets from one `build` config block in `package.json` (or
`electron-builder.yml`):

- macOS: `.dmg` (and/or `.zip`)
- Windows: NSIS `.exe` installer
- Linux: `AppImage`

### 6.2 New files

- `electron/main.cjs` (or `.mjs`) — the main process described in §4.3.
- `server/gencon-routes.mjs`, `server/gencon-server.mjs` — from §4.1.
- `electron-builder` config — in `package.json` `build` key or a separate yml.
- App icons — `.icns` (macOS), `.ico` (Windows), `.png` (Linux).

### 6.3 How the existing build feeds the desktop build

The desktop build is a **superset** of the existing build — it does not replace
`npm run build`:

```
npm run build           (existing — Vite SPA → dist/, base=/gen-con-planner/)
npm run build:desktop   (NEW — Vite SPA → dist/, base=/)        ⟶ feeds ⟶
npm run dist            (NEW — electron-builder packages dist/ + server/ +
                          electron/ + public/data/events.json)
```

electron-builder's `files` includes `dist/`, `server/`, `electron/`, and
`node_modules` it actually needs; `extraResources` includes
`public/data/events.json`. Because `server/*.mjs` has **no npm dependencies**
(only Node stdlib + global `fetch`), there is no native-module rebuild step and
no `node_modules` bloat from the backend.

### 6.4 package.json changes (additive only)

- **devDependencies:** `electron`, `electron-builder`.
- **scripts:** `build:desktop`, `dist` (and per-OS `dist:mac` / `dist:win` /
  `dist:linux` if desired), plus `electron:dev` for running the main process
  against a local build during development.
- **`build` key:** electron-builder config (appId, productName, `files`,
  `extraResources`, `mac`/`win`/`linux` target blocks).
- A `"main"` field pointing at `electron/main.cjs` — note this is read by
  Electron. It must **not** disturb the `vite` build; verify the SPA build is
  unaffected (Vite uses `index.html`, not `main`, as its entry, so this is
  safe, but check it explicitly).

Nothing here changes `dev`, `build`, `preview`, `test`, `scrape`, or `bundle`.
The web/static and GitHub Pages pipelines are untouched.

---

## 7. Code signing & notarization — the honest part

This is the only hard problem, and it is **organizational/financial, not
technical**. electron-builder automates the *mechanics* of signing once you
have credentials; getting credentials is the cost.

### 7.1 macOS

Modern macOS (Sequoia and later) is strict:

- An app downloaded from the internet that is **not signed with a Developer ID
  certificate and notarized by Apple** is blocked by Gatekeeper.
- **The old "right-click → Open" shortcut is gone as of macOS Sequoia.** A
  non-technical friend can no longer just right-click. They must go to **System
  Settings → Privacy & Security**, scroll to the Security section, and click
  **"Open Anyway"**, then re-confirm and possibly enter an admin password. This
  is doable but genuinely confusing for the target audience, and it must be
  redone after some updates.
- **Proper path:** join the **Apple Developer Program (~$99/year USD)**, get a
  Developer ID Application certificate, and let electron-builder sign +
  notarize. Notarization needs `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` +
  `APPLE_TEAM_ID` (or an App Store Connect API key) supplied as environment
  variables; electron-builder + `electron/notarize` then submit the build to
  Apple's notary service automatically. Once notarized, the friend just
  double-clicks. This is the only experience that is genuinely "non-technical
  friendly."

### 7.2 Windows

- An unsigned `.exe` triggers a **SmartScreen "Windows protected your PC"**
  warning. The user must click **"More info" → "Run anyway."** Less hostile
  than macOS Sequoia, but still a scary blue dialog for a non-technical user.
- Traditional OV/EV code-signing certificates are expensive and, as of Feb 15
  2026, capped at **1-year lifespans** (annual renewal cost).
- **Cheapest modern option: Azure Trusted Signing** — Microsoft's cloud signing
  service, ~$10/month, and it clears SmartScreen. Availability: US/Canada
  organizations with 3+ years of verifiable business history, **and individual
  developers in the US/Canada**. The owner (a US individual) likely qualifies
  as an individual developer — worth confirming before committing.

### 7.3 Linux

AppImage needs no signing. Users `chmod +x` and run, or use an AppImage
launcher. Lowest friction of the three; effectively a non-issue.

### 7.4 The realistic unsigned path (recommended for milestone 1)

Ship **unsigned** first. The friend's experience:

- **macOS:** download `.dmg`, drag to Applications, first launch is blocked →
  walk them through System Settings → Privacy & Security → "Open Anyway"
  **once**. A short screenshot guide (3–4 images) makes this survivable for the
  initial small, friendly audience.
- **Windows:** "More info" → "Run anyway."
- **Linux:** no friction.

Honest assessment:

| Path | One-time effort | Recurring cost | Friend experience |
|---|---|---|---|
| Unsigned | ~0 | $0 | Confusing but doable with a guide |
| macOS signed + notarized | ~0.5–1 day setup | $99/yr (Apple) | Double-click, just works |
| Windows signed (Azure Trusted Signing) | ~0.5–1 day setup | ~$120/yr | No SmartScreen wall |

**Recommendation:** Do **not** block the first release on signing. Ship
unsigned, learn whether the project has legs, *then* pay for macOS
notarization (highest pain → highest payoff) and only later, if Windows users
materialize, Azure Trusted Signing. Signing is a Phase 4 decision, not a
prerequisite.

---

## 8. Auto-update

electron-builder ships `electron-updater`, which can pull updates from a GitHub
Releases feed. **Recommendation: defer.** Auto-update on macOS effectively
*requires* a signed/notarized app (the updater verifies signatures), so it is
gated behind §7 anyway. For a handful of friends, "I'll send you a new `.dmg`
link" is fine. Note it as a future option once signing is in place; do not
build it in the first two milestones.

The event **data**, separately, refreshes itself: the bundled
`public/data/events.json` is only a cold-start seed, and live search writes
fresh collections into the user-data cache. So "stale data" is not an
auto-update concern — only "stale app code" is, and that is rare for this app.

---

## 9. Phased implementation plan

Effort estimates assume one developer already fluent in the codebase. They are
working-time estimates, not calendar time.

### Phase 0 — Shared-route-handler refactor *(prerequisite)*
- Extract route logic from `gencon-proxy.mjs` into
  `server/gencon-routes.mjs` (`createGenconHandler({ cacheDir, bundlePath })`).
- Thin `gencon-proxy.mjs` to a wrapper; verify dev/preview behavior unchanged.
- Add `server/gencon-server.mjs` (standalone `http.createServer`).
- Add/extend tests around the extracted handler.
- **Effort: ~0.5–1 day.** **Risk: low** — behavior-preserving.
- **Exit criteria:** `npm run dev`, `npm run preview`, `npm test`,
  `npm run typecheck` all green; live search still works via Vite.

### Phase 1 — Minimum viable Electron shell *(the first milestone)*
- Add `electron` + `electron-builder` devDeps.
- `electron/main.cjs`: start `gencon-server.mjs` on a localhost port, serve
  `dist/` + `/api/gencon/*` from that origin, open a `BrowserWindow`.
- Cache → `app.getPath('userData')/cache`; bundle via `extraResources`.
- `build:desktop` script (Vite build with `base=/`).
- electron-builder config for **macOS `.dmg` only**, **unsigned**.
- **Effort: ~1.5–2.5 days.** **Risk: medium** — first-time Electron wiring;
  `base` path and static-file serving are the fiddly bits.
- **Exit criteria:** an unsigned `.dmg` that installs, launches, shows the
  bundled events, and performs a **live Gen Con search** — on a Mac with no
  Node installed. **This is the recommended go/no-go milestone.**

### Phase 2 — Cross-platform packaging
- Add NSIS (Windows) and AppImage (Linux) targets.
- App icons for all three OSes.
- Test on each OS (a Windows VM + a Linux VM or CI runners).
- **Effort: ~1–2 days.** **Risk: medium** — Windows path/spawn quirks; needs
  real test machines.
- **Exit criteria:** unsigned installers for all three OSes that run and search.

### Phase 3 — Polish
- App menu, window-state persistence, an in-app "first launch on macOS"
  help/onboarding note, dock/taskbar icon, graceful proxy-failure messaging.
- A short screenshot guide for the unsigned-install dance (§7.4).
- **Effort: ~1–2 days.** **Risk: low.**

### Phase 4 — Signing & notarization *(decision gate, optional)*
- Join Apple Developer Program; configure electron-builder signing +
  notarization env vars; verify a clean double-click install.
- If Windows demand exists: set up Azure Trusted Signing.
- **Effort: ~0.5–1 day each once accounts exist; account approval lead time can
  be days.** **Cost: $99/yr Apple; ~$120/yr Azure.** **Risk: low technically,
  but external — account approval, certificate issuance.**

### Phase 5 — Auto-update *(optional, only after Phase 4)*
- Wire `electron-updater` to a GitHub Releases feed.
- **Effort: ~1 day.** **Risk: low.** Defer unless friends ask.

**Total to a usable cross-platform unsigned app (Phases 0–3): ~4–8 days.**
**To a polished signed macOS app (add Phase 4): +~1 day work + $99/yr + Apple
approval lead time.**

### What can be deferred / cut
- Windows + Linux (Phase 2) — macOS-only is a fine first release if friends are
  Mac users.
- All signing (Phase 4) — see §7.
- Auto-update (Phase 5).
- Polish items in Phase 3 are individually droppable.

### Key risks (and mitigations)
1. **Signing friction underestimated** → explicitly deferred to Phase 4; ship
   unsigned first.
2. **`base` path mismatch** between GitHub Pages (`/gen-con-planner/`) and
   desktop (`/`) → handled by a build-time `VITE_BASE` env var (§4.4); covered
   in Phase 1 exit criteria.
3. **GenCon API changes / rate-limits** → pre-existing risk, not new; the
   offline bundle remains the fallback. The desktop app does not increase
   request volume.
4. **Electron security defaults** → mitigated by the HTTP-server architecture:
   `contextIsolation: true`, `nodeIntegration: false`, renderer is plain web
   content.
5. **Bundle ships ~6.25 MB `events.json`** → acceptable; it is the whole point
   (offline seed) and trivial next to Chromium.
6. **Keeping web/static working** → Phase 0 is behavior-preserving and every
   phase's exit criteria re-runs `npm run dev`/`build`/`test`; the desktop
   scripts are strictly additive.

---

## 10. Recommendation

**Go.** Build the desktop app with **Electron**, using a **localhost HTTP
server in the main process** that runs the **extracted shared route handler**
(`server/gencon-routes.mjs`) so the React renderer ships **unchanged**.

Do the work in this order, treating Phase 1 as the proof point:

> **First milestone: an unsigned macOS `.dmg` that launches the existing SPA
> and performs live Gen Con search, on a Mac with no Node installed.**

If that milestone works and feels good, continue to cross-platform packaging
and polish; pay for macOS notarization only once the project has proven itself.
Throughout, the web and GitHub Pages deployments keep working untouched —
every new script and file is additive.

### Open questions for the owner

1. **Audience OS mix** — are the friends mostly macOS, Windows, or both? If
   macOS-only, Phase 2 can be skipped entirely.
2. **Willingness to pay $99/yr** for the Apple Developer Program — this is the
   single biggest fork. Unsigned is free but means walking each friend through
   the Sequoia "Open Anyway" steps.
3. **Windows individual-developer eligibility for Azure Trusted Signing** —
   worth confirming the owner qualifies before promising a clean Windows
   install; otherwise Windows stays unsigned (SmartScreen "Run anyway").
4. **App identity** — `appId` (e.g. `com.pixelbandito.genconplanner`),
   `productName`, and an app icon are needed before packaging.
5. **Distribution channel** — GitHub Releases is the natural home for the
   installers (and a prerequisite if auto-update is ever added).
