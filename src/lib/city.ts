// The city skyline along the bottom of the page sky (components/SkyBackdrop.tsx):
// a hazy far skyline, a nearer one of towers (crowns, setbacks, antennas) with
// a domed civic building, an elevated metro line, and tree canopy in front.
// In the ground box of lib/terrain.ts (LAND_H tall, as wide as the screen's aspect).
// Pure, unit-tested.
import { LAND_H, ridgePath, type RidgeSpec } from './terrain';
import { rng } from './tree';

export const GROUND_Y = 540; // street level of the near skyline
export const DECK_Y = 528; // top of the metro viaduct's deck
export const DECK_H = 7;

interface SkylineSpec {
  seed: number;
  base: number; // where the buildings stand (y)
  h: [number, number]; // usual height range
  tall: number; // chance of a tower
  tallH: [number, number];
  w: [number, number];
  gap: [number, number]; // negative overlaps
  win: { cw: number; ch: number; ww: number; wh: number; p: number }; // window grid and the share lit at night
  civic?: number; // where the domed building stands, 0–1 across the screen
}

export interface Skyline {
  body: string; // the buildings' silhouette
  sunLeft: string; // the faces lit when the sun is on the left
  sunRight: string; // … on the right
  warm: string; // lit windows, warm light
  cool: string; // lit windows, cool light
  beacons: [number, number][]; // aviation lights on the tallest tops
}

