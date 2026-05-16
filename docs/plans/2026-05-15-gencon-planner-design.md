# Gen Con Planner — Design

Date: 2026-05-15

## Problem

Gen Con has thousands of events. Attendees must browse them, build a single
**ranked** wishlist, and submit it when registration opens. Events sell out
fast. Planning requires juggling overlapping time slots, ranking priorities,
and hedging — ranking the *same* event in multiple time slots so you still get
in if your first choice sells out.

## Stack

- Vite + React + TypeScript single-page app. No backend.
- `npm run dev` to work; `npm run build` for a static bundle.

## Data — two strictly separated kinds

1. **Events (read-only, scraped)** — `public/data/events.json`, bundled into the
   app via a JSON import. Produced by `scripts/scrape.mjs`. The UI never writes
   it.
2. **Wishlist (read-write, yours)** — `localStorage`, with export/import to a
   `.json` file for backup and moving between machines.

### Event model

Normalized from the Gen Con API's `_source` object:

```
id, title, gameSystem, eventType, groupSponsor,
shortDescription, longDescription,
start (ISO), end (ISO), durationHours,
location, roomName, tableNumber,
cost, ticketsAvailable, maxPlayersUnlimited,
ageRequirement, experienceRequired, rulesEdition,
materialsRequired, gameCode, updatedAt,
dupKey   // normalized `title|sponsor`, for hedge detection
```

`events.json` = `{ scrapedAt, conventionId, gameSystems: [], events: [] }`.

### Wishlist model

A single ranked array — array index is the priority (0 = top), mirroring Gen
Con's real submission order:

```
WishlistEntry { eventId, note? }
Wishlist { entries: WishlistEntry[], version }
```

## Derived at runtime (never stored)

- **Conflicts** — two entries conflict when their time intervals overlap.
- **Expected schedule** — a greedy pass down the ranked list: place an entry if
  its slot is still free, otherwise mark it *bumped* (and record which
  higher-ranked event bumped it). This is what you would actually receive if
  nothing sold out — the "ideal schedule."
- **Hedge groups** — entries sharing a `dupKey` are flagged so you can see when
  you have ranked the same event across multiple time slots.

## Scraper

`scripts/scrape.mjs` — a reusable Node CLI:

```
node scripts/scrape.mjs "Magic: The Gathering" "Dungeons & Dragons"
```

Calls `https://www.gencon.com/api/event_search?ag[]=eo&ag[]=tn&game[]=<name>`,
follows pagination until `has_more` is false, normalizes records, dedupes by
`id`, and writes `public/data/events.json`. No auth required.

## UI

Three regions:

- **Event browser** (left) — filter by game system, event type, day, text
  search, max cost, tickets-available; each result card adds to the wishlist.
- **Wishlist panel** — the ranked list, reorder with up/down, remove, per-entry
  status (scheduled / bumped / conflict), hedge-group badges.
- **Calendar** — day columns × hour rows. Every wishlisted event is drawn.
  Expected-schedule winners render solid; bumped events render translucent
  (the "layers" — your second choices spread across slots). Each block carries
  its rank badge. Overlapping events stack into sub-columns ordered by rank.
```
