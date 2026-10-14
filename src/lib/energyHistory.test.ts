import { describe, expect, it } from 'vitest';
import { averageKwh, dailyKwh } from './energyHistory';

const DAY = 86_400_000;
const d0 = Date.parse('2026-10-10T00:00:00Z');

describe('daily kWh from mean power statistics', () => {
  it('converts mean watts over a day to kWh and splices the newer sensor in', () => {
    const legacy = [0, 1, 2].map((i) => ({ start: d0 + i * DAY, mean: 2000 }));
    const total = [{ start: d0 + 2 * DAY, mean: 1500 }];
    const days = dailyKwh(total, legacy, d0 + 5 * DAY);
    expect(days.map((d) => d.kwh)).toEqual([48, 48, 36]); // 2000 W × 24 h, then the newer sensor's 1500 W
    expect(days.every((d) => !d.partial)).toBe(true);
  });

  it('counts only elapsed hours for today and leaves it out of the average', () => {
    const now = d0 + 6 * 3_600_000; // 06:00 on day 0
    const days = dailyKwh([{ start: d0, mean: 1000 }], [{ start: d0 - DAY, mean: 2000 }], now);
    expect(days[1]).toEqual({ start: d0, kwh: 6, partial: true });
    expect(averageKwh(days)).toBe(48);
  });

  it('skips missing means', () => {
    expect(dailyKwh([{ start: d0 }], [], d0 + 2 * DAY)).toEqual([]);
    expect(averageKwh([])).toBeUndefined();
  });
});
