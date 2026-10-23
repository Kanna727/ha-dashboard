import type { HassEntity } from 'home-assistant-js-websocket';
import type { HistoryPoint } from '../src/ha/api';

// A fictional standing desk for the mock (standing_desk_*, found by its height
// number like a real one), with the entities of an ESPHome desk controller that
// emulates the keypad: a status (Idle / Raising / Lowering), a cover that heads
// for the top or bottom of the range, Stop, 1 cm nudges, memory keys M1–M4
// (M3 Stand, M4 Sit) with "Set" buttons, an idle counter, a child lock toggle
// and calibration numbers. It moves at the real speed (about 2.5 cm/s).

const BASE = 'standing_desk';
const SPEED = 2.5; // cm/s
const FROZEN = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mockFreeze');
const now = new Date().toISOString();
export const DESK_DEVICE = { id: 'dev_desk', name: 'Desk', areaId: 'workroom', model: 'esp32dev', disabled: false };

const presets: Record<string, number> = { desk_m1: 85, desk_m2: 118, desk_m3_stand: 109, desk_m4_sit: 72.5 };
let height = 72.5;
let min = 62;
let max = 127;
let idle = 1840; // s since the height last changed
let bootAt = Date.now() - 26 * 3600_000;

function e(entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  return { entity_id, state, attributes, last_changed: now, last_updated: now, context: { id: 'mock', parent_id: null, user_id: null } };
}

const id = (domain: string, key: string) => `${domain}.${BASE}_${key}`;
const percent = (h: number) => Math.round(((h - min) / (max - min)) * 100);
const idleText = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
const box = (unit: string, lo: number, hi: number, step: number) => ({ unit_of_measurement: unit, min: lo, max: hi, step, mode: 'box' });

export function deskEntities(): HassEntity[] {
  return [
    e(id('cover', 'height_slider'), 'open', { friendly_name: 'Desk Height Slider', current_position: percent(height), assumed_state: true, supported_features: 15 }),
    e(id('number', 'desk_height'), height.toFixed(1), { friendly_name: 'Desk Desk Height', min: 15, max: 131, step: 0.1, mode: 'slider', unit_of_measurement: 'cm' }),
    e(id('sensor', 'desk_height'), height.toFixed(1), { friendly_name: 'Desk Desk Height', unit_of_measurement: 'cm', state_class: 'measurement' }),
    e(id('sensor', 'desk_height_percent'), String(percent(height)), { friendly_name: 'Desk Desk Height Percent', unit_of_measurement: '%' }),
    e(id('sensor', 'desk_status'), 'Idle', { friendly_name: 'Desk Desk Status' }),
    e(id('number', 'min_height'), String(min), { friendly_name: 'Desk Min Height', ...box('cm', 15, 131, 0.01) }),
    e(id('number', 'max_height'), String(max), { friendly_name: 'Desk Max Height', ...box('cm', 15, 131, 0.1) }),
    e(id('number', 'offset_up_by'), '0', { friendly_name: 'Desk Offset Up by', ...box('cm', 0, 40, 0.1) }),
    e(id('number', 'offset_down_by'), '0', { friendly_name: 'Desk Offset Down by', ...box('cm', 0, 40, 0.1) }),
    e(id('number', 'nudge_delay'), '400', { friendly_name: 'Desk Nudge Delay', ...box('ms', 0, 700, 1) }),
    ...['desk_m1', 'desk_m2', 'desk_m3_stand', 'desk_m4_sit'].flatMap((k) => [
      e(id('button', k), 'unknown', { friendly_name: `Desk ${k}` }),
      e(id('button', `set_${k}`), 'unknown', { friendly_name: `Desk Set ${k}` }),
    ]),
    ...['desk_nudge_up', 'desk_nudge_down', 'desk_stop', 'reset_idle_timer', 'esp32_restart', 'child_lock'].map((k) => e(id('button', k), 'unknown', { friendly_name: `Desk ${k}` })),
    e(id('binary_sensor', 'child_lock'), 'off', { friendly_name: 'Desk Child Lock' }),
    e(id('switch', 'enable_idle_counter'), 'on', { friendly_name: 'Desk Enable Idle Counter' }),
    e(id('sensor', 'idle_time'), String(idle), { friendly_name: 'Desk Idle Time', unit_of_measurement: 's', device_class: 'duration' }),
    e(id('sensor', 'idle_timestamp'), idleText(idle), { friendly_name: 'Desk Idle Timestamp' }),
    e(id('sensor', 'esp32_uptime'), new Date(bootAt).toISOString(), { friendly_name: 'Desk ESP32 Uptime', device_class: 'timestamp' }),
  ];
}

/* ---------- pretend moves ---------- */

type Patch = (id: string, update: Partial<HassEntity> & { attributes?: Record<string, unknown> }) => void;

let timer = 0;
let ticking = 0;
let idleOn = true;
let locked = false;

function show(patch: Patch, moving?: 'up' | 'down') {
  const s = height.toFixed(1);
  patch(id('number', 'desk_height'), { state: s });
  patch(id('sensor', 'desk_height'), { state: s });
  patch(id('sensor', 'desk_height_percent'), { state: String(percent(height)) });
  patch(id('sensor', 'desk_status'), { state: moving === 'up' ? 'Raising' : moving === 'down' ? 'Lowering' : 'Idle' });
  patch(id('cover', 'height_slider'), { state: height <= min ? 'closed' : 'open', attributes: { current_position: percent(height) } });
  if (moving) setIdle(patch, 0);
}

