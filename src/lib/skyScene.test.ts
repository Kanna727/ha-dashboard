import { describe, expect, it } from 'vitest';
import { clearSky, kindOf, luminance, skyScene, sunAt, windKmh, type SkyInput } from './skyScene';

const NOW = Date.parse('2026-10-14T06:35:00Z');
const day = (elevation: number, rising = true) => ({ aboveHorizon: elevation >= 0, elevation, rising });
const rgb = (s: string) => s.match(/\d+/g)!.map(Number) as [number, number, number];
const scene = (sun: SkyInput['sun'], condition?: string, extra: Partial<SkyInput> = {}) => skyScene({ sun, now: NOW, condition, ...extra });

describe('sky colours', () => {
  it('is blue at midday and near black at night', () => {
    const [r, , b] = clearSky(50, true).top;
    expect(b).toBeGreaterThan(r * 2);
    expect(luminance(clearSky(-30, false).top)).toBeLessThan(0.03);
  });

  it('glows warm at the horizon around sunrise and sunset', () => {
    const [r, , b] = clearSky(1, true).low;
    expect(r).toBeGreaterThan(b);
  });

  it('runs redder at dusk than at dawn', () => {
    expect(clearSky(0, false).low[1]).toBeLessThan(clearSky(0, true).low[1]);
  });

  it('interpolates between stops', () => {
    const a = luminance(clearSky(-4, true).top);
    const b = luminance(clearSky(0, true).top);
    const mid = luminance(clearSky(-2, true).top);
    expect(mid).toBeGreaterThan(a);
    expect(mid).toBeLessThan(b);
  });

  it('lights cloud tops warm at sunset and white at noon', () => {
    const [r, g, b] = clearSky(0, false).lit;
    expect(r).toBeGreaterThan(b + 60);
    expect(g).toBeLessThan(r);
    expect(clearSky(40, true).lit).toEqual([255, 255, 255]);
  });
});

describe('sky scene', () => {
  it('maps conditions, defaulting to partly cloudy', () => {
    expect(kindOf('pouring')).toBe('rain');
    expect(kindOf('clear-night')).toBe('clear');
    expect(kindOf(undefined)).toBe('partly');
    expect(kindOf('exceptional')).toBe('partly');
  });

  it('shows stars on a clear night and hides them under cloud', () => {
    expect(scene(day(-30, false), 'clear-night', { moonPhase: 0 }).stars).toBe(1);
    expect(scene(day(-30, false), 'cloudy').stars).toBeLessThan(0.2);
    expect(scene(day(30), 'sunny').stars).toBe(0);
  });

  it('dulls and darkens the sky in rain', () => {
    const clear = scene(day(30), 'sunny');
    const rain = scene(day(30), 'rainy');
    expect(luminance(rgb(rain.top))).toBeLessThan(luminance(rgb(clear.top)));
    expect(rain.sun).toBeLessThan(0.3);
    expect(rain.disc).toBe(0);
    expect(clear.disc).toBe(1);
    expect(rain.cloud.litAlpha).toBeLessThan(clear.cloud.litAlpha);
    expect(scene(day(30), 'pouring').heavy).toBe(true);
  });

  it('lights the horizon around sunset only', () => {
    expect(scene(day(1, false), 'sunny').horizon).toBe(1);
    expect(scene(day(40), 'sunny').horizon).toBe(0);
    expect(scene(day(-25, false), 'sunny').horizon).toBe(0);
  });

  it('uses the measured cloud cover, in steps of 0.1', () => {
    expect(scene(day(30), 'partlycloudy', { coverage: 12 }).clouds).toBe(0.1);
    expect(scene(day(30), 'partlycloudy').clouds).toBe(0.5);
    expect(scene(day(30), 'rainy', { coverage: 10 }).clouds).toBe(1);
  });

  it('puts the sun on the right in the morning and the left in the evening', () => {
    const morning = scene({ ...day(10), azimuth: 100 }, 'sunny');
    const noon = scene({ ...day(70), azimuth: 180 }, 'sunny');
    const evening = scene({ ...day(5, false), azimuth: 260 }, 'sunny');
    expect(morning.x).toBeGreaterThan(0.85);
    expect(noon.x).toBeCloseTo(0.5, 2);
    expect(noon.y).toBeLessThan(0.2);
    expect(evening.x).toBeLessThan(0.15);
  });

  it('falls back to the rise/set times without an azimuth (still right to left)', () => {
    const sun = { aboveHorizon: true, elevation: 20, nextRising: '2026-10-15T00:40:00Z', nextSetting: '2026-10-14T12:30:00Z' };
    expect(skyScene({ sun, now: Date.parse('2026-10-14T02:00:00Z') }).x).toBeGreaterThan(0.6);
    expect(skyScene({ sun, now: Date.parse('2026-10-14T11:30:00Z') }).x).toBeLessThan(0.4);
  });
});

