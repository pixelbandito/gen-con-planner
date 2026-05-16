# Live Proxy + Agenda Refinements — Implementation Plan

> **For Claude:** execute task-by-task; each unit ends with typecheck + build + test green.

**Goal:** Add a server-side GenCon proxy with an on-disk cache, and refine Agenda behavior (filtering scope, click areas, continuous highlight, modal editing).

**Architecture:** A Vite plugin adds `/api/gencon/*` routes backed by a `cache/` dir; shared fetch/normalize logic in `server/gencon.mjs`. The frontend loads events from the proxy instead of a static file. Refinements split the schedule computation (hidden-aware for the Agenda, hidden-free for the Wishlist) and improve Agenda interaction.

**Tech Stack:** Vite + React + TypeScript; Node (Vite plugin middleware); Vitest.

**Verification model:** Continue on branch `agenda-redesign`. Each unit ends with `npm run typecheck`, `npm run build`, `npm run test` green, and a git commit. No git worktree.

---

## Unit 1: Filtering scope split + modal wishlist editing

**Files:** Modify `src/App.tsx`, `src/components/EventModal.tsx`, `src/styles.css`.

**Step 1 — schedule split (App.tsx).** Currently `layers` is `computeLayers(wishlist.entries, eventsById, hiddenIds)` and both the Agenda and the Wishlist/header read from it. Split into two memos:
- `agendaLayers = useMemo(() => computeLayers(entries, eventsById, hiddenIds), [...])` — passed to `AgendaView`.
- `wishlistLayers = useMemo(() => computeLayers(entries, eventsById), [...])` — **no** `hiddenIds`.
Derive `fullResult` and the header `scheduledCount`/`bumpedCount` from `wishlistLayers[0]`. `AgendaView` receives `agendaLayers` as its `layers` prop. Verify the priority-filter clamp effect uses `agendaLayers`.

**Step 2 — `setRank` handler (App.tsx).** Add `setRank(eventId: number, rank: number)`: find the entry's current index; if not present, no-op; else clamp `rank` to `[1, entries.length]` and call the existing `reorderEntry(fromIndex, rank - 1)`.

**Step 3 — modal editing (EventModal.tsx).** EventModal already receives `inWishlist`, `onAdd`, `onRemove`, `rank`, `hiddenIds`, `onToggleHidden`. Add an `onSetRank: (id: number, rank: number) => void` prop. Render a grouped "Wishlist" control section:
- Add to / Remove from wishlist button (existing).
- A "Priority" number input shown only when the event is in the wishlist: value = current `rank`, `min=1`, `max`=wishlist length; on commit (change/Enter/blur) call `onSetRank`.
- The Hide-from-Agenda toggle, visually separated under a small caption like "Temporary view options" to distinguish it from Remove.
App passes `onSetRank`.

**Step 4 — CSS.** Style the grouped modal sections; match existing `.modal-*` vocabulary.

**Verify:** `npm run typecheck`, `npm run build`, `npm run test` (9 tests) all pass. Commit.

---

## Unit 2: Agenda click areas + continuous selection highlight

**Files:** Modify `src/components/AgendaView.tsx`, `src/styles.css`.

**Step 1 — right-edge click gutter.** Reserve a constant ~24px gutter on the right of every day column body. Event-block layout (the `left`/`width` math in the packing/render code) must fit within `columnWidth − GUTTER` so blocks never cover the gutter. The slot click/drag overlay already spans the column; ensure the gutter region remains a live slot surface (it will, since the overlay spans full width and event blocks no longer cover the gutter). Net effect: the rightmost strip of every column is always slot-clickable even where events are stacked.

**Step 2 — time padding.** When `timeView === 'all'` (data-driven bounds), pad: `minHour = floor(dataMin) - 1`, `maxHour = ceil(dataMax) + 1` (clamp to a sane range, e.g. `>= 0`). Fixed time windows are unchanged. This yields clickable empty time above the first and below the last event.

**Step 3 — continuous selection highlight.** Replace per-30-min-cell selection styling. For the live drag range and the committed `slotSearch`, render ONE absolutely-positioned highlight rectangle per affected day: `top` from the range start minute, `height` from its duration (using the same `pxPerMin` math as event blocks). Remove the per-slot `is-drop`/selected cell classes used for the selection fill (keep slot cells only as invisible click targets). The highlight rectangle sits below event blocks, above hour lines.

