# Gen Con Planner

A local-first web app for planning a Gen Con event wishlist: browse the
catalog, build a single **ranked** wishlist (the order Gen Con processes your
picks at registration), and see the conflict-aware schedule you would actually
get — plus the bumped "backup layer" of second choices.

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL. The wishlist auto-saves to `localStorage`; use the
Export/Import buttons in the Wishlist panel to back it up or move it between
machines.

## Running it

**With the live proxy** — `npm run dev` (or `npm run preview` after a build).
A Vite plugin runs the GenCon proxy, so you can search and cache events live.

**As a static, offline site** — `npm run build` produces a `dist/` you can
serve from any static host (`npx serve dist`) or hand to a friend. It has no
proxy, so it loads events from the bundled `public/data/events.json` instead:
browsing, the wishlist, and the agenda all work offline; only *live* GenCon
search and cache refresh need the proxy (`npm run dev`/`preview`).

## Desktop app

Gen Con Planner can also be packaged as a standalone desktop app (Electron)
that runs live Gen Con search with no Node, npm, or terminal required — it
bundles its own Node runtime and the GenCon proxy.

Building installers requires **Node ≥ 22** (an `.nvmrc` pins this; run
`nvm use`). They land in `release/`:

- `npm run dist:mac` — macOS `.dmg`
- `npm run dist:win` — Windows NSIS `.exe`
- `npm run dist:linux` — Linux `AppImage`
- `npm run electron:dev` — run the app from a local build (development)

The macOS build is **unsigned** (no Apple Developer certificate). On first
launch macOS Gatekeeper blocks it. To open it once: try to open the app, then
go to **System Settings → Privacy & Security**, scroll to the Security section
where it names the blocked app, and click **"Open Anyway"** (re-confirm, and
enter an admin password if asked). After that first time it opens normally.
Windows shows a SmartScreen warning — click **"More info" → "Run anyway."**

## Event data

While the proxy is running, the app fetches game systems, event categories,
and free-text searches live from Gen Con and caches them under `cache/`
(gitignored). Two commands manage that data:

- `npm run bundle` — snapshot everything currently in `cache/` into
  `public/data/events.json`, the committed dataset the offline/static build
  ships with. Run it after loading the events you want to share, then commit
  the result.
- `npm run scrape "Magic: The Gathering" "Board Game"` — a CLI that pre-warms
  `cache/` for the named game systems without opening the app.

`public/data/events.json` also seeds the proxy's cache on first run, so a
fresh clone starts with data.

## How it works

- **Event browser** — filter the catalog; `+` adds an event to the wishlist.
- **Wishlist** — your single ranked list. Reorder with ▲▼. Events sharing a
  normalized title + sponsor are flagged as a **hedge group** so you can see
  when you've ranked the same event across multiple time slots.
- **Calendar** — every wishlisted event is drawn in the convention's local
  time. A greedy pass down the ranked list places each event if its slot is
  free; winners render solid (your *expected schedule*), conflict-bumped events
  render translucent (the *backup layer*). Toggle the backup layer on/off.

Nothing about conflicts or the schedule is stored — it is all recomputed from
the ranked wishlist.

## Project layout

```
scripts/scrape.mjs        CLI cache pre-warmer
scripts/bundle.mjs        Snapshots cache/ into public/data/events.json
server/                   GenCon proxy Vite plugin + shared fetch logic
public/data/events.json   Bundled dataset — offline data source + proxy seed
src/types.ts              Event + Wishlist models
src/lib/schedule.ts       Conflict / greedy-schedule / hedge logic
src/lib/storage.ts        localStorage + JSON export/import
src/components/           Browser, Calendar, Wishlist, Modal
docs/plans/               Design document
```

## Scripts

- `npm run dev` — dev server
- `npm run build` — static production build into `dist/`
- `npm run preview` — serve the production build
- `npm run typecheck` — TypeScript check
- `npm run test` — run the test suite
- `npm run scrape` — pre-warm the event cache from the CLI
- `npm run bundle` — snapshot the cache into `public/data/events.json`
