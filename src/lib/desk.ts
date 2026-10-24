import type { HistoryPoint } from '../ha/api';

// Standing desk maths: finding the desk's entities from one of them, sitting
// vs standing, today's and this week's standing time, and how far each stage
// of a three-stage column is out at a height (for the 3D model).

/* ---------- discovery ---------- */

// The desk controller's entities share a prefix: `<domain>.<base>_<key>`, e.g.
// number.office_desk_desk_height, button.office_desk_desk_m1, cover.office_desk_height_slider.
// Roles follow an ESPHome desk controller that emulates the keypad; anything
// else is kept as a setting or a generic control.
export interface DeskIds {
  base: string;
  cover?: string; // cover.*: open = to the top, close = to the bottom, position 0–100 % of the range
  height?: string; // sensor.*_height: the current height
  setHeight?: string; // number.*_height: the height to go to
  minHeight?: string; // number.*_min_height: the bottom of the range (the height number's own min may be wider)
  maxHeight?: string; // number.*_max_height: the top of the range
  status?: string; // sensor.*_status: Idle / Raising / Lowering
  presets: DeskPreset[]; // memory keys in order
  nudgeUp?: string; // button.*_nudge_up: one step up (~1 cm), like a tap on the keypad's arrow
  nudgeDown?: string;
  stop?: string; // button.*_stop
  childLock?: string; // binary_sensor (or switch) *_child_lock: on = keypad locked
  childLockToggle?: string; // button.*_child_lock: toggles it
  idleTime?: string; // sensor.*_idle_time: seconds since the height last changed
  idleEnabled?: string; // switch.*_enable_idle_counter
  idleReset?: string; // button.*_reset_idle_timer
  restart?: string; // button.*_restart
  uptime?: string; // sensor.*_uptime: a boot timestamp or seconds
  wifi?: string; // sensor.*_wifi_signal
  firmware?: string; // update.*
  settings: string[]; // calibration: offsets, nudge delay, other numbers, selects and config entities
  rest: string[]; // every other entity of the desk, shown as generic controls
}

export interface DeskPreset {
  key: string; // the button's key, e.g. 'desk_m3_stand'; learned heights are kept under it
  id: string; // the button that goes there
  label: string; // 'Stand', 'Sit', '1' …
  role?: 'sit' | 'stand';
  slot: number; // sort order (the memory key's number)
  set?: string; // the button that saves the current height to it
  heightSensor?: string; // a sensor with the height it goes to, when the controller reports one
}

const ANCHOR_SUFFIXES = ['_desk_height', '_height', '_desk'];
// Entities that only repeat what others show (the height in %, the idle time as text).
const REDUNDANT = /^(desk_)?height_percent$|^idle_timestamp$/;

const objectId = (id: string) => id.slice(id.indexOf('.') + 1);
const domainOf = (id: string) => id.slice(0, id.indexOf('.'));

// The shared prefix, from the entity the config names (or the first height number found).
export function deskBase(anchor: string): string {
  const obj = objectId(anchor);
  for (const s of ANCHOR_SUFFIXES) if (obj.endsWith(s) && obj.length > s.length) return obj.slice(0, -s.length);
  return obj;
}

// A memory key's slot and role from its key: 'desk_m3_stand' → 3, stand; 'sit' (older firmware) → sit.
export function presetOf(key: string): { slot: number; role?: 'sit' | 'stand'; label: string } | undefined {
  const m = key.match(/^(?:desk_)?m(\d)(?:_(?!height$)([a-z]+))?$/) ?? key.match(/^preset_(\d)()$/);
  if (m) {
    const role = m[2] === 'sit' || m[2] === 'stand' ? m[2] : undefined;
    return { slot: Number(m[1]), role, label: role ? (role === 'sit' ? 'Sit' : 'Stand') : m[1] };
  }
  if (key === 'sit' || key === 'stand') return { slot: key === 'sit' ? 0 : 0.5, role: key, label: key === 'sit' ? 'Sit' : 'Stand' };
  return undefined;
}

// Sorts the desk's entities into roles. `ids` is every entity ID in HA (or on
// the desk's device); only those with the desk's prefix (or in `device`) count.
// `config` lists the device's configuration entities (registry entity_category).
export function deskIds(anchor: string, ids: string[], device: string[] = [], config: string[] = []): DeskIds {
  const base = deskBase(anchor);
  const mine = [...new Set([anchor, ...ids.filter((id) => objectId(id).startsWith(base + '_')), ...device])].sort();
  const out: DeskIds = { base, presets: [], settings: [], rest: [] };
  const keyOf = (id: string) => (objectId(id).startsWith(base + '_') ? objectId(id).slice(base.length + 1) : objectId(id));
  const sets: Record<string, string> = {};
  const heights: Record<number, string> = {};
  for (const id of mine) {
    const d = domainOf(id);
    const key = keyOf(id);
    const preset = presetOf(key);
    const mHeight = d === 'sensor' ? key.match(/^(?:desk_)?m(\d)_height$/) : null;
    if (d === 'cover' && !out.cover) out.cover = id;
    else if (mHeight) heights[Number(mHeight[1])] = id;
    else if (d === 'number' && key === 'min_height') out.minHeight = id;
    else if (d === 'number' && key === 'max_height') out.maxHeight = id;
    else if (d === 'sensor' && /height$/.test(key) && !out.height) out.height = id;
    else if (d === 'number' && /height$/.test(key) && !out.setHeight) out.setHeight = id;
    else if (d === 'sensor' && /status$/.test(key) && !out.status) out.status = id;
    else if (d === 'button' && preset) out.presets.push({ key, id, ...preset });
    else if (d === 'button' && /^set_/.test(key) && presetOf(key.slice(4))) sets[key.slice(4)] = id;
    else if (d === 'button' && /nudge_up$/.test(key)) out.nudgeUp = id;
    else if (d === 'button' && /nudge_down$/.test(key)) out.nudgeDown = id;
    else if (d === 'button' && /(^|_)stop$/.test(key)) out.stop = id;
    else if (d === 'button' && key === 'child_lock') out.childLockToggle = id;
    else if ((d === 'binary_sensor' || d === 'switch') && key === 'child_lock') out.childLock = id;
    else if (d === 'sensor' && key === 'idle_time') out.idleTime = id;
    else if (d === 'switch' && key === 'enable_idle_counter') out.idleEnabled = id;
    else if (d === 'button' && key === 'reset_idle_timer') out.idleReset = id;
    else if (d === 'button' && /restart$/.test(key)) out.restart = id;
    else if (d === 'sensor' && /uptime$/.test(key)) out.uptime = id;
    else if (d === 'sensor' && key === 'wifi_signal') out.wifi = id;
    else if (d === 'update' && !out.firmware) out.firmware = id;
    else if (REDUNDANT.test(key)) continue;
    else if (d === 'number' || d === 'select' || config.includes(id)) out.settings.push(id);
    else out.rest.push(id);
  }
  for (const p of out.presets) {
    p.set = sets[p.key];
    p.heightSensor = heights[p.slot];
  }
  out.presets.sort((x, y) => x.slot - y.slot);
  return out;
}

