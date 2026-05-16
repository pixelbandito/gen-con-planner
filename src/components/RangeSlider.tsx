interface Props {
  min: number;
  max: number;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
}

/**
 * Dependency-free dual-thumb range slider. Two overlapping native range inputs
 * drive `low` / `high`; a colored fill marks the selected span. Each thumb is a
 * real range input so keyboard and screen-reader support come for free.
 *
 * The two inputs share the track. Both inputs are `pointer-events: none` so
 * the inert track never captures clicks; only the thumb pseudo-elements are
 * clickable. When the two thumbs coincide — or the low thumb is pinned at the
 * right edge — the low input is raised above the high input so its thumb stays
 * grabbable instead of being buried under the high thumb.
 */
export function RangeSlider({ min, max, low, high, onChange }: Props) {
  // Clamp ONLY for thumb positioning/rendering; a degenerate min===max track
  // still renders without dividing by zero. The emitted onChange values are
  // never position-clamped for a thumb the user did not drag.
  const span = Math.max(1, max - min);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const lo = clamp(Math.min(low, high));
  const hi = clamp(Math.max(low, high));

  const loPct = ((lo - min) / span) * 100;
  const hiPct = ((hi - min) / span) * 100;

  // Raise the low input above the high input whenever the low thumb would
  // otherwise be unreachable: when the thumbs coincide, or the low thumb is
  // pinned at (or right up against) the right edge of the track.
  const lowOnTop = lo >= hi || lo >= max;

  return (
    <div className="range-slider">
      <div className="range-slider-track" />
      <div
        className="range-slider-fill"
        style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }}
      />
      <input
        type="range"
        className="range-slider-input"
        style={{ zIndex: lowOnTop ? 2 : 1 }}
        min={min}
        max={max}
        value={lo}
        aria-label="Lowest wishlist rank"
        onChange={(e) => {
          // Emit only the dragged (low) value; pass `high` through unchanged
          // so a sentinel like 300 that exceeds `max` is never rewritten.
          const next = Math.min(Number(e.target.value), high);
          onChange(next, high);
        }}
      />
      <input
        type="range"
        className="range-slider-input"
        style={{ zIndex: lowOnTop ? 1 : 2 }}
        min={min}
        max={max}
        value={hi}
        aria-label="Highest wishlist rank"
        onChange={(e) => {
          // Emit only the dragged (high) value; pass `low` through unchanged.
          const next = Math.max(Number(e.target.value), low);
          onChange(low, next);
        }}
      />
    </div>
  );
}
