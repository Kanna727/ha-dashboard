import { describe, expect, it } from 'vitest';
import { chartStart, purifierSummary, targetRange } from './purifier';

const noFaults = [
  { name: 'No water', on: false },
  { name: 'Filter choked', on: false },
];

describe('purifier target range', () => {
  it('parses TasteTune modes', () => {
    expect(targetRange('TasteTune 50-100 ppm')).toEqual({ min: 50, max: 100 });
    expect(targetRange('TasteTune 100-150 ppm')).toEqual({ min: 100, max: 150 });
  });

  it('has no range for the other modes', () => {
    expect(targetRange('RO only')).toBeUndefined();
    expect(targetRange('Adaptive')).toBeUndefined();
    expect(targetRange('Vacation')).toBeUndefined();
    expect(targetRange(undefined)).toBeUndefined();
  });
});

describe('purifier chart start', () => {
  const now = Date.parse('2026-10-15T01:00:00Z');
  const H = 3_600_000;

  it('starts at the first reading when history is shorter than the window', () => {
    expect(chartStart([{ t: now - 2 * H }], 168, now)).toBe(now - 2 * H);
  });

  it('uses the full window when history covers it', () => {
    expect(chartStart([{ t: now - 168 * H }, { t: now - H }], 168, now)).toBeUndefined();
    expect(chartStart([], 168, now)).toBeUndefined();
  });

  it('keeps at least a minute of width for a reading taken just now', () => {
    expect(chartStart([{ t: now }], 168, now)).toBe(now - 60_000);
  });
});

describe('purifier summary', () => {
  it('works out how much was removed and whether the tank is in range', () => {
    const s = purifierSummary({ tankTds: 85.42, inputTds: 247.19, mode: 'TasteTune 50-100 ppm', faults: noFaults });
    expect(s.removedPct).toBe(65);
    expect(s.inRange).toBe('ok');
    expect(s.activeFaults).toEqual([]);
    expect(s.text).toBe('Water 85 ppm');
  });

  it('flags readings outside the target', () => {
    expect(purifierSummary({ tankTds: 120, mode: 'TasteTune 50-100 ppm', faults: [] }).inRange).toBe('high');
    expect(purifierSummary({ tankTds: 30, mode: 'TasteTune 50-100 ppm', faults: [] }).inRange).toBe('low');
    expect(purifierSummary({ tankTds: 30, mode: 'RO only', faults: [] }).inRange).toBeUndefined();
  });

  it('copes with missing readings', () => {
    const s = purifierSummary({ faults: [] });
    expect(s.removedPct).toBeUndefined();
    expect(s.inRange).toBeUndefined();
    expect(s.text).toBe('Purifier');
    expect(purifierSummary({ tankTds: 80, inputTds: 0, faults: [] }).removedPct).toBeUndefined();
  });

  it('keeps the removed share within 0-100', () => {
    expect(purifierSummary({ tankTds: 300, inputTds: 250, faults: [] }).removedPct).toBe(0);
  });

  it('puts faults first, in config order', () => {
    const s = purifierSummary({
      tankTds: 85,
      faults: [
        { name: 'No water', on: true },
        { name: 'Filter choked', on: false },
        { name: 'Valve fault', on: true },
      ],
    });
    expect(s.activeFaults).toEqual(['No water', 'Valve fault']);
    expect(s.text).toBe('Purifier: No water +1');
  });
});
