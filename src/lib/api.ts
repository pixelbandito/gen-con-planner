// Typed wrappers around the dev/preview GenCon proxy routes.
//
// The proxy matches requests on the absolute path prefix `/api/gencon/...`,
// so these wrappers request absolute paths regardless of Vite's BASE_URL.

import type { CachedSystem, SystemCatalogEntry } from '../types';

/** GET the parsed JSON from a proxy route, throwing on a non-OK response. */
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Request to ${path} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** GET /api/gencon/events — every game system currently cached. */
export function fetchCachedEvents(): Promise<{ systems: CachedSystem[] }> {
  return getJson<{ systems: CachedSystem[] }>('/api/gencon/events');
}

/** GET /api/gencon/events?game=NAME — events for a single game system. */
export function fetchSystemEvents(
  name: string,
  refresh = false,
): Promise<CachedSystem> {
  const params = new URLSearchParams({ game: name });
  if (refresh) params.set('refresh', '1');
  return getJson<CachedSystem>(`/api/gencon/events?${params.toString()}`);
}

/** GET /api/gencon/systems — the game-system catalog. */
export function fetchSystems(refresh = false): Promise<{
  fetchedAt: string;
  stale: boolean;
  systems: SystemCatalogEntry[];
}> {
  const path = refresh ? '/api/gencon/systems?refresh=1' : '/api/gencon/systems';
  return getJson(path);
}
