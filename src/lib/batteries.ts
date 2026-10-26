import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import type { RegistrySnapshot, StatPoint } from '../ha/api';

export type BatteryStatus = 'critical' | 'low' | 'ok' | 'offline';

export interface BatteryRow {
  entity: string;
  name: string;
  area?: string; // area id of the entity's device
  level?: number; // % (undefined for a low/ok binary sensor, or offline)
  status: BatteryStatus;
  charging?: boolean; // only for devices that report charging (phones, tablets)
  rechargeable: boolean; // reports a charging state: no drain estimate
}

export const CRITICAL = 10;
const DAY = 86_400_000;

const isBatterySensor = (s: HassEntity) => s.entity_id.startsWith('sensor.') && s.attributes.device_class === 'battery' && s.attributes.unit_of_measurement === '%';
const isBatteryBinary = (s: HassEntity) => s.entity_id.startsWith('binary_sensor.') && s.attributes.device_class === 'battery';
const offline = (s: HassEntity) => s.state === 'unavailable' || s.state === 'unknown';

// "Bedroom Bedroom Dual Button Battery" → "Bedroom Dual Button": drops the
// trailing "Battery (level)" and a repeated leading word group (HA prefixes the
// device name with its area, and many devices already carry the area).
export function batteryName(friendly: string): string {
  let n = friendly.replace(/\s*battery(\s*(level|low|percentage))?\s*$/i, '').trim();
  const words = n.split(/\s+/);
  for (let k = Math.floor(words.length / 2); k >= 1; k--) {
    const a = words.slice(0, k).join(' ').toLowerCase();
    const b = words.slice(k, 2 * k).join(' ').toLowerCase();
    if (a === b) {
      n = words.slice(k).join(' ');
      break;
    }
  }
  return n || friendly;
}

// Charging state from a sibling entity on the same device: a battery_charging
// binary sensor, or a "battery state" sensor (Charging / Full / Discharging).
function chargingOf(siblings: HassEntity[]): boolean | undefined {
  for (const s of siblings) {
    if (s.entity_id.startsWith('binary_sensor.') && s.attributes.device_class === 'battery_charging' && !offline(s)) return s.state === 'on';
  }
  for (const s of siblings) {
    if (s.entity_id.startsWith('sensor.') && /_battery_state$/.test(s.entity_id) && !offline(s)) return /^(charging|full)$/i.test(s.state);
  }
  return undefined;
}

// Every battery in HA: % sensors (device_class battery) and battery-low binary
// sensors where the device has no % sensor. Nothing to configure; `hide` drops
// entity IDs. Sorted worst first: critical, low, offline, then by level.
export function batteryRows(states: HassEntities, registry: RegistrySnapshot | undefined, low: number, hide: string[] = []): BatteryRow[] {
  const deviceOf = new Map(registry?.entities.map((e) => [e.entityId, e.deviceId]) ?? []);
  const areaOf = new Map(registry?.devices.map((d) => [d.id, d.areaId ?? undefined]) ?? []);
  const byDevice = new Map<string, string[]>();
  for (const e of registry?.entities ?? []) byDevice.set(e.deviceId, [...(byDevice.get(e.deviceId) ?? []), e.entityId]);
  const siblings = (id: string): HassEntity[] => {
    const dev = deviceOf.get(id);
    const ids = dev ? byDevice.get(dev) ?? [] : [];
    // Without the registry, fall back to the entity ID's own prefix.
    const prefix = id.replace(/^[a-z_]+\./, '').replace(/_battery(_level)?$/, '');
    const guess = [`sensor.${prefix}_battery_state`, `binary_sensor.${prefix}_charging`, `binary_sensor.${prefix}_battery_charging`];
    return [...new Set([...ids, ...guess])].map((x) => states[x]).filter((s): s is HassEntity => !!s);
  };
  const hidden = new Set(hide);

  const all = Object.values(states).filter((s) => !hidden.has(s.entity_id));
  const percent = all.filter(isBatterySensor);
  const devicesWithPercent = new Set(percent.map((s) => deviceOf.get(s.entity_id)).filter(Boolean));
  const binaries = all.filter((s) => isBatteryBinary(s) && !devicesWithPercent.has(deviceOf.get(s.entity_id)));

  const rows: BatteryRow[] = [...percent, ...binaries].map((s) => {
    const name = batteryName(String(s.attributes.friendly_name ?? s.entity_id));
    const area = areaOf.get(deviceOf.get(s.entity_id) ?? '');
    const charging = chargingOf(siblings(s.entity_id));
    const base = { entity: s.entity_id, name, area, charging, rechargeable: charging !== undefined };
    if (offline(s)) return { ...base, status: 'offline' as const };
    if (isBatteryBinary(s)) return { ...base, status: s.state === 'on' ? ('low' as const) : ('ok' as const) };
    const level = parseFloat(s.state);
    if (!Number.isFinite(level)) return { ...base, status: 'offline' as const };
    const status: BatteryStatus = level <= CRITICAL ? 'critical' : level <= low ? 'low' : 'ok';
    return { ...base, level, status };
  });

  const rank: Record<BatteryStatus, number> = { critical: 0, low: 1, offline: 2, ok: 3 };
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || (a.level ?? 101) - (b.level ?? 101) || a.name.localeCompare(b.name));
}

