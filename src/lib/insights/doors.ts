// Doors: opened at a time of day it never is, or left open much longer than usual.
// "Never" means: nothing within 90 minutes of that time of day in the history
// (at least 12 earlier openings to know what normal is).
import { toRuns, completed } from './runs';
import { coversDoorAlert, doorAtNight } from './suggest';
import { clock, clockAt, clockGap, DAY, duration, MIN, minuteOfDay, percentile } from './stats';
import type { Automation, Insight, StateRow } from './types';

const ODD_GAP = 90; // minutes from the nearest usual opening

// The stretch of the day around `minute` that no earlier opening fell in, trimmed
// by half an hour each side; undefined when it is short.
export function quietWindow(prior: number[], minute: number): { from: number; to: number } | undefined {
  const m = [...prior].sort((a, b) => a - b);
  for (let i = 0; i < m.length; i++) {
    const a = m[i];
    // The next opening, going round midnight after the last one of the day.
    const b = i < m.length - 1 ? m[i + 1] : m[0] + 1440;
    const span = b - a;
    const into = (minute - a + 1440) % 1440;
    // Two openings at the same minute leave no gap between them.
    if (span > 0 && into > 0 && into < span && span >= 180) return { from: (a + 30) % 1440, to: (b - 30 + 1440) % 1440 };
  }
  return undefined;
}

export function doorInsights(door: { entity: string; name: string }, rows: StateRow[], now: number, automations: Automation[] = []): Insight[] {
  const runs = toRuns(door.entity, rows).filter((r) => !r.truncated);
  const out: Insight[] = [];

  const recent = runs.filter((r) => r.start >= now - DAY);
  const prior = runs.filter((r) => r.start < now - DAY).map((r) => minuteOfDay(r.start));
  if (prior.length >= 12) {
    for (const r of recent) {
      const m = minuteOfDay(r.start);
      const gap = Math.min(...prior.map((p) => clockGap(p, m)));
      if (gap <= ODD_GAP) continue;
      const night = m >= 23 * 60 || m < 5 * 60 + 30;
      const win = quietWindow(prior, m);
      const s = night && win ? doorAtNight(door.entity, door.name, win.from, win.to) : undefined;
      if (s) {
        const covered = coversDoorAlert(automations, door.entity);
        if (covered) s.covered = covered;
      }
      out.push({
        id: `door-odd-hour:${door.entity}:${r.start}`,
        kind: 'door-odd-hour',
        severity: night ? 'alert' : 'notice',
        entity: door.entity,
        name: door.name,
        title: `${door.name} opened at ${clockAt(r.start)}`,
        detail: win ? `It was not opened between ${clock(win.from - 30)} and ${clock(win.to + 30)} in the last ${prior.length} openings.` : `Nothing like that time of day in the last ${prior.length} openings.`,
        at: r.start,
        suggestion: s,
      });
    }
  }

  const cur = toRuns(door.entity, rows).find((r) => r.end === null && !r.truncated);
  const past = completed(toRuns(door.entity, rows), 5_000);
  if (cur && past.length >= 8) {
    const open = now - cur.start;
    const limit = Math.max(percentile(past, 0.95) * 2, 10 * MIN);
    if (open > limit) {
      out.push({
        id: `door-open-long:${door.entity}:${cur.start}`,
        kind: 'door-open-long',
        severity: 'notice',
        entity: door.entity,
        name: door.name,
        title: `${door.name} has been open for ${duration(open)}`,
        detail: `Usually it is open for ${duration(percentile(past, 0.5))}.`,
        at: cur.start,
      });
    }
  }
  return out;
}
