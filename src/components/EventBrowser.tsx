import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CatalogEntry,
  Collection,
  CollectionKind,
  GenConEvent,
  SlotSearch,
} from '../types';
import {
  fmtDateTime,
  fmtDayLabel,
  fmtRelative,
  fmtTime,
  parseWall,
} from '../lib/time';
import { fmtCost, gameClass } from '../lib/style';
import { eventInterval } from '../lib/schedule';
import { collectionKey } from '../lib/api';
import { SearchableSelect } from './SearchableSelect';
import type { SearchableSelectOption } from './SearchableSelect';

interface Props {
  events: GenConEvent[];
  rankById: Map<number, number>;
  wishlistIds: Set<number>;
  gameCatalog: CatalogEntry[];
  categoryCatalog: CatalogEntry[];
  collections: Map<string, Collection>;
  loadingCollections: Set<string>;
  systemError: string | null;
  slotSearch: SlotSearch;
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onSelect: (id: number) => void;
  onMatchIds: (ids: Set<number>) => void;
  onClearSlotSearch: () => void;
  onCollapse: () => void;
  onLoadCollection: (kind: CollectionKind, name: string) => void;
  onRefreshCollection: (kind: CollectionKind, name: string) => void;
  onRefreshCatalogs: () => void;
}

const RESULT_CAP = 300;