**Step 4 — CSS.** Add the gutter + continuous-highlight styles; remove now-unused per-slot selection rules.

**Verify:** typecheck, build, test green. `npm run dev`, curl `http://localhost:5757/` 200, kill npm + child vite (`pkill -f "gen-con-planner.*vite"`). Commit.

---

## Unit 3: `server/gencon.mjs` + Vite proxy plugin + cache

**Files:** Create `server/gencon.mjs`, `server/gencon-proxy.mjs`, `server/gencon.test.ts`; modify `vite.config.ts`, `scripts/scrape.mjs`, `.gitignore`.

**Step 1 — `.gitignore`.** Add `cache/`.

**Step 2 — `server/gencon.mjs`** (ESM, plain JS). Export:
- `normalizeEvent(src)` — the `_source` → Event mapping (move the existing copy from `scripts/scrape.mjs` here verbatim, including the `dupKey`/`norm` logic).
- `slugify(name)` — lowercase, non-alphanumerics → `-`, collapse repeats, trim `-`.
- `isStale(fetchedAtIso)` — `Date.now() - Date.parse(fetchedAtIso) > 7*24*3600*1000`.
- `parseSystemBuckets(metaJson)` — from `filtered.game_system.buckets`, map to `{name: key.trim(), eventCount: doc_count}`, drop entries whose trimmed name is empty, dedupe by name keeping the max `eventCount`, sort by name.
- `fetchGameSystems()` — fetch `https://www.gencon.com/api/event_search/meta_data?ag[]=eo&ag[]=tn&filter=game` (header `accept: application/json`), return `parseSystemBuckets(...)`.
- `fetchEvents(gameSystem)` — page through `https://www.gencon.com/api/event_search?ag[]=eo&ag[]=tn&game[]=<enc>&page=N` until `has_more` is false; collect+normalize+dedupe-by-id; return the event array. (Mirror the existing scraper's pagination.)

**Step 3 — `server/gencon.test.ts`** (Vitest). Test the pure functions: `slugify` ("Magic: The Gathering" → "magic-the-gathering", "Dungeons & Dragons" → "dungeons-dragons"); `isStale` (a fresh ISO is not stale, an 8-day-old one is); `parseSystemBuckets` (drops empty/whitespace keys, trims names, dedupes a leading-space duplicate, keeps counts); `normalizeEvent` (maps a sample `_source` to the Event shape with a correct `dupKey`). Write these as failing tests first, then confirm green.

**Step 4 — `server/gencon-proxy.mjs`.** Export a function `genconProxy()` returning a Vite plugin object with `name`, `configureServer(server)`, and `configurePreviewServer(server)`. Both attach the same connect-style middleware handling:
- `GET /api/gencon/systems` — read `cache/systems.json`; if missing or `?refresh=1`, `fetchGameSystems()`, write cache with `fetchedAt = new Date().toISOString()`. Respond `{ fetchedAt, stale: isStale(fetchedAt), systems }`.
- `GET /api/gencon/events?game=<name>` — read `cache/events/<slug>.json`; if missing or `?refresh=1`, `fetchEvents(name)`, write cache. Use an in-flight `Map` keyed by slug so concurrent requests for the same system await one fetch. Respond `{ gameSystem, fetchedAt, stale, events }`.
- `GET /api/gencon/events` (no `game`) — read every `cache/events/*.json`; respond `{ systems: [{ gameSystem, fetchedAt, stale, events }] }`. If `cache/events/` is empty/absent, first seed it: read `public/data/events.json`, group `events` by `gameSystem`, write one `cache/events/<slug>.json` per group with `fetchedAt` = that file's `scrapedAt`.
- Errors → JSON `{ error }` with status 502 (upstream) or 500.
Cache writes: `mkdir -p` the dirs, `writeFile` JSON. Keep it simple and synchronous-friendly with async/await.

**Step 5 — `vite.config.ts`.** Import and add `genconProxy()` to `plugins`.

**Step 6 — `scripts/scrape.mjs`.** Refactor to import `normalizeEvent`/`fetchEvents`/`slugify` from `server/gencon.mjs` (drop the now-duplicated local copies) and write each system to `cache/events/<slug>.json` in the proxy's cache format (`{ gameSystem, fetchedAt, events }`) instead of the single `public/data/events.json`. Keep its CLI argument behavior.

**Verify:** `npm run test` (now includes `server/gencon.test.ts`), `npm run typecheck`, `npm run build` green. Smoke: `npm run dev`, then `curl 'http://localhost:5757/api/gencon/events'` returns JSON with the seeded systems; `curl 'http://localhost:5757/api/gencon/systems'` returns the catalog (live fetch on first call). Kill npm + child vite. Commit.

---

## Unit 4: Frontend API client + App startup migration

**Files:** Create `src/lib/api.ts`; modify `src/App.tsx`, `src/types.ts`.

**Step 1 — `src/lib/api.ts`.** Typed wrappers: `fetchCachedEvents()` → `GET /api/gencon/events`; `fetchSystemEvents(name, refresh?)` → `GET /api/gencon/events?game=…[&refresh=1]`; `fetchSystems(refresh?)` → `GET /api/gencon/systems`. Define result types (`CachedSystem { gameSystem, fetchedAt, stale, events }`, `SystemCatalogEntry { name, eventCount }`, etc.) in `src/types.ts`.

**Step 2 — App startup.** Replace the `fetch('/data/events.json')` effect with `fetchCachedEvents()`. Hold dataset state as the merged events plus per-system metadata: `systemsMeta: Map<string, { fetchedAt, stale }>` and the flat `events` array. `eventsById` derives from `events`.

**Step 3 — dynamic merge.** Add an App handler `loadSystem(name)`: calls `fetchSystemEvents(name)`, merges the returned events into state (replace any existing events for that `gameSystem`), updates `systemsMeta`. Add `refreshSystem(name)` (same with `refresh=1`). Track in-progress system loads for a loading indicator.

**Step 4 — graceful empty/error.** If the proxy is unreachable or returns no cached systems, show a clear banner ("No event data — pick a game system to fetch it" / proxy error). Keep the existing loading state.

**Verify:** typecheck, build, test green. `npm run dev`, confirm the app loads events via the proxy (curl `/` 200 and the app's startup request path). Kill processes. Commit.

---

## Unit 5: Search catalog select + live fetch + cache management UI

**Files:** Modify `src/components/EventBrowser.tsx`, `src/App.tsx`, `src/lib/storage.ts`, `src/styles.css`.

**Step 1 — catalog-driven game-system select.** EventBrowser receives the full system catalog (from `fetchSystems`, loaded by App — lazily on first open of the picker or at startup). The game-system `<select>` lists all catalog systems, each annotated as cached or not (and event count). Selecting a system that is not yet loaded calls App's `loadSystem(name)`; show a loading state until merged. Selecting a loaded system just filters as before.

**Step 2 — cache management UI.** Replace the Unit-4 "Manage data" copy-scrape-command section with: a list of loaded/cached systems, each showing `fetchedAt` (relative, e.g. "3 days ago"), a **stale** badge when `stale`, and a **Refresh** button calling App's `refreshSystem(name)`. A "Refresh catalog" control re-fetches `/systems`.

**Step 3 — stale indication on events.** Events belonging to a stale-cache system get a small, unobtrusive "stale data" marker (e.g. in the event row meta and/or the modal). Derive from `systemsMeta`.

**Step 4 — cleanup.** Remove the now-dead `loadQueries`/`saveQueries` from `src/lib/storage.ts` and the `gencon-planner-queries-v1` usage (the query set is superseded by live cache management). Confirm nothing else imports them.

**Verify:** typecheck, build, test green. `npm run dev`; confirm picking a new game system fetches+caches it and a Refresh button re-fetches. Kill processes. Commit.

---

## Final verification

- `npm run test` — all tests pass (engine + `server/gencon`).
- `npm run typecheck`, `npm run build` — clean.
- `npm run dev` — manual pass: startup loads cached events; pick a new system → live fetch; refresh a system; stale badge; Agenda filtering scoped correctly; right-gutter slot clicks; continuous highlight; modal priority editing.
