import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CatalogEntry,
  Collection,
  CollectionKind,
  GenConEvent,
  PriorityFilter,
  SlotSearch,
  Wishlist,
} from './types';
import type { GreedyResult } from './lib/schedule';
import { computeLayers, hedgeGroups } from './lib/schedule';
import {
  collectionKey,
  fetchCachedEvents,
  fetchCategories,
  fetchCollection,
  fetchEventsByIds,
  fetchSystems,
} from './lib/api';
import {
  exportWishlist,
  loadEventSnapshots,
  loadWishlist,
  parseImportedWishlist,
  saveEventSnapshots,
  saveWishlist,
} from './lib/storage';
import { EventBrowser } from './components/EventBrowser';
import { AgendaView } from './components/AgendaView';
import { WishlistPanel } from './components/WishlistPanel';
import { CollapsedRail } from './components/CollapsedRail';
import { EventModal } from './components/EventModal';

const WISHLIST_CAP = 300;

export default function App() {
  // Loaded collections (game systems, event categories, and free-text
  // searches), keyed `kind::name`.
  const [collections, setCollections] = useState<Map<string, Collection>>(
    () => new Map(),
  );
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Per-collection fetch failure — surfaced inline, not as the startup banner.
  const [systemError, setSystemError] = useState<string | null>(null);
  // The GenCon catalogs, fetched separately and non-blocking.
  const [gameCatalog, setGameCatalog] = useState<CatalogEntry[]>([]);
  const [categoryCatalog, setCategoryCatalog] = useState<CatalogEntry[]>([]);
  // Collections currently being fetched/refreshed live, keyed `kind::name`.
  const [loadingCollections, setLoadingCollections] = useState(
    () => new Set<string>(),
  );
  // Synchronous in-flight guard — state Sets can read stale in rapid calls.
  const inFlightCollections = useRef(new Set<string>());
  const [wishlist, setWishlist] = useState<Wishlist>(() => loadWishlist());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Durable metadata mirror for wishlisted events — survives a cleared proxy
  // cache or a stopped dev server. Kept in sync by the effect below.
  const [eventSnapshots, setEventSnapshots] = useState<Map<number, GenConEvent>>(
    () => new Map(loadEventSnapshots().map((e) => [e.id, e])),
  );
  // True while the manual recover-missing-events fetch is in flight.
  const [recovering, setRecovering] = useState(false);

  // Cross-pane state. Session-only — none of this is persisted.
  const [hiddenIds, setHiddenIds] = useState(() => new Set<number>());
  const [slotSearch, setSlotSearch] = useState<SlotSearch>(null);
  const [activeMatchIds, setActiveMatchIds] = useState(() => new Set<number>());
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>({
    mode: 'layer',
    layer: 1,
  });
  const [searchCollapsed, setSearchCollapsed] = useState(false);
  const [wishlistCollapsed, setWishlistCollapsed] = useState(false);

  // Load every cached collection from the GenCon proxy on startup.
  useEffect(() => {
    fetchCachedEvents()
      .then(({ collections: loaded }) => {
        setCollections(
          new Map(loaded.map((c) => [collectionKey(c.kind, c.name), c])),
        );
        setDataLoading(false);
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : String(e));
        setDataLoading(false);
      });
  }, []);

  // Load both catalogs separately — they must not block the app.
  // On failure the pickers fall back to whatever collections are loaded.
  useEffect(() => {
    fetchSystems()
      .then(({ systems }) => setGameCatalog(systems))
      .catch(() => {
        /* Catalog unavailable — picker falls back to loaded collections. */
      });
    fetchCategories()
      .then(({ categories }) => setCategoryCatalog(categories))
      .catch(() => {
        /* Catalog unavailable — picker falls back to loaded collections. */
      });
  }, []);

  // Persist the wishlist whenever it changes.
  useEffect(() => {
    saveWishlist(wishlist);
  }, [wishlist]);

  // Fetch one collection from the proxy and store it. Because `events` is
  // derived from `collections`, storing the collection is all that is needed.
  // `refresh` forces the proxy to re-scrape rather than serve its cache.
  async function loadCollectionEvents(
    kind: CollectionKind,
    name: string,
    refresh: boolean,
  ) {
    const key = collectionKey(kind, name);
    if (inFlightCollections.current.has(key)) return;
    inFlightCollections.current.add(key);
    setLoadingCollections((prev) => new Set(prev).add(key));
    try {
      const collection = await fetchCollection(kind, name, refresh);
      setCollections((prev) => new Map(prev).set(key, collection));
      setSystemError(null);
    } catch (e: unknown) {
      setSystemError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightCollections.current.delete(key);
      setLoadingCollections((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function loadCollection(kind: CollectionKind, name: string) {
    return loadCollectionEvents(kind, name, false);
  }

  function refreshCollection(kind: CollectionKind, name: string) {
    return loadCollectionEvents(kind, name, true);
  }

  // Refresh both catalogs together. Each catalog's result is applied
  // independently (a catalog that loaded still updates even if the other
  // failed), but `systemError` is only cleared when BOTH succeed — so one
  // catalog's success can never mask the other's failure.
  async function refreshCatalogs() {
    const [systemsResult, categoriesResult] = await Promise.allSettled([
      fetchSystems(true),
      fetchCategories(true),
    ]);

    if (systemsResult.status === 'fulfilled') {
      setGameCatalog(systemsResult.value.systems);
    }
    if (categoriesResult.status === 'fulfilled') {
      setCategoryCatalog(categoriesResult.value.categories);
    }

    const systemsFailed = systemsResult.status === 'rejected';
    const categoriesFailed = categoriesResult.status === 'rejected';
    if (!systemsFailed && !categoriesFailed) {
      setSystemError(null);
    } else if (systemsFailed && categoriesFailed) {
      setSystemError(
        'Could not refresh the game-system catalog or the category catalog',
      );
    } else if (systemsFailed) {
      setSystemError('Could not refresh the game-system catalog');
    } else {
      setSystemError('Could not refresh the category catalog');
    }
  }

  // Id-deduped event map derived purely from loaded collections. An event can
  // appear in both a game and a category collection — keep the first seen.
  const collectionEventsById = useMemo(() => {
    const byId = new Map<number, GenConEvent>();
    for (const collection of collections.values()) {
      for (const e of collection.events) {
        if (!byId.has(e.id)) byId.set(e.id, e);
      }
    }
    return byId;
  }, [collections]);

  // The Search browser's list — collections only, so snapshot-only events
  // (recovered wishlist metadata) never appear as browsable rows.
  const events = useMemo(
    () => [...collectionEventsById.values()],
    [collectionEventsById],
  );

  // Resolution map for the Wishlist/Agenda/modal: collections win, then fall
  // back to durable snapshots so wishlisted events resolve with the proxy off.
  const eventsById = useMemo(() => {
    const m = new Map<number, GenConEvent>(eventSnapshots);
    for (const [id, e] of collectionEventsById) m.set(id, e);
    return m;
  }, [collectionEventsById, eventSnapshots]);

  // Agenda layers honor hidden events — hiding is an Agenda-only view filter.
  const agendaLayers = useMemo(
    () => computeLayers(wishlist.entries, eventsById, hiddenIds),
    [wishlist, eventsById, hiddenIds],
  );
  // Wishlist layers ignore hidden events: status pills and header counts must
  // reflect the true wishlist, not the Agenda's temporary view state.
  const wishlistLayers = useMemo(
    () => computeLayers(wishlist.entries, eventsById),
    [wishlist, eventsById],
  );

  // Keep the layer selection in range: if the wishlist shrinks so that fewer
  // layers exist, a stale high-layer selection would render an empty agenda.
  // The priority filter is an Agenda concern, so it tracks the Agenda layers.
  useEffect(() => {
    if (priorityFilter.mode !== 'layer') return;
    const maxLayer = Math.max(1, agendaLayers.length);
    if (priorityFilter.layer > maxLayer) {
      setPriorityFilter({ mode: 'layer', layer: maxLayer });
    }
  }, [agendaLayers, priorityFilter]);
  // Layer 1 is the greedy fill of the whole wishlist: the full status map.
  const fullResult = useMemo(
    () => wishlistLayers[0]?.result ?? new Map<number, GreedyResult>(),
    [wishlistLayers],
  );
  const rankById = useMemo(() => {
    const m = new Map<number, number>();
    wishlist.entries.forEach((e, i) => m.set(e.eventId, i + 1));
    return m;
  }, [wishlist]);
  const hedges = useMemo(
    () => hedgeGroups(wishlist.entries, eventsById),
    [wishlist, eventsById],
  );
  const wishlistIds = useMemo(
    () => new Set(wishlist.entries.map((e) => e.eventId)),
    [wishlist],
  );

  // Keep durable snapshots in sync with the wishlist: snapshot every
  // wishlisted event resolvable from collections (preferred) or an existing
  // snapshot, and drop snapshots for events no longer wishlisted (bounded).
  // The write is guarded so an unchanged result cannot trigger a render loop.
  useEffect(() => {
    const next = new Map<number, GenConEvent>();
    for (const { eventId } of wishlist.entries) {
      const resolved =
        collectionEventsById.get(eventId) ?? eventSnapshots.get(eventId);
      if (resolved) next.set(eventId, resolved);
    }
    const changed =
      next.size !== eventSnapshots.size ||
      [...next].some(([id, e]) => eventSnapshots.get(id) !== e);
    if (changed) {
      setEventSnapshots(next);
      saveEventSnapshots([...next.values()]);
    }
  }, [wishlist, collectionEventsById, eventSnapshots]);

  // Wishlisted event ids that resolve from neither collections nor snapshots —
  // candidates for manual recovery.
  const missingWishlistIds = useMemo(() => {
    const missing = new Set<number>();
    for (const { eventId } of wishlist.entries) {
      if (!collectionEventsById.has(eventId) && !eventSnapshots.has(eventId)) {
        missing.add(eventId);
      }
    }
    return missing;
  }, [wishlist, collectionEventsById, eventSnapshots]);

  // Re-fetch missing wishlisted events by id and merge them into the durable
  // snapshots (the snapshot-sync effect persists the result).
  async function recoverMissingEvents() {
    if (recovering || missingWishlistIds.size === 0) return;
    setRecovering(true);
    try {
      const { events: recovered } = await fetchEventsByIds([
        ...missingWishlistIds,
      ]);
      if (recovered.length > 0) {
        setEventSnapshots((prev) => {
          const next = new Map(prev);
          for (const e of recovered) next.set(e.id, e);
          return next;
        });
      }
      setSystemError(null);
    } catch (e: unknown) {
      setSystemError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecovering(false);
    }
  }

  function addToWishlist(id: number) {
    if (wishlist.entries.length >= WISHLIST_CAP) {
      alert('Wishlist is capped at 300 events.');
      return;
    }
    setWishlist((w) =>
      w.entries.some((e) => e.eventId === id)
        ? w
        : { ...w, entries: [...w.entries, { eventId: id }] });
  }

  function removeFromWishlist(id: number) {
    setWishlist((w) => ({
      ...w,
      entries: w.entries.filter((e) => e.eventId !== id),
    }));
  }

  function moveEntry(id: number, dir: -1 | 1) {
    setWishlist((w) => {
      const i = w.entries.findIndex((e) => e.eventId === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= w.entries.length) return w;
      const entries = w.entries.slice();
      [entries[i], entries[j]] = [entries[j], entries[i]];
      return { ...w, entries };
    });
  }

  function reorderEntry(fromIndex: number, toIndex: number) {
    setWishlist((w) => {
      const n = w.entries.length;
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        fromIndex >= n ||
        toIndex < 0 ||
        toIndex >= n
      ) {
        return w;
      }
      const entries = w.entries.slice();
      const [moved] = entries.splice(fromIndex, 1);
      entries.splice(toIndex, 0, moved);
      return { ...w, entries };
    });
  }

  function setRank(eventId: number, rank: number) {
    const index = wishlist.entries.findIndex((e) => e.eventId === eventId);
    if (index < 0) return;
    const clamped = Math.min(
      wishlist.entries.length,
      Math.max(1, Math.round(rank)),
    );
    reorderEntry(index, clamped - 1);
  }

  function setNote(id: number, note: string) {
    setWishlist((w) => ({
      ...w,
      entries: w.entries.map((e) =>
        e.eventId === id ? { ...e, note: note || undefined } : e),
    }));
  }

  function clearWishlist() {
    if (wishlist.entries.length === 0) return;
    if (confirm('Clear the entire wishlist? This cannot be undone.')) {
      setWishlist({ version: 1, entries: [] });
    }
  }

  function toggleHidden(id: number) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearHidden() {
    setHiddenIds(new Set());
  }

  function handleImport(file: File) {
    file
      .text()
      .then((text) => setWishlist(parseImportedWishlist(text)))
      .catch((e: unknown) =>
        alert(`Import failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  const scheduledCount = wishlistLayers[0]?.scheduledIds.length ?? 0;
  const bumpedCount = wishlist.entries.filter(
    (e) => fullResult.get(e.eventId)?.status === 'bumped',
  ).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Gen Con Planner</h1>
          {!dataLoading && !loadError && (
            <span className="dataset-meta">
              {events.length} events · {collections.size} collections
            </span>
          )}
        </div>
        <div className="topbar-stats">
          <span className="stat stat-list">
            {wishlist.entries.length} wishlisted
          </span>
          <span className="stat stat-ok">{scheduledCount} scheduled</span>
          <span className="stat stat-warn">{bumpedCount} bumped</span>
        </div>
      </header>

      {loadError && (
        <div className="banner banner-error">
          Could not reach the GenCon proxy: {loadError}. The proxy is provided
          by the dev/preview server — make sure it is running.
        </div>
      )}

      {dataLoading && !loadError && (
        <div className="banner">Loading events…</div>
      )}

      {!dataLoading && !loadError && events.length === 0 && (
        <div className="banner">
          No event data yet — pick a game system or event type in Search to
          fetch it.
        </div>
      )}

      {!dataLoading && !loadError && (
        <main className="panes">
          {searchCollapsed ? (
            <CollapsedRail
              label="Search"
              side="left"
              onExpand={() => setSearchCollapsed(false)}
            />
          ) : (
            <EventBrowser
              events={events}
              rankById={rankById}
              wishlistIds={wishlistIds}
              gameCatalog={gameCatalog}
              categoryCatalog={categoryCatalog}
              collections={collections}
              loadingCollections={loadingCollections}
              systemError={systemError}
              slotSearch={slotSearch}
              onAdd={addToWishlist}
              onRemove={removeFromWishlist}
              onSelect={setSelectedId}
              onMatchIds={setActiveMatchIds}
              onClearSlotSearch={() => setSlotSearch(null)}
              onCollapse={() => setSearchCollapsed(true)}
              onLoadCollection={loadCollection}
              onRefreshCollection={refreshCollection}
              onRefreshCatalogs={refreshCatalogs}
            />
          )}
          <AgendaView
            entries={wishlist.entries}
            eventsById={eventsById}
            layers={agendaLayers}
            hiddenIds={hiddenIds}
            rankById={rankById}
            priorityFilter={priorityFilter}
            slotSearch={slotSearch}
            onPriorityFilter={setPriorityFilter}
            onClearHidden={clearHidden}
            onSelect={setSelectedId}
            onSlotSearch={setSlotSearch}
            onUncollapseSearch={() => setSearchCollapsed(false)}
            onToggleHidden={toggleHidden}
          />
          {wishlistCollapsed ? (
            <CollapsedRail
              label="Wishlist"
              side="right"
              onExpand={() => setWishlistCollapsed(false)}
            />
          ) : (
            <WishlistPanel
              wishlist={wishlist}
              eventsById={eventsById}
              fullResult={fullResult}
              rankById={rankById}
              hedges={hedges}
              activeMatchIds={activeMatchIds}
              onMove={moveEntry}
              onReorder={reorderEntry}
              onRemove={removeFromWishlist}
              onNote={setNote}
              onSelect={setSelectedId}
              onExport={() => exportWishlist(wishlist)}
              onImport={handleImport}
              onClear={clearWishlist}
              onCollapse={() => setWishlistCollapsed(true)}
              missingCount={missingWishlistIds.size}
              recovering={recovering}
              onRecover={recoverMissingEvents}
            />
          )}
        </main>
      )}

      {selectedId != null && eventsById.get(selectedId) && (
        <EventModal
          event={eventsById.get(selectedId)!}
          rank={rankById.get(selectedId)}
          status={fullResult.get(selectedId)?.status}
          inWishlist={wishlistIds.has(selectedId)}
          wishlistCount={wishlist.entries.length}
          hiddenIds={hiddenIds}
          onAdd={addToWishlist}
          onRemove={removeFromWishlist}
          onSetRank={setRank}
          onToggleHidden={toggleHidden}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