function setIdle(patch: Patch, s: number) {
  idle = s;
  patch(id('sensor', 'idle_time'), { state: String(idle) });
  patch(id('sensor', 'idle_timestamp'), { state: idleText(idle) });
}

// The idle counter ticks once a second, like the controller's.
function startIdle(patch: Patch) {
  if (ticking || FROZEN) return;
  ticking = window.setInterval(() => idleOn && setIdle(patch, idle + 1), 1000);
}

function stop(patch: Patch) {
  window.clearInterval(timer);
  timer = 0;
  show(patch);
}

function moveTo(target: number, patch: Patch) {
  window.clearInterval(timer);
  const goal = Math.min(131, Math.max(15, target));
  const dir = goal > height ? 'up' : 'down';
  if (Math.abs(goal - height) < 0.05) return show(patch);
  let last = performance.now();
  timer = window.setInterval(() => {
    const t = performance.now();
    const step = (SPEED * (t - last)) / 1000;
    last = t;
    height = dir === 'up' ? Math.min(goal, height + step) : Math.max(goal, height - step);
    if (height === goal) return stop(patch);
    show(patch, dir);
  }, 250);
  show(patch, dir);
}

// Returns true when the call was the desk's.
export function deskService(domain: string, service: string, data: Record<string, unknown>, ids: string[], patch: Patch): boolean {
  const target = ids.find(isDeskEntity);
  if (!target) return false;
  startIdle(patch);
  const key = target.slice(target.indexOf('.') + 1 + BASE.length + 1);
  if (domain === 'cover') {
    if (service === 'open_cover') moveTo(max, patch);
    else if (service === 'close_cover') moveTo(min, patch);
    else if (service === 'stop_cover') stop(patch);
    else if (service === 'set_cover_position') moveTo(min + ((data.position as number) / 100) * (max - min), patch);
    return true;
  }
  if (domain === 'number' && service === 'set_value') {
    const v = Number(data.value);
    patch(target, { state: String(v) });
    if (key === 'desk_height') moveTo(v, patch);
    else if (key === 'min_height') min = v;
    else if (key === 'max_height') max = v;
    return true;
  }
  if (domain === 'switch') {
    const on = service === 'turn_on' || (service === 'toggle' && idleOn === false);
    if (key === 'enable_idle_counter') idleOn = on;
    patch(target, { state: on ? 'on' : 'off' });
    return true;
  }
  if (domain === 'button' && service === 'press') {
    patch(target, { state: new Date().toISOString() });
    if (presets[key] !== undefined) moveTo(presets[key], patch);
    else if (key.startsWith('set_') && presets[key.slice(4)] !== undefined) presets[key.slice(4)] = Math.round(height * 10) / 10;
    else if (key === 'desk_nudge_up') moveTo(height + 1, patch);
    else if (key === 'desk_nudge_down') moveTo(height - 1, patch);
    else if (key === 'desk_stop') stop(patch);
    else if (key === 'reset_idle_timer') setIdle(patch, 0);
    else if (key === 'child_lock') {
      locked = !locked;
      patch(id('binary_sensor', 'child_lock'), { state: locked ? 'on' : 'off' });
    } else if (key === 'esp32_restart') {
      bootAt = Date.now();
      patch(id('sensor', 'esp32_uptime'), { state: new Date(bootAt).toISOString() });
    }
    return true;
  }
  return true;
}

// Mounted by the mock provider: the idle counter runs from the start.
export function startDeskMock(patch: Patch) {
  startIdle(patch);
}

/* ---------- history ---------- */

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A week of desk days: sitting most of the time, standing for a few spells
// between 9 and 7, nothing at weekends. Ends at the current height.
export function deskHistory(hours: number): HistoryPoint[] {
  const rand = seeded(9);
  const end = Date.now();
  const start = end - hours * 3600_000;
  const sit = presets.desk_m4_sit;
  const stand = presets.desk_m3_stand;
  const pts: HistoryPoint[] = [{ t: start, v: sit }];
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);
  for (let d = day.getTime(); d < end; d += 86_400_000) {
    const wd = new Date(d).getDay();
    if (wd === 0 || wd === 6) continue;
    let t = d + (9 + rand()) * 3600_000;
    while (t < d + 19 * 3600_000) {
      t += (40 + rand() * 80) * 60_000; // sitting
      const spell = (15 + rand() * 45) * 60_000;
      if (t + spell > end || t + spell > d + 19 * 3600_000) break;
      if (t > start) {
        pts.push({ t, v: stand + Math.round((rand() - 0.5) * 4) / 2 });
        pts.push({ t: t + spell, v: sit });
      }
      t += spell;
    }
  }
  pts.push({ t: end - idle * 1000, v: height });
  return pts.filter((p) => p.t >= start).sort((a, b) => a.t - b.t);
}

export const isDeskEntity = (x: string) => x.slice(x.indexOf('.') + 1).startsWith(`${BASE}_`);
