import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  GenConEvent,
  PriorityFilter,
  SlotSearch,
  WishlistEntry,
} from '../types';
import type { Layer } from '../lib/schedule';
import { rangeItems } from '../lib/schedule';
import { fmtDayLabel, fmtHour, fmtTime, parseWall } from '../lib/time';
import type { WallTime } from '../lib/time';
import { gameClass } from '../lib/style';
import { RangeSlider } from './RangeSlider';

interface Props {
  entries: WishlistEntry[];
  eventsById: Map<number, GenConEvent>;
  layers: Layer[];
  wishlistLength: number;
  hiddenIds: Set<number>;
  rankById: Map<number, number>;
  priorityFilter: PriorityFilter;
  slotSearch: SlotSearch;
  onPriorityFilter: (f: PriorityFilter) => void;
  onClearHidden: () => void;
  onSelect: (id: number) => void;
  onSlotSearch: (s: SlotSearch) => void;
  onUncollapseSearch: () => void;
  onToggleHidden: (id: number) => void;
}

const MIN_BLOCK_PX = 26;
const MAX_RANK = 300;
const SLOT_MIN = 30;
/**
 * Right-edge strip of every day column kept clear of event blocks so a slot
 * search can always be started there, no matter how full the column is.
 */
const RIGHT_GUTTER_PX = 24;

/** Day-window choices for the day-count zoom. */
type DaysShown = 1 | 2 | 4 | 'all';
const DAY_OPTIONS: DaysShown[] = [1, 2, 4, 'all'];

/** Time-of-day window choices. Each maps to an [minHour, maxHour] clamp. */
type TimeView = 'morning' | 'afternoon' | 'evening' | 'all';
const TIME_WINDOWS: Record<TimeView, [number, number] | null> = {
  morning: [6, 13],
  afternoon: [12, 18],
  evening: [17, 26],
  all: null,
};
const TIME_OPTIONS: { id: TimeView; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Evening' },
  { id: 'all', label: 'All day' },
];

/** Vertical density options, in pixels per minute. */
const DENSITY_OPTIONS = [0.6, 1, 1.6];