export type OutlookKind = 'drain' | 'slow' | 'recharge' | 'flat' | 'short' | 'none';

// What a battery's history says (`batteryOutlook`): draining with `days` left
// (a year or less), draining slower than that ('slow', days still given),
// charged now and then ('recharge': days until it needs charging, from the
// current cycle, when it can tell), no drop measured yet ('flat'), too
// little history since the last battery change ('short'), or no history at all ('none').
export interface Outlook {
  kind: OutlookKind;
  days?: number;
}

const RISE = 15; // a day-to-day jump of 15 points or more is a new battery or a charge

// From daily mean levels (long-term statistics) over at most `window` days:
// a least-squares line through the readings since the last rise. A rise spread
// over consecutive days counts once; more than one rise in the window means
// the battery is recharged (a toothbrush, a robot on its dock).
export function batteryOutlook(points: StatPoint[], level: number, now: number, window = 120): Outlook {
  const pts = points
    .filter((p) => p.mean !== undefined && Number.isFinite(p.mean) && p.start >= now - window * DAY)
    .map((p) => ({ t: p.start, v: p.mean! }));
  if (!pts.length) return { kind: 'none' };
  const rising = pts.map((p, i) => i > 0 && p.v - pts[i - 1].v >= RISE);
  const events = rising.filter((r, i) => r && !rising[i - 1]).length;
  const last = rising.lastIndexOf(true);
  const cycle = last >= 0 ? pts.slice(last) : pts;
  const recharged = events > 1;
  const span = cycle.length ? cycle[cycle.length - 1].t - cycle[0].t : 0;
  if (cycle.length < (recharged ? 4 : 7) || span < (recharged ? 3 : 6) * DAY) return { kind: recharged ? 'recharge' : 'short' };
  const n = cycle.length;
  const mt = cycle.reduce((s, p) => s + p.t, 0) / n;
  const mv = cycle.reduce((s, p) => s + p.v, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of cycle) {
    num += (p.t - mt) * (p.v - mv);
    den += (p.t - mt) ** 2;
  }
  const perDay = (num / den) * DAY; // % per day
  if (!(perDay < -0.02)) return { kind: recharged ? 'recharge' : 'flat' };
  const days = Math.max(0, Math.round(level / -perDay));
  if (recharged) return { kind: 'recharge', days };
  return { kind: days > 365 ? 'slow' : 'drain', days };
}

// The outlook as a short phrase for a battery's line.
export function fmtOutlook(o: Outlook): string {
  switch (o.kind) {
    case 'drain':
      return `${fmtDaysLeft(o.days!)} left`;
    case 'slow':
      return 'over a year left';
    case 'recharge':
      return o.days === undefined ? 'recharged now and then' : o.days < 1 ? 'needs charging now' : `needs charging in ${fmtDaysLeft(o.days)}`;
    case 'flat':
      return 'no drop measured yet';
    case 'short':
      return 'new battery, still measuring';
    case 'none':
      return 'no history yet';
  }
}

// "~5 days", "~3 weeks", "~4 months".
export function fmtDaysLeft(days: number): string {
  if (days < 1) return 'any day now';
  if (days < 14) return `~${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `~${Math.round(days / 7)} weeks`;
  return `~${Math.round(days / 30)} months`;
}

// The Timeline's axis labels. Dots closer than `minGap` (a fraction of the
// axis) share one label; each label goes in the lowest row where it doesn't
// touch another. A label at `at` is drawn from at·W − at·width to
// at·W + (1 − at)·width (it slides from left- to right-aligned along the axis).
export function clusterByPosition<T extends { at: number }>(items: T[], minGap = 0.025): T[][] {
  const sorted = [...items].sort((a, b) => a.at - b.at);
  const out: T[][] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && it.at - last[0].at < minGap) last.push(it);
    else out.push([it]);
  }
  return out;
}

export function labelRows(labels: { at: number; width: number }[], axisWidth: number, gap = 10): number[] {
  const ends: number[] = []; // right edge of the last label in each row
  return labels.map(({ at, width }) => {
    const start = at * axisWidth - at * width;
    let row = ends.findIndex((end) => start >= end + gap);
    if (row === -1) row = ends.push(0) - 1;
    ends[row] = start + width;
    return row;
  });
}
