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
    // -1 = layer fully resolved, we are done. 0 should be unreachable (the
    // first item of a slice can never be bumped — `placed` is empty when it
    // is processed), but guard against it anyway so a future change to
    // greedyFill can never turn this into an infinite loop.
    if (firstBumped <= 0) break;
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
