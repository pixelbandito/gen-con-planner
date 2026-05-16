# Gen Con Planner — Agenda Redesign

Date: 2026-05-16
Supersedes parts of `2026-05-15-gencon-planner-design.md` (the calendar/filter
sections). Data model, scraper, and storage approach are unchanged.

## Goals

Replace the calendar's "bumped layer" toggle with a **priority filter**, turn
the calendar into a zoomable **Agenda** work surface, add data-refresh tooling
to Search, and make the Wishlist drag-reorderable and cross-pane aware.

## 1. Priority / layer engine (`schedule.ts`)

All derived, never stored.

**Greedy fill:** walk a ranked slice top→bottom; place an event if its slot is
free, else mark it bumped by the higher-ranked holder.

**Cascade layers** — computed from the wishlist:

```
active = wishlist entries, minus hidden events, original ranks kept
layers = []
start  = 0
repeat:
  slice  = active[start..]
  result = greedyFill(slice)            // each item: scheduled | bumped
  layers.push({ startRank: active[start].rank, result })
  if result has no bumped events: stop
  start = index of the first bumped event in active
```

`start` strictly increases, so this terminates. Layer L is the greedy fill of
everything from its `startRank` down — an event scheduled on Layer 1 can
reappear on Layer 2 if it ranks below Layer 2's start (cascade; pages overlap).

**Agenda filter modes:**
- **Layer preset** (`Layer 1 · Top choices`, `Layer 2 · from #m`, … Layer K):
  shows that layer's greedy winners, solid. Conflict losers are not drawn — you
  advance to the next layer to see them.
- **Explicit range `a–b`:** a plain filter — every wishlist event ranked in
  `[a,b]`, overlaps stacked into sub-columns (not greedy).

**Hidden events:** a per-event, session-only toggle (not persisted). Hiding
removes events from `active`; all layers recompute as if the pick fell through.

## 2. Agenda pane

Main work surface. Search and Wishlist become collapsible side panes; collapse
both for a full-width Agenda.

The grid stays a time grid, with two independent zoom axes:
- **Horizontal (days):** `1 / 2 / 4 / Full con`, with ◀ ▶ to pan. Default 4.
- **Vertical (time):** density control + visible-hours presets
  (`Morning / Afternoon / Evening / All`).

**Priority filter bar** replaces the bumped-layer checkbox: a mode toggle
(Layers | Range) as described in §1, plus a `Hidden (N) · restore` chip.

**Slot search** — grid divided into 30-min slots:
- **Click** a slot → Search pane (un-collapsed if needed) filtered to
  *unscheduled* events that **overlap** that moment.
- **Click-drag** a range → Search filtered to *unscheduled* events **fully
  contained** in that range.

## 3. Search data management + Wishlist

**Search — Manage data** (collapsible section): shows loaded game systems /
count / scrape date; an input to add game-system names to a stored query set
(localStorage, seeded from the dataset); a **Copy scrape command** button that
copies `npm run scrape "…" "…"`. Scraping stays CLI-only (GenCon's API sends no
CORS headers, so the browser cannot fetch it directly).

**Wishlist:**
- Cap 300; adding beyond is blocked. A marker after rank 50 shows GenCon's real
  submission limit.
- Native HTML5 drag-and-drop reorder; existing ▲▼ buttons kept for
  keyboard / non-drag accessibility.
- Compact rows: rank, title, day/time, **game code** (needed to recreate the
  list on GenCon's site).
- Cross-pane highlight: rows matching the active Search filter or Agenda
  slot-search are highlighted.

## App-level state added

- `slotSearch: {kind:'overlap',ts} | {kind:'contained',start,end} | null`
- `activeMatchIds: Set<number>` — Search/Agenda → Wishlist highlight
- `hiddenIds: Set<number>` — session-only
- pane collapse flags for Search and Wishlist
