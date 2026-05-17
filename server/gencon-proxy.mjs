// Vite plugin: a server-side GenCon proxy backed by an on-disk cache.
//
// This is a thin wrapper around the shared route handler in gencon-routes.mjs.
// The route logic, caching, seeding, and error handling all live there; this
// file only resolves the repo's cache directory and bundle path and registers
// the handler as connect middleware on the dev and preview servers.
//
// Cache lives under cache/ (gitignored); it is seeded on first run from
// public/data/events.json. See gencon-routes.mjs for the route reference.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenconHandler } from './gencon-routes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'cache');
const BUNDLE_PATH = join(ROOT, 'public', 'data', 'events.json');

/** Vite plugin factory: registers the proxy on dev and preview servers. */
export function genconProxy() {
  const handler = createGenconHandler({
    cacheDir: CACHE_DIR,
    bundlePath: BUNDLE_PATH,
  });
  return {
    name: 'gencon-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
