import { describe, expect, it } from 'vitest';
import { arcPoint, moonIllumination, moonLitPath, moonPhase, skyProgress, skyWindow, sunTimes } from './sky';

describe('sky window', () => {
  it('runs sunrise → sunset by day, using next_rising − 24 h', () => {
    const w = skyWindow(true, '2026-10-15T00:40:00Z', '2026-10-14T12:30:00Z')!;
    expect(w.body).toBe('sun');
    expect(new Date(w.start).toISOString()).toBe('2026-10-14T00:40:00.000Z');
    expect(skyProgress(w, Date.parse('2026-10-14T06:35:00Z'))).toBeCloseTo(0.5, 2);
  });

  it('runs sunset → sunrise by night, using next_setting − 24 h', () => {
    const w = skyWindow(false, '2026-10-15T00:40:00Z', '2026-10-15T12:30:00Z')!;
    expect(w.body).toBe('moon');
    expect(new Date(w.start).toISOString()).toBe('2026-10-14T12:30:00.000Z');
    expect(skyProgress(w, Date.parse('2026-10-14T12:30:00Z'))).toBe(0);
    expect(skyProgress(w, Date.parse('2026-10-15T03:00:00Z'))).toBe(1); // clamped after sunrise
  });

  it('is undefined without sun data', () => {
    expect(skyWindow(true, undefined, '2026-10-14T12:30:00Z')).toBeUndefined();
  });

  it('puts the body at the top of the arc at mid-progress', () => {
    expect(arcPoint(0, 10, 290, 60, 50)).toEqual({ x: 10, y: 60 });
    const mid = arcPoint(0.5, 10, 290, 60, 50);
    expect(mid.x).toBe(150);
    expect(mid.y).toBeCloseTo(10);
  });
});

describe('moon phase', () => {
  it('matches known new and full moons', () => {
    expect(moonPhase(Date.UTC(2024, 0, 11, 11, 57))).toBeLessThan(0.02); // new moon
    expect(Math.abs(moonPhase(Date.UTC(2024, 0, 25, 17, 54)) - 0.5)).toBeLessThan(0.02); // full moon
    expect(Math.abs(moonPhase(Date.UTC(2024, 0, 18, 3, 53)) - 0.25)).toBeLessThan(0.02); // first quarter
  });

  it('lights the disc from 0 to 1 and back', () => {
    expect(moonIllumination(0)).toBeCloseTo(0);
    expect(moonIllumination(0.25)).toBeCloseTo(0.5);
    expect(moonIllumination(0.5)).toBeCloseTo(1);
  });

  it('draws the lit side on the right while waxing and left while waning', () => {
    expect(moonLitPath(50, 50, 10, 0.2)).toContain('A 10 10 0 0 1'); // waxing: outer arc via the right
    expect(moonLitPath(50, 50, 10, 0.8)).toContain('A 10 10 0 0 0'); // waning: via the left
  });
});

describe('sun times', () => {
  it('gives sunrise then sunset by day', () => {
    const t = sunTimes(true, '2026-10-15T00:40:00Z', '2026-10-14T12:30:00Z');
    expect(t.map((x) => x.kind)).toEqual(['sunrise', 'sunset']);
    expect(new Date(t[0].at).toISOString()).toBe('2026-10-14T00:40:00.000Z');
    expect(new Date(t[1].at).toISOString()).toBe('2026-10-14T12:30:00.000Z');
  });

  it("gives this evening's sunset then tomorrow's sunrise at night", () => {
    const t = sunTimes(false, '2026-10-15T00:40:00Z', '2026-10-15T12:30:00Z');
    expect(t.map((x) => x.kind)).toEqual(['sunset', 'sunrise']);
    expect(new Date(t[0].at).toISOString()).toBe('2026-10-14T12:30:00.000Z');
  });

  it('gives nothing without times', () => {
    expect(sunTimes(true)).toEqual([]);
  });
});
