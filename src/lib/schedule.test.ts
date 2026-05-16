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
