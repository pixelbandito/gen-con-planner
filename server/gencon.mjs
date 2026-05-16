// Shared GenCon API helpers.
//
// Used by both the dev/preview Vite proxy plugin (server/gencon-proxy.mjs)
// and the CLI cache pre-warmer (scripts/scrape.mjs). No authentication
// required; the GenCon public API only needs an `accept` header.

const EVENT_SEARCH = 'https://www.gencon.com/api/event_search';
const META_DATA =
  'https://www.gencon.com/api/event_search/meta_data?ag[]=eo&ag[]=tn&filter=game';

const STALE_MS = 7 * 24 * 3600 * 1000;

/** Normalize lowercase, collapse whitespace, strip punctuation — for dupKey. */
function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map a raw API `_source` object to our Event model. */
export function normalizeEvent(src) {
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

/** URL-/filename-safe slug from a game-system name. */
export function slugify(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** True when a cache entry fetched at `fetchedAtIso` is older than 7 days. */
export function isStale(fetchedAtIso) {
  return Date.now() - Date.parse(fetchedAtIso) > STALE_MS;
}

/**
 * Turn the meta_data game_system buckets into a clean catalog.
 * Drops empty/whitespace keys, dedupes by trimmed name keeping the larger
 * count, and sorts by name ascending.
 */
export function parseSystemBuckets(metaJson) {
  const buckets = metaJson?.filtered?.game_system?.buckets ?? [];
  const byName = new Map();
  for (const bucket of buckets) {
    const name = (bucket.key ?? '').trim();
    if (name === '') continue;
    const eventCount = bucket.doc_count;
    const existing = byName.get(name);
    if (!existing || eventCount > existing.eventCount) {
      byName.set(name, { name, eventCount });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetch the GenCon game-system catalog. */
export async function fetchGameSystems() {
  const res = await fetch(META_DATA, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`GenCon meta_data: HTTP ${res.status}`);
  }
  const json = await res.json();
  return parseSystemBuckets(json);
}

/** Build one event_search page URL. */
function pageUrl(game, page) {
  const params =
    `ag[]=eo&ag[]=tn&game[]=${encodeURIComponent(game)}` +
    (page > 1 ? `&page=${page}` : '');
  return `${EVENT_SEARCH}?${params}`;
}

/**
 * Page through event_search for one game system, normalize records, dedupe
 * by id, and return events sorted by `start` ascending.
 */
export async function fetchEvents(gameSystem) {
  // Defensive upper bound on pagination so a pathological API response
  // (e.g. `has_more` stuck true) cannot loop forever.
  const MAX_PAGES = 500;
  const byId = new Map();
  let page = 1;
  for (;;) {
    const res = await fetch(pageUrl(gameSystem, page), {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(
        `GenCon event_search "${gameSystem}" page ${page}: HTTP ${res.status}`,
      );
    }
    const data = await res.json();
    const records = data.records ?? [];
    for (const r of records) {
      if (r?._source) {
        const event = normalizeEvent(r._source);
        byId.set(event.id, event);
      }
    }
    if (!data.has_more || records.length === 0) break;
    if (page >= MAX_PAGES) {
      throw new Error(
        `GenCon event_search "${gameSystem}": exceeded ${MAX_PAGES}-page cap`,
      );
    }
    page += 1;
  }
  return [...byId.values()].sort((a, b) =>
    (a.start ?? '').localeCompare(b.start ?? ''),
  );
}
