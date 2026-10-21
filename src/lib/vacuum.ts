// Robot vacuum maths for the vacuum page (vacuum/*): map calibration, rooms,
// restricted zones, consumables and labels. Pure, so it is unit-tested.
//
// The map comes from the vacuum's camera entity (an image) plus attributes in
// the vacuum's own coordinates (mm): rooms with bounding boxes and centres,
// virtual walls, no-go and no-mop areas, the robot and dock positions, and
// `calibration_points` pairing vacuum and image coordinates.

export interface Pt {
  x: number;
  y: number;
}

// [x0, y0, x1, y1] in vacuum coordinates. Rects are kept with x0 <= x1, y0 <= y1.
export type Rect = [number, number, number, number];
export type Line = [number, number, number, number];

/* ---------- calibration ---------- */

export interface Calibration {
  toImg(p: Pt): Pt;
  toVac(p: Pt): Pt;
  // Image pixels per vacuum mm (for sizes, e.g. the robot marker).
  scale: number;
}

type Affine = [number, number, number, number, number, number]; // out.x = a·x + b·y + c, out.y = d·x + e·y + f

const apply = (m: Affine, p: Pt): Pt => ({ x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] });

function invert(m: Affine): Affine | null {
  const [a, b, c, d, e, f] = m;
  const det = a * e - b * d;
  if (!det) return null;
  return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det];
}

// Solves the affine map from three vacuum ↔ image point pairs (the integration
// sends exactly three: origin, +1000 x, +1000 y). Handles map rotation and flips.
export function calibration(points: unknown): Calibration | null {
  if (!Array.isArray(points) || points.length < 3) return null;
  const pairs = points.slice(0, 3).map((p) => p as { vacuum?: Pt; map?: Pt });
  if (pairs.some((p) => !p?.vacuum || !p?.map)) return null;
  const [p0, p1, p2] = pairs as { vacuum: Pt; map: Pt }[];
  // Solve [x y 1]·coeffs for each output axis with Cramer's rule.
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const rows = [p0, p1, p2].map((p) => [p.vacuum.x, p.vacuum.y, 1]);
  const d = det(rows);
  if (!d) return null;
  const solve = (out: number[]) =>
    [0, 1, 2].map((col) => det(rows.map((r, i) => r.map((v, j) => (j === col ? out[i] : v)))) / d);
  const [a, b, c] = solve([p0.map.x, p1.map.x, p2.map.x]);
  const [dd, e, f] = solve([p0.map.y, p1.map.y, p2.map.y]);
  const fwd: Affine = [a, b, c, dd, e, f];
  const back = invert(fwd);
  if (!back) return null;
  return { toImg: (p) => apply(fwd, p), toVac: (p) => apply(back, p), scale: Math.hypot(a, dd) };
}

/* ---------- rooms ---------- */

export interface VacRoom {
  id: number;
  name: string;
  box: Rect;
  center: Pt;
  order: number; // cleaning sequence position, 0 = none
  icon?: string;
}

