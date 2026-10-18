// Ground shapes along the bottom of the page sky (components/SkyBackdrop.tsx):
// filled ridges grown from seeded noise, used for the city's tree canopy
// (lib/city.ts) and the rise the tree stands on. Pure, unit-tested.
//
// Everything is in a box LAND_H units tall whose width follows the screen's
// aspect, so shapes keep their proportions on a phone and a wide desktop
// alike; wider screens just see more.

export const LAND_H = 600;
export const TREE_Y = 528; // ground level under the tree at the right edge

// 1D value noise: smooth random values between integer lattice points.
function hash(i: number, seed: number) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function noise(x: number, seed: number) {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return hash(i, seed) + (hash(i + 1, seed) - hash(i, seed)) * s;
}

// Fractal noise in 0–1.
export function fractal(x: number, seed: number, octaves: number, rough: number) {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * 2 ** o, seed + o * 17) * amp;
    norm += amp;
    amp *= rough;
  }
  return sum / norm;
}

// Piecewise profile through [t, y] points, t = 0–1 across the screen, eased so shapes stay rounded.
function profile(points: [number, number][], t: number) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, y1] = points[i];
    if (t <= t1) {
      const [t0, y0] = points[i - 1];
      const k = (t - t0) / (t1 - t0);
      return y0 + (y1 - y0) * k * k * (3 - 2 * k);
    }
  }
  return points[points.length - 1][1];
}

export interface RidgeSpec {
  seed: number;
  base: [number, number][]; // ground line across the screen (y, units; below LAND_H is hidden)
  amp: number; // how high the noise lifts it
  scale: number; // feature width, units
  octaves: number;
  rough: number;
  trees?: number; // height of a fuzzy treeline on top, units
}

// A filled ridge: its top edge sampled every few units, closed along the bottom.
export function ridgePath(spec: RidgeSpec, width: number, step = 4): string {
  const pts: string[] = [];
  for (let x = 0; x <= width + step; x += step) {
    const t = Math.min(1, x / width);
    // Noise is sampled from the centre, so the middle is the same on every screen.
    const u = (x - width / 2) / spec.scale + 500;
    let y = profile(spec.base, t) - spec.amp * fractal(u, spec.seed, spec.octaves, spec.rough);
    if (spec.trees) y -= spec.trees * fractal((x - width / 2) / 7 + 900, spec.seed + 5, 2, 0.6) ** 1.5;
    pts.push(`${Math.round(Math.min(x, width))} ${y.toFixed(1)}`);
  }
  return `M0 ${LAND_H}L${pts.join('L')}L${Math.round(width)} ${LAND_H}Z`;
}

// The foreground: a low bank on the left and the rise the tree stands on, right.
export const RISE: RidgeSpec = {
  seed: 51,
  base: [
    [0, 600],
    [0.12, 582],
    [0.3, 650],
    [0.66, 650],
    [0.84, 552],
    [1, TREE_Y + 8],
  ],
  amp: 22,
  scale: 140,
  octaves: 4,
  rough: 0.5,
  trees: 3,
};
