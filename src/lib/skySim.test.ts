import { describe, expect, it } from 'vitest';
import { fmtHour, moonName, simSun } from './skySim';
import { skyScene } from './skyScene';

const BASE = new Date(2026, 9, 18, 15, 0);

describe('simulated sun', () => {
  it('peaks at noon and bottoms out at midnight', () => {
    expect(simSun(12, BASE).sun.elevation).toBeCloseTo(70);
    expect(simSun(0, BASE).sun.elevation).toBeCloseTo(-50);
    expect(simSun(6, BASE).sun.elevation).toBeCloseTo(0);
    expect(simSun(18, BASE).sun.elevation).toBeCloseTo(0);
  });

  it('is up between 06:00 and 18:00, rising until noon', () => {
    expect(simSun(9, BASE).sun).toMatchObject({ aboveHorizon: true, rising: true });
    expect(simSun(15, BASE).sun).toMatchObject({ aboveHorizon: true, rising: false });
    expect(simSun(21, BASE).sun).toMatchObject({ aboveHorizon: false, rising: false });
    expect(simSun(3, BASE).sun).toMatchObject({ aboveHorizon: false, rising: true });
  });

  it('gives rise/set times that put the sun on its arc', () => {
    const noon = simSun(12, BASE);
    expect(skyScene({ sun: noon.sun, now: noon.now, condition: 'sunny' }).x).toBeCloseTo(0.5, 2);
    const midnight = simSun(0, BASE);
    expect(skyScene({ sun: midnight.sun, now: midnight.now, condition: 'clear-night' }).x).toBeCloseTo(0.5, 2);
    const evening = simSun(17.5, BASE);
    expect(skyScene({ sun: evening.sun, now: evening.now, condition: 'sunny' }).x).toBeLessThan(0.15);
  });

  it('wraps hours and formats them', () => {
    expect(simSun(25, BASE).now).toBe(simSun(1, BASE).now);
    expect(fmtHour(6.5)).toBe('06:30');
    expect(fmtHour(23.99)).toBe('23:59');
  });

  it('names moon phases', () => {
    expect(moonName(0)).toBe('new moon');
    expect(moonName(0.5)).toBe('full moon');
    expect(moonName(0.1)).toBe('waxing crescent');
    expect(moonName(0.65)).toBe('waning gibbous');
  });
});