describe('moon', () => {
  it('trails the sun by its phase without a location', () => {
    // Full moon at midnight: opposite the sun, so high in the sky.
    const full = scene({ ...day(-50, true), azimuth: 0 }, 'clear-night', { moonPhase: 0.5, modelMoon: true, now: NOW });
    expect(full.moon.opacity).toBeGreaterThan(0.9);
    expect(full.moon.y).toBeLessThan(0.3);
    expect(full.moon.glow).toBeGreaterThan(0.9);
    // New moon: with the sun, below the horizon at midnight.
    expect(scene({ ...day(-50, true), azimuth: 0 }, 'clear-night', { moonPhase: 0, modelMoon: true }).moon.opacity).toBe(0);
  });

  it('turns the lit side towards the sun', () => {
    // Evening crescent: the sun has set on the left, so the lit limb points left/down.
    const s = scene({ aboveHorizon: false, elevation: -8, azimuth: 255, rising: false }, 'clear-night', {
      moonPhase: 0.15,
      modelMoon: true,
    });
    expect(Math.abs(s.moon.angle)).toBeGreaterThan(90);
  });

  it('lights night clouds by the moon', () => {
    const night = { aboveHorizon: false, elevation: -40, azimuth: 0, rising: true };
    const full = scene(night, 'partlycloudy', { moonPhase: 0.5, modelMoon: true });
    const none = scene(night, 'partlycloudy', { moonPhase: 0, modelMoon: true });
    expect(full.cloud.litAlpha).toBeGreaterThan(none.cloud.litAlpha * 3);
  });
});

describe('wind and moisture', () => {
  it('converts wind units', () => {
    expect(windKmh(10, 'm/s')).toBeCloseTo(36);
    expect(windKmh(10)).toBe(10);
    expect(windKmh(10, 'mph')).toBeCloseTo(16.09, 1);
  });

  it('blows towards the side opposite the bearing (east on the right)', () => {
    expect(scene(day(30), 'windy', { wind: 30, windBearing: 270 }).wind.dir).toBe(1); // westerly → blows right
    expect(scene(day(30), 'windy', { wind: 30, windBearing: 90 }).wind.dir).toBe(-1);
    expect(scene(day(30), 'windy', { wind: 60 }).wind.level).toBe(1);
  });

  it('hazes only in wet weather, and beads up with humidity and rain', () => {
    expect(scene(day(30), 'sunny', { humidity: 40 }).haze).toBe(0);
    expect(scene(day(30), 'sunny', { humidity: 40 }).dew).toBe(0);
    expect(scene(day(30), 'sunny', { humidity: 95 }).haze).toBe(0);
    expect(scene(day(30), 'rainy', { humidity: 95 }).haze).toBeGreaterThan(0.8);
    expect(scene(day(30), 'sunny', { humidity: 95 }).dew).toBeGreaterThan(0.7);
    expect(scene(day(30), 'rainy', { humidity: 70 }).dew).toBeGreaterThan(0.2);
  });
});

describe('sun position fallback', () => {
  it('estimates elevation from the rise/set times when HA gives none', () => {
    const noon = sunAt({ aboveHorizon: true, nextRising: '2026-10-15T00:40:00Z', nextSetting: '2026-10-14T12:30:00Z' }, NOW);
    expect(noon.elevation).toBeCloseTo(60, 0);
    expect(noon.hour).toBeCloseTo(12, 1);
    const justSet = sunAt({ aboveHorizon: false, nextRising: '2026-10-15T00:40:00Z', nextSetting: '2026-10-15T12:30:00Z' }, Date.parse('2026-10-14T12:40:00Z'));
    expect(justSet.elevation).toBeLessThan(0);
    expect(justSet.elevation).toBeGreaterThan(-5);
    expect(justSet.rising).toBe(false);
  });

  it('prefers the sun.sun attributes', () => {
    expect(sunAt({ aboveHorizon: true, elevation: 12, rising: false, azimuth: 250 }, NOW)).toMatchObject({ elevation: 12, rising: false, azimuth: 250 });
  });
});

describe('city colours', () => {
  it('fades the layers into the sky with distance', () => {
    const { land } = scene(day(30), 'sunny');
    const l = (c: string) => luminance(rgb(c));
    expect(l(land.far)).toBeGreaterThan(l(land.mid));
    expect(l(land.mid)).toBeGreaterThan(l(land.hills));
    expect(l(land.hills)).toBeGreaterThan(l(land.fore));
  });

  it('keeps the land darker than the sky at night', () => {
    const s = scene(day(-30, false), 'clear-night');
    expect(luminance(rgb(s.land.far))).toBeLessThan(luminance(rgb(s.low)));
  });
});
