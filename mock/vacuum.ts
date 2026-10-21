import type { HassEntity } from 'home-assistant-js-websocket';
import type { Line, Pt, Rect } from '../src/lib/vacuum';

// A fictional robot vacuum for the mock (vacuum.robot, matching the example
// config): the entities a Dreame-style integration exposes, a map image drawn
// here on a canvas, and pretend cleaning runs, zone edits, merges and splits.

const BASE = 'robot';
const NAME = 'Robot';
const now = new Date().toISOString();

interface MRoom {
  id: number;
  name: string;
  box: Rect;
  color: string;
  order: number;
}

// Vacuum coordinates in mm; the image is 800 × 560 px at 0.05 px/mm, origin at its centre.
const W = 800;
const H = 560;
const S = 0.05;
const toPx = (p: Pt): Pt => ({ x: W / 2 + p.x * S, y: H / 2 - p.y * S });
const CALIBRATION = [
  { vacuum: { x: 0, y: 0 }, map: toPx({ x: 0, y: 0 }) },
  { vacuum: { x: 1000, y: 0 }, map: toPx({ x: 1000, y: 0 }) },
  { vacuum: { x: 0, y: 1000 }, map: toPx({ x: 0, y: 1000 }) },
];

const COLORS = ['#f4c742', '#64d0e0', '#84b4ff', '#ff9c64', '#8fd694', '#e98bd9', '#c7a4ff'];

const model = {
  rooms: [
    { id: 1, name: 'Living room', box: [-7000, -4200, -800, 1200], color: COLORS[0], order: 0 },
    { id: 2, name: 'Kitchen', box: [-7000, 1200, -3000, 4600], color: COLORS[1], order: 0 },
    { id: 3, name: 'Hallway', box: [-3000, 1200, 600, 4600], color: COLORS[2], order: 0 },
    { id: 4, name: 'Bedroom', box: [600, -800, 7000, 4600], color: COLORS[3], order: 0 },
    { id: 5, name: 'Study', box: [-800, -4200, 4200, -800], color: COLORS[4], order: 0 },
  ] as MRoom[],
  walls: [[4200, -4200, 4200, -800]] as Line[],
  noGo: [[-6600, -3900, -5200, -2900]] as Rect[],
  noMop: [[1200, 2400, 3400, 4300]] as Rect[],
  dock: { x: -2600, y: 1500, a: 90 },
  robot: { x: -2600, y: 1500, a: 270 },
  path: [] as Pt[],
  mapName: 'Ground floor',
};

