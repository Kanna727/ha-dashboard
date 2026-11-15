// Habits: the times of day something is usually switched on or off, on weekdays
// and at weekends separately. A habit needs the same thing within a 45-minute
// window on at least 60 % of the days of its kind (and at least four). It is
// reported as an observation and offered as an automation, unless one that does
// the same already exists.
import { toRuns } from './runs';
import { atTime, coversTime } from './suggest';
import { clock, DAY, dayType, median, minuteOfDay, startOfDay } from './stats';
import type { Automation, Device, Insight, StateRow } from './types';

export interface Habit {
  dir: 'on' | 'off';
  type: 'weekday' | 'weekend';
  // The usual time, minutes after midnight.
  minute: number;
  // On how many of the days seen it happened inside the window.
  count: number;
  days: number;
}

export interface HabitOptions {
  window?: number; // minutes
  share?: number;
  minCount?: number;
}

// The most days' times that fit in one window, and their median.
function cluster(points: { day: number; minute: number }[], window: number): { minute: number; count: number } | undefined {
  const sorted = [...points].sort((a, b) => a.minute - b.minute);
  let best: typeof sorted = [];
  for (let i = 0; i < sorted.length; i++) {
    const inWin: typeof sorted = [];
    const seen = new Set<number>();
    for (let j = i; j < sorted.length && sorted[j].minute - sorted[i].minute <= window; j++) {
      if (seen.has(sorted[j].day)) continue; // one per day
      seen.add(sorted[j].day);
      inWin.push(sorted[j]);
    }
    if (inWin.length > best.length) best = inWin;
  }
  return best.length ? { minute: Math.round(median(best.map((p) => p.minute))), count: best.length } : undefined;
}

// Whole past days (not today) of each kind inside the history.
function daysSeen(rows: StateRow[], now: number): Record<'weekday' | 'weekend', number> {
  const out = { weekday: 0, weekend: 0 };
  if (!rows.length) return out;
  const from = startOfDay(Math.min(...rows.map((r) => r.t))) + DAY; // the first day is partial
  for (let d = from; d + DAY <= startOfDay(now); d += DAY) out[dayType(d + 12 * 3_600_000)]++;
  return out;
}

export function findHabits(entity: string, rows: StateRow[], now: number, o: HabitOptions = {}): Habit[] {
  const window = o.window ?? 45;
  const share = o.share ?? 0.6;
  const minCount = o.minCount ?? 4;
  const runs = toRuns(entity, rows).filter((r) => !r.truncated);
  const seen = daysSeen(rows, now);
  const today = startOfDay(now);
  const out: Habit[] = [];
  for (const dir of ['on', 'off'] as const) {
    for (const type of ['weekday', 'weekend'] as const) {
      const pts = runs
        .map((r) => (dir === 'on' ? r.start : r.end))
        .filter((t): t is number => t !== null && t < today && dayType(t) === type)
        .map((t) => ({ day: startOfDay(t), minute: minuteOfDay(t) }));
      const c = cluster(pts, window);
      if (c && c.count >= minCount && c.count >= share * seen[type]) out.push({ dir, type, minute: c.minute, count: c.count, days: seen[type] });
    }
  }
  return out;
}

const KINDS_WITH_HABITS: Device['kind'][] = ['light', 'fan', 'switch', 'geyser', 'climate'];

export function habitInsights(device: Device, rows: StateRow[], now: number, automations: Automation[] = []): Insight[] {
  if (!KINDS_WITH_HABITS.includes(device.kind)) return [];
  return findHabits(device.entity, rows, now).map((h) => {
    const days = h.type === 'weekday' ? 'weekdays' : 'weekends';
    // An automation at the usual time, a few minutes early to switch on, a few late to switch off.
    const minute = h.dir === 'on' ? h.minute - 5 : h.minute + 10;
    const s = atTime(device.entity, device.name, h.dir, minute, h.type);
    const covered = coversTime(automations, device.entity, h.dir, minute);
    if (covered) s.covered = covered;
    return {
      id: `habit:${device.entity}:${h.dir}:${h.type}:${clock(h.minute)}`,
      kind: 'habit' as const,
      severity: 'info' as const,
      entity: device.entity,
      name: device.name,
      title: `${device.name} usually goes ${h.dir} around ${clock(h.minute)} on ${days}`,
      detail: `It did on ${h.count} of the last ${h.days} ${days}.`,
      at: now,
      score: h.days ? h.count / h.days : 0,
      suggestion: s,
    };
  });
}
