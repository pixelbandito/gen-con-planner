// Vite plugin: a server-side GenCon proxy backed by an on-disk cache.
//
// Routes (dev + preview servers only):
//   GET /api/gencon/systems          - game-system catalog
//   GET /api/gencon/events?game=NAME - events for one system
//   GET /api/gencon/events           - all cached systems (seeds from
//                                      public/data/events.json if empty)
// `?refresh=1` forces a live re-fetch. Cache lives under cache/ (gitignored).

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchEvents,
  fetchGameSystems,
  isStale,
  slugify,
} from './gencon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'cache');
const EVENTS_CACHE_DIR = join(CACHE_DIR, 'events');
const SYSTEMS_CACHE = join(CACHE_DIR, 'systems.json');
const SEED_PATH = join(ROOT, 'public', 'data', 'events.json');

// In-flight event fetches, keyed by slug — collapses concurrent requests
// for the same game system into a single upstream fetch.
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

/** List `cache/events/*.json` filenames; [] if the directory is missing. */
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

/** Fetch + cache events for one game system (deduped via the in-flight map). */
async function loadEventsForSystem(name) {
  const slug = slugify(name);
  if (inFlight.has(slug)) return inFlight.get(slug);
  const promise = (async () => {
    const events = await fetchEvents(name);
    const entry = {
      gameSystem: name,
      fetchedAt: new Date().toISOString(),
      events,
    };
    await writeJson(join(EVENTS_CACHE_DIR, `${slug}.json`), entry);
    return entry;
  })();
  inFlight.set(slug, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(slug);
  }
}

/** GET /api/gencon/events?game=NAME */
async function handleEventsForGame(res, name, refresh) {
  const cachePath = join(EVENTS_CACHE_DIR, `${slugify(name)}.json`);
  let entry = refresh ? null : await readJson(cachePath);
  if (!entry) {
    entry = await loadEventsForSystem(name);
  }
  sendJson(res, 200, {
    gameSystem: entry.gameSystem,
    fetchedAt: entry.fetchedAt,
    stale: isStale(entry.fetchedAt),
    events: entry.events,
  });
}

/** Seed cache/events/ from public/data/events.json, grouped by game system. */
async function seedEventCacheFromBundle() {
  const seed = await readJson(SEED_PATH);
  if (!seed) return;
  const fetchedAt = seed.scrapedAt;
  const bySystem = new Map();
  for (const event of seed.events ?? []) {
    const system = event.gameSystem ?? '';
    if (!bySystem.has(system)) bySystem.set(system, []);
    bySystem.get(system).push(event);
  }
  for (const [gameSystem, events] of bySystem) {
    await writeJson(join(EVENTS_CACHE_DIR, `${slugify(gameSystem)}.json`), {
      gameSystem,
      fetchedAt,
      events,
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

/** GET /api/gencon/events (no game param) */
async function handleAllEvents(res) {
  let files = await listEventCacheFiles();
  if (files.length === 0) {
    await ensureSeeded();
    files = await listEventCacheFiles();
  }
  const systems = [];
  for (const file of files) {
    const entry = await readJson(join(EVENTS_CACHE_DIR, file));
    if (!entry) continue;
    systems.push({
      gameSystem: entry.gameSystem,
      fetchedAt: entry.fetchedAt,
      stale: isStale(entry.fetchedAt),
      events: entry.events,
    });
  }
  sendJson(res, 200, { systems });
}

/** Shared connect middleware for both the dev and preview servers. */
async function middleware(req, res, next) {
  if (!req.url || !req.url.startsWith('/api/gencon/')) {
    next();
    return;
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    const refresh = url.searchParams.get('refresh') === '1';

    if (url.pathname === '/api/gencon/systems') {
      await handleSystems(res, refresh);
      return;
    }
    if (url.pathname === '/api/gencon/events') {
      const game = url.searchParams.get('game');
      if (game) {
        await handleEventsForGame(res, game, refresh);
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
}

/** Vite plugin factory: registers the proxy on dev and preview servers. */
export function genconProxy() {
  return {
    name: 'gencon-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
