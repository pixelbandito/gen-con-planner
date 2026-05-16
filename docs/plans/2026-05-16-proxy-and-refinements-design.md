# Gen Con Planner — Live Proxy + Agenda Refinements

Date: 2026-05-16
Follows `2026-05-16-agenda-redesign-design.md`. Adds a server-side GenCon
proxy with an on-disk cache, and refines Agenda behavior.

## 1. GenCon proxy + cache

GenCon's API sends no CORS headers, so the browser cannot call it directly.
A **Vite plugin** (`configureServer` + `configurePreviewServer`) adds proxy
routes backed by an on-disk cache.

### Routes (all under `/api/gencon/`)

- `GET /systems` — the game-system catalog. Serves `cache/systems.json`; on
  cache-miss or `?refresh=1`, fetches GenCon's
  `event_search/meta_data?ag[]=eo&ag[]=tn&filter=game`, keeps
  `filtered.game_system.buckets`, drops empty/whitespace keys, trims and
  dedupes names, caches. Returns `{ fetchedAt, stale, systems: [{name, eventCount}] }`.
- `GET /events?game=<name>` — all events for one system. Serves
  `cache/events/<slug>.json`; on miss or `?refresh=1`, fetches **all pages**
  from `event_search`, normalizes, caches. Returns
  `{ gameSystem, fetchedAt, stale, events }`. An in-flight map prevents
  double-fetching the same system concurrently.
- `GET /events` (no `game`) — every currently-cached system, for app startup:
  `{ systems: [{ gameSystem, fetchedAt, stale, events }] }`.

### Cache

A gitignored `cache/` directory: `systems.json` and `events/<slug>.json`
(slug = lowercased name, non-alphanumerics → `-`). Each file carries
`fetchedAt` (ISO). **Stale = `fetchedAt` older than 7 days.** A stale cache is
still served as-is — `stale` is only a UI flag. The cache is re-fetched only
on first request for a system or on an explicit `?refresh=1`.

On first run, if `cache/events/` is empty, the plugin seeds it from the
existing `public/data/events.json` (kept solely as seed data), grouping events
by `gameSystem`.

### Shared code

Fetch + normalize logic lives in `server/gencon.mjs` (`fetchGameSystems`,
`fetchEvents`, `normalizeEvent`, slug/stale helpers), used by both the Vite
plugin and the existing `scripts/scrape.mjs` CLI (kept as an optional cache
pre-warmer). The proxy fetches GenCon with only an `accept` header — no auth.

### Frontend

`src/lib/api.ts` wraps the routes. App startup loads `/api/gencon/events`
(cached systems) instead of the static file. Dataset state becomes mutable —
systems are merged in as they load. The game-system `<select>` in the Search
pane is populated from `/systems` (full catalog); picking an uncached system
transparently triggers `/events?game=…` and merges the result. The Unit-4
"copy scrape command" UI is replaced by **cache management**: a list of
cached systems with `fetchedAt`, a stale badge, and a Refresh button.

## 2. Agenda refinements

### Filtering scope

Hide and priority filters affect **only the Agenda**. App computes two
schedules:

- `wishlistLayers = computeLayers(entries, eventsById)` — no hidden events;
  drives the Wishlist status pills and the header counts.
- `agendaLayers = computeLayers(entries, eventsById, hiddenIds)` — drives the
  Agenda.

Search is already independent of hide/priority — unchanged.

### Agenda click areas

- A reserved **right-edge gutter** (~24px) in every day column. Event blocks
  lay out within `columnWidth − gutter` and never cover it; the gutter is
  always a live slot click/drag surface, so a slot search can start at a time
  that is already full.
- **Time padding**: when the time view is data-driven ("All"), pad the
  computed bounds ~1 hour above the earliest and below the latest event for
  clickable empty time at the day's edges.

### Continuous selection highlight

A slot selection currently paints each 30-min cell separately, reading as
stacked blocks. Replace with a **single absolutely-positioned rectangle** per
day (`top` = range start, `height` = duration) for both the live drag and the
committed slot search.

### Modal editing

`EventModal` gets grouped wishlist controls:

- **Add to / Remove from wishlist** — a real membership change.
- **Priority** — a number input showing the current rank; retyping it moves
  the entry to that position via a new App `setRank(eventId, rank)` handler
  (reusing `reorderEntry`).
- **Hide from Agenda** — kept, but visually separated and labelled as a
  *temporary view toggle*, distinct from Remove.

Agenda event blocks open this modal; no inline editing.
