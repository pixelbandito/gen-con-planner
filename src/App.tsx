import { useEffect, useMemo, useState } from 'react';
import type {
  EventsDataset,
  GenConEvent,
  PriorityFilter,
  SlotSearch,
  Wishlist,
} from './types';
import type { GreedyResult } from './lib/schedule';
import { computeLayers, hedgeGroups } from './lib/schedule';
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
  const [dataset, setDataset] = useState<EventsDataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  // Load the static, read-only event dataset.
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/events.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: EventsDataset) => setDataset(d))
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Persist the wishlist whenever it changes.
  useEffect(() => {
    saveWishlist(wishlist);
  }, [wishlist]);

  const eventsById = useMemo(() => {
    const m = new Map<number, GenConEvent>();
    if (dataset) for (const e of dataset.events) m.set(e.id, e);
    return m;
  }, [dataset]);

  const layers = useMemo(
    () => computeLayers(wishlist.entries, eventsById, hiddenIds),
    [wishlist, eventsById, hiddenIds],
  );

  // Keep the layer selection in range: if the wishlist shrinks so that fewer
  // layers exist, a stale high-layer selection would render an empty agenda.
  useEffect(() => {
    if (priorityFilter.mode !== 'layer') return;
    const maxLayer = Math.max(1, layers.length);
    if (priorityFilter.layer > maxLayer) {
      setPriorityFilter({ mode: 'layer', layer: maxLayer });
    }
  }, [layers, priorityFilter]);
  // Layer 1 is the greedy fill of the whole wishlist: the full status map.
  const fullResult = useMemo(
    () => layers[0]?.result ?? new Map<number, GreedyResult>(),
    [layers],
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

  const scheduledCount = layers[0]?.scheduledIds.length ?? 0;
  const bumpedCount = wishlist.entries.filter(
    (e) => fullResult.get(e.eventId)?.status === 'bumped',
  ).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Gen Con Planner</h1>
          {dataset && (
            <span className="dataset-meta">
              {dataset.events.length} events ·{' '}
              {dataset.gameSystems.join(', ')} · scraped{' '}
              {dataset.scrapedAt.slice(0, 10)}
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
          Could not load event data: {loadError}. Run{' '}
          <code>npm run scrape</code> to generate{' '}
          <code>public/data/events.json</code>.
        </div>
      )}

      {!dataset && !loadError && (
        <div className="banner">Loading events…</div>
      )}

      {dataset && (
        <main className="panes">
          {searchCollapsed ? (
            <CollapsedRail
              label="Search"
              side="left"
              onExpand={() => setSearchCollapsed(false)}
            />
          ) : (
            <EventBrowser
              events={dataset.events}
              rankById={rankById}
              wishlistIds={wishlistIds}
              gameSystems={dataset.gameSystems}
              scrapedAt={dataset.scrapedAt}
              slotSearch={slotSearch}
              onAdd={addToWishlist}
              onRemove={removeFromWishlist}
              onSelect={setSelectedId}
              onMatchIds={setActiveMatchIds}
              onClearSlotSearch={() => setSlotSearch(null)}
              onCollapse={() => setSearchCollapsed(true)}
            />
          )}
          <AgendaView
            entries={wishlist.entries}
            eventsById={eventsById}
            layers={layers}
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
          hiddenIds={hiddenIds}
          onAdd={addToWishlist}
          onRemove={removeFromWishlist}
          onToggleHidden={toggleHidden}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