let picture = '';
function render(): string {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return '';
  const rect = (r: Rect) => {
    const a = toPx({ x: r[0], y: r[3] });
    const b = toPx({ x: r[2], y: r[1] });
    return [a.x, a.y, b.x - a.x, b.y - a.y] as const;
  };
  g.lineJoin = 'round';
  for (const r of model.rooms) {
    g.fillStyle = r.color;
    g.fillRect(...rect(r.box));
  }
  g.strokeStyle = '#9a9a9a';
  g.lineWidth = 5;
  for (const r of model.rooms) g.strokeRect(...rect(r.box));
  // Furniture specks, so the map isn't flat.
  g.fillStyle = '#9a9a9a';
  for (const [x, y] of [[-5000, -1500], [-4200, -2600], [2600, 1800], [3000, 1800], [1800, -2500]]) {
    const p = toPx({ x, y });
    g.fillRect(p.x - 4, p.y - 4, 8, 8);
  }
  // The integration draws restricted zones into the image too.
  g.lineWidth = 2;
  g.fillStyle = 'rgba(248,113,113,0.25)';
  g.strokeStyle = '#f87171';
  for (const z of model.noGo) {
    g.fillRect(...rect(z));
    g.strokeRect(...rect(z));
  }
  g.fillStyle = 'rgba(56,189,248,0.2)';
  g.strokeStyle = '#38bdf8';
  for (const z of model.noMop) {
    g.fillRect(...rect(z));
    g.strokeRect(...rect(z));
  }
  g.strokeStyle = '#f87171';
  g.lineWidth = 4;
  for (const w of model.walls) {
    const a = toPx({ x: w[0], y: w[1] });
    const b = toPx({ x: w[2], y: w[3] });
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  if (model.path.length > 1) {
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    model.path.forEach((p, i) => (i ? g.lineTo(toPx(p).x, toPx(p).y) : g.moveTo(toPx(p).x, toPx(p).y)));
    g.stroke();
  }
  g.font = '600 15px sans-serif';
  g.fillStyle = '#1b1b1b';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const r of model.rooms) {
    const p = toPx({ x: (r.box[0] + r.box[2]) / 2, y: (r.box[1] + r.box[3]) / 2 });
    g.fillText(r.name, p.x, p.y);
  }
  const d = toPx(model.dock);
  g.fillStyle = '#34d399';
  g.beginPath();
  g.arc(d.x, d.y, 9, 0, Math.PI * 2);
  g.fill();
  const rb = toPx(model.robot);
  g.fillStyle = '#4b5563';
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(rb.x, rb.y, 10, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  return c.toDataURL('image/png');
}

const roomsAttr = () =>
  Object.fromEntries(
    model.rooms.map((r) => [
      String(r.id),
      { x0: r.box[0], y0: r.box[1], x1: r.box[2], y1: r.box[3], x: (r.box[0] + r.box[2]) / 2, y: (r.box[1] + r.box[3]) / 2, room_id: r.id, name: r.name, custom_name: r.name, order: r.order, icon: 'mdi:home-outline' },
    ]),
  );

const area = (z: Rect) => ({ x0: z[0], y0: z[1], x1: z[2], y1: z[1], x2: z[2], y2: z[3], x3: z[0], y3: z[3], angle: 0 });

function mapAttrs(): Record<string, unknown> {
  picture = render();
  return {
    friendly_name: `${NAME} Current Map`,
    entity_picture: picture,
    calibration_points: CALIBRATION,
    rooms: roomsAttr(),
    vacuum_position: model.robot,
    charger_position: model.dock,
    virtual_walls: model.walls.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1 })),
    no_go_areas: model.noGo.map(area),
    no_mopping_areas: model.noMop.map(area),
    map_id: 3,
    saved_map_id: 100,
    rotation: 0,
    recovery_map_picture: { '08/10/26 15:02:35: Map2 (Edited Map)': `${picture}#index=2`, '08/10/26 14:50:13: Map1 (Original Map)': `${picture}#index=1` },
    cleaning_history_picture: { [`1: ${historyLabel.replace('-', '/')} - Cleaning (Completed)`]: picture },
  };
}

const e = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity => ({
  entity_id,
  state,
  attributes: { friendly_name: `${NAME} ${entity_id.split('.')[1].slice(BASE.length + 1).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())}`, ...attributes },
  last_changed: now,
  last_updated: now,
  context: { id: '', parent_id: null, user_id: null },
});

const historyAt = Date.now() - 26 * 3600_000;
const hd = new Date(historyAt);
const historyLabel = `${String(hd.getMonth() + 1).padStart(2, '0')}-${String(hd.getDate()).padStart(2, '0')} ${String(hd.getHours()).padStart(2, '0')}:${String(hd.getMinutes()).padStart(2, '0')}`;

const SUCTION = ['Quiet', 'Standard', 'Strong', 'Turbo'];
const WATER = ['Low', 'Medium', 'High'];
const ROOM_SETTINGS: [string, string[]][] = [
  ['suction_level', SUCTION],
  ['water_volume', WATER],
  ['cleaning_times', ['1', '2', '3']],
  ['cleaning_mode', ['Sweeping', 'Mopping', 'Sweeping and mopping']],
];
const UNAVAILABLE = { options: ['unavailable'] };

function roomEntities(custom: boolean): HassEntity[] {
  return model.rooms.flatMap((r) => [
    ...ROOM_SETTINGS.map(([k, options]) =>
      e(`select.${BASE}_room_${r.id}_${k}`, custom ? (k === 'cleaning_times' ? '1' : options[1]) : 'unavailable', {
        ...(custom ? { options } : UNAVAILABLE),
        friendly_name: `${NAME} ${k.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())} ${r.name}`,
      }),
    ),
    e(`select.${BASE}_room_${r.id}_name`, r.name, {
      options: ['Living room', 'Kitchen', 'Bedroom', 'Study', 'Hallway', 'Bathroom', 'Balcony', 'Dining room'],
      room_id: r.id,
      friendly_name: `${NAME} Room ${r.id} Name`,
    }),
  ]);
}

