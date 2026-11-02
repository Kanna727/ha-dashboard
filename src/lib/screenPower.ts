// Wall-screen power (the ChromeOS extension in kiosk-extension/ does the
// switching). Pure, unit-tested; components/ScreenPower.tsx applies it.

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

// Whether `now` falls in the quiet hours [from, to). The window may cross
// midnight ('23:00'–'06:00'); from === to means no quiet hours.
export function inQuietHours(now: Date, [from, to]: [string, string]): boolean {
  const t = now.getHours() * 60 + now.getMinutes();
  const a = minutesOf(from);
  const b = minutesOf(to);
  if (a === b) return false;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

export interface PresenceState {
  state: string;
  last_changed: string;
}

// Milliseconds since someone was last seen by any of these sensors: 0 while
// one is on, otherwise the time since the most recent one turned off.
// Unavailable/unknown sensors don't count; with nothing usable, Infinity.
export function sinceSeenMs(sensors: (PresenceState | undefined)[], nowMs: number): number {
  let best = Infinity;
  for (const s of sensors) {
    if (!s) continue;
    if (s.state === 'on') return 0;
    if (s.state !== 'off') continue;
    const at = Date.parse(s.last_changed);
    if (!Number.isNaN(at)) best = Math.min(best, Math.max(0, nowMs - at));
  }
  return best;
}

export interface ScreenInput {
  quiet: boolean; // inside the quiet hours
  vacation: boolean; // vacation mode is on and counts
  sinceSeenMs: number;
  holdMinutes: number;
}

// Keep the screen on, except at night or on vacation once nobody has been seen
// for holdMinutes; then ChromeOS may turn it off after its own idle delay.
export const screenOn = (i: ScreenInput) => (!i.quiet && !i.vacation) || i.sinceSeenMs < i.holdMinutes * 60_000;
