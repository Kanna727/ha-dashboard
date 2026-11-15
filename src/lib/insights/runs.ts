// On/off history turned into runs, and the first detector on them: something
// that has been on far longer than it usually is.
import { coversOffTimer, turnOffAfter } from './suggest';
import { duration, HOUR, MIN, median, percentile, roundUp } from './stats';
import type { Automation, Device, Insight, StateRow } from './types';

export interface Run {
  start: number;
  // null: still on.
  end: number | null;
  // It was already on when the history begins, so its real start is unknown.
  truncated: boolean;
}

const UNKNOWN = new Set(['unavailable', 'unknown', '']);

// Whether a state of an entity counts as "on" (a door: open).
export const isOn = (entity: string, s: string): boolean => (entity.startsWith('climate.') ? s !== 'off' : s === 'on');

// The history as runs of being on. Unavailable and unknown readings change nothing.
export function toRuns(entity: string, rows: StateRow[]): Run[] {
  const out: Run[] = [];
  let open: Run | undefined;
  let first = true;
  for (const r of [...rows].sort((a, b) => a.t - b.t)) {
    if (UNKNOWN.has(r.s)) continue;
    const on = isOn(entity, r.s);
    if (on && !open) {
      open = { start: r.t, end: null, truncated: first };
      out.push(open);
    } else if (!on && open) {
      open.end = r.t;
      open = undefined;
    }
    first = false;
  }
  return out;
}

// Runs that began and ended inside the history, at least `min` long (a flicker isn't a run).
export const completed = (runs: Run[], min = 2 * MIN): number[] => runs.filter((r) => r.end !== null && !r.truncated && r.end - r.start >= min).map((r) => (r.end as number) - r.start);

const ONE_OF = (kind: Device['kind']) => (kind === 'geyser' ? 'geyser' : kind);

// On for much longer than any recent run. Needs at least 5 finished runs to know "usual".
export function leftOn(device: Device, rows: StateRow[], now: number, automations: Automation[] = []): Insight | undefined {
  const runs = toRuns(device.entity, rows);
  const cur = runs.find((r) => r.end === null && !r.truncated);
  if (!cur) return undefined;
  const past = completed(runs);
  if (past.length < 5) return undefined;
  const p90 = percentile(past, 0.9);
  const typical = median(past);
  const threshold = Math.max(p90 * 1.5, p90 + 20 * MIN, 45 * MIN);
  const on = now - cur.start;
  if (on <= threshold) return undefined;
  const minutes = roundUp(Math.max(p90 * 1.25, 10 * MIN) / MIN, 5);
  const s = turnOffAfter(device.entity, device.name, minutes);
  const covered = coversOffTimer(automations, device.entity);
  if (covered) s.covered = covered;
  return {
    id: `left-on:${device.entity}:${cur.start}`,
    kind: 'left-on',
    severity: on > Math.max(p90 * 3, 4 * HOUR) ? 'alert' : 'notice',
    entity: device.entity,
    name: device.name,
    title: `${device.name} has been ${ONE_OF(device.kind) === 'light' ? 'lit' : 'on'} for ${duration(on)}`,
    detail: `It usually runs about ${duration(typical)}, and no longer than ${duration(Math.max(...past))} in the last ${past.length} runs.`,
    at: cur.start,
    suggestion: s,
  };
}