const SCHEDULE = [
  { id: 1, enabled: true, invalid: false, time: '10:30', repeats: '0111110', once: false, map_id: '0', suction_level: 1, water_volume: 2, options: ['1', '3'] },
  { id: 2, enabled: false, invalid: false, time: '21:00', repeats: '1111111', once: false, map_id: '0', suction_level: 2, water_volume: 2, options: null },
];

export function vacuumEntities(): HassEntity[] {
  return [
    e(`vacuum.${BASE}`, 'docked', {
      friendly_name: NAME,
      fan_speed_list: ['silent', 'standard', 'strong', 'turbo'],
      fan_speed: 'standard',
      status: 'charging_completed',
      error: 'No error',
      battery: 100,
      charging: false,
      docked: true,
      segment_cleaning: false,
      zone_cleaning: false,
      spot_cleaning: false,
      schedule: SCHEDULE,
      supported_features: 31676,
    }),
    e(`camera.${BASE}_map`, now, mapAttrs()),
    e(`camera.${BASE}_map_1`, now, { friendly_name: `${NAME} Saved Map 1`, entity_picture: picture, map_name: model.mapName, map_id: 100 }),
    e(`sensor.${BASE}_battery_level`, '100', { unit_of_measurement: '%', device_class: 'battery' }),
    e(`sensor.${BASE}_cleaning_time`, '0', { unit_of_measurement: 'min' }),
    e(`sensor.${BASE}_cleaned_area`, '0', { unit_of_measurement: 'm²' }),
    e(`sensor.${BASE}_current_room`, 'Hallway', { room_id: 3 }),
    e(`sensor.${BASE}_status`, 'charging_completed'),
    e(`sensor.${BASE}_state`, 'charging_completed'),
    e(`sensor.${BASE}_task_status`, 'completed'),
    e(`sensor.${BASE}_error`, 'no_error'),
    e(`sensor.${BASE}_water_tank`, 'installed'),
    e(`sensor.${BASE}_dust_collection`, 'available'),
    e(`sensor.${BASE}_auto_empty_status`, 'idle'),
    e(`sensor.${BASE}_charging_status`, 'charging_completed'),
    e(`sensor.${BASE}_main_brush_left`, '91', { unit_of_measurement: '%', friendly_name: `${NAME} Main Brush` }),
    e(`sensor.${BASE}_main_brush_time_left`, '274', { unit_of_measurement: 'h' }),
    e(`sensor.${BASE}_side_brush_left`, '87', { unit_of_measurement: '%', friendly_name: `${NAME} Side Brush` }),
    e(`sensor.${BASE}_side_brush_time_left`, '174', { unit_of_measurement: 'h' }),
    e(`sensor.${BASE}_filter_left`, '8', { unit_of_measurement: '%', friendly_name: `${NAME} Filter` }),
    e(`sensor.${BASE}_filter_time_left`, '12', { unit_of_measurement: 'h' }),
    e(`sensor.${BASE}_sensor_dirty_left`, '64', { unit_of_measurement: '%', friendly_name: `${NAME} Sensor Cleaning` }),
    e(`sensor.${BASE}_sensor_dirty_time_left`, '19', { unit_of_measurement: 'h' }),
    e(`sensor.${BASE}_total_cleaned_area`, '1391', { unit_of_measurement: 'm²' }),
    e(`sensor.${BASE}_total_cleaning_time`, '1544', { unit_of_measurement: 'min' }),
    e(`sensor.${BASE}_cleaning_count`, '84'),
    e(`sensor.${BASE}_first_cleaning_date`, '2024-07-21T15:32:56+00:00', { device_class: 'timestamp' }),
    e(`sensor.${BASE}_cleaning_history`, new Date(historyAt).toISOString(), {
      device_class: 'timestamp',
      [historyLabel]: { timestamp: Math.round(historyAt / 1000), cleaning_time: '64 min', cleaned_area: '43 m²', status: 'Cleaning', completed: true },
      '07-30 10:31': { timestamp: Math.round((historyAt - 6 * 86400_000) / 1000), cleaning_time: '22 min', cleaned_area: '14 m²', status: 'Room cleaning', completed: false },
    }),
    e(`sensor.${BASE}_firmware_version`, '4.3.9_1321'),
    e(`binary_sensor.${BASE}_charging_state`, 'off'),
    e(`binary_sensor.${BASE}_problem`, 'off'),
    e(`binary_sensor.${BASE}_maintenance`, 'off'),
    e(`switch.${BASE}_resume_cleaning`, 'on'),
    e(`switch.${BASE}_carpet_boost`, 'off'),
    e(`switch.${BASE}_customized_cleaning`, 'off'),
    e(`switch.${BASE}_child_lock`, 'off'),
    e(`switch.${BASE}_dnd`, 'on', { friendly_name: `${NAME} DnD` }),
    e(`switch.${BASE}_multi_floor_map`, 'on'),
    e(`switch.${BASE}_auto_dust_collecting`, 'on', { friendly_name: `${NAME} Auto-Empty` }),
    e(`switch.${BASE}_cleaning_sequence`, 'off'),
    ...['reset_main_brush', 'reset_side_brush', 'reset_filter', 'reset_sensor', 'start_auto_empty', 'clear_warning', 'start_fast_mapping', 'start_mapping', 'backup_saved_map'].map((k) =>
      e(`button.${BASE}_${k}`, 'unknown'),
    ),
    e(`number.${BASE}_volume`, '80', { min: 0, max: 100, step: 1, mode: 'slider', unit_of_measurement: '%' }),
    e(`number.${BASE}_mop_cleaning_remainder`, '0', { min: 0, max: 180, step: 15, mode: 'box', unit_of_measurement: 'min' }),
    e(`select.${BASE}_suction_level`, 'Standard', { options: SUCTION }),
    e(`select.${BASE}_water_volume`, 'Medium', { options: WATER }),
    e(`select.${BASE}_cleaning_mode`, 'Sweeping and mopping', { options: ['Sweeping', 'Mopping', 'Sweeping and mopping'] }),
    e(`select.${BASE}_carpet_sensitivity`, 'Medium', { options: ['Low', 'Medium', 'High'] }),
    e(`select.${BASE}_auto_empty_frequency`, '1x', { options: ['1x', '2x', '3x'], friendly_name: `${NAME} Auto-Empty Frequency` }),
    e(`select.${BASE}_map_rotation`, '0', { options: ['0', '90', '180', '270'], unit_of_measurement: '°' }),
    e(`select.${BASE}_selected_map`, model.mapName, { options: [model.mapName], map_id: 100 }),
    e(`time.${BASE}_dnd_start`, '22:00:00', { friendly_name: `${NAME} DnD Start Time` }),
    e(`time.${BASE}_dnd_end`, '08:00:00', { friendly_name: `${NAME} DnD End Time` }),
    ...roomEntities(false),
  ];
}

