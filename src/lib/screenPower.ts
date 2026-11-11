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

// A hand-set state (HA's display entity toggled, or a touch) holds until the
// automatic decision next changes: turning the screen off by day keeps it off
// until 23:00 or until it's turned on again.
export interface Override {
  on: boolean;
  auto: boolean; // the automatic decision when it was set
}

export const effectiveOn = (auto: boolean, o: Override | null) => (o && o.auto === auto ? o.on : auto);

export interface EntityInput {
  prev?: string; // the entity's state last seen
  state?: string;
  on: boolean; // the screen's state now
  lastWrite?: { on: boolean; at: number };
  nowMs: number;
}

// What the display entity's state means. A change to a value the screen isn't
// in is a command from HA ('command'), unless it is our own write landing late.
// Otherwise the entity is brought in line with the screen ('write'), at most
// once per 15 s for the same value.
export function entityStep(i: EntityInput): 'command' | 'write' | 'none' {
  if (i.state !== 'on' && i.state !== 'off') return 'none';
  const want = i.state === 'on';
  const recent = (v: boolean) => !!i.lastWrite && i.lastWrite.on === v && i.nowMs - i.lastWrite.at < 15_000;
  const changed = (i.prev === 'on' || i.prev === 'off') && i.prev !== i.state;
  if (changed && want !== i.on && !recent(want)) return 'command';
  if (want !== i.on && !recent(i.on)) return 'write';
  return 'none';
}

// The battery level (0–1, from the extension) to write into SCREEN_POWER.battery,
// in whole percent, or undefined when the entity already has it or the same
// value was just written (within 15 s).
export function batteryToWrite(
  level: number | undefined,
  state: string | undefined,
  lastWrite: { value: number; at: number } | undefined,
  nowMs: number,
): number | undefined {
  if (level === undefined || !Number.isFinite(level)) return undefined;
  const value = Math.round(Math.min(1, Math.max(0, level)) * 100);
  if (state !== undefined && Number(state) === value) return undefined;
  if (lastWrite && lastWrite.value === value && nowMs - lastWrite.at < 15_000) return undefined;
  return value;
}
