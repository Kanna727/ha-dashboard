// Particle look for an energy-tree branch, from that plug's own watts (not its
// share of the biggest consumer), so a fridge always crawls and a geyser always
// races whatever else is on.
//
// Watts map to a level on a log scale: each level doubles the watts (10, 20, 40 …
// 2.5 kW) and moves ~1.35× faster, 10 px/s up to ~110 px/s. Levels are whole
// steps with hysteresis, so a reading that wobbles around a boundary doesn't keep
// changing the animation (which makes the dots jump).

export type FlowDensity = 'light' | 'medium' | 'heavy';

export const FLOW_GAP: Record<FlowDensity, number> = { light: 26, medium: 18, heavy: 12 }; // px between particles
export const FLOW_LEVELS = 8;
const HOLD = 0.75; // how far past the current level a reading must move to change it

export function flowLevel(w: number, prev?: number): number {
  const raw = Math.min(FLOW_LEVELS, Math.max(0, Math.log2(Math.max(w, 1) / 10)));
  if (prev !== undefined && Math.abs(raw - prev) < HOLD) return prev;
  return Math.round(raw);
}

// Density comes in three buckets (each has its own @keyframes in app.css, so the
// dash pattern loops seamlessly): light up to ~230 W, medium to ~900 W, then heavy.
export function flowDensity(level: number): FlowDensity {
  if (level >= 7) return 'heavy';
  if (level >= 5) return 'medium';
  return 'light';
}

export const flowSpeed = (level: number) => 10 * Math.pow(1.35, level); // px/s

// Seconds for a particle to move one gap.
export const flowDuration = (level: number) => FLOW_GAP[flowDensity(level)] / flowSpeed(level);

// Ease-out cubic between a and b at progress k (0–1), for gliding numbers.
export const tweenAt = (a: number, b: number, k: number) => a + (b - a) * (1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3));