const f = (v: number) => +v.toFixed(1);
const rect = (x: number, y: number, w: number, h: number) => `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;

export function skyline(spec: SkylineSpec, width: number): Skyline {
  const out = {
    body: [] as string[],
    sunLeft: [] as string[],
    sunRight: [] as string[],
    warm: [] as string[],
    cool: [] as string[],
    beacons: [] as [number, number][],
  };

  function building(r: () => number, x: number, w: number) {
    const between = ([a, b]: [number, number]) => a + (b - a) * r();
    const tall = r() < spec.tall;
    const h = tall ? between(spec.tallH) : between(spec.h);
    const top = spec.base - h;
    out.body.push(rect(x, top, w, LAND_H - top));
    out.sunLeft.push(rect(x, top, w * 0.3, LAND_H - top));
    out.sunRight.push(rect(x + w * 0.7, top, w * 0.3, LAND_H - top));
    let peak = top;
    const roof = r();
    if (roof < 0.22) {
      // setbacks
      const h1 = h * (0.06 + r() * 0.06);
      out.body.push(rect(x + w * 0.14, top - h1, w * 0.72, h1 + 1));
      peak = top - h1;
      if (r() < 0.5) {
        const h2 = h1 * 0.8;
        out.body.push(rect(x + w * 0.3, peak - h2, w * 0.4, h2 + 1));
        peak -= h2;
      }
    } else if (roof < 0.38) {
      // a pointed crown
      const c = h * (0.08 + r() * 0.06);
      out.body.push(
        `M${f(x + w * 0.06)} ${f(top + 1)}L${f(x + w * 0.3)} ${f(top - c * 0.5)}L${f(x + w * 0.5)} ${f(top - c)}L${f(x + w * 0.7)} ${f(top - c * 0.5)}L${f(x + w * 0.94)} ${f(top + 1)}Z`,
      );
      peak = top - c;
    } else if (roof < 0.52) {
      // a slanted top
      const s = h * 0.07;
      const left = r() < 0.5;
      out.body.push(`M${f(x)} ${f(top + 1)}L${f(x)} ${f(top - (left ? s : 0))}L${f(x + w)} ${f(top - (left ? 0 : s))}L${f(x + w)} ${f(top + 1)}Z`);
      peak = top - s;
    }
    if (tall || r() < 0.12) {
      // an antenna or mast
      const a = 14 + r() * 26;
      out.body.push(rect(x + w / 2 - 0.9, peak - a, 1.8, a + 1));
      peak -= a;
    }
    if (tall) out.beacons.push([f(x + w / 2), f(peak)]);
    // Windows: a grid over the main block, lit floor by floor at night (a few
    // floors bright, the rest mostly dark), mostly warm.
    const { cw, ch, ww, wh, p } = spec.win;
    const cols = Math.floor((w - 3) / cw);
    const rows = Math.floor((h - 6) / ch);
    const x0 = x + (w - cols * cw) / 2 + (cw - ww) / 2;
    for (let j = 0; j < rows; j++) {
      const floor = r() < 0.4 ? Math.min(0.9, p * 2.6) : p * 0.25;
      for (let i = 0; i < cols; i++) {
        if (r() >= floor) continue;
        const win = rect(x0 + i * cw, top + 5 + j * ch, ww, wh);
        (r() < 0.75 ? out.warm : out.cool).push(win);
      }
    }
  }

  function civic(cx: number) {
    // A wide domed building: base block, a central drum, dome and finial, small corner domes.
    const w = 120;
    const top = spec.base - 52;
    out.body.push(rect(cx - w / 2, top, w, LAND_H - top));
    out.body.push(rect(cx - 20, top - 16, 40, 17));
    out.body.push(`M${f(cx - 22)} ${f(top - 15)}A22 24 0 0 1 ${f(cx + 22)} ${f(top - 15)}Z`);
    out.body.push(rect(cx - 0.9, top - 50, 1.8, 12));
    for (const dx of [-w / 2 + 8, w / 2 - 8]) out.body.push(`M${f(cx + dx - 7)} ${f(top + 1)}A7 8 0 0 1 ${f(cx + dx + 7)} ${f(top + 1)}Z`);
    for (let i = 0; i < 9; i++) {
      // tall arched windows along the front
      out.warm.push(rect(cx - w / 2 + 10 + i * 12.5, top + 12, 4, 10));
    }
  }

  // Build outwards from the centre, so the middle of the skyline is the same on any screen.
  const civicX = spec.civic === undefined ? undefined : spec.civic * width;
  for (const side of [1, -1] as const) {
    const r = rng(spec.seed + (side > 0 ? 0 : 1000));
    let x = width / 2;
    while (side > 0 ? x < width + 20 : x > -20) {
      const w = spec.w[0] + (spec.w[1] - spec.w[0]) * r();
      const left = side > 0 ? x : x - w;
      if (civicX !== undefined && left < civicX + 70 && left + w > civicX - 70) {
        // leave room for the civic building
        x = side > 0 ? civicX + 72 : civicX - 72;
        continue;
      }
      building(r, left, w);
      const gap = spec.gap[0] + (spec.gap[1] - spec.gap[0]) * r();
      x = side > 0 ? left + w + gap : left - gap;
    }
  }
  if (civicX !== undefined) civic(civicX);
  return {
    body: out.body.join(''),
    sunLeft: out.sunLeft.join(''),
    sunRight: out.sunRight.join(''),
    warm: out.warm.join(''),
    cool: out.cool.join(''),
    beacons: out.beacons,
  };
}

export const SKYLINES: Record<'far' | 'near', SkylineSpec> = {
  // Distant towers in the haze: narrow, close together, small windows.
  far: { seed: 7, base: 486, h: [30, 95], tall: 0.08, tallH: [120, 175], w: [16, 38], gap: [-6, 3], win: { cw: 5, ch: 7, ww: 1.6, wh: 2.4, p: 0.16 } },
  // The nearer skyline: offices and residential blocks, a few towers, one civic dome.
  near: {
    seed: 19,
    base: GROUND_Y,
    h: [55, 165],
    tall: 0.16,
    tallH: [200, 300],
    w: [28, 66],
    gap: [4, 34],
    win: { cw: 7, ch: 9, ww: 3, wh: 4.2, p: 0.3 },
    civic: 0.3,
  },
};

// Tree canopy along the street in front of everything, and the rise the tree stands on.
export const CANOPY: RidgeSpec = {
  seed: 61,
  base: [
    [0, 566],
    [1, 562],
  ],
  amp: 22,
  scale: 70,
  octaves: 4,
  rough: 0.55,
  trees: 16,
};

// The elevated metro: a deck across the screen on pillars.
export function viaduct(width: number) {
  let d = rect(-5, DECK_Y, width + 10, DECK_H);
  for (let x = 30; x < width; x += 84) d += rect(x, DECK_Y + DECK_H, 6, LAND_H - DECK_Y - DECK_H);
  return d;
}

export function city(width: number) {
  return { far: skyline(SKYLINES.far, width), near: skyline(SKYLINES.near, width), viaduct: viaduct(width), canopy: ridgePath(CANOPY, width) };
}
