// Shared GenCon route handlers backed by an on-disk JSON cache.
//
// Routes:
//   GET /api/gencon/systems              - game-system catalog
//   GET /api/gencon/categories           - event-category catalog
//   GET /api/gencon/hosts                - host (group-sponsor) catalog
//   GET /api/gencon/events?game=NAME     - events for one game system
//   GET /api/gencon/events?category=NAME - events for one event category
//   GET /api/gencon/events?host=NAME     - events for one host
//   GET /api/gencon/events?search=TEXT   - events for a free-text query
//   GET /api/gencon/events               - all cached collections (seeds from
//                                          the bundle file if empty)
//   GET /api/gencon/events-by-id?ids=1,2 - re-fetch events by id (no caching)
// `?refresh=1` forces a live re-fetch.
//
// A "collection" is one cacheable fetch unit: { kind, name, fetchedAt, events }
// where kind is 'game', 'category', 'host', or 'search'. Cache files are
// <cacheDir>/events/<kind>-<slug>.json.
//
// `createGenconHandler({ cacheDir, bundlePath })` returns the request handler:
// an async (req, res, next?) => {...}. `cacheDir` is the root of the on-disk
// cache; `bundlePath` is the read-only seed file (the bundled events.json).

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  cacheSlug,
  fetchCategories,
  fetchCategoryEvents,
  fetchEventById,
  fetchEvents,
  fetchGameSystems,
  fetchHostEvents,
  fetchHosts,
  fetchSearchEvents,
  isStale,
} from './gencon.mjs';

/**
 * Build the GenCon `/api/gencon/*` request handler.
 *
 * @param {object}  opts
 * @param {string}  opts.cacheDir   Root of the writable on-disk cache.
 * @param {string}  opts.bundlePath Read-only seed file (the bundled events.json).
 * @returns {(req, res, next?) => Promise<void>} connect-style request handler.
 */
