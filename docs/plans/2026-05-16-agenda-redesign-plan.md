# Agenda Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the calendar's bumped-layer toggle with a cascade-based priority filter, turn the calendar into a zoomable Agenda work surface, add CLI-scrape command tooling to Search, and make the Wishlist drag-reorderable and cross-pane aware.

**Architecture:** Pure derivation stays pure — a rewritten `schedule.ts` computes cascade layers, ranges, and hidden-event recomputation with zero stored state. `App.tsx` lifts cross-pane state (slot search, match highlighting, hidden ids, pane collapse, filter mode). Three panes — Search, Agenda, Wishlist — communicate only through that lifted state.

**Tech Stack:** Vite + React + TypeScript (existing); Vitest added for unit-testing the layer engine.

**Verification model:** This is not a git repo and has no test runner. Task 1 adds Vitest. The engine task is TDD (`npm run test`). UI tasks verify with `npm run typecheck` + `npm run build`. No git commits are assumed; if checkpoints are wanted, `git init` first and commit after each task.

---

## Stage A — Priority / layer engine

### Task 1: Add Vitest

**Files:**
- Modify: `package.json`

**Step 1:** Add `vitest@^2.1.8` to `devDependencies`.

**Step 2:** Add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

**Step 3:** Run `npm install`. Expected: success.

**Step 4:** Run `npm run test`. Expected: "No test files found" (exit 0 or a clean no-tests message). Vitest auto-uses `vite.config.ts`; no separate config needed.

---

### Task 2: Rewrite `schedule.ts` — greedy fill, cascade layers, ranges, hidden events

**Files:**
- Modify: `src/lib/schedule.ts` (full rewrite)
- Create: `src/lib/schedule.test.ts`

**Step 1: Write the failing tests.** Create `src/lib/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GenConEvent, WishlistEntry } from '../types';
import { computeLayers, greedyFill, overlaps, rangeItems } from './schedule';

/** Minimal event factory — only the fields the engine reads. */
function ev(id: number, start: string | null, end: string | null): GenConEvent {
  return {
    id, title: `E${id}`, gameSystem: '', eventType: '', groupSponsor: '',
    shortDescription: '', longDescription: '', start, end, durationHours: null,
    location: '', roomName: '', tableNumber: '', cost: null,
    ticketsAvailable: null, maxPlayersUnlimited: null, ageRequirement: '',
    experienceRequired: '', rulesEdition: '', materialsRequired: '',
    gameCode: '', updatedAt: null, dupKey: '',
  };
}
const T = (h: number) => `2026-07-30T${String(h).padStart(2, '0')}:00:00.000-04:00`;
function db(...events: GenConEvent[]) {
  return new Map(events.map((e) => [e.id, e]));
}
const wl = (...ids: number[]): WishlistEntry[] => ids.map((eventId) => ({ eventId }));

describe('overlaps', () => {
  it('treats touching intervals as non-overlapping', () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
  });
  it('detects real overlap', () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 5, end: 20 })).toBe(true);
  });
});

describe('greedyFill', () => {
  it('schedules the winner and bumps the conflict', () => {
    const events = db(ev(1, T(9), T(11)), ev(2, T(10), T(12)), ev(3, T(11), T(13)));
    const res = greedyFill(
      [{ eventId: 1, rank: 1 }, { eventId: 2, rank: 2 }, { eventId: 3, rank: 3 }],
      events,
    );
    expect(res.get(1)!.status).toBe('scheduled');
    expect(res.get(2)!.status).toBe('bumped');
    expect(res.get(2)!.bumpedBy).toBe(1);
    expect(res.get(3)!.status).toBe('scheduled');
  });
  it('marks untimed events without blocking others', () => {
    const events = db(ev(1, null, null), ev(2, T(9), T(11)));
    const res = greedyFill([{ eventId: 1, rank: 1 }, { eventId: 2, rank: 2 }], events);
    expect(res.get(1)!.status).toBe('untimed');
    expect(res.get(2)!.status).toBe('scheduled');
  });
});

describe('computeLayers (cascade)', () => {
  it('returns one layer when nothing conflicts', () => {
    const events = db(ev(1, T(9), T(10)), ev(2, T(10), T(11)));
    const layers = computeLayers(wl(1, 2), events);
    expect(layers).toHaveLength(1);
    expect(layers[0].scheduledIds).toEqual([1, 2]);
  });
  it('cascades from the first bumped rank, allowing overlap across pages', () => {
    // ranks: 1=9-11, 2=10-12 (bumped by 1), 3=13-14, 4=13-15 (bumped by 3)
    const events = db(ev(1, T(9), T(11)), ev(2, T(10), T(12)), ev(3, T(13), T(14)), ev(4, T(13), T(15)));
    const layers = computeLayers(wl(1, 2, 3, 4), events);
    expect(layers[0].scheduledIds).toEqual([1, 3]);
    expect(layers[1].startRank).toBe(2);             // first bumped is rank 2
    expect(layers[1].scheduledIds).toContain(3);     // rank-3 reappears (cascade)
    expect(layers[1].scheduledIds).toContain(2);
  });
  it('recomputes when an event is hidden', () => {
    const events = db(ev(1, T(9), T(11)), ev(2, T(10), T(12)));
    const layers = computeLayers(wl(1, 2), events, new Set([1]));
    expect(layers).toHaveLength(1);
    expect(layers[0].scheduledIds).toEqual([2]);     // 2 now wins the slot
  });
});

describe('rangeItems', () => {
  it('filters by rank span and drops hidden events', () => {
    const items = rangeItems(wl(10, 20, 30, 40), new Set([30]), 2, 4);
    expect(items.map((i) => i.eventId)).toEqual([20, 40]);
  });
});
```

