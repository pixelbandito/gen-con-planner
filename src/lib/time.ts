// Time helpers.
//
// Gen Con timestamps look like "2026-07-29T17:00:00.000-04:00". The offset is
// always Indianapolis-local. We parse the wall-clock portion directly and
// display it as-is, so times are correct regardless of the user's timezone.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface WallTime {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  /** Date.UTC-based millis — timezone-agnostic, safe for ordering/overlap. */
  ts: number;
  /** "YYYY-MM-DD" */
  dayKey: string;
  /** Minutes since midnight. */
  minOfDay: number;
}

export function parseWall(iso: string | null | undefined): WallTime | null {
  if (!iso) return null;
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const h = +m[4];
  const mi = +m[5];
  return {
    y, mo, d, h, mi,
    ts: Date.UTC(y, mo - 1, d, h, mi),
    dayKey: `${m[1]}-${m[2]}-${m[3]}`,
    minOfDay: h * 60 + mi,
  };
}

export function fmtTime(w: WallTime): string {
  const ampm = w.h < 12 ? 'AM' : 'PM';
  const hr = w.h % 12 === 0 ? 12 : w.h % 12;
  return `${hr}:${String(w.mi).padStart(2, '0')} ${ampm}`;
}

/** Format an hour-of-day label, tolerating values past 24 (overnight). */
export function fmtHour(hour: number): string {
  const hh = ((hour % 24) + 24) % 24;
  const ampm = hh < 12 ? 'AM' : 'PM';
  const hr = hh % 12 === 0 ? 12 : hh % 12;
  return `${hr} ${ampm}`;
}

export function fmtDayLabel(dayKey: string): string {
  const [y, mo, d] = dayKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${DOW[dow]} ${MONTHS[mo - 1]} ${d}`;
}

export function fmtDateTime(
  start: string | null,
  end: string | null,
): string {
  const s = parseWall(start);
  if (!s) return 'Time TBD';
  const e = parseWall(end);
  const base = `${fmtDayLabel(s.dayKey)} · ${fmtTime(s)}`;
  return e ? `${base} – ${fmtTime(e)}` : base;
}

/** Short relative label for an ISO timestamp ("just now", "3 hours ago"). */
export function fmtRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
