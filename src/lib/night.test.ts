import { describe, expect, it } from 'vitest';
import { driftAt, nightActive } from './night';

const base = { enabled: true, layoutAllowed: true, idleMs: 6 * 60_000, idleMinutes: 5, nightOnly: true, sunDown: true };

describe('night mode', () => {
  it('turns on after the idle time, at night', () => {
    expect(nightActive(base)).toBe(true);
    expect(nightActive({ ...base, idleMs: 4 * 60_000 })).toBe(false);
  });

  it('stays off by day when nightOnly, but not otherwise', () => {
    expect(nightActive({ ...base, sunDown: false })).toBe(false);
    expect(nightActive({ ...base, sunDown: false, nightOnly: false })).toBe(true);
  });

  it('respects enabled and the layout list', () => {
    expect(nightActive({ ...base, enabled: false })).toBe(false);
    expect(nightActive({ ...base, layoutAllowed: false })).toBe(false);
  });

  it('drifts within range, the same for a given minute, differently across minutes', () => {
    const a = driftAt(100);
    expect(driftAt(100)).toEqual(a);
    expect(Math.abs(a.x)).toBeLessThanOrEqual(24);
    expect(Math.abs(a.y)).toBeLessThanOrEqual(24);
    const offsets = new Set(Array.from({ length: 10 }, (_, i) => JSON.stringify(driftAt(i))));
    expect(offsets.size).toBeGreaterThan(5);
  });
});
