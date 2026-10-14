import { describe, expect, it } from 'vitest';
import { rainSoon, rainText } from './rain';
import type { ForecastDay } from '../ha/api';

const H = 3_600_000;
const now = Date.parse('2026-10-14T13:20:00Z');
const slot = (hoursFromNowHour: number, condition: string, extra: Partial<ForecastDay> = {}): ForecastDay => ({
  datetime: new Date(Date.parse('2026-10-14T13:00:00Z') + hoursFromNowHour * H).toISOString(),
  condition,
  temperature: 25,
  ...extra,
});

describe('rain nudge', () => {
  it('finds the first wet slot within 3 hours', () => {
    const hourly = [slot(0, 'cloudy'), slot(1, 'cloudy'), slot(2, 'rainy'), slot(3, 'pouring')];
    expect(rainSoon(hourly, 'cloudy', now)).toBe(Date.parse('2026-10-14T15:00:00Z'));
  });

  it('counts precipitation amount or probability as wet', () => {
    expect(rainSoon([slot(1, 'cloudy', { precipitation: 0.6 })], 'cloudy', now)).not.toBeNull();
    expect(rainSoon([slot(1, 'cloudy', { precipitation_probability: 70 })], 'cloudy', now)).not.toBeNull();
    expect(rainSoon([slot(1, 'cloudy', { precipitation: 0.1, precipitation_probability: 20 })], 'cloudy', now)).toBeNull();
  });

  it('stays quiet when it is already raining or rain is further out', () => {
    expect(rainSoon([slot(1, 'rainy')], 'rainy', now)).toBeNull();
    expect(rainSoon([slot(4, 'rainy')], 'sunny', now)).toBeNull();
  });

  it('counts the current hour and words it as soon', () => {
    const at = rainSoon([slot(0, 'rainy')], 'partlycloudy', now)!;
    expect(at).toBeLessThanOrEqual(now);
    expect(rainText(at, now)).toBe('Rain likely soon');
    expect(rainText(now + 2 * H, now)).toMatch(/^Rain likely around /);
  });
});
