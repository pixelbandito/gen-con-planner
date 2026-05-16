import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenConEvent, SlotSearch } from '../types';
import { fmtDateTime, fmtDayLabel, fmtTime, parseWall } from '../lib/time';
import { fmtCost, gameClass } from '../lib/style';
import { eventInterval } from '../lib/schedule';
import { loadQueries, saveQueries } from '../lib/storage';

interface Props {
  events: GenConEvent[];
  rankById: Map<number, number>;
  wishlistIds: Set<number>;
  gameSystems: string[];
  scrapedAt: string;
  slotSearch: SlotSearch;
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onSelect: (id: number) => void;
  onMatchIds: (ids: Set<number>) => void;
  onClearSlotSearch: () => void;
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
  gameSystems,
  scrapedAt,
  slotSearch,
  onAdd,
  onRemove,
  onSelect,
  onMatchIds,
  onClearSlotSearch,
}: Props) {
  const [text, setText] = useState('');
  const [gameSystem, setGameSystem] = useState('');
  const [eventType, setEventType] = useState('');
  const [day, setDay] = useState('');
  const [maxCost, setMaxCost] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [hideWishlisted, setHideWishlisted] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);
  const [queries, setQueries] = useState<string[]>(() => {
    const stored = loadQueries();
    return stored.length > 0 ? stored : gameSystems;
  });
  const [queryDraft, setQueryDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist the query set whenever it changes.
  useEffect(() => {
    saveQueries(queries);
  }, [queries]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const filterGameSystems = useMemo(
    () => [...new Set(events.map((e) => e.gameSystem).filter(Boolean))].sort(),
    [events],
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
  // Keyed on `filtered`/`filterActive` so it fires only when the set changes.
  useEffect(() => {
    onMatchIds(filterActive ? new Set(filtered.map((e) => e.id)) : new Set());
  }, [filtered, filterActive, onMatchIds]);

  const shown = filtered.slice(0, RESULT_CAP);

  function addQuery() {
    const name = queryDraft.trim();
    if (!name) return;
    setQueries((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setQueryDraft('');
  }

  function removeQuery(name: string) {
    setQueries((prev) => prev.filter((q) => q !== name));
  }

  function copyScrapeCommand() {
    const cmd =
      `npm run scrape ` + queries.map((q) => `"${q}"`).join(' ');
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section className="pane pane-browser">
      <div className="pane-head">
        <h2>Browse events</h2>
        <span className="count">
          {filtered.length} match{filtered.length === 1 ? '' : 'es'}
        </span>
      </div>

      <div className="filters">
        <input
          className="filter-text"
          type="search"
          placeholder="Search title, sponsor, code…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select value={gameSystem} onChange={(e) => setGameSystem(e.target.value)}>
          <option value="">All game systems</option>
          {filterGameSystems.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
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
          Manage data
        </button>
        {manageOpen && (
          <div className="manage-body">
            <div className="manage-meta">
              <div>{events.length} events</div>
              <div>{gameSystems.join(', ') || 'No game systems'}</div>
              <div>Scraped {scrapedAt.slice(0, 10)}</div>
            </div>

            <div className="manage-queries">
              <div className="manage-query-add">
                <input
                  type="text"
                  placeholder="Add a game system…"
                  value={queryDraft}
                  onChange={(e) => setQueryDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addQuery();
                  }}
                />
                <button className="btn btn-mini" onClick={addQuery}>
                  Add
                </button>
              </div>
              {queries.length === 0 ? (
                <div className="list-note">No queries yet.</div>
              ) : (
                <ul className="query-list">
                  {queries.map((q) => (
                    <li key={q} className="query-chip">
                      <span>{q}</span>
                      <button
                        className="query-remove"
                        onClick={() => removeQuery(q)}
                        title={`Remove "${q}"`}
                        aria-label={`Remove ${q}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              className="btn btn-mini"
              onClick={copyScrapeCommand}
              disabled={queries.length === 0}
            >
              {copied ? 'Copied!' : 'Copy scrape command'}
            </button>
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
