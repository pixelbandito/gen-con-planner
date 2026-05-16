import { useMemo } from 'react';
import type { GenConEvent, PriorityFilter, WishlistEntry } from '../types';
import type { Layer } from '../lib/schedule';
import { rangeItems } from '../lib/schedule';
import { fmtDayLabel, fmtHour, fmtTime, parseWall } from '../lib/time';
import { gameClass } from '../lib/style';

interface Props {
  entries: WishlistEntry[];
  eventsById: Map<number, GenConEvent>;
  layers: Layer[];
  hiddenIds: Set<number>;
  rankById: Map<number, number>;
  priorityFilter: PriorityFilter;
  onPriorityFilter: (f: PriorityFilter) => void;
  onClearHidden: () => void;
  onSelect: (id: number) => void;
}

const PX_PER_MIN = 1;
const MIN_BLOCK_PX = 26;
const MAX_RANK = 300;

interface Placed {
  event: GenConEvent;
  rank: number;
  dayKey: string;
  startMin: number;
  endMin: number;
  startW: ReturnType<typeof parseWall>;
  col: number;
  cols: number;
}

/**
 * Assign overlapping events to side-by-side sub-columns. Events that form a
 * connected overlap cluster all share the cluster's column count, so widths
 * line up.
 */
function packDay(items: Placed[]): void {
  items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = [];

  const flush = () => {
    if (cluster.length) {
      const cols = Math.max(...cluster.map((it) => it.col)) + 1;
      for (const it of cluster) it.cols = cols;
    }
    cluster = [];
    colEnds = [];
  };

  for (const it of items) {
    if (it.startMin >= clusterEnd) flush();
    let c = colEnds.findIndex((end) => end <= it.startMin);
    if (c === -1) c = colEnds.length;
    colEnds[c] = it.endMin;
    it.col = c;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
}

const clampRank = (n: number) =>
  Number.isNaN(n) ? 1 : Math.min(MAX_RANK, Math.max(1, Math.round(n)));

export function AgendaView({
  entries,
  eventsById,
  layers,
  hiddenIds,
  rankById,
  priorityFilter,
  onPriorityFilter,
  onClearHidden,
  onSelect,
}: Props) {
  const { byDay, days, minHour, maxHour, untimed } = useMemo(() => {
    // The ranked event ids the agenda should draw for the active filter.
    const drawn: { eventId: number; rank: number }[] =
      priorityFilter.mode === 'layer'
        ? (layers[priorityFilter.layer - 1]?.scheduledIds ?? []).map((id) => ({
            eventId: id,
            rank: rankById.get(id) ?? 0,
          }))
        : rangeItems(entries, hiddenIds, priorityFilter.a, priorityFilter.b);

    const all: Placed[] = [];
    let untimedCount = 0;

    for (const it of drawn) {
      const ev = eventsById.get(it.eventId);
      if (!ev) continue;
      const s = parseWall(ev.start);
      const e = parseWall(ev.end);
      if (!s || !e) {
        untimedCount += 1;
        continue;
      }
      const durMin = Math.max((e.ts - s.ts) / 60000, 30);
      all.push({
        event: ev,
        rank: it.rank,
        dayKey: s.dayKey,
        startMin: s.minOfDay,
        endMin: s.minOfDay + durMin,
        startW: s,
        col: 0,
        cols: 1,
      });
    }

    const grouped = new Map<string, Placed[]>();
    for (const p of all) {
      const list = grouped.get(p.dayKey) ?? [];
      list.push(p);
      grouped.set(p.dayKey, list);
    }
    for (const list of grouped.values()) packDay(list);

    let lo = 24 * 60;
    let hi = 0;
    for (const p of all) {
      lo = Math.min(lo, p.startMin);
      hi = Math.max(hi, p.endMin);
    }
    const minH = all.length ? Math.floor(lo / 60) : 9;
    const maxH = all.length ? Math.ceil(hi / 60) : 23;

    return {
      byDay: grouped,
      days: [...grouped.keys()].sort(),
      minHour: minH,
      maxHour: maxH,
      untimed: untimedCount,
    };
  }, [entries, eventsById, layers, hiddenIds, rankById, priorityFilter]);

  const bodyHeight = (maxHour - minHour) * 60 * PX_PER_MIN;
  const hours: number[] = [];
  for (let h = minHour; h <= maxHour; h += 1) hours.push(h);

  const rangeA = priorityFilter.mode === 'range' ? priorityFilter.a : 1;
  const rangeB = priorityFilter.mode === 'range' ? priorityFilter.b : 50;

  return (
    <section className="pane pane-agenda">
      <div className="pane-head">
        <h2>Agenda</h2>
      </div>

      <div className="priority-bar">
        <div className="priority-modes">
          <button
            className={`btn btn-mini ${
              priorityFilter.mode === 'layer' ? 'is-active' : ''
            }`}
            onClick={() => onPriorityFilter({ mode: 'layer', layer: 1 })}
          >
            Layers
          </button>
          <button
            className={`btn btn-mini ${
              priorityFilter.mode === 'range' ? 'is-active' : ''
            }`}
            onClick={() =>
              onPriorityFilter({ mode: 'range', a: rangeA, b: rangeB })
            }
          >
            Range
          </button>
        </div>

        {priorityFilter.mode === 'layer' ? (
          <div className="priority-segments">
            {layers.map((layer) => (
              <button
                key={layer.index}
                className={`btn btn-mini ${
                  priorityFilter.layer === layer.index ? 'is-active' : ''
                }`}
                onClick={() =>
                  onPriorityFilter({ mode: 'layer', layer: layer.index })
                }
              >
                {layer.index === 1
                  ? `L${layer.index} · Top choices`
                  : `L${layer.index} · from #${layer.startRank}`}
              </button>
            ))}
          </div>
        ) : (
          <div className="priority-range">
            <label className="range-field">
              #
              <input
                type="number"
                min={1}
                max={MAX_RANK}
                value={rangeA}
                onChange={(e) => {
                  const a = clampRank(Number(e.target.value));
                  onPriorityFilter({
                    mode: 'range',
                    a,
                    b: Math.max(a, rangeB),
                  });
                }}
              />
            </label>
            <span className="range-dash">–</span>
            <label className="range-field">
              #
              <input
                type="number"
                min={1}
                max={MAX_RANK}
                value={rangeB}
                onChange={(e) => {
                  const b = clampRank(Number(e.target.value));
                  onPriorityFilter({
                    mode: 'range',
                    a: Math.min(rangeA, b),
                    b,
                  });
                }}
              />
            </label>
          </div>
        )}

        {hiddenIds.size > 0 && (
          <button className="hidden-chip" onClick={onClearHidden}>
            Hidden ({hiddenIds.size}) · restore
          </button>
        )}
      </div>

      <div className="cal-legend">
        <span className="legend-item legend-scheduled">Wishlisted events</span>
      </div>

      {days.length === 0 ? (
        <div className="cal-empty">
          Nothing to show for this priority filter. Add events from the browser
          or widen the layer / range selection.
        </div>
      ) : (
        <div className="cal-scroll">
          <div className="cal-board">
            <div className="cal-col cal-gutter">
              <div className="cal-col-head" />
              <div className="cal-col-body" style={{ height: bodyHeight }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    className="cal-hour-label"
                    style={{ top: (h - minHour) * 60 * PX_PER_MIN }}
                  >
                    {fmtHour(h)}
                  </div>
                ))}
              </div>
            </div>

            {days.map((dayKey) => (
              <div key={dayKey} className="cal-col cal-day">
                <div className="cal-col-head">{fmtDayLabel(dayKey)}</div>
                <div className="cal-col-body" style={{ height: bodyHeight }}>
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="cal-hour-line"
                      style={{ top: (h - minHour) * 60 * PX_PER_MIN }}
                    />
                  ))}
                  {(byDay.get(dayKey) ?? []).map((p) => {
                    const top =
                      (p.startMin - minHour * 60) * PX_PER_MIN;
                    const height = Math.max(
                      (p.endMin - p.startMin) * PX_PER_MIN,
                      MIN_BLOCK_PX,
                    );
                    const widthPct = 100 / p.cols;
                    return (
                      <button
                        key={p.event.id}
                        className={`cal-event ${gameClass(
                          p.event.gameSystem,
                        )} is-scheduled`}
                        style={{
                          top,
                          height,
                          left: `${p.col * widthPct}%`,
                          width: `calc(${widthPct}% - 3px)`,
                        }}
                        onClick={() => onSelect(p.event.id)}
                        title={p.event.title}
                      >
                        <span className="cal-event-rank">#{p.rank}</span>
                        <span className="cal-event-title">
                          {p.event.title}
                        </span>
                        {p.startW && (
                          <span className="cal-event-time">
                            {fmtTime(p.startW)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {untimed > 0 && (
        <div className="cal-footnote">
          {untimed} wishlisted event{untimed === 1 ? '' : 's'} have no
          scheduled time — see the wishlist panel.
        </div>
      )}
    </section>
  );
}
