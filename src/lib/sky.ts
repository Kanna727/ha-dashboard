// Sun/moon arc maths for the weather card (and night mode). Pure, unit-tested.

const DAY_MS = 86_400_000;

export interface SkyWindow {
  body: 'sun' | 'moon';
  start: number; // epoch ms: sunrise (sun) or sunset (moon)
  end: number; // epoch ms: sunset (sun) or next sunrise (moon)
}

// sun.sun only gives the *next* rising and setting. While the sun is up, today's
// sunrise is roughly next_rising − 24 h; at night, the last sunset is roughly
// next_setting − 24 h. Off by a minute or two at most, plenty for a progress dot.
export function skyWindow(aboveHorizon: boolean, nextRising?: string, nextSetting?: string): SkyWindow | undefined {
  const rise = nextRising ? Date.parse(nextRising) : NaN;
  const set = nextSetting ? Date.parse(nextSetting) : NaN;
  if (!Number.isFinite(rise) || !Number.isFinite(set)) return undefined;
  return aboveHorizon ? { body: 'sun', start: rise - DAY_MS, end: set } : { body: 'moon', start: set - DAY_MS, end: rise };
}

// How far through the window `now` is, 0–1.
export function skyProgress(w: SkyWindow, now: number): number {
  const span = w.end - w.start;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (now - w.start) / span));
}

// A point on the arc for progress p, in an SVG box (horizon at y = base).
export function arcPoint(p: number, left: number, right: number, base: number, height: number) {
  return { x: left + (right - left) * p, y: base - height * Math.sin(Math.PI * p) };
}

// Moon phase: 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter.
const SYNODIC_DAYS = 29.530588853;
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
export function moonPhase(at: number): number {
  const days = (at - REF_NEW_MOON) / DAY_MS;
  const p = (days / SYNODIC_DAYS) % 1;
  return p < 0 ? p + 1 : p;
}

// Lit fraction of the disc (0 new … 1 full).
export const moonIllumination = (phase: number) => (1 - Math.cos(2 * Math.PI * phase)) / 2;

// SVG path of the lit part of a moon disc. Waxing (phase < 0.5) is lit on the
// right, waning on the left (northern-hemisphere view).
// The outer edge is a half circle; the terminator is a half ellipse whose width
// shrinks to zero at the quarters.
export function moonLitPath(cx: number, cy: number, r: number, phase: number): string {
  const k = Math.cos(2 * Math.PI * phase); // 1 at new, −1 at full
  const rx = Math.abs(k) * r;
  const waxing = phase < 0.5;
  const outerSweep = waxing ? 1 : 0;
  // Crescent (k > 0): the terminator bulges toward the lit side; gibbous: away from it.
  const innerSweep = waxing ? (k > 0 ? 0 : 1) : k > 0 ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} A ${rx} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z`;
}
