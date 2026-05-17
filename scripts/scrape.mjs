#!/usr/bin/env node
// Gen Con event cache pre-warmer.
//
// Usage:
//   node scripts/scrape.mjs "Magic: The Gathering" "Dungeons & Dragons"
//
// Fetches events for each game system from the public Gen Con API and writes
// one cache file per system under cache/events/game-<slug>.json, in the same
// { kind, name, fetchedAt, events } collection format the dev/preview proxy
// (server/gencon-proxy.mjs) reads. This is an optional way to pre-populate the
// proxy's game collections. No authentication required.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchEvents, slugify } from '../server/gencon.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '..', 'cache', 'events');

const DEFAULT_GAMES = ['Magic: The Gathering', 'Dungeons & Dragons'];

async function main() {
  const games = process.argv.slice(2).length
    ? process.argv.slice(2)
    : DEFAULT_GAMES;
  console.log(`Scraping ${games.length} game system(s): ${games.join(', ')}`);

  await mkdir(CACHE_DIR, { recursive: true });
  for (const game of games) {
    const events = await fetchEvents(game);
    const entry = {
      kind: 'game',
      name: game,
      fetchedAt: new Date().toISOString(),
      events,
    };
    const outPath = join(CACHE_DIR, `game-${slugify(game)}.json`);
    await writeFile(outPath, JSON.stringify(entry, null, 2) + '\n');
    console.log(`  ${game}: ${events.length} events -> ${outPath}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
