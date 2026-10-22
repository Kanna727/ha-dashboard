// Page swipes (layout/usePageSwipe.ts): is a finished touch a deliberate
// sideways swipe? Pure, so it is unit-tested.

export interface TouchPoint {
  x: number;
  y: number;
  t: number; // ms
}

export const SWIPE = {
  minPx: 70, // at least this far…
  minFraction: 0.12, // …and this share of the screen width
  ratio: 1.8, // this many times more sideways than up/down
  maxMs: 800, // a flick, not a slow drag
  edgePx: 20, // starts this close to a side belong to the system (back gesture)
};

// 1 = next page (finger moved left), −1 = previous, 0 = not a swipe.
export function swipeDir(start: TouchPoint, end: TouchPoint, width: number): 1 | -1 | 0 {
  if (start.x < SWIPE.edgePx || start.x > width - SWIPE.edgePx) return 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (end.t - start.t > SWIPE.maxMs) return 0;
  if (Math.abs(dx) < Math.max(SWIPE.minPx, width * SWIPE.minFraction)) return 0;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE.ratio) return 0;
  return dx < 0 ? 1 : -1;
}

// The page `dir` steps from `current` in `pages`, without wrapping round.
export function stepPage<T>(pages: readonly T[], current: T, dir: 1 | -1): T | undefined {
  const i = pages.indexOf(current);
  if (i < 0) return undefined;
  return pages[i + dir];
}
