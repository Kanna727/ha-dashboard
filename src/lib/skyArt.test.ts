import { describe, expect, it } from 'vitest';
import { boltPaths, cloudSvg, planStrike } from './skyArt';
import { rng } from './tree';

const TILE = { w: 1600, h: 640, freq: [0.002, 0.005] as [number, number], octaves: 4, seed: 7, cover: 0.5, fade: 0.4 };
const decode = (uri: string) => decodeURIComponent(uri.slice('url("data:image/svg+xml,'.length, -2));

describe('cloud tiles', () => {
  it('builds a seamless fractal-noise mask', () => {
    const svg = decode(cloudSvg(TILE, 'shape'));
    expect(svg).toContain("stitchTiles='stitch'");
    expect(svg).toContain("width='1600'");
    expect(svg).not.toContain('feDiffuseLighting');
  });

  it('lowers the threshold as the cover grows', () => {
    const offset = (cover: number) => Number(decode(cloudSvg({ ...TILE, cover }, 'shape')).match(/ 7 0 0 0 (-[\d.]+)/)![1]);
    expect(offset(1)).toBeGreaterThan(offset(0.2));
  });

  it('lights the lit mask from the given direction', () => {
    expect(decode(cloudSvg(TILE, 'lit', 210))).toContain("azimuth='210'");
  });
});

describe('lightning', () => {
  it('runs a bolt from the top down, with forks, stable for a seed', () => {
    const a = boltPaths(3);
    expect(a.main.startsWith('M50.0 0.0')).toBe(true);
    expect(a.forks.length).toBeGreaterThanOrEqual(2);
    expect(boltPaths(3)).toEqual(a);
    expect(boltPaths(11).main).not.toBe(a.main);
    const ys = [...a.main.matchAll(/[\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys.every((y, i) => i === 0 || y > ys[i - 1])).toBe(true);
    expect(ys[ys.length - 1]).toBeGreaterThan(79);
  });

  it('plans strikes all across the page, with 1–3 flickers and bursts', () => {
    const r = rng(42);
    const strikes = Array.from({ length: 200 }, () => planStrike(r));
    const xs = strikes.map((s) => s.x);
    expect(Math.min(...xs)).toBeLessThan(0.2);
    expect(Math.max(...xs)).toBeGreaterThan(0.8);
    expect(strikes.some((s) => !s.bolt)).toBe(true); // in-cloud flashes
    for (const s of strikes) {
      const offsets = s.flicker.map((f) => f.offset);
      expect(offsets[0]).toBe(0);
      expect(offsets[offsets.length - 1]).toBe(1);
      expect(offsets.every((o, i) => i === 0 || o >= offsets[i - 1])).toBe(true);
      expect(s.next).toBeGreaterThanOrEqual(700);
      expect(s.next).toBeLessThanOrEqual(5000);
    }
    const mean = strikes.reduce((t, s) => t + s.next, 0) / strikes.length;
    expect(mean).toBeLessThan(2500);
  });
});