interface Placed {
  event: GenConEvent;
  rank: number;
  dayKey: string;
  startMin: number;
  endMin: number;
  startW: WallTime;
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

/** Build a Date.UTC-based timestamp for an hour/minute on a "YYYY-MM-DD" day. */
function slotTs(dayKey: string, hour: number, minute: number): number {
  const [y, mo, d] = dayKey.split('-').map(Number);
  return Date.UTC(y, mo - 1, d, hour, minute);
}

/** Human-readable label for a cascade layer, reused by chooser and dropdown. */
function layerLabel(layer: Layer): string {
  return layer.index === 1
    ? `L${layer.index} · Top choices`
    : `L${layer.index} · from #${layer.startRank}`;
}

export function AgendaView({
  entries,
  eventsById,
  layers,
  wishlistLength,
  hiddenIds,
  rankById,
  priorityFilter,
  slotSearch,
  onPriorityFilter,
  onClearHidden,
  onSelect,
  onSlotSearch,
  onUncollapseSearch,
  onToggleHidden,
}: Props) {
  // ---- zoom state (Task 5) ----
  const [daysShown, setDaysShown] = useState<DaysShown>(4);
  const [dayOffset, setDayOffset] = useState(0);
  const [timeView, setTimeView] = useState<TimeView>('all');
  const [pxPerMin, setPxPerMin] = useState(1);

  // ---- layer-chooser split-button dropdown ----
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const layerChooserRef = useRef<HTMLDivElement | null>(null);

  // ---- slot drag state (Task 6) ----
  // Known, intentional edge case: if a drag is released over an event block
  // (which stops mouseup propagation), this anchor ref is never cleared and
  // simply lingers until the next slot interaction overwrites it — harmless.
  const dragAnchor = useRef<number | null>(null);
  const [dragRange, setDragRange] = useState<[number, number] | null>(null);

  const { byDay, allDays, minHour, maxHour, untimed } = useMemo(() => {
    // The ranked event ids the agenda should draw for the active filter.
    const drawn: { eventId: number; rank: number }[] =
      priorityFilter.mode === 'layer'
        ? (layers[priorityFilter.layer - 1]?.scheduledIds ?? []).map((id) => ({
            eventId: id,
            rank: rankById.get(id) ?? -1,
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
    // When there are events, pad the data-driven bounds by an hour on each
    // side so there is clickable empty time above the earliest event and
    // below the latest. Fixed TIME_WINDOWS views clamp this back themselves.
    const minH = all.length ? Math.max(0, Math.floor(lo / 60) - 1) : 9;
    const maxH = all.length ? Math.ceil(hi / 60) + 1 : 23;

    return {
      byDay: grouped,
      allDays: [...grouped.keys()].sort(),
      minHour: minH,
      maxHour: maxH,
      untimed: untimedCount,
    };
  }, [entries, eventsById, layers, hiddenIds, rankById, priorityFilter]);

  // Clamp the day-pan window so it never runs past either end.
  const dayCount =
    daysShown === 'all' ? allDays.length : Math.min(daysShown, allDays.length);
  const maxOffset = Math.max(0, allDays.length - dayCount);
  const clampedOffset = Math.min(dayOffset, maxOffset);
  const days =
    daysShown === 'all'
      ? allDays
      : allDays.slice(clampedOffset, clampedOffset + dayCount);

  // Clamp the data-driven time bounds into the selected time-of-day window.
  const timeWindow = TIME_WINDOWS[timeView];
  const viewMinHour = timeWindow ? Math.max(minHour, timeWindow[0]) : minHour;
  const viewMaxHour = timeWindow ? Math.min(maxHour, timeWindow[1]) : maxHour;
  // Guard against an inverted range (e.g. evening-only data, morning view).
  const lowHour = Math.min(viewMinHour, viewMaxHour);
  const highHour = Math.max(viewMinHour, viewMaxHour);

  const bodyHeight = (highHour - lowHour) * 60 * pxPerMin;
  const hours: number[] = [];
  for (let h = lowHour; h <= highHour; h += 1) hours.push(h);

  // Half-hour slot starts within the visible time window.
  const slotMins: number[] = [];
  for (let m = lowHour * 60; m < highHour * 60; m += SLOT_MIN) slotMins.push(m);

  const rangeA = priorityFilter.mode === 'range' ? priorityFilter.a : 1;
  const rangeB = priorityFilter.mode === 'range' ? priorityFilter.b : 50;

  const canPanBack = daysShown !== 'all' && clampedOffset > 0;
  const canPanFwd = daysShown !== 'all' && clampedOffset < maxOffset;

  function panBy(delta: -1 | 1) {
    setDayOffset(Math.min(maxOffset, Math.max(0, clampedOffset + delta)));
  }

  function changeDensity(delta: -1 | 1) {
    const idx = DENSITY_OPTIONS.indexOf(pxPerMin);
    const next = idx < 0 ? 1 : idx + delta;
    if (next >= 0 && next < DENSITY_OPTIONS.length) {
      setPxPerMin(DENSITY_OPTIONS[next]);
    }
  }

  // ---- slot drag handlers (Task 6) ----
  function slotDown(ts: number) {
    dragAnchor.current = ts;
    setDragRange([ts, ts]);
  }

  function slotEnter(ts: number) {
    if (dragAnchor.current == null) return;
    setDragRange([dragAnchor.current, ts]);
  }

  function slotUp(upTs: number) {
    const anchor = dragAnchor.current;
    dragAnchor.current = null;
    setDragRange(null);
    if (anchor == null) return;
    if (anchor === upTs) {
      onSlotSearch({ kind: 'overlap', ts: upTs });
    } else {
      const start = Math.min(anchor, upTs);
      const end = Math.max(anchor, upTs) + SLOT_MIN * 60000;
      onSlotSearch({ kind: 'contained', start, end });
    }
    onUncollapseSearch();
  }

  // The active selection as a UTC start/end timestamp pair: the live drag
  // takes precedence over the committed slotSearch. The drag spans the anchor
  // slot through the current slot; an `overlap` search is its single 30-min
  // slot; a `contained` search uses its own start/end.
  const selectionRange: [number, number] | null = (() => {
    if (dragRange) {
      const lo = Math.min(dragRange[0], dragRange[1]);
      const hi = Math.max(dragRange[0], dragRange[1]);
      return [lo, hi + SLOT_MIN * 60000];
    }
    if (!slotSearch) return null;
    if (slotSearch.kind === 'overlap') {
      return [slotSearch.ts, slotSearch.ts + SLOT_MIN * 60000];
    }
    return [slotSearch.start, slotSearch.end];
  })();

  /**
   * The continuous highlight rectangle for a day, or null if the selection
   * does not touch it. Splits the selection at midnight so a rectangle never
   * extends past the column it belongs to.
   */
  function selectionRect(
    dayKey: string,
  ): { top: number; height: number } | null {
    if (!selectionRange) return null;
    const [y, mo, d] = dayKey.split('-').map(Number);
    const dayStart = Date.UTC(y, mo - 1, d);
    const dayEnd = dayStart + 24 * 60 * 60000;
    const lo = Math.max(selectionRange[0], dayStart);
    const hi = Math.min(selectionRange[1], dayEnd);
    if (hi <= lo) return null;
    const startMin = (lo - dayStart) / 60000;
    const endMin = (hi - dayStart) / 60000;
    return {
      top: (startMin - lowHour * 60) * pxPerMin,
      height: (endMin - startMin) * pxPerMin,
    };
  }

  // Close the layer dropdown on outside click or Escape.
  useEffect(() => {
    if (!layerMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!layerChooserRef.current?.contains(e.target as Node)) {
        setLayerMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setLayerMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [layerMenuOpen]);

  return (
    <section className="pane pane-agenda">
      <div className="pane-head">
        <h2>Agenda</h2>
        <div className="agenda-zoom">
          <div className="zoom-group">
            {DAY_OPTIONS.map((opt) => (
              <button
                key={String(opt)}
                className={`btn btn-mini ${
                  daysShown === opt ? 'is-active' : ''
                }`}
                onClick={() => {
                  setDaysShown(opt);
                  setDayOffset(0);
                }}
              >
                {opt === 'all' ? 'All' : `${opt}d`}
              </button>
            ))}
            <button
              className="btn btn-mini"
              onClick={() => panBy(-1)}
              disabled={!canPanBack}
              aria-label="Previous days"
            >
              ◀
            </button>
            <button
              className="btn btn-mini"
              onClick={() => panBy(1)}
              disabled={!canPanFwd}
              aria-label="Next days"
            >
              ▶
            </button>
          </div>
          <div className="zoom-group">
            {TIME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`btn btn-mini ${
                  timeView === opt.id ? 'is-active' : ''
                }`}
                onClick={() => setTimeView(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="zoom-group">
            <button
              className="btn btn-mini"
              onClick={() => changeDensity(-1)}
              disabled={pxPerMin === DENSITY_OPTIONS[0]}
              aria-label="Less vertical zoom"
            >
              −
            </button>
            <span className="zoom-label">Zoom</span>
            <button
              className="btn btn-mini"
              onClick={() => changeDensity(1)}
              disabled={pxPerMin === DENSITY_OPTIONS[DENSITY_OPTIONS.length - 1]}
              aria-label="More vertical zoom"
            >
              +
            </button>
          </div>
        </div>
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
          (() => {
            const currentLayer = priorityFilter.layer;
            const lastLayer = Math.max(1, layers.length);
            const active =
              layers.find((l) => l.index === currentLayer) ?? layers[0];
            return (
              <div className="priority-segments">
                <div className="layer-chooser" ref={layerChooserRef}>
                  <div className="layer-split">
                    <button
                      className="btn btn-mini layer-step"
                      onClick={() =>
                        onPriorityFilter({
                          mode: 'layer',
                          layer: currentLayer - 1,
                        })
                      }
                      disabled={currentLayer <= 1}
                      aria-label="Previous layer"
                    >
                      ‹
                    </button>
                    <button
                      className="btn btn-mini layer-current"
                      onClick={() => setLayerMenuOpen((o) => !o)}
                      aria-haspopup="listbox"
                      aria-expanded={layerMenuOpen}
                    >
                      {active ? layerLabel(active) : `L${currentLayer}`}
                      <span className="layer-caret">▾</span>
                    </button>
                    <button
                      className="btn btn-mini layer-step"
                      onClick={() =>
                        onPriorityFilter({
                          mode: 'layer',
                          layer: currentLayer + 1,
                        })
                      }
                      disabled={currentLayer >= lastLayer}
                      aria-label="Next layer"
                    >
                      ›
                    </button>
                  </div>
                  {layerMenuOpen && (
                    <ul className="layer-menu" role="listbox">
                      {layers.map((layer) => (
                        <li
                          key={layer.index}
                          className={`layer-menu-option ${
                            layer.index === currentLayer ? 'is-selected' : ''
                          }`}
                          role="option"
                          aria-selected={layer.index === currentLayer}
                          onClick={() => {
                            onPriorityFilter({
                              mode: 'layer',
                              layer: layer.index,
                            });
                            setLayerMenuOpen(false);
                          }}
                        >
                          {layerLabel(layer)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })()
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
            <RangeSlider
              min={1}
              max={Math.max(wishlistLength, 1)}
              low={rangeA}
              high={rangeB}
              onChange={(low, high) =>
                onPriorityFilter({ mode: 'range', a: low, b: high })
              }
            />
          </div>
        )}

        {hiddenIds.size > 0 && (
          <button className="hidden-chip" onClick={onClearHidden}>
            Hidden ({hiddenIds.size}) · restore
          </button>
        )}
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
                    style={{ top: (h - lowHour) * 60 * pxPerMin }}
                  >
                    {fmtHour(h)}
                  </div>
                ))}
              </div>
            </div>

            {days.map((dayKey) => (
              <div key={dayKey} className="cal-col cal-day">
                <div className="cal-col-head">{fmtDayLabel(dayKey)}</div>
                <div
                  className="cal-col-body"
                  style={{ height: bodyHeight }}
                  onMouseLeave={() => {
                    if (dragAnchor.current == null) setDragRange(null);
                  }}
                >
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="cal-hour-line"
                      style={{ top: (h - lowHour) * 60 * pxPerMin }}
                    />
                  ))}

                  {/* Single continuous highlight for the active selection,
                      sitting above the hour grid but below event blocks. */}
                  {(() => {
                    const rect = selectionRect(dayKey);
                    if (!rect) return null;
                    return (
                      <div
                        className="cal-selection"
                        style={{ top: rect.top, height: rect.height }}
                      />
                    );
                  })()}

                  {/* Transparent 30-min slot overlay for slot search. Spans
                      the full column width, including the right gutter. */}
                  <div className="cal-slot-layer">
                    {slotMins.map((m) => {
                      const ts = slotTs(
                        dayKey,
                        Math.floor(m / 60),
                        m % 60,
                      );
                      return (
                        <div
                          key={m}
                          className="cal-slot"
                          style={{
                            top: (m - lowHour * 60) * pxPerMin,
                            height: SLOT_MIN * pxPerMin,
                          }}
                          onMouseDown={() => slotDown(ts)}
                          onMouseEnter={() => slotEnter(ts)}
                          onMouseUp={() => slotUp(ts)}
                        />
                      );
                    })}
                  </div>

                  {/* Event blocks are confined to the area left of the right
                      gutter so that strip stays a live slot-search surface. */}
                  <div
                    className="cal-event-layer"
                    style={{ right: RIGHT_GUTTER_PX }}
                  >
                    {(byDay.get(dayKey) ?? []).map((p) => {
                      const top = (p.startMin - lowHour * 60) * pxPerMin;
                      const height = Math.max(
                        (p.endMin - p.startMin) * pxPerMin,
                        MIN_BLOCK_PX,
                      );
                      const widthPct = 100 / p.cols;
                      return (
                        <div
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
                          onMouseDown={(e) => e.stopPropagation()}
                          onMouseUp={(e) => e.stopPropagation()}
                          onClick={() => onSelect(p.event.id)}
                          title={p.event.title}
                        >
                          <span className="cal-event-rank">#{p.rank}</span>
                          <span className="cal-event-title">
                            {p.event.title}
                          </span>
                          <span className="cal-event-time">
                            {fmtTime(p.startW)}
                          </span>
                          <button
                            className="cal-event-hide"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleHidden(p.event.id);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            title="Hide from layout"
                            aria-label="Hide from layout"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
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
