import { describe, expect, it } from 'vitest';
import { city, DECK_Y, GROUND_Y, skyline, SKYLINES } from './city';
import { LAND_H } from './terrain';

const numbers = (d: string) => [...d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));

describe('city skyline', () => {
  it('is the same skyline for the same width', () => {
    expect(city(1600)).toEqual(city(1600));
  });

  it('fills the width with buildings standing to the bottom of the box', () => {
    const near = skyline(SKYLINES.near, 1600);
    const xs = [...near.body.matchAll(/M(-?[\d.]+) /g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(1550);
    // every block runs down to the bottom of the box
    const blocks = [...near.body.matchAll(/M-?[\d.]+ (-?[\d.]+)h-?[\d.]+v(-?[\d.]+)/g)];
    expect(blocks.some(([, y, h]) => Math.abs(Number(y) + Number(h) - LAND_H) < 0.2)).toBe(true);
  });

  it('gives the towers aviation lights at their tops, above the street', () => {
    const near = skyline(SKYLINES.near, 1600);
    expect(near.beacons.length).toBeGreaterThan(0);
    for (const [, y] of near.beacons) expect(y).toBeLessThan(GROUND_Y - SKYLINES.near.tallH[0]);
  });

  it('lights some windows, mostly warm, grouped by floor', () => {
    const near = skyline(SKYLINES.near, 1600);
    const warm = near.warm.split('M').length - 1;
    const cool = near.cool.split('M').length - 1;
    expect(warm).toBeGreaterThan(cool);
    expect(warm + cool).toBeGreaterThan(100);
  });

  it('keeps the far skyline lower than the towers in front', () => {
    const far = skyline(SKYLINES.far, 1600);
    const near = skyline(SKYLINES.near, 1600);
    const top = (d: string) => Math.min(...numbers(d).filter((_, i) => i % 2 === 1 && _ > 0));
    expect(Math.min(...far.beacons.map(([, y]) => y), 1e9)).toBeGreaterThan(Math.min(...near.beacons.map(([, y]) => y)));
    expect(top(far.body)).toBeGreaterThan(0);
  });

  it('runs the metro deck across the screen on pillars', () => {
    const { viaduct } = city(1200);
    expect(viaduct.startsWith(`M-5 ${DECK_Y}`)).toBe(true);
    expect(viaduct.split('M').length - 1).toBeGreaterThan(10);
  });

  it('keeps the middle of the skyline the same on any screen width', () => {
    // The first buildings right of the centre, relative to it.
    const right = (w: number) =>
      [...skyline(SKYLINES.near, w).body.matchAll(/M(-?[\d.]+) (-?[\d.]+)h/g)]
        .map(([, x, y]) => [Math.round(Number(x) - w / 2), Math.round(Number(y))] as const)
        .filter(([x]) => x >= 0 && x < 300)
        .map((p) => p.join());
    expect(right(800)).toEqual(right(2000));
    expect(right(800).length).toBeGreaterThan(3);
  });
});
