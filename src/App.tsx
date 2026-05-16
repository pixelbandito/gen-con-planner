import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  GenConEvent,
  PriorityFilter,
  SlotSearch,
  SystemCatalogEntry,
  Wishlist,
} from './types';
import type { GreedyResult } from './lib/schedule';
import { computeLayers, hedgeGroups } from './lib/schedule';
import { fetchCachedEvents, fetchSystemEvents, fetchSystems } from './lib/api';
import {
  exportWishlist,
  loadWishlist,
  parseImportedWishlist,
  saveWishlist,
} from './lib/storage';
import { EventBrowser } from './components/EventBrowser';
import { AgendaView } from './components/AgendaView';
import { WishlistPanel } from './components/WishlistPanel';
import { CollapsedRail } from './components/CollapsedRail';
import { EventModal } from './components/EventModal';

const WISHLIST_CAP = 300;

export default function App() {
  // System-aware event model, sourced from the GenCon proxy cache.
  const [events, setEvents] = useState<GenConEvent[]>([]);
  const [systemsMeta, setSystemsMeta] = useState<
    Map<string, { fetchedAt: string; stale: boolean }>
  >(() => new Map());
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Per-system fetch failure — surfaced inline, not as the startup banner.
  const [systemError, setSystemError] = useState<string | null>(null);
  // The GenCon game-system catalog, fetched separately and non-blocking.
  const [catalog, setCatalog] = useState<SystemCatalogEntry[]>([]);
  // Game-system names currently being fetched/refreshed live.
  const [loadingSystems, setLoadingSystems] = useState(() => new Set<string>());
  // Synchronous in-flight guard — state Sets can read stale in rapid calls.
  const inFlightSystems = useRef(new Set<string>());
  const [wishlist, setWishlist] = useState<Wishlist>(() => loadWishlist());
  const [selectedId, setSelectedId] = useState<number | null>(null);

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

  // Load every cached game system from the GenCon proxy on startup.
  useEffect(() => {
    fetchCachedEvents()
      .then(({ systems }) => {
        setEvents(systems.flatMap((s) => s.events));
        setSystemsMeta(
          new Map(
            systems.map((s) => [
              s.gameSystem,
              { fetchedAt: s.fetchedAt, stale: s.stale },
            ]),
          ),
        );
        setDataLoading(false);
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : String(e));
        setDataLoading(false);
      });
  }, []);

  // Load the game-system catalog separately — it must not block the app.
  // On failure the picker falls back to the systems already loaded.
  useEffect(() => {
    fetchSystems()
      .then(({ systems }) => setCatalog(systems))
      .catch(() => {
        /* Catalog unavailable — picker falls back to loaded systems. */
      });
  }, []);

  // Persist the wishlist whenever it changes.
  useEffect(() => {
    saveWishlist(wishlist);
  }, [wishlist]);

  // Fetch one game system's events from the proxy and merge them into state.
  // `refresh` forces the proxy to re-scrape rather than serve its cache.
  async function loadSystemEvents(name: string, refresh: boolean) {
    if (inFlightSystems.current.has(name)) return;
    inFlightSystems.current.add(name);
    setLoadingSystems((prev) => new Set(prev).add(name));
    try {
      const result = await fetchSystemEvents(name, refresh);
      setEvents((prev) => [
        ...prev.filter((e) => e.gameSystem !== name),
        ...result.events,
      ]);
      setSystemsMeta((prev) =>
        new Map(prev).set(name, {
          fetchedAt: result.fetchedAt,
          stale: result.stale,
        }));
      setSystemError(null);
    } catch (e: unknown) {
      setSystemError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightSystems.current.delete(name);
      setLoadingSystems((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  }

  function loadSystem(name: string) {
    return loadSystemEvents(name, false);
  }

  function refreshSystem(name: string) {
    return loadSystemEvents(name, true);
  }

  function refreshCatalog() {
    fetchSystems(true)
      .then(({ systems }) => {
        setCatalog(systems);
        setSystemError(null);
      })
      .catch((e: unknown) => {
        setSystemError(e instanceof Error ? e.message : String(e));
      });
  }

  const eventsById = useMemo(() => {
    const m = new Map<number, GenConEvent>();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

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
              {events.length} events · {systemsMeta.size} systems
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
          No event data yet — pick a game system in Search to fetch it.
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
              catalog={catalog}
              systemsMeta={systemsMeta}
              loadingSystems={loadingSystems}
              systemError={systemError}
              slotSearch={slotSearch}
              onAdd={addToWishlist}
              onRemove={removeFromWishlist}
              onSelect={setSelectedId}
              onMatchIds={setActiveMatchIds}
              onClearSlotSearch={() => setSlotSearch(null)}
              onCollapse={() => setSearchCollapsed(true)}
              onLoadSystem={loadSystem}
              onRefreshSystem={refreshSystem}
              onRefreshCatalog={refreshCatalog}
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
