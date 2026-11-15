import { describe, expect, it } from 'vitest';
import { cleanSeries, type Pt } from './netWorth';

const DAY = 86_400_000;
const series = (vals: number[]): Pt[] => vals.map((v, i) => ({ t: Date.UTC(2026, 0, 1) + i * DAY, v }));
const wobble = (n: number, level: number) => Array.from({ length: n }, (_, i) => level + Math.round(Math.sin(i * 1.7) * 4000));

describe('cleaning a net worth series', () => {
  it('replaces a one-day drop that comes straight back with the line between its neighbours', () => {
    const vals = wobble(30, 3_000_000);
    const real = vals[14];
    vals[14] = -560_000;
    const c = cleanSeries(series(vals));
    expect(c.removed).toHaveLength(1);
    expect(c.removed[0]).toMatchObject({ v: -560_000 });
    expect(Math.abs(c.points[14].v - real)).toBeLessThan(10_000);
    expect(c.points).toHaveLength(30);
  });

  it('replaces a short run of bad days', () => {
    const vals = wobble(30, 3_000_000);
    vals[10] = 100;
    vals[11] = 200;
    vals[12] = 300;
    const c = cleanSeries(series(vals));
    expect(c.removed.map((r) => r.v)).toEqual([100, 200, 300]);
    for (const i of [10, 11, 12]) expect(c.points[i].v).toBeGreaterThan(2_900_000);
  });

  it('keeps a real change of level', () => {
    const vals = [...wobble(15, 3_000_000), ...wobble(15, 3_600_000)];
    const c = cleanSeries(series(vals));
    expect(c.removed).toEqual([]);
    expect(c.points.map((p) => p.v)).toEqual(vals);
  });

  it('keeps ordinary daily movement', () => {
    const vals = wobble(40, 1_000_000);
    expect(cleanSeries(series(vals)).removed).toEqual([]);
  });

  it('keeps a long drop (that is not a glitch) and a glitch at the very end it cannot confirm', () => {
    const vals = wobble(30, 3_000_000);
    for (let i = 10; i < 20; i++) vals[i] -= 900_000;
    expect(cleanSeries(series(vals)).removed).toEqual([]);
    const tail = wobble(30, 3_000_000);
    tail[29] = 10;
    expect(cleanSeries(series(tail)).removed).toEqual([]);
  });

  it('leaves a short series, and sorts and drops broken points', () => {
    const short = series([1, 2, 3]);
    expect(cleanSeries(short).points).toEqual(short);
    const c = cleanSeries([...series(wobble(20, 100_000))].reverse().concat([{ t: NaN, v: 5 }]));
    expect(c.points[0].t).toBeLessThan(c.points[1].t);
    expect(c.points).toHaveLength(20);
  });
});
