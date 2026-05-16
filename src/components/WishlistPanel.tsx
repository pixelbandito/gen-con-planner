import { useMemo, useRef, useState } from 'react';
import type { GenConEvent, Wishlist } from '../types';
import type { GreedyResult } from '../lib/schedule';
import { fmtDateTime } from '../lib/time';
import { fmtCost, gameClass, STATUS_LABEL } from '../lib/style';

interface Props {
  wishlist: Wishlist;
  eventsById: Map<number, GenConEvent>;
  fullResult: Map<number, GreedyResult>;
  rankById: Map<number, number>;
  hedges: Map<string, number[]>;
  activeMatchIds: Set<number>;
  onMove: (id: number, dir: -1 | 1) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (id: number) => void;
  onNote: (id: number, note: string) => void;
  onSelect: (id: number) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onClear: () => void;
  onCollapse: () => void;
}

/** GenCon's real wishlist max; this app allows 300 for pre-planning. */
const SUBMISSION_LIMIT = 50;
const WISHLIST_CAP = 300;

export function WishlistPanel({
  wishlist,
  eventsById,
  fullResult,
  rankById,
  hedges,
  activeMatchIds,
  onMove,
  onReorder,
  onRemove,
  onNote,
  onSelect,
  onExport,
  onImport,
  onClear,
  onCollapse,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

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
      const info = fullResult.get(entry.eventId);
      const ev = eventsById.get(entry.eventId);
      if (ev && info?.status === 'scheduled' && ev.cost) sum += ev.cost;
    }
    return sum;
  }, [wishlist, fullResult, eventsById]);

  const { entries } = wishlist;

  function endDrag() {
    dragIndexRef.current = null;
    setDropIndex(null);
  }

  function handleDrop(targetIndex: number) {
    const from = dragIndexRef.current;
    if (from != null && from !== targetIndex) {
      onReorder(from, targetIndex);
    }
    endDrag();
  }

  return (
    <section className="pane pane-wishlist">
      <div className="pane-head">
        <button
          className="btn btn-mini pane-collapse"
          onClick={onCollapse}
          title="Collapse wishlist pane"
          aria-label="Collapse wishlist pane"
        >
          »
        </button>
        <h2>Wishlist</h2>
        <span className="count">
          {entries.length} / {WISHLIST_CAP} · {fmtCost(totalCost)} expected
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
        {entries.flatMap((entry, i) => {
          const ev = eventsById.get(entry.eventId);
          const info = fullResult.get(entry.eventId);
          const status = info?.status ?? 'missing';
          const hedge = hedgeCount.get(entry.eventId);
          const bumpedByRank =
            info?.bumpedBy != null
              ? rankById.get(info.bumpedBy)
              : undefined;
          const pastLimit = i >= SUBMISSION_LIMIT;
          const isMatch = activeMatchIds.has(entry.eventId);
          // Drop indicator edge depends on drag direction: dragging down lands
          // the item after the target (bottom edge); dragging up lands it
          // before the target (top edge).
          const isDropTarget = dropIndex === i;
          const draggingDown =
            dragIndexRef.current != null && dragIndexRef.current < i;
          const liClass = [
            'wish-row',
            ev ? gameClass(ev.gameSystem) : '',
            `is-${status}`,
            pastLimit ? 'is-past-limit' : '',
            isMatch ? 'is-match' : '',
            isDropTarget
              ? draggingDown
                ? 'is-drop-after'
                : 'is-drop-before'
              : '',
          ]
            .filter(Boolean)
            .join(' ');
          const row = (
            <li
              key={entry.eventId}
              className={liClass}
              onDragOver={(e) => {
                if (dragIndexRef.current == null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropIndex !== i) setDropIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(i);
              }}
            >
              <div
                className="wish-grip"
                draggable
                title="Drag to reorder"
                aria-hidden="true"
                onDragStart={(e) => {
                  dragIndexRef.current = i;
                  e.dataTransfer.effectAllowed = 'move';
                  // Required: some browsers (Firefox) won't start a drag unless
                  // dataTransfer has data set. The drop logic reads dragIndexRef,
                  // not this payload, so the value here is unused but necessary.
                  e.dataTransfer.setData('text/plain', String(i));
                }}
                onDragEnd={endDrag}
              >
                ⠿
              </div>
              <div className="wish-rank">{i + 1}</div>
              <div className="wish-main">
                <div
                  className="wish-title"
                  onClick={() => onSelect(entry.eventId)}
                >
                  {ev ? ev.title : `Unknown event ${entry.eventId}`}
                </div>
                {ev && ev.gameCode && (
                  <div className="wish-code" title="Gen Con game code">
                    {ev.gameCode}
                  </div>
                )}
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
          // Divider sits directly after the 50th entry, before #51.
          if (i === SUBMISSION_LIMIT - 1 && entries.length > SUBMISSION_LIMIT) {
            return [
              row,
              <li
                key="submission-limit"
                className="wish-limit-divider"
                aria-hidden="true"
              >
                — Gen Con submission limit ({SUBMISSION_LIMIT}) —
              </li>,
            ];
          }
          return [row];
        })}
      </ol>
    </section>
  );
}
