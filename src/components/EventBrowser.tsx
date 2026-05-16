import { useMemo, useState } from 'react';
import type { GenConEvent } from '../types';
import type { ScheduleInfo } from '../lib/schedule';
import { fmtDateTime, fmtDayLabel, parseWall } from '../lib/time';
import { fmtCost, gameClass } from '../lib/style';

interface Props {
  events: GenConEvent[];
  schedule: Map<number, ScheduleInfo>;
  wishlistIds: Set<number>;
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onSelect: (id: number) => void;
}

const RESULT_CAP = 300;

export function EventBrowser({
  events,
  schedule,
  wishlistIds,
  onAdd,
  onRemove,
  onSelect,
}: Props) {
  const [text, setText] = useState('');
  const [gameSystem, setGameSystem] = useState('');
  const [eventType, setEventType] = useState('');
  const [day, setDay] = useState('');
  const [maxCost, setMaxCost] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [hideWishlisted, setHideWishlisted] = useState(false);

  const gameSystems = useMemo(
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
    onlyAvailable, hideWishlisted, wishlistIds,
  ]);

  const shown = filtered.slice(0, RESULT_CAP);

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
          {gameSystems.map((g) => (
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

      <div className="event-list">
        {shown.map((e) => {
          const info = schedule.get(e.id);
          const inList = wishlistIds.has(e.id);
          return (
            <div key={e.id} className={`event-row ${gameClass(e.gameSystem)}`}>
              <div className="event-row-main" onClick={() => onSelect(e.id)}>
                <div className="event-row-title">
                  {inList && <span className="rank-chip">#{info?.rank}</span>}
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
