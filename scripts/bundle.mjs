#!/usr/bin/env node
// Snapshot the proxy's on-disk cache (cache/events/*.json — every cached
// game, category, and search collection) into public/data/events.json, the
// committed dataset that powers the offline/static build.
//
// Usage: npm run bundle
//
// Run this after loading the events you want to share into the running app,
// then commit the updated public/data/events.json.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVENTS_CACHE_DIR = join(ROOT, 'cache', 'events');
const BUNDLE_PATH = join(ROOT, 'public', 'data', 'events.json');

async function main() {
  let files = [];
  try {
    files = (await readdir(EVENTS_CACHE_DIR)).filter((f) =>
      f.endsWith('.json'),
    );
  } catch {
    // cache/events/ does not exist yet — handled below as "nothing to bundle".
  }
  if (files.length === 0) {
    console.error(
      'Nothing to bundle: cache/events/ is empty. Run the app (npm run dev) ' +
        'and load some game systems / categories / searches first.',
    );
    process.exit(1);
  }

  const collections = [];
  for (const file of files.sort()) {
    const c = JSON.parse(
      await readFile(join(EVENTS_CACHE_DIR, file), 'utf8'),
    );
    collections.push({
      kind: c.kind ?? 'game',
      name: c.name,
      // Default a missing timestamp to the epoch so it reads as stale
      // (safer than null, which Date.parse → NaN would treat as fresh).
      fetchedAt: c.fetchedAt ?? new Date(0).toISOString(),
      events: c.events ?? [],
    });
  }

  await mkdir(dirname(BUNDLE_PATH), { recursive: true });
  await writeFile(
    BUNDLE_PATH,
    JSON.stringify(
      { bundledAt: new Date().toISOString(), collections },
      null,
      2,
    ) + '\n',
  );

  const total = collections.reduce((n, c) => n + c.events.length, 0);
  console.log(
    `Bundled ${collections.length} collection(s), ${total} events ` +
      '-> public/data/events.json',
  );
}

main().catch((err) => {
  console.error('Bundle failed:', err.message);
  process.exit(1);
});