**Step 2: Run tests to verify they fail.** Run `npm run test`. Expected: FAIL (exports not found).

**Step 3: Write the implementation.** Replace `src/lib/schedule.ts` entirely:

```ts
// Schedule derivation: conflicts, greedy fill, cascade layers, rank ranges.
// All derived from the ranked wishlist — nothing here is stored.

import type { GenConEvent, WishlistEntry } from '../types';
import { parseWall } from './time';

export type ScheduleStatus = 'scheduled' | 'bumped' | 'untimed' | 'missing';

export interface Interval {
  start: number;
  end: number;
}

export interface RankedItem {
  eventId: number;
  /** 1-based position in the wishlist. */
  rank: number;
}

export interface GreedyResult {
  status: ScheduleStatus;
  /** When bumped: the eventId of the higher-ranked event holding the slot. */
  bumpedBy?: number;
}

export interface Layer {
  /** 1-based layer number. */
  index: number;
  /** Rank of the first event this layer covers. */
  startRank: number;
  /** The rank slice this layer greedily fills. */
  items: RankedItem[];
  result: Map<number, GreedyResult>;
  /** Greedy winners, in rank order. */
  scheduledIds: number[];
}

/** Timezone-agnostic interval for an event, or null if untimed/invalid. */
export function eventInterval(ev: GenConEvent | undefined): Interval | null {
  if (!ev) return null;
  const s = parseWall(ev.start);
  const e = parseWall(ev.end);
  if (!s || !e || e.ts <= s.ts) return null;
  return { start: s.ts, end: e.ts };
}

/** Half-open overlap: touching endpoints do not count. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Convert wishlist entries to ranked items, dropping hidden events. */
export function rankedItems(
  entries: WishlistEntry[],
  hiddenIds: Set<number> = new Set(),
): RankedItem[] {
  return entries
    .map((e, i) => ({ eventId: e.eventId, rank: i + 1 }))
    .filter((it) => !hiddenIds.has(it.eventId));
}

/** Greedy top-to-bottom fill of a ranked slice. */
export function greedyFill(
  items: RankedItem[],
  eventsById: Map<number, GenConEvent>,
): Map<number, GreedyResult> {
  const out = new Map<number, GreedyResult>();
  const placed: { iv: Interval; eventId: number }[] = [];
  for (const it of items) {
    const ev = eventsById.get(it.eventId);
    if (!ev) {
      out.set(it.eventId, { status: 'missing' });
      continue;
    }
    const iv = eventInterval(ev);
    if (!iv) {
      out.set(it.eventId, { status: 'untimed' });
      continue;
    }
    const clash = placed.find((p) => overlaps(p.iv, iv));
    if (clash) {
      out.set(it.eventId, { status: 'bumped', bumpedBy: clash.eventId });
    } else {
      placed.push({ iv, eventId: it.eventId });
      out.set(it.eventId, { status: 'scheduled' });
    }
  }
  return out;
}

/**
 * Cascade layers. Layer 1 is the greedy fill of the whole list; each later
 * layer is the greedy fill starting at the previous layer's first bumped
 * event. Pages overlap by design.
 */
export function computeLayers(
  entries: WishlistEntry[],
  eventsById: Map<number, GenConEvent>,
  hiddenIds: Set<number> = new Set(),
): Layer[] {
  const active = rankedItems(entries, hiddenIds);
  const layers: Layer[] = [];
  let start = 0;
  while (start < active.length) {
    const slice = active.slice(start);
    const result = greedyFill(slice, eventsById);
    const scheduledIds = slice
      .filter((it) => result.get(it.eventId)?.status === 'scheduled')
      .map((it) => it.eventId);
    layers.push({
      index: layers.length + 1,
      startRank: active[start].rank,
      items: slice,
      result,
      scheduledIds,
    });
    const firstBumped = slice.findIndex(
      (it) => result.get(it.eventId)?.status === 'bumped',
    );
    if (firstBumped === -1) break;
    start += firstBumped;
  }
  return layers;
}

/** Wishlist entries whose rank falls in [a, b], minus hidden events. */
export function rangeItems(
  entries: WishlistEntry[],
  hiddenIds: Set<number>,
  a: number,
  b: number,
): RankedItem[] {
  return rankedItems(entries, hiddenIds).filter(
    (it) => it.rank >= a && it.rank <= b,
  );
}

/** Group wishlist entries sharing a dupKey into hedge groups (size >= 2). */
export function hedgeGroups(
  entries: WishlistEntry[],
  eventsById: Map<number, GenConEvent>,
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const entry of entries) {
    const ev = eventsById.get(entry.eventId);
    if (!ev || !ev.dupKey) continue;
    const list = groups.get(ev.dupKey) ?? [];
    list.push(entry.eventId);
    groups.set(ev.dupKey, list);
  }
  for (const [key, list] of groups) {
    if (list.length < 2) groups.delete(key);
  }
  return groups;
}
```

