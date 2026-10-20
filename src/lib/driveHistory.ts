// Driving history for the car popup's chart: km, trips and drive time per day,
// week or month, from the long-term statistics "change" of total_increasing
// sensors (the odometer; the trips/drive-time "today" counters). Always fed
// daily rows: HA's own week/month rows start at the period's start even when
// the sensor began mid-way, which would hide that the period is incomplete.
// Pure, unit-tested; times are local, weeks start on Monday.

export type DrivePeriod = 'day' | 'week' | 'month';

export interface StatChangeLike {
  start: number;
  change: number;
}

export interface DriveBucket {
  start: number; // epoch ms, local start of the day/week/month
  km: number;
  trips?: number; // undefined before the sensor existed
  minutes?: number;
  partial: boolean; // the bucket that's still running
  incomplete: DriveMetric[]; // metrics whose sensor started part-way through this bucket
}

// How many buckets each view shows; one fetch of DRIVE_DAYS daily rows covers all three.
export const DRIVE_RANGE: Record<DrivePeriod, { count: number }> = {
  day: { count: 30 },
  week: { count: 26 },
  month: { count: 24 },
};
export const DRIVE_DAYS = 24 * 31 + 31;

export function bucketStart(t: number, period: DrivePeriod): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  if (period === 'month') d.setDate(1);
  return d.getTime();
}

export function nextBucket(start: number, period: DrivePeriod): number {
  const d = new Date(start);
  if (period === 'day') d.setDate(d.getDate() + 1);
  else if (period === 'week') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

function sumBy(series: StatChangeLike[] | undefined, period: DrivePeriod): Map<number, number> | undefined {
  if (!series?.length) return undefined;
  const m = new Map<number, number>();
  for (const s of series) {
    const k = bucketStart(s.start, period);
    // A meter reset or a correction can show as a negative change; ignore it.
    m.set(k, (m.get(k) ?? 0) + Math.max(0, s.change));
  }
  return m;
}

// The last `count` buckets up to now, starting no earlier than the first
// distance data (so a car added recently doesn't show months of empty bars).
export function driveBuckets(
  period: DrivePeriod,
  now: number,
  km: StatChangeLike[] | undefined,
  trips?: StatChangeLike[],
  minutes?: StatChangeLike[],
  count = DRIVE_RANGE[period].count,
): DriveBucket[] {
  const kmBy = sumBy(km, period);
  if (!kmBy) return [];
  const tripsBy = sumBy(trips, period);
  const minBy = sumBy(minutes, period);
  const firstKm = Math.min(...kmBy.keys());
  const firstTrips = tripsBy ? Math.min(...tripsBy.keys()) : Infinity;
  const firstMin = minBy ? Math.min(...minBy.keys()) : Infinity;
  // The first daily row of each series: a bucket that starts before it is incomplete.
  const firstRow = (s?: StatChangeLike[]) => (s?.length ? Math.min(...s.map((r) => bucketStart(r.start, 'day'))) : Infinity);
  const rows: Record<DriveMetric, number> = { km: firstRow(km), trips: firstRow(trips), minutes: firstRow(minutes) };

  const current = bucketStart(now, period);
  const starts: number[] = [current];
  while (starts.length < count) {
    const d = new Date(starts[0]);
    if (period === 'day') d.setDate(d.getDate() - 1);
    else if (period === 'week') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    if (d.getTime() < firstKm) break;
    starts.unshift(d.getTime());
  }
  return starts.map((start) => ({
    start,
    km: kmBy.get(start) ?? 0,
    trips: start >= firstTrips ? (tripsBy?.get(start) ?? 0) : undefined,
    minutes: start >= firstMin ? (minBy?.get(start) ?? 0) : undefined,
    partial: start === current,
    incomplete: (['km', 'trips', 'minutes'] as DriveMetric[]).filter((m) => rows[m] > start && rows[m] < nextBucket(start, period)),
  }));
}

export type DriveMetric = 'km' | 'trips' | 'minutes';

export interface DriveSummary {
  total: number;
  average?: number; // per bucket that is over and had the sensor all the way through
  best?: DriveBucket; // the busiest bucket
}

export function driveSummary(buckets: DriveBucket[], metric: DriveMetric): DriveSummary {
  const has = buckets.filter((b) => b[metric] !== undefined);
  const total = has.reduce((t, b) => t + (b[metric] ?? 0), 0);
  const complete = has.filter((b) => !b.partial && !b.incomplete.includes(metric));
  const average = complete.length ? complete.reduce((t, b) => t + (b[metric] ?? 0), 0) / complete.length : undefined;
  const best = has.reduce<DriveBucket | undefined>((m, b) => ((b[metric] ?? 0) > ((m?.[metric] as number | undefined) ?? 0) ? b : m), undefined);
  return { total, average, best };
}