export function createGenconHandler({ cacheDir, bundlePath }) {
  const CACHE_DIR = cacheDir;
  const EVENTS_CACHE_DIR = join(CACHE_DIR, 'events');
  const SYSTEMS_CACHE = join(CACHE_DIR, 'systems.json');
  const CATEGORIES_CACHE = join(CACHE_DIR, 'categories.json');
  const HOSTS_CACHE = join(CACHE_DIR, 'hosts.json');
  const BUNDLE_PATH = bundlePath;

  // In-flight collection fetches, keyed by `${kind}-${slug}` — collapses
  // concurrent requests for the same collection into a single upstream fetch.
  // Keying on kind+slug keeps a game and a category from ever colliding.
  const inFlight = new Map();

  /** Read and JSON-parse a file, returning null if it does not exist. */
  async function readJson(path) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Write a value as pretty JSON, creating parent directories as needed.
   * The write is atomic: data is written to a unique temp file in the same
   * directory and then renamed onto the final path, so concurrent readers
   * never observe a half-written file.
   */
  async function writeJson(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(value, null, 2) + '\n');
    await rename(tmpPath, path);
  }

  /** List `<cacheDir>/events/*.json` filenames; [] if the directory is missing. */
  async function listEventCacheFiles() {
    try {
      const names = await readdir(EVENTS_CACHE_DIR);
      return names.filter((n) => n.endsWith('.json'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  function sendJson(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  }

  /** Cache file path for one collection. */
  function collectionPath(kind, name) {
    return join(EVENTS_CACHE_DIR, `${kind}-${cacheSlug(name)}.json`);
  }

  /** Normalize a read cache entry into a collection (missing kind → 'game'). */
  function asCollection(entry) {
    return {
      kind: entry.kind ?? 'game',
      name: entry.name ?? entry.gameSystem ?? '',
      fetchedAt: entry.fetchedAt,
      events: entry.events ?? [],
    };
  }

  /** GET /api/gencon/systems */
  async function handleSystems(res, refresh) {
    let cached = refresh ? null : await readJson(SYSTEMS_CACHE);
    if (!cached) {
      const systems = await fetchGameSystems();
      cached = { fetchedAt: new Date().toISOString(), systems };
      await writeJson(SYSTEMS_CACHE, cached);
    }
    sendJson(res, 200, {
      fetchedAt: cached.fetchedAt,
      stale: isStale(cached.fetchedAt),
      systems: cached.systems,
    });
  }

  /** GET /api/gencon/categories */
  async function handleCategories(res, refresh) {
    let cached = refresh ? null : await readJson(CATEGORIES_CACHE);
    if (!cached) {
      const categories = await fetchCategories();
      cached = { fetchedAt: new Date().toISOString(), categories };
      await writeJson(CATEGORIES_CACHE, cached);
    }
    sendJson(res, 200, {
      fetchedAt: cached.fetchedAt,
      stale: isStale(cached.fetchedAt),
      categories: cached.categories,
    });
  }

  /** GET /api/gencon/hosts */
  async function handleHosts(res, refresh) {
    let cached = refresh ? null : await readJson(HOSTS_CACHE);
    if (!cached) {
      const hosts = await fetchHosts();
      cached = { fetchedAt: new Date().toISOString(), hosts };
      await writeJson(HOSTS_CACHE, cached);
    }
    sendJson(res, 200, {
      fetchedAt: cached.fetchedAt,
      stale: isStale(cached.fetchedAt),
      hosts: cached.hosts,
    });
  }

  /** Fetch events for one collection by kind. */
  function fetchByKind(kind, name) {
    if (kind === 'category') return fetchCategoryEvents(name);
    if (kind === 'host') return fetchHostEvents(name);
    if (kind === 'search') return fetchSearchEvents(name);
    return fetchEvents(name);
  }

  /** Fetch + cache one collection (deduped via the in-flight map). */
  async function loadCollection(kind, name) {
    const key = `${kind}-${cacheSlug(name)}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = (async () => {
      const events = await fetchByKind(kind, name);
      const entry = {
        kind,
        name,
        fetchedAt: new Date().toISOString(),
        events,
      };
      await writeJson(collectionPath(kind, name), entry);
      return entry;
    })();
    inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(key);
    }
  }

  /** GET /api/gencon/events?game=NAME, ?category=NAME, or ?search=TEXT */
  async function handleCollection(res, kind, name, refresh) {
    let entry = refresh ? null : await readJson(collectionPath(kind, name));
    if (!entry) {
      entry = await loadCollection(kind, name);
    } else {
      entry = asCollection(entry);
    }
    sendJson(res, 200, {
      kind: entry.kind,
      name: entry.name,
      fetchedAt: entry.fetchedAt,
      stale: isStale(entry.fetchedAt),
      events: entry.events,
    });
  }

  /**
   * Seed <cacheDir>/events/ from the bundled events.json — which is already in
   * the { collections: [{ kind, name, fetchedAt, events }] } shape, so each
   * collection is written straight to its cache file.
   */
  async function seedEventCacheFromBundle() {
    const bundle = await readJson(BUNDLE_PATH);
    if (!bundle) return;
    for (const c of bundle.collections ?? []) {
      if (!c?.kind || !c?.name) continue;
      await writeJson(collectionPath(c.kind, c.name), {
        kind: c.kind,
        name: c.name,
        fetchedAt: c.fetchedAt,
        events: c.events ?? [],
      });
    }
  }

  // Seed-once latch: collapses concurrent cold-cache requests into a single
  // seeding run. On failure the latch is reset so a later request can retry.
  let seedPromise = null;
  function ensureSeeded() {
    if (!seedPromise) {
      seedPromise = seedEventCacheFromBundle().catch((e) => {
        seedPromise = null;
        throw e;
      });
    }
    return seedPromise;
  }

  /** GET /api/gencon/events (no game/category param) */
  async function handleAllEvents(res) {
    let files = await listEventCacheFiles();
    if (files.length === 0) {
      await ensureSeeded();
      files = await listEventCacheFiles();
    }
    const collections = [];
    for (const file of files) {
      const entry = await readJson(join(EVENTS_CACHE_DIR, file));
      if (!entry) continue;
      const c = asCollection(entry);
      collections.push({
        kind: c.kind,
        name: c.name,
        fetchedAt: c.fetchedAt,
        stale: isStale(c.fetchedAt),
        events: c.events,
      });
    }
    sendJson(res, 200, { collections });
  }

  /**
   * Run `worker` over `items` with at most `limit` in flight at once — be
   * gentle to GenCon when recovering several events. Results preserve input
   * order.
   */
  async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function runner() {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= items.length) return;
        results[i] = await worker(items[i]);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, runner),
    );
    return results;
  }

  /**
   * GET /api/gencon/events-by-id?ids=1,2,3 — re-fetch events by id for client
   * recovery. Does NOT write to the cache; the client persists results itself.
   */
  async function handleEventsById(res, idsParam) {
    const ids = (idsParam ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) {
      sendJson(res, 400, { error: 'ids query must list numeric event ids' });
      return;
    }
    // Isolate per-id failures: a non-OK response for one id resolves to null
    // instead of rejecting the whole batch, so that bad id is simply omitted
    // from the response rather than failing recovery of every other id.
    const fetched = await mapWithConcurrency(ids, 4, (id) =>
      fetchEventById(id).catch(() => null),
    );
    sendJson(res, 200, { events: fetched.filter((e) => e != null) });
  }

  /** Request handler for both the dev/preview proxy and the standalone server. */
  return async function handler(req, res, next) {
    if (!req.url || !req.url.startsWith('/api/gencon/')) {
      if (next) next();
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const refresh = url.searchParams.get('refresh') === '1';

      if (url.pathname === '/api/gencon/systems') {
        await handleSystems(res, refresh);
        return;
      }
      if (url.pathname === '/api/gencon/categories') {
        await handleCategories(res, refresh);
        return;
      }
      if (url.pathname === '/api/gencon/hosts') {
        await handleHosts(res, refresh);
        return;
      }
      if (url.pathname === '/api/gencon/events-by-id') {
        await handleEventsById(res, url.searchParams.get('ids'));
        return;
      }
      if (url.pathname === '/api/gencon/events') {
        const game = url.searchParams.get('game');
        const category = url.searchParams.get('category');
        const host = url.searchParams.get('host');
        const search = url.searchParams.get('search');
        if (game) {
          await handleCollection(res, 'game', game, refresh);
        } else if (category) {
          await handleCollection(res, 'category', category, refresh);
        } else if (host) {
          await handleCollection(res, 'host', host, refresh);
        } else if (search !== null) {
          if (search.trim() === '') {
            sendJson(res, 400, { error: 'search query must not be empty' });
          } else {
            await handleCollection(res, 'search', search.trim(), refresh);
          }
        } else {
          await handleAllEvents(res);
        }
        return;
      }
      sendJson(res, 404, { error: `Unknown route: ${url.pathname}` });
    } catch (err) {
      const message = err?.message ?? String(err);
      // Upstream HTTP failures are surfaced as 502; everything else as 500.
      const status = /HTTP \d{3}/.test(message) ? 502 : 500;
      sendJson(res, status, { error: message });
    }
  };
}
