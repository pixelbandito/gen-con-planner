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
 * The two inputs share the track. The lower input sits above the upper one
 * (via z-index) only across the left portion of the track so whichever thumb
 * the user reaches for stays grabbable even when both thumbs are close.
 */
export function RangeSlider({ min, max, low, high, onChange }: Props) {
  // Clamp into [min, max] and keep low <= high; a degenerate min===max track
  // still renders without dividing by zero.
  const span = Math.max(1, max - min);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const lo = clamp(Math.min(low, high));
  const hi = clamp(Math.max(low, high));

  const loPct = ((lo - min) / span) * 100;
  const hiPct = ((hi - min) / span) * 100;

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
        min={min}
        max={max}
        value={lo}
        aria-label="Lowest wishlist rank"
        onChange={(e) => {
          const next = Math.min(Number(e.target.value), hi);
          onChange(next, hi);
        }}
      />
      <input
        type="range"
        className="range-slider-input"
        min={min}
        max={max}
        value={hi}
        aria-label="Highest wishlist rank"
        onChange={(e) => {
          const next = Math.max(Number(e.target.value), lo);
          onChange(lo, next);
        }}
      />
    </div>
  );
}