// A picker is catalog-driven; if its catalog has not loaded yet it falls
// back to whichever collections of that kind are already loaded. Pure: every
// input is an explicit argument, so it closes over nothing from component
// scope.
function catalogOptions(
  kind: CollectionKind,
  catalog: CatalogEntry[],
  collections: Map<string, Collection>,
): CatalogEntry[] {
  if (catalog.length > 0) {
    return [...catalog].sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...collections.values()]
    .filter((c) => c.kind === kind)
    .map((c) => ({ name: c.name, eventCount: c.events.length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Readable local-ish label for a raw timezone-agnostic millis value. */
function fmtMs(ms: number): string {
  const d = new Date(ms);
  const w = parseWall(
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getUTCDate()).padStart(2, '0')}T` +
      `${String(d.getUTCHours()).padStart(2, '0')}:` +
      `${String(d.getUTCMinutes()).padStart(2, '0')}`,
  );
  return w ? `${fmtDayLabel(w.dayKey)} · ${fmtTime(w)}` : 'unknown time';
}

function slotSearchLabel(slot: NonNullable<SlotSearch>): string {
  return slot.kind === 'overlap'
    ? `Events overlapping ${fmtMs(slot.ts)}`
    : `Events within ${fmtMs(slot.start)} – ${fmtMs(slot.end)}`;
}

export function EventBrowser({
  events,
  rankById,
  wishlistIds,
  gameCatalog,
  categoryCatalog,
  collections,
  loadingCollections,
  systemError,
  slotSearch,
  onAdd,
  onRemove,
  onSelect,
  onMatchIds,
  onClearSlotSearch,
  onCollapse,
  onLoadCollection,
  onRefreshCollection,
  onRefreshCatalogs,
}: Props) {
  const [text, setText] = useState('');
  const [gameSystem, setGameSystem] = useState('');
  const [eventType, setEventType] = useState('');
  const [day, setDay] = useState('');
  const [maxCost, setMaxCost] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [hideWishlisted, setHideWishlisted] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);

  const systemOptions = useMemo(
    () => catalogOptions('game', gameCatalog, collections),
    [gameCatalog, collections],
  );
  const categoryOptions = useMemo(
    () => catalogOptions('category', categoryCatalog, collections),
    [categoryCatalog, collections],
  );

  // Options for the searchable game-system picker. The label is just the
  // system name plus its event count; what's cached is shown in the
  // "Manage cached events" section instead.
  const systemSelectOptions = useMemo<SearchableSelectOption[]>(() => {
    const opts: SearchableSelectOption[] = [
      { value: '', label: 'All game systems' },
    ];
    for (const s of systemOptions) {
      const count = s.eventCount > 0 ? ` (${s.eventCount})` : '';
      opts.push({
        value: s.name,
        label: `${s.name}${count}`,
      });
    }
    return opts;
  }, [systemOptions]);

  // Loaded collections (game, category, and search kinds), sorted, for the
  // cache-management section.
  const loadedCollections = useMemo(
    () =>
      [...collections.values()].sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
      ),
    [collections],
  );

  // Event ids that drive the stale tag. An event is stale only if it appears
  // in a stale collection AND in no non-stale collection — a fresh copy from
  // any non-stale collection means the loaded data is current.
  const staleEventIds = useMemo(() => {
    const staleIds = new Set<number>();
    const freshIds = new Set<number>();
    for (const c of collections.values()) {
      const target = c.stale ? staleIds : freshIds;
      for (const e of c.events) target.add(e.id);
    }
    for (const id of freshIds) staleIds.delete(id);
    return staleIds;
  }, [collections]);

  const days = useMemo(() => {
    const keys = new Set<string>();
    for (const e of events) {
      const w = parseWall(e.start);
      if (w) keys.add(w.dayKey);
    }
    return [...keys].sort();
  }, [events]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    const cap = maxCost.trim() === '' ? null : Number(maxCost);
    const rows = events.filter((e) => {
      if (gameSystem && e.gameSystem !== gameSystem) return false;
      if (eventType && e.eventType !== eventType) return false;
      if (day) {
        const w = parseWall(e.start);
        if (!w || w.dayKey !== day) return false;
      }
      if (cap != null && !Number.isNaN(cap)) {
        if (e.cost == null || e.cost > cap) return false;
      }
      if (onlyAvailable && !(e.ticketsAvailable && e.ticketsAvailable > 0)) {
        return false;
      }
      if (hideWishlisted && wishlistIds.has(e.id)) return false;
      if (q) {
        const hay =
          `${e.title} ${e.shortDescription} ${e.groupSponsor} ${e.gameCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // Slot search applies only to unscheduled (non-wishlisted) events.
      if (slotSearch && !wishlistIds.has(e.id)) {
        const iv = eventInterval(e);
        if (!iv) return false;
        if (slotSearch.kind === 'overlap') {
          if (!(iv.start <= slotSearch.ts && slotSearch.ts < iv.end)) {
            return false;
          }
        } else {
          if (!(iv.start >= slotSearch.start && iv.end <= slotSearch.end)) {
            return false;
          }
        }
      } else if (slotSearch) {
        // Slot search excludes already-wishlisted events.
        return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      const sa = parseWall(a.start)?.ts ?? Infinity;
      const sb = parseWall(b.start)?.ts ?? Infinity;
      return sa - sb || a.title.localeCompare(b.title);
    });
    return rows;
  }, [
    events, text, gameSystem, eventType, day, maxCost,
    onlyAvailable, hideWishlisted, wishlistIds, slotSearch,
  ]);

  // A filter is "active" when any control is non-default or a slot search runs.
  const filterActive =
    text.trim() !== '' ||
    gameSystem !== '' ||
    eventType !== '' ||
    day !== '' ||
    maxCost.trim() !== '' ||
    onlyAvailable ||
    hideWishlisted ||
    slotSearch != null;

  // Lift the matching id set to App so the Wishlist pane can highlight.
  // A fresh `new Set(...)` never structurally equals the previous one, so we
  // track a signature of the emitted ids and only re-emit when it changes.
  const lastMatchSig = useRef<string>('');
  useEffect(() => {
    const ids = filterActive ? filtered.map((e) => e.id) : [];
    const sig = filterActive
      ? [...ids].sort((a, b) => a - b).join(',')
      : '';
    if (sig === lastMatchSig.current) return;
    lastMatchSig.current = sig;
    onMatchIds(filterActive ? new Set(ids) : new Set());
  }, [filtered, filterActive, onMatchIds]);

  const shown = filtered.slice(0, RESULT_CAP);

  // Selecting a system/category filters the list and, if that collection has
  // not yet been loaded, kicks off a live fetch through the proxy.
  function handleSystemChange(name: string) {
    setGameSystem(name);
    if (name && !collections.has(collectionKey('game', name))) {
      onLoadCollection('game', name);
    }
  }

  function handleCategoryChange(name: string) {
    setEventType(name);
    if (name && !collections.has(collectionKey('category', name))) {
      onLoadCollection('category', name);
    }
  }

  const systemLoading =
    gameSystem !== '' &&
    loadingCollections.has(collectionKey('game', gameSystem));
  const categoryLoading =
    eventType !== '' &&
    loadingCollections.has(collectionKey('category', eventType));

  // Run a free-text GenCon search: fetch a `search` collection through the
  // proxy and merge it into the event pool. The local substring filter is
  // unaffected and keeps applying to the merged result.
  const searchQuery = text.trim();
  const searchLoading =
    searchQuery !== '' &&
    loadingCollections.has(collectionKey('search', searchQuery));
  function runGenconSearch() {
    if (searchQuery !== '') onLoadCollection('search', searchQuery);
  }

  return (
    <section className="pane pane-browser">
      <div className="pane-head">
        <h2>Browse events</h2>
        <span className="count">
          {filtered.length} match{filtered.length === 1 ? '' : 'es'}
        </span>
        <button
          className="btn btn-mini pane-collapse"
          onClick={onCollapse}
          title="Collapse search pane"
          aria-label="Collapse search pane"
        >
          «
        </button>
      </div>

      <div className="filters">
        <div className="text-search">
          <input
            className="filter-text"
            type="search"
            placeholder="Search title, sponsor, code…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runGenconSearch();
            }}
          />
          <button
            className="btn btn-search"
            onClick={runGenconSearch}
            disabled={searchQuery === '' || searchLoading}
            title="Fetch matching events from Gen Con"
          >
            {searchLoading ? 'Searching…' : 'Search Gen Con'}
          </button>
        </div>
        {searchLoading && (
          <div className="system-loading">Searching Gen Con for “{searchQuery}”…</div>
        )}
        <SearchableSelect
          value={gameSystem}
          options={systemSelectOptions}
          onChange={handleSystemChange}
          placeholder="Search game systems…"
          ariaLabel="Filter by game system"
        />
        {systemLoading && (
          <div className="system-loading">Loading {gameSystem}…</div>
        )}
        <select
          value={eventType}
          onChange={(e) => handleCategoryChange(e.target.value)}
        >
          <option value="">All event types</option>
          {categoryOptions.map((t) => {
            const count = t.eventCount > 0 ? ` (${t.eventCount})` : '';
            return (
              <option key={t.name} value={t.name}>
                {t.name}{count}
              </option>
            );
          })}
        </select>
        {categoryLoading && (
          <div className="system-loading">Loading {eventType}…</div>
        )}
        <select value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="">All days</option>
          {days.map((d) => (
            <option key={d} value={d}>{fmtDayLabel(d)}</option>
          ))}
        </select>
        <input
          className="filter-cost"
          type="number"
          min="0"
          placeholder="Max $"
          value={maxCost}
          onChange={(e) => setMaxCost(e.target.value)}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
          />
          Tickets available
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={hideWishlisted}
            onChange={(e) => setHideWishlisted(e.target.checked)}
          />
          Hide wishlisted
        </label>
      </div>

      <div className="manage-data">
        <button
          className="manage-toggle"
          onClick={() => setManageOpen((o) => !o)}
          aria-expanded={manageOpen}
        >
          <span className="manage-caret">{manageOpen ? '▾' : '▸'}</span>
          Manage cached events ({loadedCollections.length})
        </button>
        {manageOpen && (
          <div className="manage-body">
            {loadedCollections.length === 0 ? (
              <div className="list-note">
                Nothing loaded yet — pick a game system or event type above to
                fetch it.
              </div>
            ) : (
              <ul className="cache-list">
                {loadedCollections.map((c) => {
                  const key = collectionKey(c.kind, c.name);
                  const busy = loadingCollections.has(key);
                  return (
                    <li key={key} className="cache-row">
                      <div className="cache-row-main">
                        <span className={`cache-kind cache-kind-${c.kind}`}>
                          {c.kind === 'category'
                            ? 'type'
                            : c.kind === 'search'
                              ? 'search'
                              : 'game'}
                        </span>
                        <span className="cache-name">{c.name}</span>
                        {c.stale && (
                          <span className="stale-badge">stale</span>
                        )}
                        <span className="cache-time">
                          {fmtRelative(c.fetchedAt)}
                        </span>
                      </div>
                      <button
                        className="btn btn-mini"
                        onClick={() => onRefreshCollection(c.kind, c.name)}
                        disabled={busy}
                      >
                        {busy ? 'Refreshing…' : 'Refresh'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <button className="btn btn-mini" onClick={onRefreshCatalogs}>
              Refresh catalogs
            </button>
            {systemError && (
              <div className="list-note list-note-error">
                Fetch failed: {systemError}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="event-list">
        {slotSearch && (
          <div className="slot-chip">
            <span>{slotSearchLabel(slotSearch)}</span>
            <button
              className="slot-chip-clear"
              onClick={onClearSlotSearch}
              title="Clear slot search"
              aria-label="Clear slot search"
            >
              ✕
            </button>
          </div>
        )}
        {shown.map((e) => {
          const inList = wishlistIds.has(e.id);
          const stale = staleEventIds.has(e.id);
          return (
            <div key={e.id} className={`event-row ${gameClass(e.gameSystem)}`}>
              <div className="event-row-main" onClick={() => onSelect(e.id)}>
                <div className="event-row-title">
                  {inList && (
                    <span className="rank-chip">#{rankById.get(e.id)}</span>
                  )}
                  {e.title}
                </div>
                <div className="event-row-meta">
                  {fmtDateTime(e.start, e.end)} · {fmtCost(e.cost)} ·{' '}
                  {e.ticketsAvailable ?? '?'} tix · {e.eventType}
                  {stale && <span className="stale-tag">stale</span>}
                </div>
                <div className="event-row-sub">{e.groupSponsor}</div>
              </div>
              <button
                className={inList ? 'btn btn-remove' : 'btn btn-add'}
                onClick={() => (inList ? onRemove(e.id) : onAdd(e.id))}
                title={inList ? 'Remove from wishlist' : 'Add to wishlist'}
              >
                {inList ? '−' : '+'}
              </button>
            </div>
          );
        })}
        {filtered.length > RESULT_CAP && (
          <div className="list-note">
            Showing first {RESULT_CAP} of {filtered.length}. Narrow your
            filters to see the rest.
          </div>
        )}
        {filtered.length === 0 && (
          <div className="list-note">No events match these filters.</div>
        )}
      </div>
    </section>
  );
}