**Step 4: Run tests to verify they pass.** Run `npm run test`. Expected: all PASS.

**Step 5: Verify the type surface.** Run `npm run typecheck`. Expected: errors only in `App.tsx` / `CalendarView.tsx` / `WishlistPanel.tsx` (they still import the removed `computeSchedule`/`ScheduleInfo`). Those are fixed in later tasks — note them, do not fix yet.

---

## Stage B — Agenda pane

### Task 3: Lift cross-pane state into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Step 1:** Define cross-pane types near the top of `App.tsx`:

```ts
export type SlotSearch =
  | { kind: 'overlap'; ts: number }
  | { kind: 'contained'; start: number; end: number }
  | null;

export type PriorityFilter =
  | { mode: 'layer'; layer: number }
  | { mode: 'range'; a: number; b: number };
```

**Step 2:** Add state: `hiddenIds` (`Set<number>`, session-only — not persisted, not in `loadWishlist`), `slotSearch` (`SlotSearch`), `activeMatchIds` (`Set<number>`), `priorityFilter` (default `{ mode: 'layer', layer: 1 }`), `searchCollapsed` / `wishlistCollapsed` booleans.

**Step 3:** Replace the `computeSchedule` memo with `layers = useMemo(() => computeLayers(wishlist.entries, eventsById, hiddenIds), [wishlist, eventsById, hiddenIds])`. Derive `fullResult = layers[0]?.result ?? new Map()` for status lookups, and a `rankById` map.

**Step 4:** Update header counts to read from `layers[0]` (scheduled = `layers[0]?.scheduledIds.length`, bumped = entries minus scheduled minus untimed).

**Step 5:** Add handlers: `toggleHidden(id)`, `clearHidden()`, `setSlotSearch`, `setActiveMatchIds`, `setPriorityFilter`, collapse toggles. Cap `addToWishlist` at 300 entries (block + `alert` beyond).

**Step 6:** Run `npm run typecheck`. Expected: errors now only in child components (props changed) — fixed in their tasks.

---

### Task 4: Rename CalendarView → AgendaView; priority filter bar

