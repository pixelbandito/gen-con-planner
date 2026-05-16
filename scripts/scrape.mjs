#!/usr/bin/env node
// Gen Con event scraper.
//
// Usage:
//   node scripts/scrape.mjs "Magic: The Gathering" "Dungeons & Dragons"
//
// Calls the public Gen Con event_search API for each game system, follows
// pagination, normalizes records, and writes public/data/events.json.
// No authentication required.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'public', 'data', 'events.json');
const API = 'https://www.gencon.com/api/event_search';

const DEFAULT_GAMES = ['Magic: The Gathering', 'Dungeons & Dragons'];

/** Build one page URL. `ag[]=eo&ag[]=tn` are the catalog's default filters. */
function pageUrl(game, page) {
  const params =
    `ag[]=eo&ag[]=tn&game[]=${encodeURIComponent(game)}` +
    (page > 1 ? `&page=${page}` : '');
  return `${API}?${params}`;
}

/** Normalize lowercase, collapse whitespace, strip punctuation — for dupKey. */
function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map a raw API `_source` object to our Event model. */
function normalizeEvent(src) {
  return {
    id: src.id,
    title: src.title ?? '',
    gameSystem: src.game_system ?? '',
    eventType: src.printable_event_type_no_prefix ?? src.event_type ?? '',
    groupSponsor: src.group_sponsor ?? '',
    shortDescription: src.short_description ?? '',
    longDescription: src.long_description ?? '',
    start: src.start_date ?? null,
    end: src.end_date ?? null,
    durationHours: src.event_duration ? Number(src.event_duration) : null,
    location: src.location ?? '',
    roomName: src.room_name ?? '',
    tableNumber: src.table_number ?? '',
    cost: src.event_cost != null ? Number(src.event_cost) : null,
    ticketsAvailable:
      src.tickets_available != null ? Number(src.tickets_available) : null,
    maxPlayersUnlimited: src.max_players_unlimited ?? null,
    ageRequirement: src.age_requirement_short ?? '',
    experienceRequired: src.experience_required_short ?? '',
    rulesEdition: src.rules_edition ?? '',
    materialsRequired: src.materials_required ?? '',
    gameCode: src.game_code ?? '',
    updatedAt: src.updated_at ?? null,
    dupKey: `${norm(src.title)}|${norm(src.group_sponsor)}`,
  };
}

async function fetchGame(game) {
  const collected = [];
  let page = 1;
  let conventionId = null;
  for (;;) {
    const url = pageUrl(game, page);
    const res = await fetch(url, {
      headers: { accept: 'application/json, text/plain, */*' },
    });
    if (!res.ok) {
      throw new Error(`${game} page ${page}: HTTP ${res.status}`);
    }
    const data = await res.json();
    conventionId = data.convention_id ?? conventionId;
    const records = data.records ?? [];
    for (const r of records) {
      if (r?._source) collected.push(normalizeEvent(r._source));
    }
    process.stdout.write(
      `  ${game}: page ${page} (+${records.length}, total ${collected.length}/${data.total_count})\n`,
    );
    if (!data.has_more || records.length === 0) break;
    page += 1;
  }
  return { events: collected, conventionId };
}

async function main() {
  const games = process.argv.slice(2).length
    ? process.argv.slice(2)
    : DEFAULT_GAMES;
  console.log(`Scraping ${games.length} game system(s): ${games.join(', ')}`);

  const byId = new Map();
  let conventionId = null;
  for (const game of games) {
    const { events, conventionId: cid } = await fetchGame(game);
    if (cid != null) conventionId = cid;
    for (const e of events) byId.set(e.id, e); // dedupe by id
  }

  const events = [...byId.values()].sort((a, b) =>
    (a.start ?? '').localeCompare(b.start ?? ''),
  );
  const out = {
    scrapedAt: new Date().toISOString(),
    conventionId,
    gameSystems: games,
    events,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${events.length} unique events -> ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