export const VACUUM_DEVICE = { id: 'dev_robot', name: NAME, areaId: null, model: 'Robot S10', disabled: false };

/* ---------- pretend runs and edits ---------- */

type Patch = (id: string, update: Partial<HassEntity> & { attributes?: Record<string, unknown> }) => void;

let timer = 0;
let targets: Pt[] = [];
let minutes = 0;
let m2 = 0;
let after: 'dock' | 'idle' = 'dock';

// A lawnmower sweep across a box, a few lanes.
function sweep(r: Rect): Pt[] {
  const lanes = 4;
  const pts: Pt[] = [];
  for (let i = 0; i <= lanes; i++) {
    const x = r[0] + 300 + ((r[2] - r[0] - 600) * i) / lanes;
    pts.push(i % 2 ? { x, y: r[3] - 300 } : { x, y: r[1] + 300 }, i % 2 ? { x, y: r[1] + 300 } : { x, y: r[3] - 300 });
  }
  return pts;
}

function redraw(patch: Patch) {
  patch(`camera.${BASE}_map`, { state: new Date().toISOString(), attributes: mapAttrs() });
  patch(`camera.${BASE}_map_1`, { attributes: { entity_picture: picture, map_name: model.mapName } });
}

function run(patch: Patch, label: Record<string, unknown>, path: Pt[], then: 'dock' | 'idle' = 'dock') {
  window.clearInterval(timer);
  targets = path;
  after = then;
  model.path = [{ x: model.robot.x, y: model.robot.y }];
  patch(`vacuum.${BASE}`, { state: 'cleaning', attributes: { status: 'cleaning', docked: false, segment_cleaning: false, zone_cleaning: false, spot_cleaning: false, ...label } });
  tick(patch);
}