**Files:**
- Rename: `src/components/CalendarView.tsx` → `src/components/AgendaView.tsx`
- Modify: `src/App.tsx` (import + element), `src/styles.css`

**Step 1:** Rename the file and the exported component to `AgendaView`. Update the import and JSX in `App.tsx`. Change the pane `<h2>` to "Agenda".

**Step 2:** Remove the `showBumped` state and the "Show bumped layer" checkbox entirely.

**Step 3:** Add a priority filter bar below `pane-head`: a mode toggle (`Layers` / `Range`). In Layers mode render a segmented control of `layers` (label: `L1 · Top choices`, `L2 · from #{startRank}`, …). In Range mode render two number inputs (`a`, `b`, clamped 1–300). Props: `layers: Layer[]`, `priorityFilter`, `onPriorityFilter`.

**Step 4:** Compute the events to draw: in `layer` mode, the selected layer's `scheduledIds`; in `range` mode, `rangeItems(entries, hiddenIds, a, b)`. Build `Placed[]` from those (reuse existing packing). Drop the `is-bumped` styling path — layer mode shows only winners; range mode shows all, stacked.

**Step 5:** Add a `Hidden (N) · restore` chip in the filter bar when `hiddenIds.size > 0`, calling `clearHidden`.

**Step 6:** Run `npm run typecheck` and `npm run build`. Expected: PASS once `App.tsx` passes the new props. Smoke: dev server, switch layers/range, confirm blocks change.

---

### Task 5: Agenda zoom (days + time)

**Files:**
- Modify: `src/components/AgendaView.tsx`, `src/styles.css`

**Step 1:** Add `daysShown` state (`1 | 2 | 4 | 'all'`, default `4`) and `dayOffset` state (`0`). Add a control group: day-count buttons + ◀ ▶ pan. The visible day list = `allDays.slice(dayOffset, dayOffset + n)` (or all days when `'all'`).

**Step 2:** Add `timeView` state (`'morning' | 'afternoon' | 'evening' | 'all'`, default `'all'`). Map each to an `[minHour, maxHour]` window; clamp the computed event bounds into it. Add a button group for it.

**Step 3:** Add a vertical density control (`pxPerMin`, e.g. 0.6 / 1 / 1.6) — a small `−/+` or slider — replacing the hard-coded `PX_PER_MIN`.

**Step 4:** Run `npm run typecheck` + `npm run build`. Smoke: zoom in/out on days and time; pan with ◀ ▶.

---

### Task 6: Slot click / drag → slot search

**Files:**
- Modify: `src/components/AgendaView.tsx`, `src/App.tsx`, `src/styles.css`

**Step 1:** Overlay a transparent 30-min slot grid on each day column's body. Each slot knows its `[startTs, endTs]` (build via `Date.UTC` from the day + slot offset).

**Step 2:** `onMouseDown` on a slot records an anchor; `onMouseUp` on the same slot → `setSlotSearch({ kind: 'overlap', ts: slotStart })`. `onMouseUp` on a different slot → `setSlotSearch({ kind: 'contained', start: min, end: max })`. Show a light highlight on the dragged range.

**Step 3:** When `slotSearch` is set, call `onUncollapseSearch()` so the Search pane is visible.

**Step 4:** Run `npm run typecheck` + `npm run build`. Smoke: clicking/dragging slots updates Search (verified after Task 9).

---

### Task 7: Hide-event interaction

**Files:**
- Modify: `src/components/AgendaView.tsx`, `src/components/EventModal.tsx`

**Step 1:** Add a hover `✕` (hide) button on each Agenda event block → `onToggleHidden(eventId)`.

**Step 2:** Add a "Hide / Unhide from layout" button in `EventModal` (App passes `hiddenIds` + `toggleHidden`).

**Step 3:** Run `npm run typecheck` + `npm run build`. Smoke: hide a layer-1 event, confirm a lower-ranked event takes its slot; restore via the chip.

---

## Stage C — Search pane

### Task 8: Manage-data section (query history + scrape command)

**Files:**
- Modify: `src/components/EventBrowser.tsx`, `src/lib/storage.ts`, `src/styles.css`

**Step 1:** In `storage.ts` add `loadQueries(): string[]` / `saveQueries(q: string[])` (localStorage key `gencon-planner-queries-v1`).

