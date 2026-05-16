// Wishlist persistence: localStorage, plus JSON file export/import.

import type { GenConEvent, Wishlist, WishlistEntry } from '../types';

const KEY = 'gencon-planner-wishlist-v1';
// Durable metadata mirror for wishlisted events, so the Wishlist/Agenda can
// resolve them even when the proxy cache is cleared or the dev server is down.
// Kept separate from the wishlist record and from its JSON export.
const SNAPSHOTS_KEY = 'gencon-planner-event-snapshots-v1';

function sanitizeEntries(raw: unknown): WishlistEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  return raw
    .filter((e): e is WishlistEntry =>
      !!e && typeof (e as WishlistEntry).eventId === 'number')
    .map((e) => ({
      eventId: e.eventId,
      ...(typeof e.note === 'string' ? { note: e.note } : {}),
    }))
    // A wishlist cannot contain the same event twice — keep the first
    // occurrence of each id to avoid duplicate React keys downstream.
    .filter((e) => {
      if (seen.has(e.eventId)) return false;
      seen.add(e.eventId);
      return true;
    });
}

export function loadWishlist(): Wishlist {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { version: 1, entries: sanitizeEntries(parsed?.entries) };
    }
  } catch {
    // Corrupt storage — fall through to an empty wishlist.
  }
  return { version: 1, entries: [] };
}

export function saveWishlist(w: Wishlist): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    // Storage full or unavailable — nothing actionable to do.
  }
}

export function exportWishlist(w: Wishlist): void {
  const blob = new Blob([JSON.stringify(w, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gencon-wishlist-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Load the durable event-metadata snapshots; [] on missing/corrupt storage. */
export function loadEventSnapshots(): GenConEvent[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (e): e is GenConEvent =>
            !!e && typeof (e as GenConEvent).id === 'number',
        );
      }
    }
  } catch {
    // Corrupt storage — fall through to no snapshots.
  }
  return [];
}

/** Persist the durable event-metadata snapshots. */
export function saveEventSnapshots(events: GenConEvent[]): void {
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(events));
  } catch {
    // Storage full or unavailable — nothing actionable to do.
  }
}

export function parseImportedWishlist(text: string): Wishlist {
  const parsed = JSON.parse(text);
  const entries = sanitizeEntries(parsed?.entries);
  if (!Array.isArray(parsed?.entries)) {
    throw new Error('That file does not look like a wishlist export.');
  }
  return { version: 1, entries };
}
