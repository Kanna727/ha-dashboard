// Particle look for an energy-tree branch, from the consumer's watts.
// Density comes in three buckets (each has its own @keyframes in app.css, so the
// dash pattern loops seamlessly); speed scales smoothly with the power share.

export type FlowDensity = 'light' | 'medium' | 'heavy';

export const FLOW_GAP: Record<FlowDensity, number> = { light: 26, medium: 18, heavy: 12 }; // px between particles

export function flowDensity(w: number): FlowDensity {
  if (w >= 1000) return 'heavy';
  if (w >= 200) return 'medium';
  return 'light';
}

// Seconds for a particle to move one gap. 20 px/s for a trickle up to 90 px/s
// for the biggest consumer, so relative speed reads at a glance.
export function flowDuration(w: number, maxW: number): number {
  const share = maxW > 0 ? Math.min(1, Math.max(0, w / maxW)) : 0;
  const pxPerSec = 20 + 70 * share;
  return FLOW_GAP[flowDensity(w)] / pxPerSec;
}

// Ease-out cubic between a and b at progress k (0–1), for gliding numbers.
export const tweenAt = (a: number, b: number, k: number) => a + (b - a) * (1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3));