// The camera's `rooms` attribute: { "<id>": { x0, y0, x1, y1, x, y, name, custom_name, order, ... } }.
// Some versions nest it per map name ({ "Map 1": [...] }) on the vacuum entity; that form has no boxes and is skipped.
export function parseRooms(attr: unknown): VacRoom[] {
  if (!attr || typeof attr !== 'object' || Array.isArray(attr)) return [];
  const out: VacRoom[] = [];
  for (const [key, raw] of Object.entries(attr as Record<string, unknown>)) {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const n = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : undefined);
    const [x0, y0, x1, y1] = [n('x0'), n('y0'), n('x1'), n('y1')];
    if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined) continue;
    const id = n('room_id') ?? Number(key);
    if (!Number.isFinite(id)) continue;
    const box = normRect({ x: x0, y: y0 }, { x: x1, y: y1 });
    out.push({
      id,
      name: String(r.custom_name || r.name || `Room ${id}`),
      box,
      center: { x: n('x') ?? (box[0] + box[2]) / 2, y: n('y') ?? (box[1] + box[3]) / 2 },
      order: n('order') ?? 0,
      icon: typeof r.icon === 'string' ? r.icon : undefined,
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

export const inRect = (p: Pt, r: Rect, pad = 0) => p.x >= r[0] - pad && p.x <= r[2] + pad && p.y >= r[1] - pad && p.y <= r[3] + pad;

// The room under a point. Room boxes overlap where rooms interlock, so among
// the boxes that contain the point, `matches` (the map colour under the point,
// when the image can be read) decides first, then the nearest centre.
export function roomAt(p: Pt, rooms: VacRoom[], matches?: (room: VacRoom) => boolean): VacRoom | undefined {
  const inside = rooms.filter((r) => inRect(p, r.box));
  if (!inside.length) return undefined;
  const pool = matches ? inside.filter(matches) : [];
  const pick = pool.length ? pool : inside;
  const dist = (r: VacRoom) => Math.hypot(r.center.x - p.x, r.center.y - p.y);
  return pick.reduce((best, r) => (dist(r) < dist(best) ? r : best));
}

// Rooms in their cleaning sequence (rooms without one keep their id order, after).
export function sequenced(rooms: VacRoom[]): VacRoom[] {
  return [...rooms].sort((a, b) => (a.order || 999) - (b.order || 999) || a.id - b.id);
}

/* ---------- shapes ---------- */

export function normRect(a: Pt, b: Pt): Rect {
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}

export const rectCorners = (r: Rect): Pt[] => [
  { x: r[0], y: r[1] },
  { x: r[2], y: r[1] },
  { x: r[2], y: r[3] },
  { x: r[0], y: r[3] },
];

export const moveRect = (r: Rect, dx: number, dy: number): Rect => [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy];
export const moveLine = (l: Line, dx: number, dy: number): Line => [l[0] + dx, l[1] + dy, l[2] + dx, l[3] + dy];

// Drag corner `i` (rectCorners order) to `p`; the opposite corner stays.
export function resizeRect(r: Rect, i: number, p: Pt): Rect {
  const opp = rectCorners(r)[(i + 2) % 4];
  return normRect(opp, p);
}

export function moveLineEnd(l: Line, end: 0 | 1, p: Pt): Line {
  return end === 0 ? [p.x, p.y, l[2], l[3]] : [l[0], l[1], p.x, p.y];
}

export const rectArea = (r: Rect) => ((r[2] - r[0]) * (r[3] - r[1])) / 1e6; // m²
export const lineLength = (l: Line) => Math.hypot(l[2] - l[0], l[3] - l[1]) / 1000; // m

/* ---------- restricted zones ---------- */

export interface Restrictions {
  walls: Line[];
  noGo: Rect[];
  noMop: Rect[];
}

export const NO_RESTRICTIONS: Restrictions = { walls: [], noGo: [], noMop: [] };

const nums = (o: unknown, keys: string[]): number[] | null => {
  if (Array.isArray(o)) return o.length >= keys.length && o.every((v) => typeof v === 'number') ? (o as number[]) : null;
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  return keys.every((k) => typeof r[k] === 'number') ? keys.map((k) => r[k] as number) : null;
};

function parseAreas(v: unknown): Rect[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((a): Rect[] => {
    // Areas are four corners (x0..y3, maybe rotated) or a plain [x0, y0, x1, y1]; keep their bounding box.
    const quad = nums(a, ['x0', 'y0', 'x1', 'y1', 'x2', 'y2', 'x3', 'y3']);
    if (quad) {
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      return [[Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]];
    }
    const box = nums(a, ['x0', 'y0', 'x1', 'y1']);
    return box ? [normRect({ x: box[0], y: box[1] }, { x: box[2], y: box[3] })] : [];
  });
}

function parseWalls(v: unknown): Line[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((w): Line[] => {
    const l = nums(w, ['x0', 'y0', 'x1', 'y1']);
    return l ? [[l[0], l[1], l[2], l[3]]] : [];
  });
}

export function parseRestrictions(attrs: Record<string, unknown> | undefined): Restrictions {
  return {
    walls: parseWalls(attrs?.virtual_walls),
    noGo: parseAreas(attrs?.no_go_areas),
    noMop: parseAreas(attrs?.no_mopping_areas),
  };
}

const ints = <T extends number[]>(a: T) => a.map((v) => Math.round(v)) as T;

// dreame_vacuum.vacuum_set_restricted_zone replaces all three lists at once,
// so the payload always carries every wall and area, not just the changed one.
export function restrictionsPayload(r: Restrictions) {
  return { walls: r.walls.map(ints), zones: r.noGo.map(ints), no_mops: r.noMop.map(ints) };
}

export function sameRestrictions(a: Restrictions, b: Restrictions): boolean {
  return JSON.stringify(restrictionsPayload(a)) === JSON.stringify(restrictionsPayload(b));
}

/* ---------- status ---------- */

export type Tone = 'active' | 'ok' | 'warn' | 'idle';

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

// A short status for the page header and the top-bar pill. The vacuum
// entity's state is coarse (cleaning/docked/returning/error...), so the
// integration's `status` attribute (e.g. "sleeping", "zone_cleaning") refines it.
export function vacuumStatus(state: string | undefined, attrs: Record<string, unknown> = {}): { label: string; tone: Tone } {
  if (!state || state === 'unavailable' || state === 'unknown') return { label: 'Offline', tone: 'idle' };
  const err = attrs.error;
  if (state === 'error' || (typeof err === 'string' && err && !/^no.?error$/i.test(err))) {
    return { label: typeof err === 'string' && err && !/^no.?error$/i.test(err) ? String(err) : 'Error', tone: 'warn' };
  }
  const status = typeof attrs.status === 'string' ? attrs.status : '';
  if (state === 'cleaning') {
    if (attrs.segment_cleaning) return { label: 'Cleaning rooms', tone: 'active' };
    if (attrs.zone_cleaning) return { label: 'Cleaning zones', tone: 'active' };
    if (attrs.spot_cleaning) return { label: 'Spot cleaning', tone: 'active' };
    if (attrs.mapping) return { label: 'Mapping', tone: 'active' };
    return { label: status && status !== 'cleaning' ? titleCase(status) : 'Cleaning', tone: 'active' };
  }
  if (state === 'returning') return { label: 'Returning to dock', tone: 'active' };
  if (state === 'paused') return { label: 'Paused', tone: 'ok' };
  if (state === 'docked') {
    if (attrs.charging === true || status === 'charging') return { label: 'Charging', tone: 'ok' };
    return { label: 'Docked', tone: 'ok' };
  }
  return { label: titleCase(state), tone: 'idle' };
}

export const isRunning = (state: string | undefined) => state === 'cleaning' || state === 'returning';

// The room card's vacuum chip: a few words that fit a chip (`short`), the full
// line for its label/tooltip (`long`), and whether it lights up.
export function chipStatus(
  state: string | undefined,
  attrs: Record<string, unknown> = {},
  extra: { battery?: number; room?: string; area?: number } = {},
): { short: string; long: string; on: boolean; tone: Tone } {
  const s = vacuumStatus(state, attrs);
  const pct = extra.battery !== undefined ? `${Math.round(extra.battery)}%` : '';
  if (s.tone === 'idle') return { short: '', long: `Vacuum: ${s.label}`, on: false, tone: s.tone };
  if (s.tone === 'warn') return { short: s.label.length > 14 ? 'Needs help' : s.label, long: `Vacuum: ${s.label}`, on: true, tone: s.tone };
  if (state === 'cleaning') {
    const where = extra.room || s.label;
    const area = extra.area ? `${Math.round(extra.area)} m²` : '';
    return { short: where, long: `Vacuum: ${s.label}${extra.room ? ` · ${extra.room}` : ''}${area ? ` · ${area}` : ''}`, on: true, tone: s.tone };
  }
  if (state === 'returning') return { short: 'Docking', long: `Vacuum: ${s.label}`, on: true, tone: s.tone };
  if (state === 'paused') return { short: 'Paused', long: `Vacuum: paused${pct ? ` · ${pct}` : ''}`, on: true, tone: s.tone };
  return { short: pct || s.label, long: `Vacuum: ${s.label}${pct ? ` · ${pct}` : ''}`, on: false, tone: s.tone };
}

/* ---------- formatting ---------- */

export function fmtMinutes(min: number | undefined): string {
  if (min === undefined || !Number.isFinite(min)) return '–';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtHours(h: number | undefined): string {
  if (h === undefined || !Number.isFinite(h)) return '–';
  if (h >= 48) return `${Math.round(h / 24)} days`;
  return `${Math.round(h)} h`;
}

/* ---------- discovery ---------- */

// The vacuum device's other entities are named "<vacuum object id>_<key>"
// (e.g. vacuum.robot → select.robot_suction_level, key "suction_level").
export function siblingKey(vacuumId: string, entityId: string): string | undefined {
  const base = vacuumId.split('.')[1];
  const obj = entityId.split('.')[1];
  if (!base || !obj || entityId === vacuumId) return undefined;
  return obj.startsWith(`${base}_`) ? obj.slice(base.length + 1) : undefined;
}

// Per-room entities: "room_<n>_<setting>", e.g. room_2_suction_level.
export function roomKey(key: string): { room: number; setting: string } | undefined {
  const m = /^room_(\d+)_(.+)$/.exec(key);
  return m ? { room: Number(m[1]), setting: m[2] } : undefined;
}

// Display name without the device's name in front ("Robot Suction Level" → "Suction Level").
export function shortName(friendly: string | undefined, device: string | undefined, fallback: string): string {
  const name = (friendly ?? '').trim();
  if (!name) return titleCase(fallback);
  if (device) {
    const d = device.trim();
    if (d && name.toLowerCase().startsWith(d.toLowerCase()) && name.length > d.length) {
      const rest = name.slice(d.length).trim();
      if (rest) return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
  }
  return name;
}

// The longest run of whole words every name starts with: the device name the
// integration puts in front of each entity's friendly name.
export function commonPrefix(names: string[]): string {
  const split = names.filter(Boolean).map((n) => n.trim().split(/\s+/));
  if (split.length < 2) return '';
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const w = split[0][i];
    if (w === undefined || !split.every((s) => s[i] === w && s.length > i + 1)) break;
    out.push(w);
  }
  return out.join(' ');
}

/* ---------- consumables ---------- */

export interface Consumable {
  key: string; // e.g. "main_brush"
  percent?: string; // sensor key with the % left
  hours?: string; // sensor key with the hours left
  reset?: string; // button key that resets it
}

// "<part>_left" (%) sensors, their "<part>_time_left" (h) twins and "reset_<part>"
// buttons. Some resets use a shorter name ("sensor_dirty" → "reset_sensor").
export function consumables(keys: { key: string; domain: string }[]): Consumable[] {
  const sensors = new Set(keys.filter((k) => k.domain === 'sensor').map((k) => k.key));
  const resets = keys.filter((k) => k.domain === 'button' && k.key.startsWith('reset_')).map((k) => k.key);
  const out: Consumable[] = [];
  for (const s of sensors) {
    const m = /^(.+)_left$/.exec(s);
    if (!m || s.endsWith('_time_left')) continue;
    const part = m[1];
    const time = sensors.has(`${part}_time_left`) ? `${part}_time_left` : undefined;
    const reset = resets.find((r) => r === `reset_${part}`) ?? resets.find((r) => part.startsWith(r.slice(6)));
    out.push({ key: part, percent: s, hours: time, reset });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/* ---------- schedule and history ---------- */

export interface ScheduleItem {
  id: number;
  time: string;
  enabled: boolean;
  days: number; // how many days a week (0 = once)
  everyDay: boolean;
  suction?: number;
  water?: number;
  rooms: number[];
}

export function parseSchedule(v: unknown): ScheduleItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .flatMap((raw): ScheduleItem[] => {
      const s = raw as Record<string, unknown>;
      if (!s || typeof s.time !== 'string' || s.invalid) return [];
      const rep = typeof s.repeats === 'string' ? s.repeats : '';
      const days = [...rep].filter((c) => c === '1').length;
      return [
        {
          id: Number(s.id) || 0,
          time: s.time,
          enabled: !!s.enabled,
          days: s.once ? 0 : days,
          everyDay: days === 7,
          suction: typeof s.suction_level === 'number' ? s.suction_level : undefined,
          water: typeof s.water_volume === 'number' ? s.water_volume : undefined,
          rooms: Array.isArray(s.options) ? s.options.map(Number).filter(Number.isFinite) : [],
        },
      ];
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

export interface HistoryRun {
  label: string;
  at: number; // epoch ms
  minutes?: number;
  area?: number; // m²
  completed?: boolean;
  status?: string;
}

// The history sensor's attributes: one entry per run, keyed by a date label.
export function parseHistory(attrs: Record<string, unknown> | undefined): HistoryRun[] {
  if (!attrs) return [];
  const runs: HistoryRun[] = [];
  for (const [label, raw] of Object.entries(attrs)) {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.timestamp !== 'number') continue;
    const n = (v: unknown) => {
      const x = parseFloat(String(v ?? ''));
      return Number.isFinite(x) ? x : undefined;
    };
    runs.push({
      label,
      at: r.timestamp * 1000,
      minutes: n(r.cleaning_time),
      area: n(r.cleaned_area),
      completed: typeof r.completed === 'boolean' ? r.completed : undefined,
      status: typeof r.status === 'string' ? r.status : undefined,
    });
  }
  return runs.sort((a, b) => b.at - a.at);
}

// Index of a select option in its list (the clean services take suction 0–3 and water 1–3 by position).
export function optionIndex(options: unknown, value: string | undefined): number | undefined {
  if (!Array.isArray(options) || value === undefined) return undefined;
  const i = options.findIndex((o) => String(o).toLowerCase() === value.toLowerCase());
  return i >= 0 ? i : undefined;
}
