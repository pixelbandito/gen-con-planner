interface Props {
  label: string;
  side: 'left' | 'right' | 'center';
  onExpand: () => void;
}

/**
 * A thin vertical strip rendered in place of a collapsed pane. Shows the
 * pane's name as vertical text plus an expand button. The expand arrow points
 * toward the freed-up space: `»` reopens a left pane, `«` a right pane; a
 * center pane has no single direction, so it uses a neutral `⇔`.
 */
export function CollapsedRail({ label, side, onExpand }: Props) {
  const arrow = side === 'left' ? '»' : side === 'right' ? '«' : '⇔';
  return (
    <div className={`pane-rail pane-rail-${side}`}>
      <button
        className="btn btn-mini rail-expand"
        onClick={onExpand}
        title={`Expand ${label}`}
        aria-label={`Expand ${label}`}
      >
        {arrow}
      </button>
      <span className="rail-label">{label}</span>
    </div>
  );
}
