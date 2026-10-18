// Generated art for the page sky: cloud masks and lightning bolts. Pure, unit-tested.
import { rng } from './tree';

// Deterministic pseudo-random, so generated shapes don't change between renders.
export function rand(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface CloudTile {
  w: number; // tile size in px; the tile repeats sideways seamlessly (stitchTiles)
  h: number;
  freq: [number, number]; // fractal noise base frequency, x (wide puffs) and y
  octaves: number;
  seed: number;
  cover: number; // 0–1: how much of the tile is cloud
  fade: number; // 0–1: where the clouds start thinning towards the bottom of the tile
}

// A cloud tile as an SVG data URI, used as a CSS mask so its colour can change
// without re-rendering it. 'shape' is the cloud's density; 'lit' is how much
// light from `lightAz` (SVG azimuth, degrees clockwise from +x) and `lightEl`
// degrees up each part catches, using the noise as a height map. The browser
// rasterises it once, after which the layer only slides.
const PAD = 32;

export function cloudSvg(t: CloudTile, mode: 'shape' | 'lit', lightAz = 270, lightEl = 30): string {
  // Threshold the noise: more cover lowers the threshold. The slope keeps edges soft.
  // Full cover closes the last gaps: an overcast sky has no holes.
  const threshold = 0.62 - 0.26 * t.cover - (0.16 * Math.max(0, t.cover - 0.8)) / 0.2;
  const slope = 7;
  const n = (v: number) => +v.toFixed(4);
  // The height map is the cloud noise plus a rounder billow noise (so masses
  // have cauliflower tops rather than ripples), kept off its limits so nothing
  // clips flat, and blurred: 8-bit heights otherwise light up as contour lines.
  const alphaOfRed = `type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0'`;
  const lit =
    mode === 'lit'
      ? `<feTurbulence x='0' y='0' width='${t.w}' height='${t.h}' type='fractalNoise' baseFrequency='0.0065' numOctaves='2' seed='${t.seed + 11}' stitchTiles='stitch' result='bt'/>` +
        `<feTile in='bt' result='b'/><feColorMatrix in='b' ${alphaOfRed} result='ba'/><feColorMatrix in='n' ${alphaOfRed} result='na'/>` +
        `<feComposite in='na' in2='ba' operator='arithmetic' k2='1.4' k3='1.3' k4='-0.85' result='h0'/>` +
        `<feGaussianBlur in='h0' stdDeviation='3' result='hgt'/>` +
        `<feDiffuseLighting in='hgt' surfaceScale='6' diffuseConstant='1.1' lighting-color='#fff' result='l'><feDistantLight azimuth='${Math.round(lightAz)}' elevation='${lightEl}'/></feDiffuseLighting>` +
        `<feColorMatrix in='l' type='luminanceToAlpha' result='la'/><feComposite in='la' in2='shape' operator='in'/>`
      : '';
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${t.w}' height='${t.h}' viewBox='0 0 ${t.w} ${t.h}' preserveAspectRatio='none'>` +
    `<defs><linearGradient id='f' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff'/><stop offset='${n(t.fade)}' stop-color='#fff'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient>` +
    `<mask id='m'><rect width='${t.w}' height='${t.h}' fill='url(#f)'/></mask>` +
    // The filter runs a little past both side edges, on the noise tiled sideways
    // (feTile), so the blur below wraps round instead of leaving a seam.
    `<filter id='c' filterUnits='userSpaceOnUse' x='${-PAD}' y='0' width='${t.w + 2 * PAD}' height='${t.h}' color-interpolation-filters='sRGB'>` +
    `<feTurbulence x='0' y='0' width='${t.w}' height='${t.h}' type='fractalNoise' baseFrequency='${n(t.freq[0])} ${n(t.freq[1])}' numOctaves='${t.octaves}' seed='${t.seed}' stitchTiles='stitch' result='t'/>` +
    `<feTile in='t' result='n'/>` +
    `<feColorMatrix in='n' type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 ${slope} 0 0 0 ${n(-slope * threshold)}' result='shape'/>` +
    lit +
    `</filter></defs><rect width='${t.w}' height='${t.h}' fill='#fff' filter='url(#c)' mask='url(#m)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// A jagged lightning bolt in a 100 × 100 box (stretched to its element): a
// tortuous main channel from the top, with short steps, the odd sharp kink, and
// 2–4 thinner forks that wander off sideways and fade out.
export function boltPaths(seed: number): { main: string; forks: string[] } {
  const r = rng(seed);
  const pts: [number, number][] = [[50, 0]];
  let x = 50;
  let y = 0;
  const end = 80 + r() * 18;
  while (y < end) {
    y = Math.min(end, y + 2.5 + r() * 5);
    const kink = r() < 0.15 ? (r() - 0.5) * 26 : 0;
    x = Math.min(90, Math.max(10, x + (r() - 0.5) * 9 + kink));
    pts.push([x, y]);
  }
  const d = (p: [number, number][]) => 'M' + p.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(' L');
  const forks: string[] = [];
  const nForks = 2 + Math.floor(r() * 3);
  for (let f = 0; f < nForks; f++) {
    const from = pts[2 + Math.floor(r() * (pts.length * 0.6))];
    const side = r() < 0.5 ? -1 : 1;
    const fork: [number, number][] = [from];
    let [fx, fy] = from;
    const steps = 4 + Math.floor(r() * 5);
    for (let k = 0; k < steps; k++) {
      fx += side * (1.5 + r() * 4.5) + (r() - 0.5) * 3;
      fy += 2 + r() * 4;
      fork.push([fx, fy]);
    }
    forks.push(d(fork));
  }
  return { main: d(pts), forks };
}

// One lightning strike in a storm: where it lands (0–1 across the page), whether
// a bolt reaches the ground or it's a flash inside the clouds, its flicker (1–3
// return strokes as opacity keyframes), and how long until the next one
// (biased short, so strikes come in bursts).
export interface Strike {
  x: number;
  bolt: boolean;
  seed: number;
  duration: number; // ms
  flicker: { offset: number; opacity: number }[];
  next: number; // ms until the next strike
}

export function planStrike(r: () => number): Strike {
  const strokes = 1 + Math.floor(r() * 3);
  const times: { t: number; opacity: number }[] = [{ t: 0, opacity: 0 }];
  let t = 30;
  for (let i = 0; i < strokes; i++) {
    times.push({ t, opacity: 1 - i * 0.2 * r() });
    times.push({ t: t + 45 + r() * 30, opacity: 0.1 + r() * 0.2 });
    t += 110 + r() * 160;
  }
  const end = t + 220;
  times.push({ t: end, opacity: 0 });
  return {
    x: 0.06 + r() * 0.88,
    bolt: r() < 0.65,
    seed: Math.floor(r() * 1e6),
    duration: end,
    flicker: times.map((k) => ({ offset: +(k.t / end).toFixed(3), opacity: +k.opacity.toFixed(2) })),
    next: 700 + r() * r() * 4300,
  };
}
