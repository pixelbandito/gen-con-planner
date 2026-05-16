import { useMemo, useRef } from 'react';
import type { GenConEvent, Wishlist } from '../types';
import type { ScheduleInfo, ScheduleStatus } from '../lib/schedule';
import { fmtDateTime } from '../lib/time';
import { fmtCost, gameClass } from '../lib/style';

interface Props {
  wishlist: Wishlist;
  eventsById: Map<number, GenConEvent>;
  schedule: Map<number, ScheduleInfo>;
  hedges: Map<string, number[]>;
  onMove: (id: number, dir: -1 | 1) => void;
  onRemove: (id: number) => void;
  onNote: (id: number, note: string) => void;
  onSelect: (id: number) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onClear: () => void;
}

const STATUS_LABEL: Record<ScheduleStatus, string> = {
  scheduled: 'Scheduled',
  bumped: 'Bumped',
  untimed: 'No time set',
  missing: 'Not in dataset',
};

export function WishlistPanel({
  wishlist,
  eventsById,
  schedule,
  hedges,
  onMove,
  onRemove,
  onNote,
  onSelect,
  onExport,
  onImport,
  onClear,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const hedgeCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const list of hedges.values()) {
      for (const id of list) m.set(id, list.length);
    }
    return m;
  }, [hedges]);

  const totalCost = useMemo(() => {
    let sum = 0;
    for (const entry of wishlist.entries) {
      const info = schedule.get(entry.eventId);
      const ev = eventsById.get(entry.eventId);
      if (ev && info?.status === 'scheduled' && ev.cost) sum += ev.cost;
    }
    return sum;
  }, [wishlist, schedule, eventsById]);

  const { entries } = wishlist;

  return (
    <section className="pane pane-wishlist">
      <div className="pane-head">
        <h2>Wishlist</h2>
        <span className="count">
          {entries.length} ranked · {fmtCost(totalCost)} expected
        </span>
      </div>

      <div className="wishlist-actions">
        <button className="btn" onClick={onExport}>Export</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <button className="btn btn-danger" onClick={onClear}>Clear</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = '';
          }}
        />
      </div>

      {entries.length === 0 && (
        <div className="list-note">
          Add events to build your ranked wishlist. Rank order = the order Gen
          Con processes your picks. Rank the same event in multiple time slots
          to hedge against sell-outs.
        </div>
      )}

      <ol className="wishlist">
        {entries.map((entry, i) => {
          const ev = eventsById.get(entry.eventId);
          const info = schedule.get(entry.eventId);
          const status = info?.status ?? 'missing';
          const hedge = hedgeCount.get(entry.eventId);
          const bumpedByRank =
            info?.bumpedBy != null
              ? schedule.get(info.bumpedBy)?.rank
              : undefined;
          return (
            <li
              key={entry.eventId}
              className={`wish-row ${ev ? gameClass(ev.gameSystem) : ''} is-${status}`}
            >
              <div className="wish-rank">{i + 1}</div>
              <div className="wish-main">
                <div
                  className="wish-title"
                  onClick={() => onSelect(entry.eventId)}
                >
                  {ev ? ev.title : `Unknown event ${entry.eventId}`}
                </div>
                <div className="wish-meta">
                  {ev ? fmtDateTime(ev.start, ev.end) : '—'}
                  {ev && ev.cost != null && ` · ${fmtCost(ev.cost)}`}
                </div>
                <div className="wish-badges">
                  <span className={`status-pill status-${status}`}>
                    {STATUS_LABEL[status]}
                    {status === 'bumped' && bumpedByRank
                      ? ` by #${bumpedByRank}`
                      : ''}
                  </span>
                  {hedge && (
                    <span className="hedge-pill" title="Hedge group">
                      hedge ×{hedge}
                    </span>
                  )}
                </div>
                <input
                  className="wish-note"
                  type="text"
                  placeholder="note (e.g. backup for Friday draft)"
                  value={entry.note ?? ''}
                  onChange={(e) => onNote(entry.eventId, e.target.value)}
                />
              </div>
              <div className="wish-controls">
                <button
                  className="btn btn-mini"
                  disabled={i === 0}
                  onClick={() => onMove(entry.eventId, -1)}
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  className="btn btn-mini"
                  disabled={i === entries.length - 1}
                  onClick={() => onMove(entry.eventId, 1)}
                  title="Move down"
                >
                  ▼
                </button>
                <button
                  className="btn btn-mini btn-danger"
                  onClick={() => onRemove(entry.eventId)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
