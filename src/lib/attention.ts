// The Home page's "Needs attention" panel (panels/AttentionPanel.tsx): what
// should catch the eye from across the room. Pure helpers, unit-tested.

const HOUR = 3_600_000;

// The washer finished (its "running" sensor went off) within `withinMs` and
// its door hasn't been opened since: the laundry is still inside.
export function washerDone(
  running: { state: string; last_changed: string } | undefined,
  door: { state: string; last_changed: string } | undefined,
  now: number,
  withinMs = 4 * HOUR,
): number | null {
  if (!running || running.state !== 'off') return null;
  const at = Date.parse(running.last_changed);
  if (!Number.isFinite(at) || now - at > withinMs) return null;
  if (door && (door.state === 'on' || Date.parse(door.last_changed) > at)) return null;
  return at;
}

// Night for the car check: from 21:00 to 06:00.
export const isNight = (d: Date) => d.getHours() >= 21 || d.getHours() < 6;
