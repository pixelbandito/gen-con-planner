import { useEffect, useMemo, useState } from 'react';
import type { EventsDataset, GenConEvent, Wishlist } from './types';
import { computeSchedule, hedgeGroups } from './lib/schedule';
import {
  exportWishlist,
  loadWishlist,
  parseImportedWishlist,
  saveWishlist,
} from './lib/storage';
import { EventBrowser } from './components/EventBrowser';
import { CalendarView } from './components/CalendarView';
import { WishlistPanel } from './components/WishlistPanel';
import { EventModal } from './components/EventModal';

export default function App() {
  const [dataset, setDataset] = useState<EventsDataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState<Wishlist>(() => loadWishlist());
  const [selectedId, setSelectedId] = useState<number | null>(null);

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

  const schedule = useMemo(
    () => computeSchedule(wishlist.entries, eventsById),
    [wishlist, eventsById],
  );
  const hedges = useMemo(
    () => hedgeGroups(wishlist.entries, eventsById),
    [wishlist, eventsById],
  );
  const wishlistIds = useMemo(
    () => new Set(wishlist.entries.map((e) => e.eventId)),
    [wishlist],
  );

  function addToWishlist(id: number) {
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

  function handleImport(file: File) {
    file
      .text()
      .then((text) => setWishlist(parseImportedWishlist(text)))
      .catch((e: unknown) =>
        alert(`Import failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  const scheduledCount = [...schedule.values()].filter(
    (s) => s.status === 'scheduled',
  ).length;
  const bumpedCount = [...schedule.values()].filter(
    (s) => s.status === 'bumped',
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
          <EventBrowser
            events={dataset.events}
            schedule={schedule}
            wishlistIds={wishlistIds}
            onAdd={addToWishlist}
            onRemove={removeFromWishlist}
            onSelect={setSelectedId}
          />
          <CalendarView
            entries={wishlist.entries}
            eventsById={eventsById}
            schedule={schedule}
            onSelect={setSelectedId}
          />
          <WishlistPanel
            wishlist={wishlist}
            eventsById={eventsById}
            schedule={schedule}
            hedges={hedges}
            onMove={moveEntry}
            onRemove={removeFromWishlist}
            onNote={setNote}
            onSelect={setSelectedId}
            onExport={() => exportWishlist(wishlist)}
            onImport={handleImport}
            onClear={clearWishlist}
          />
        </main>
      )}

      {selectedId != null && eventsById.get(selectedId) && (
        <EventModal
          event={eventsById.get(selectedId)!}
          info={schedule.get(selectedId)}
          inWishlist={wishlistIds.has(selectedId)}
          onAdd={addToWishlist}
          onRemove={removeFromWishlist}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
