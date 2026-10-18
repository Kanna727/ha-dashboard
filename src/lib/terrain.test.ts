import { describe, expect, it } from 'vitest';
import { fractal, LAND_H, ridgePath, RISE, TREE_Y } from './terrain';

// The top edge of a ridge path as [x, y] points.
const edge = (d: string) =>
  d
    .slice(d.indexOf('L') + 1, d.lastIndexOf('L'))
    .split('L')
    .map((p) => p.split(' ').map(Number) as [number, number]);

describe('terrain', () => {
  it('keeps fractal noise in 0–1 and repeatable', () => {
    const xs = Array.from({ length: 200 }, (_, i) => fractal(i * 0.37, 5, 5, 0.5));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1);
    expect(fractal(3.3, 5, 5, 0.5)).toBe(fractal(3.3, 5, 5, 0.5));
  });

  it('closes each ridge along the bottom, spanning the width', () => {
    const d = ridgePath(RISE, 1200);
    expect(d.startsWith(`M0 ${LAND_H}L0 `)).toBe(true);
    expect(d.endsWith(`L1200 ${LAND_H}Z`)).toBe(true);
  });

  it('raises the ground under the tree at the right edge', () => {
    const rise = edge(ridgePath(RISE, 1600));
    const at = (x: number) => rise.find(([px]) => px >= x)![1];
    expect(Math.abs(at(1599) - TREE_Y)).toBeLessThan(25);
    expect(at(800)).toBeGreaterThan(LAND_H); // nothing in the middle
  });

  it('keeps the middle the same on any screen width', () => {
    const spec = {
      ...RISE,
      base: [
        [0, 500],
        [1, 500],
      ] as [number, number][],
    };
    const mid = (w: number) => edge(ridgePath(spec, w)).find(([x]) => x >= w / 2)![1];
    expect(mid(600)).toBeCloseTo(mid(2000), 0);
  });
});
