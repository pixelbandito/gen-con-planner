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

## Running the app

The app must be run via `npm run dev` (or `npm run preview` after
`npm run build`). The GenCon proxy that serves event data is a Vite plugin and
requires Node at runtime, so a pure static deploy of `dist/` will not include
the `/api/gencon/*` routes and will not load any events.

## Refreshing event data

Event data is scraped from Gen Con's public `event_search` API into
`seed/events.json`. Re-run it any time, with any game systems:

```bash
npm run scrape "Magic: The Gathering" "Dungeons & Dragons"
npm run scrape "Board Game"            # add more systems
```

With no arguments it defaults to Magic + D&D.

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
scripts/scrape.mjs        Reusable CLI scraper
seed/events.json          Scraped, read-only seed event dataset
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
- `npm run scrape` — refresh event data