function tick(patch: Patch) {
  timer = window.setInterval(() => {
    const t = targets[0];
    if (!t) {
      window.clearInterval(timer);
      if (after === 'idle') {
        patch(`vacuum.${BASE}`, { state: 'idle', attributes: { status: 'idle' } });
        return redraw(patch);
      }
      // Head home.
      after = 'idle';
      targets = [{ x: model.dock.x, y: model.dock.y }];
      patch(`vacuum.${BASE}`, { state: 'returning', attributes: { status: 'back_home', segment_cleaning: false, zone_cleaning: false, spot_cleaning: false } });
      timer = window.setInterval(() => step(patch, true), 500);
      return;
    }
    step(patch, false);
  }, 500);
}

function step(patch: Patch, home: boolean) {
  const t = targets[0];
  if (!t) return;
  const dx = t.x - model.robot.x;
  const dy = t.y - model.robot.y;
  const d = Math.hypot(dx, dy);
  const v = 600;
  if (d <= v) {
    model.robot = { ...model.robot, x: t.x, y: t.y };
    targets.shift();
  } else {
    model.robot = { x: model.robot.x + (dx / d) * v, y: model.robot.y + (dy / d) * v, a: Math.round((Math.atan2(dy, dx) * 180) / Math.PI) };
  }
  model.path.push({ x: model.robot.x, y: model.robot.y });
  const room = model.rooms.find((r) => model.robot.x >= r.box[0] && model.robot.x <= r.box[2] && model.robot.y >= r.box[1] && model.robot.y <= r.box[3]);
  if (room) patch(`sensor.${BASE}_current_room`, { state: room.name, attributes: { room_id: room.id } });
  if (!home) {
    minutes += 0.5;
    m2 += 0.4;
    patch(`sensor.${BASE}_cleaning_time`, { state: String(Math.round(minutes)) });
    patch(`sensor.${BASE}_cleaned_area`, { state: String(Math.round(m2)) });
  }
  if (home && !targets.length) {
    window.clearInterval(timer);
    model.path = [];
    patch(`vacuum.${BASE}`, { state: 'docked', attributes: { status: 'charging', docked: true, charging: true } });
  }
  redraw(patch);
}

const roomsInOrder = () => [...model.rooms].sort((a, b) => (a.order || 99) - (b.order || 99));

