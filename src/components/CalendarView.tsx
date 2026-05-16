import { useMemo, useState } from 'react';
import type { GenConEvent, WishlistEntry } from '../types';
import type { ScheduleInfo } from '../lib/schedule';
import { fmtDayLabel, fmtHour, fmtTime, parseWall } from '../lib/time';
import { gameClass } from '../lib/style';

interface Props {
  entries: WishlistEntry[];
  eventsById: Map<number, GenConEvent>;
  schedule: Map<number, ScheduleInfo>;
  onSelect: (id: number) => void;
}

const PX_PER_MIN = 1;
const MIN_BLOCK_PX = 26;

interface Placed {
  event: GenConEvent;
  info: ScheduleInfo;
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

export function CalendarView({
  entries,
  eventsById,
  schedule,
  onSelect,
}: Props) {
  const [showBumped, setShowBumped] = useState(true);

  const { byDay, days, minHour, maxHour, untimed } = useMemo(() => {
    const all: Placed[] = [];
    let untimedCount = 0;

    for (const entry of entries) {
      const ev = eventsById.get(entry.eventId);
      const info = schedule.get(entry.eventId);
      if (!ev || !info) continue;
      const s = parseWall(ev.start);
      const e = parseWall(ev.end);
      if (!s || !e) {
        untimedCount += 1;
        continue;
      }
      const durMin = Math.max((e.ts - s.ts) / 60000, 30);
      all.push({
        event: ev,
        info,
        dayKey: s.dayKey,
        startMin: s.minOfDay,
        endMin: s.minOfDay + durMin,
        startW: s,
        col: 0,
        cols: 1,
      });
    }

    const visible = showBumped
      ? all
      : all.filter((p) => p.info.status !== 'bumped');

    const grouped = new Map<string, Placed[]>();
    for (const p of visible) {
      const list = grouped.get(p.dayKey) ?? [];
      list.push(p);
      grouped.set(p.dayKey, list);
    }
    for (const list of grouped.values()) packDay(list);

    let lo = 24 * 60;
    let hi = 0;
    for (const p of visible) {
      lo = Math.min(lo, p.startMin);
      hi = Math.max(hi, p.endMin);
    }
    const minH = visible.length ? Math.floor(lo / 60) : 9;
    const maxH = visible.length ? Math.ceil(hi / 60) : 23;

    return {
      byDay: grouped,
      days: [...grouped.keys()].sort(),
      minHour: minH,
      maxHour: maxH,
      untimed: untimedCount,
    };
  }, [entries, eventsById, schedule, showBumped]);

  const bodyHeight = (maxHour - minHour) * 60 * PX_PER_MIN;
  const hours: number[] = [];
  for (let h = minHour; h <= maxHour; h += 1) hours.push(h);

  return (
    <section className="pane pane-calendar">
      <div className="pane-head">
        <h2>Calendar</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={showBumped}
            onChange={(e) => setShowBumped(e.target.checked)}
          />
          Show bumped layer
        </label>
      </div>

      <div className="cal-legend">
        <span className="legend-item legend-scheduled">Expected schedule</span>
        <span className="legend-item legend-bumped">
          Bumped (backup layer)
        </span>
      </div>

      {days.length === 0 ? (
        <div className="cal-empty">
          Your wishlist is empty. Add events from the browser and they will
          appear here — your expected schedule solid, conflict-bumped backups
          translucent.
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
                        )} is-${p.info.status}`}
                        style={{
                          top,
                          height,
                          left: `${p.col * widthPct}%`,
                          width: `calc(${widthPct}% - 3px)`,
                        }}
                        onClick={() => onSelect(p.event.id)}
                        title={p.event.title}
                      >
                        <span className="cal-event-rank">
                          #{p.info.rank}
                        </span>
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
