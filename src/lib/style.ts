// Small presentation helpers shared across components.

/** CSS class keyed to a game system, for consistent color-coding. */
export function gameClass(gameSystem: string): string {
  const g = (gameSystem || '').toLowerCase();
  if (g.includes('magic')) return 'sys-mtg';
  if (g.includes('dungeons')) return 'sys-dnd';
  return 'sys-other';
}

/** Human-readable event cost. */
export function fmtCost(cost: number | null): string {
  if (cost == null) return '—';
  if (cost === 0) return 'Free';
  return `$${cost % 1 === 0 ? String(cost) : cost.toFixed(2)}`;
}
