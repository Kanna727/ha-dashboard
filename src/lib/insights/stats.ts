// Small robust statistics and clock helpers the detectors share.
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Median absolute deviation scaled to be comparable with a standard deviation.
export function spread(xs: number[]): number {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

// The value below which `p` (0..1) of the numbers fall, by nearest rank.
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

export const isWeekend = (t: number) => [0, 6].includes(new Date(t).getDay());
export const dayType = (t: number): 'weekday' | 'weekend' => (isWeekend(t) ? 'weekend' : 'weekday');

export const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

// Minutes after local midnight.
export const minuteOfDay = (t: number) => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};

export const clock = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const clockAt = (t: number) => clock(minuteOfDay(t));

// How far apart two times of day are, going the short way round midnight.
export const clockGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
};

// "40 s", "12 min", "2 h 10 min".
export function duration(ms: number): string {
  if (ms < MIN) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const min = Math.round(ms / MIN);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export const roundUp = (n: number, to: number) => Math.ceil(n / to) * to;
