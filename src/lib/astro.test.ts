import { describe, expect, it } from 'vitest';
import { modelBody, moonPosition, sunPosition, toScreen } from './astro';

// Reference values from SunCalc's own tests (2013-03-05 00:00 UTC, 50.5° N 30.5° E).
const DATE = Date.UTC(2013, 2, 5);

describe('astronomy', () => {
  it('places the sun', () => {
    const s = sunPosition(DATE, 50.5, 30.5);
    expect(s.azimuth).toBeCloseTo(36.74, 1); // −2.5003 rad from south
    expect(s.altitude).toBeCloseTo(-40.11, 1); // −0.7000 rad
  });

  it('places the moon (unrefracted, within a degree)', () => {
    const m = moonPosition(DATE, 50.5, 30.5);
    expect(Math.abs(m.azimuth - 123.94)).toBeLessThan(1); // −0.9784 rad from south
    expect(Math.abs(m.altitude - 0.45)).toBeLessThan(1);
  });

  it('models a plain day: east at 06:00, south and high at noon, west at 18:00', () => {
    expect(modelBody(6)).toMatchObject({ azimuth: 90 });
    expect(modelBody(12).azimuth).toBe(180);
    expect(modelBody(12).altitude).toBeCloseTo(70);
    expect(modelBody(18).azimuth).toBe(270);
    expect(modelBody(0).altitude).toBeCloseTo(-50);
  });

  it('maps east to the right of the page and west to the left', () => {
    expect(toScreen({ altitude: 0, azimuth: 90 }).x).toBeGreaterThan(0.9);
    expect(toScreen({ altitude: 0, azimuth: 270 }).x).toBeLessThan(0.1);
    expect(toScreen({ altitude: 90, azimuth: 180 }).y).toBeLessThan(0.15);
    expect(toScreen({ altitude: -10, azimuth: 180 }).y).toBeGreaterThan(1);
  });
});
