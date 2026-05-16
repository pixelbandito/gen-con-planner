// Typed wrappers around the dev/preview GenCon proxy routes.
//
// The proxy matches requests on the absolute path prefix `/api/gencon/...`,
// so these wrappers request absolute paths regardless of Vite's BASE_URL.

import type { CatalogEntry, Collection, CollectionKind } from '../types';

/**
 * Stable key for a collection in the client's `collections` map / loading
 * sets. This is the single source of truth shared by App and EventBrowser.
 *
 * Note: this is intentionally distinct from the proxy's `${kind}-${slug}`
 * cache-key/filename scheme — they live in separate namespaces and need not
 * agree.
 */
export function collectionKey(kind: CollectionKind, name: string): string {
  return `${kind}::${name}`;
}

/** GET the parsed JSON from a proxy route, throwing on a non-OK response. */
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Request to ${path} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** GET /api/gencon/events — every collection currently cached. */
export function fetchCachedEvents(): Promise<{ collections: Collection[] }> {
  return getJson<{ collections: Collection[] }>('/api/gencon/events');
}

/**
 * GET /api/gencon/events?game=NAME, ?category=NAME, or ?search=TEXT — one
 * collection. The query param name is the collection kind, so adding a kind
 * needs no change here.
 */
export function fetchCollection(
  kind: CollectionKind,
  name: string,
  refresh = false,
): Promise<Collection> {
  const params = new URLSearchParams({ [kind]: name });
  if (refresh) params.set('refresh', '1');
  return getJson<Collection>(`/api/gencon/events?${params.toString()}`);
}

/** GET /api/gencon/systems — the game-system catalog. */
export function fetchSystems(refresh = false): Promise<{
  fetchedAt: string;
  stale: boolean;
  systems: CatalogEntry[];
}> {
  const path = refresh ? '/api/gencon/systems?refresh=1' : '/api/gencon/systems';
  return getJson(path);
}

/** GET /api/gencon/categories — the event-category catalog. */
export function fetchCategories(refresh = false): Promise<{
  fetchedAt: string;
  stale: boolean;
  categories: CatalogEntry[];
}> {
  const path = refresh
    ? '/api/gencon/categories?refresh=1'
    : '/api/gencon/categories';
  return getJson(path);
}
