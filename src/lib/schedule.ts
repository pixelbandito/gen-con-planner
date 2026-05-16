// Schedule derivation: conflicts, the greedy "expected schedule", and hedges.
//
// Nothing here is stored. It is all recomputed from the ranked wishlist.

import type { GenConEvent, WishlistEntry } from '../types';
import { parseWall } from './time';

export type ScheduleStatus = 'scheduled' | 'bumped' | 'untimed' | 'missing';

export interface ScheduleInfo {
  status: ScheduleStatus;
  /** 1-based rank (position in the wishlist). */
  rank: number;
  /** When bumped: the eventId of the higher-ranked event that took the slot. */
  bumpedBy?: number;
}

/**
 * Walk the ranked wishlist top to bottom. Place an event if its time slot is
 * still free; otherwise mark it "bumped" by the higher-ranked event that holds
 * the slot. The placed events are the schedule you would actually receive if
 * nothing sold out — the "ideal schedule".
 */
export function computeSchedule(
  entries: WishlistEntry[],
  eventsById: Map<number, GenConEvent>,
): Map<number, ScheduleInfo> {
  const result = new Map<number, ScheduleInfo>();
  const placed: { start: number; end: number; eventId: number }[] = [];

  entries.forEach((entry, i) => {
    const rank = i + 1;
    const ev = eventsById.get(entry.eventId);
    if (!ev) {
      result.set(entry.eventId, { status: 'missing', rank });
      return;
    }
    const s = parseWall(ev.start);
    const e = parseWall(ev.end);
    if (!s || !e) {
      result.set(entry.eventId, { status: 'untimed', rank });
      return;
    }
    const clash = placed.find((p) => s.ts < p.end && e.ts > p.start);
    if (clash) {
      result.set(entry.eventId, {
        status: 'bumped',
        rank,
        bumpedBy: clash.eventId,
      });
    } else {
      placed.push({ start: s.ts, end: e.ts, eventId: entry.eventId });
      result.set(entry.eventId, { status: 'scheduled', rank });
    }
  });
  return result;
}

/**
 * Group wishlist entries that are the "same" event (matching dupKey) into
 * hedge groups. Only groups with 2+ entries are returned.
 */
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
