import { describe, expect, it } from 'vitest';
import { bucketStart, driveBuckets, driveSummary, nextBucket } from './driveHistory';

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

describe('bucketStart / nextBucket', () => {
  it('starts days at midnight, weeks on Monday and months on the 1st', () => {
    const t = at(2026, 10, 22, 15); // Thursday
    expect(bucketStart(t, 'day')).toBe(at(2026, 10, 22));
    expect(bucketStart(t, 'week')).toBe(at(2026, 10, 19));
    expect(bucketStart(at(2026, 10, 18, 9), 'week')).toBe(at(2026, 10, 12)); // Sunday belongs to the week before
    expect(bucketStart(t, 'month')).toBe(at(2026, 10, 1));
    expect(nextBucket(at(2026, 12, 1), 'month')).toBe(at(2027, 1, 1));
  });
});

describe('driveBuckets', () => {
  const now = at(2026, 10, 20, 18);
  const km = [
    { start: at(2026, 10, 17), change: 12 },
    { start: at(2026, 10, 17, 5), change: 3 }, // hourly-ish rows add up into the day
    { start: at(2026, 10, 19), change: 40 },
    { start: at(2026, 10, 20), change: -2 }, // a correction never subtracts
  ];
  const trips = [{ start: at(2026, 10, 19), change: 3 }];

  it('fills every day from the first data to today, marks today as running', () => {
    const b = driveBuckets('day', now, km, trips, undefined, 30);
    expect(b.every((x) => x.incomplete.length === 0)).toBe(true); // days are never cut by a sensor's start
    expect(b.map((x) => [new Date(x.start).getDate(), x.km, x.trips, x.partial])).toEqual([
      [17, 15, undefined, false], // before the trips sensor existed
      [18, 0, undefined, false],
      [19, 40, 3, false],
      [20, 0, 0, true],
    ]);
    expect(b.every((x) => x.minutes === undefined)).toBe(true);
  });

  it('caps the number of buckets and sums weeks and months', () => {
    expect(driveBuckets('day', now, km, undefined, undefined, 2).map((x) => new Date(x.start).getDate())).toEqual([19, 20]);
    const w = driveBuckets('week', now, km);
    expect(w.map((x) => [new Date(x.start).getDate(), x.km])).toEqual([
      [12, 15],
      [19, 40],
    ]);
    expect(driveBuckets('month', now, km).map((x) => x.km)).toEqual([55]);
  });

  it('marks the week or month a sensor started in as incomplete', () => {
    // km began on Saturday 17 Oct (mid-week); trips on Monday 19 Oct, a week's first day.
    const w = driveBuckets('week', now, km, trips);
    expect(w.map((x) => x.incomplete)).toEqual([['km'], []]);
    expect(driveSummary(w, 'km').average).toBeUndefined(); // the only finished week started part-way
    const m = driveBuckets('month', now, km, trips);
    expect(m[0].incomplete).toEqual(['km', 'trips']);
  });

  it('is empty without distance data', () => {
    expect(driveBuckets('day', now, [], trips)).toEqual([]);
  });
});

describe('driveSummary', () => {
  it('totals, averages complete buckets and finds the busiest', () => {
    const b = driveBuckets('day', at(2026, 10, 20, 18), [
      { start: at(2026, 10, 18), change: 10 },
      { start: at(2026, 10, 19), change: 30 },
      { start: at(2026, 10, 20), change: 50 },
    ]);
    const s = driveSummary(b, 'km');
    expect(s.total).toBe(90);
    expect(s.average).toBe(20); // today is still running, so it's left out
    expect(new Date(s.best!.start).getDate()).toBe(20);
    expect(driveSummary(b, 'trips')).toEqual({ total: 0, average: undefined, best: undefined });
  });
});