**Step 2:** In `EventBrowser`, add a collapsible "Manage data" section showing: dataset game systems, event count, `scrapedAt` (pass `dataset` meta as props). An input + Add button appends a game-system name to the stored query set (seed from `dataset.gameSystems` on first load).

**Step 3:** A "Copy scrape command" button writes ``npm run scrape `queries.map(q => `"${q}"`).join(' ')` `` to the clipboard via `navigator.clipboard.writeText`, with a transient "Copied" confirmation.

**Step 4:** Run `npm run typecheck` + `npm run build`. Smoke: add a system, copy command, confirm clipboard text.

---

### Task 9: Search → match highlight; consume slot search

**Files:**
- Modify: `src/components/EventBrowser.tsx`, `src/App.tsx`

**Step 1:** When any filter is non-default, lift the filtered event-id set: call `onMatchIds(new Set(filtered.map(e => e.id)))` in an effect; clear it (empty set) when no filter is active.

**Step 2:** Accept `slotSearch` as a prop. When set, apply it as an extra filter over *unscheduled* events (id not in `wishlistIds`): `overlap` → events whose interval overlaps `ts`; `contained` → events whose interval is fully inside `[start,end]`. Show a clearable chip describing it; clearing calls `onClearSlotSearch`.

**Step 3:** Run `npm run typecheck` + `npm run build`. Smoke: a slot click on the Agenda filters the Search list to that time.

---

## Stage D — Wishlist pane

### Task 10: Cap 300 + rank-50 marker

**Files:**
- Modify: `src/components/WishlistPanel.tsx`, `src/styles.css`

**Step 1:** After the 50th `<li>`, render a divider row: "— GenCon submission limit (50) —". Entries past 50 render slightly dimmed.

**Step 2:** Show count as `N / 300` in the pane head (the 300 cap is enforced in `App.addToWishlist` from Task 3).

**Step 3:** Run `npm run typecheck` + `npm run build`. Smoke: a 51+ wishlist shows the marker.

---

### Task 11: Wishlist drag-and-drop reorder

**Files:**
- Modify: `src/components/WishlistPanel.tsx`, `src/App.tsx`, `src/styles.css`

**Step 1:** Add `onReorder(fromIndex, toIndex)` to `App` — splices the entry array and updates state.

**Step 2:** Make each `<li draggable>`; on `dragstart` store the index, on `dragover` `preventDefault` + show a drop indicator, on `drop` call `onReorder`. Keep the existing ▲▼ buttons (keyboard / non-drag path).

**Step 3:** Run `npm run typecheck` + `npm run build`. Smoke: drag a row to reorder; confirm ▲▼ still work.

---

### Task 12: Wishlist cross-pane highlight + game code

**Files:**
- Modify: `src/components/WishlistPanel.tsx`

**Step 1:** Accept `activeMatchIds: Set<number>`. Rows whose `eventId` is in the set get a `is-match` class (left accent / background tint). When the set is empty, no highlighting.

**Step 2:** Add the event `gameCode` to each row, in a compact monospace style next to the title.

**Step 3:** Run `npm run typecheck` + `npm run build`. Smoke: an active Search filter highlights matching wishlist rows.

---

## Stage E — Pane collapse

### Task 13: Collapsible Search & Wishlist panes

**Files:**
- Modify: `src/App.tsx`, `src/components/EventBrowser.tsx`, `src/components/WishlistPanel.tsx`, `src/styles.css`

**Step 1:** Add a collapse `«` / `»` button to each side pane's head. Collapsed state from Task 3's `searchCollapsed` / `wishlistCollapsed`.

**Step 2:** When collapsed, render a thin vertical rail (label + expand button) instead of the pane; the Agenda flexes to fill. Agenda's slot-search auto-uncollapses Search (Task 6 wiring).

**Step 3:** Run `npm run typecheck` + `npm run build`. Smoke: collapse/expand both panes; Agenda goes full-width.

---

## Final verification

- `npm run test` — engine tests pass.
- `npm run typecheck` — clean.
- `npm run build` — succeeds.
- `npm run preview` — manual pass over the full design: layers, range, zoom, slot search, hide, data command, drag, highlight, collapse.