/* ---------- posture ---------- */

export const DEFAULT_STAND_ABOVE = 90; // cm; between a typical sitting (~72) and standing (~105) height

// Where sitting ends and standing starts: halfway between the Sit and Stand
// keys' heights when both are known, else the configured or default line.
export function standLine(presets: DeskPreset[], heights: Record<string, number>, configured?: number): number {
  if (configured) return configured;
  const sit = heights[presets.find((p) => p.role === 'sit')?.key ?? ''];
  const stand = heights[presets.find((p) => p.role === 'stand')?.key ?? ''];
  return sit && stand && stand - sit > 10 ? (sit + stand) / 2 : DEFAULT_STAND_ABOVE;
}

export const isStanding = (cm: number | undefined, line: number) => cm !== undefined && cm >= line;

export interface PostureStats {
  standMs: number;
  standUps: number; // times it went from sitting to standing height
  longestStandMs: number;
  since?: number; // when the current posture began (epoch ms), if within the window
}

// Standing time between `from` and `to` from the height history (a step
// series: each reading holds until the next). Time before the first reading
// is unknown and not counted.
export function postureStats(points: HistoryPoint[], from: number, to: number, line: number): PostureStats {
  const out: PostureStats = { standMs: 0, standUps: 0, longestStandMs: 0 };
  let run = 0;
  let prev: boolean | undefined;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const t0 = Math.max(p.t, from);
    const t1 = Math.min(points[i + 1]?.t ?? to, to);
    const up = p.v >= line;
    if (prev !== undefined && up !== prev) {
      if (up && p.t >= from) out.standUps++;
      if (p.t >= from) out.since = p.t;
      if (!up) run = 0;
    }
    prev = up;
    if (t1 <= t0) continue;
    if (up) {
      out.standMs += t1 - t0;
      run += t1 - t0;
      out.longestStandMs = Math.max(out.longestStandMs, run);
    }
  }
  return out;
}

// Standing time per day for the last `days` days (oldest first), local midnights.
export function dailyStanding(points: HistoryPoint[], days: number, now: number, line: number): { start: number; standMs: number; standUps: number }[] {
  const out = [];
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i).getTime();
    const end = Math.min(now, new Date(d.getFullYear(), d.getMonth(), d.getDate() - i + 1).getTime());
    const s = postureStats(points, start, end, line);
    out.push({ start, standMs: s.standMs, standUps: s.standUps });
  }
  return out;
}

// "1h 05m", "12m", "now"
export function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return '0m';
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/* ---------- movement ---------- */

// Moving, from the controller's status ('Raising' / 'Lowering') or a cover's state ('opening' = rising).
export function motion(state: string | undefined): 'up' | 'down' | undefined {
  const s = state?.toLowerCase();
  return s === 'raising' || s === 'opening' ? 'up' : s === 'lowering' || s === 'closing' ? 'down' : undefined;
}

// "7m 15s", "1h 05m", "2d 4h": how long the desk has stayed at its height.
export function fmtIdle(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
  if (s < 86_400) return Math.floor(s / 3600) + 'h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + 'm';
  return Math.floor(s / 86_400) + 'd ' + Math.floor((s % 86_400) / 3600) + 'h';
}

// Height ↔ the cover's position (0–100 % of the range).
export const heightToPosition = (cm: number, min: number, max: number) => Math.round(((cm - min) / (max - min)) * 100);
export const positionToHeight = (pos: number, min: number, max: number) => min + (pos / 100) * (max - min);

// The keypad shows one decimal ("72.5").
export const displayHeight = (cm: number | undefined) => (cm === undefined ? '--.-' : cm.toFixed(1));

/* ---------- the 3D model's columns ---------- */

// Visible length of each stage of a three-stage column (bottom, middle, top)
// that is `length` m long in all. The wide bottom stage stays the same; the
// middle and top stages come out together, as the real columns do.
export function columnStages(length: number, bottom = 0.42): [number, number, number] {
  const b = Math.min(bottom, length * 0.8);
  const rest = Math.max(0, length - b) / 2;
  return [b, rest, rest];
}
