// Page swipes (layout/Pager.tsx): when a drag becomes a sideways page drag,
// where the page sits while the finger moves, and whether letting go turns
// the page. Pure, so it is unit-tested.

export const SWIPE = {
  lockPx: 10, // movement before deciding sideways vs. up/down
  lockRatio: 1.2, // sideways when |dx| > 1.2 × |dy| at that point
  edgePx: 20, // starts this close to a side belong to the system (back gesture)
  commitFraction: 0.3, // let go past 30 % of the width: turn the page
  flickSpeed: 0.35, // px/ms: or flick at least this fast in the drag's direction
  flickMinPx: 20,
  rubber: 0.25, // no page that way: the drag stretches at a quarter speed
};

// null until the finger has moved enough to tell.
export function lockAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.hypot(dx, dy) < SWIPE.lockPx) return null;
  return Math.abs(dx) > Math.abs(dy) * SWIPE.lockRatio ? 'x' : 'y';
}

// Where the pages sit for a drag of dx (px), stretching where there is no page.
export function dragOffset(dx: number, canPrev: boolean, canNext: boolean): number {
  const can = dx < 0 ? canNext : canPrev;
  return can ? dx : dx * SWIPE.rubber;
}

// Letting go after dragging dx at velocity v (px/ms, + = rightwards):
// 1 = next page, −1 = previous, 0 = spring back.
export function releaseDir(dx: number, v: number, width: number, canPrev: boolean, canNext: boolean): 1 | -1 | 0 {
  if (!dx) return 0;
  const dir = dx < 0 ? 1 : -1;
  if (!(dir === 1 ? canNext : canPrev)) return 0;
  // A flick back the other way cancels, however far the page came.
  if (Math.abs(v) >= SWIPE.flickSpeed && Math.sign(v) !== Math.sign(dx)) return 0;
  if (Math.abs(dx) >= width * SWIPE.commitFraction) return dir;
  if (Math.abs(v) >= SWIPE.flickSpeed && Math.abs(dx) >= SWIPE.flickMinPx) return dir;
  return 0;
}

// How long the rest of the move takes: as fast as the finger was going, within limits.
export function settleMs(remainingPx: number, v: number): number {
  const speed = Math.max(Math.abs(v), 1.1); // px/ms
  return Math.round(Math.min(360, Math.max(140, remainingPx / speed)));
}

// The page `dir` steps from `current` in `pages`, without wrapping round.
export function stepPage<T>(pages: readonly T[], current: T, dir: 1 | -1): T | undefined {
  const i = pages.indexOf(current);
  if (i < 0) return undefined;
  return pages[i + dir];
}
