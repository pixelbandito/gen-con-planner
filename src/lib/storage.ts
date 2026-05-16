// Wishlist persistence: localStorage, plus JSON file export/import.

import type { Wishlist, WishlistEntry } from '../types';

const KEY = 'gencon-planner-wishlist-v1';
const QUERIES_KEY = 'gencon-planner-queries-v1';

function sanitizeEntries(raw: unknown): WishlistEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is WishlistEntry =>
      !!e && typeof (e as WishlistEntry).eventId === 'number')
    .map((e) => ({
      eventId: e.eventId,
      ...(typeof e.note === 'string' ? { note: e.note } : {}),
    }));
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

/** The scraper query set: game-system names to feed `npm run scrape`. */
export function loadQueries(): string[] {
  try {
    const raw = localStorage.getItem(QUERIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((q): q is string => typeof q === 'string');
      }
    }
  } catch {
    // Corrupt storage — fall through to an empty query set.
  }
  return [];
}

export function saveQueries(q: string[]): void {
  try {
    localStorage.setItem(QUERIES_KEY, JSON.stringify(q));
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

export function parseImportedWishlist(text: string): Wishlist {
  const parsed = JSON.parse(text);
  const entries = sanitizeEntries(parsed?.entries);
  if (!Array.isArray(parsed?.entries)) {
    throw new Error('That file does not look like a wishlist export.');
  }
  return { version: 1, entries };
}