// Handles vacuum.* and the integration's services for the mock robot.
// Returns true when it handled the call.
export function vacuumService(domain: string, service: string, data: Record<string, unknown>, target: string[], patch: Patch): boolean {
  const me = target.includes(`vacuum.${BASE}`);
  if (domain === 'vacuum' && me) {
    if (service === 'start') {
      minutes = 0;
      m2 = 0;
      run(patch, {}, roomsInOrder().flatMap((r) => sweep(r.box)));
    } else if (service === 'pause') {
      window.clearInterval(timer);
      patch(`vacuum.${BASE}`, { state: 'paused', attributes: { status: 'paused' } });
    } else if (service === 'stop') {
      window.clearInterval(timer);
      patch(`vacuum.${BASE}`, { state: 'idle', attributes: { status: 'idle', segment_cleaning: false, zone_cleaning: false } });
    } else if (service === 'return_to_base') {
      window.clearInterval(timer);
      targets = [];
      after = 'dock';
      tick(patch);
    }
    return true;
  }
  if (domain === 'button' && target.some((t) => t.startsWith(`button.${BASE}_reset_`))) {
    for (const t of target) {
      const part = t.slice(`button.${BASE}_reset_`.length);
      const pct = part === 'sensor' ? 'sensor_dirty' : part;
      patch(`sensor.${BASE}_${pct}_left`, { state: '100' });
    }
    return true;
  }
  if (domain === 'switch' && target.includes(`switch.${BASE}_customized_cleaning`)) {
    const on = service === 'turn_on';
    patch(`switch.${BASE}_customized_cleaning`, { state: on ? 'on' : 'off' });
    for (const ent of roomEntities(on)) patch(ent.entity_id, { state: ent.state, attributes: ent.attributes });
    return true;
  }
  if (domain !== 'dreame_vacuum' || !me) return false;
  const n = (v: unknown) => (Array.isArray(v) ? v.map(Number) : [Number(v)]);
  switch (service) {
    case 'vacuum_clean_segment':
      minutes = 0;
      m2 = 0;
      run(patch, { segment_cleaning: true }, n(data.segments).flatMap((id) => {
        const r = model.rooms.find((x) => x.id === id);
        return r ? sweep(r.box) : [];
      }));
      break;
    case 'vacuum_clean_zone': {
      const zones = (Array.isArray((data.zone as unknown[])[0]) ? data.zone : [data.zone]) as Rect[];
      run(patch, { zone_cleaning: true }, zones.flatMap(sweep));
      break;
    }
    case 'vacuum_clean_spot': {
      const p = (data.points as number[][])[0];
      run(patch, { spot_cleaning: true }, sweep([p[0] - 700, p[1] - 700, p[0] + 700, p[1] + 700]));
      break;
    }
    case 'vacuum_goto':
      run(patch, {}, [{ x: Number(data.x), y: Number(data.y) }], 'idle');
      break;
    case 'vacuum_remote_control_move_step': {
      const a = ((model.robot.a ?? 0) + Number(data.rotation)) % 360;
      const rad = (a * Math.PI) / 180;
      model.robot = { x: model.robot.x + Math.cos(rad) * Number(data.velocity) * 2, y: model.robot.y + Math.sin(rad) * Number(data.velocity) * 2, a };
      redraw(patch);
      break;
    }
    case 'vacuum_set_restricted_zone':
      model.walls = (data.walls as Line[]) ?? [];
      model.noGo = (data.zones as Rect[]) ?? [];
      model.noMop = (data.no_mops as Rect[]) ?? [];
      redraw(patch);
      break;
    case 'vacuum_rename_segment': {
      const r = model.rooms.find((x) => x.id === Number(data.segment_id));
      if (r) r.name = String(data.segment_name);
      redraw(patch);
      break;
    }
    case 'vacuum_merge_segments': {
      const [a, b] = n(data.segments).map((id) => model.rooms.find((x) => x.id === id));
      if (a && b) {
        a.box = [Math.min(a.box[0], b.box[0]), Math.min(a.box[1], b.box[1]), Math.max(a.box[2], b.box[2]), Math.max(a.box[3], b.box[3])];
        model.rooms = model.rooms.filter((x) => x !== b);
      }
      redraw(patch);
      break;
    }
    case 'vacuum_split_segments': {
      const r = model.rooms.find((x) => x.id === Number(data.segment));
      const l = data.line as number[];
      if (r && l) {
        const id = Math.max(...model.rooms.map((x) => x.id)) + 1;
        const color = COLORS[(id - 1) % COLORS.length];
        // Split across the line's longer axis, at its midpoint.
        if (Math.abs(l[2] - l[0]) < Math.abs(l[3] - l[1])) {
          const x = Math.min(Math.max((l[0] + l[2]) / 2, r.box[0] + 200), r.box[2] - 200);
          model.rooms.push({ id, name: `Room ${id}`, box: [x, r.box[1], r.box[2], r.box[3]], color, order: 0 });
          r.box = [r.box[0], r.box[1], x, r.box[3]];
        } else {
          const y = Math.min(Math.max((l[1] + l[3]) / 2, r.box[1] + 200), r.box[3] - 200);
          model.rooms.push({ id, name: `Room ${id}`, box: [r.box[0], y, r.box[2], r.box[3]], color, order: 0 });
          r.box = [r.box[0], r.box[1], r.box[2], y];
        }
      }
      redraw(patch);
      break;
    }
    case 'vacuum_set_cleaning_sequence': {
      const seq = n(data.cleaning_sequence ?? []).filter(Number.isFinite);
      for (const r of model.rooms) r.order = seq.indexOf(r.id) + 1;
      redraw(patch);
      break;
    }
    case 'vacuum_rename_map':
      model.mapName = String(data.map_name);
      patch(`select.${BASE}_selected_map`, { state: model.mapName, attributes: { options: [model.mapName] } });
      redraw(patch);
      break;
    default:
      redraw(patch);
  }
  return true;
}
