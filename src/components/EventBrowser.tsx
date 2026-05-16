import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenConEvent, SlotSearch, SystemCatalogEntry } from '../types';
import {
  fmtDateTime,
  fmtDayLabel,
  fmtRelative,
  fmtTime,
  parseWall,
} from '../lib/time';
import { fmtCost, gameClass } from '../lib/style';
import { eventInterval } from '../lib/schedule';

interface SystemMeta {
  fetchedAt: string;
  stale: boolean;
}

interface Props {
  events: GenConEvent[];
  rankById: Map<number, number>;
  wishlistIds: Set<number>;
  catalog: SystemCatalogEntry[];
  systemsMeta: Map<string, SystemMeta>;
  loadingSystems: Set<string>;
  systemError: string | null;
  slotSearch: SlotSearch;
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onSelect: (id: number) => void;
  onMatchIds: (ids: Set<number>) => void;
  onClearSlotSearch: () => void;
  onCollapse: () => void;
  onLoadSystem: (name: string) => void;
  onRefreshSystem: (name: string) => void;
  onRefreshCatalog: () => void;
}

const RESULT_CAP = 300;

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
  catalog,
  systemsMeta,
  loadingSystems,
  systemError,
  slotSearch,
  onAdd,
  onRemove,
  onSelect,
  onMatchIds,
  onClearSlotSearch,
  onCollapse,
  onLoadSystem,
  onRefreshSystem,
  onRefreshCatalog,
}: Props) {
  const [text, setText] = useState('');
  const [gameSystem, setGameSystem] = useState('');
  const [eventType, setEventType] = useState('');
  const [day, setDay] = useState('');
  const [maxCost, setMaxCost] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [hideWishlisted, setHideWishlisted] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);

  // The system picker is catalog-driven; if the catalog has not loaded yet it
  // falls back to whichever systems are already cached/loaded.
  const systemOptions = useMemo(() => {
    if (catalog.length > 0) {
      return [...catalog].sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...systemsMeta.keys()]
      .sort()
      .map((name) => ({ name, eventCount: 0 }));
  }, [catalog, systemsMeta]);

  // Sorted list of loaded systems for the cache-management section.
  const loadedSystems = useMemo(
    () => [...systemsMeta.keys()].sort(),
    [systemsMeta],
  );

  const eventTypes = useMemo(
    () => [...new Set(events.map((e) => e.eventType).filter(Boolean))].sort(),
    [events],
  );
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

  // Selecting a system filters the list and, if that system has not yet been
  // loaded, kicks off a live fetch through the proxy.
  function handleSystemChange(name: string) {
    setGameSystem(name);
    if (name && !systemsMeta.has(name)) onLoadSystem(name);
  }

  const selectedLoading = gameSystem !== '' && loadingSystems.has(gameSystem);

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
        <input
          className="filter-text"
          type="search"
          placeholder="Search title, sponsor, code…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select
          value={gameSystem}
          onChange={(e) => handleSystemChange(e.target.value)}
        >
          <option value="">All game systems</option>
          {systemOptions.map((s) => {
            const loaded = systemsMeta.has(s.name);
            const count = s.eventCount > 0 ? ` (${s.eventCount})` : '';
            return (
              <option key={s.name} value={s.name}>
                {loaded ? '✓ ' : ''}{s.name}{count}
              </option>
            );
          })}
        </select>
        {selectedLoading && (
          <div className="system-loading">Loading {gameSystem}…</div>
        )}
        <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
          <option value="">All event types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
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
          Loaded data ({loadedSystems.length})
        </button>
        {manageOpen && (
          <div className="manage-body">
            {loadedSystems.length === 0 ? (
              <div className="list-note">
                No game systems loaded yet — pick one above to fetch it.
              </div>
            ) : (
              <ul className="cache-list">
                {loadedSystems.map((name) => {
                  const meta = systemsMeta.get(name)!;
                  const busy = loadingSystems.has(name);
                  return (
                    <li key={name} className="cache-row">
                      <div className="cache-row-main">
                        <span className="cache-name">{name}</span>
                        {meta.stale && (
                          <span className="stale-badge">stale</span>
                        )}
                        <span className="cache-time">
                          {fmtRelative(meta.fetchedAt)}
                        </span>
                      </div>
                      <button
                        className="btn btn-mini"
                        onClick={() => onRefreshSystem(name)}
                        disabled={busy}
                      >
                        {busy ? 'Refreshing…' : 'Refresh'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <button className="btn btn-mini" onClick={onRefreshCatalog}>
              Refresh catalog
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
          const stale = systemsMeta.get(e.gameSystem)?.stale ?? false;
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
