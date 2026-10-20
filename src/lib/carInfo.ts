// Extra car readings found on the car's own device (the device of CAR.lock),
// so new Kia Connect entities show up without config: trips, monthly totals,
// cabin air, the geocoded address, hazards, valet mode, service schedule and
// any other problem sensor. Pure, unit-tested; panels/useCarExtras.ts feeds it.

// Matched by entity ID suffix (Kia Connect's names, e.g. sensor.<car>_last_trip_distance).
export const CAR_EXTRA_KEYS = [
  'last_trip_start',
  'last_trip_end',
  'last_trip_distance',
  'last_trip_drive_time',
  'last_trip_idle_time',
  'last_trip_average_speed',
  'last_trip_top_speed',
  'last_trip_hard_braking',
  'last_trip_rapid_acceleration',
  'last_trip_speeding',
  'trips_today',
  'distance_today',
  'drive_time_today',
  'trips_this_month',
  'distance_this_month',
  'drive_time_this_month',
  'idle_time_this_month',
  'average_speed_this_month',
  'top_speed_this_month',
  'cabin_pm2_5',
  'geocoded_location',
  'hazard_lights',
  'accessory',
  'last_scanned_at',
  'vehicle_identification_number',
  'start_valet_mode',
  'stop_valet_mode',
] as const;
export type CarExtraKey = (typeof CAR_EXTRA_KEYS)[number];

export interface CarExtras {
  sensors: Partial<Record<CarExtraKey, string>>;
  // The device's other binary sensors (not configured, not matched above):
  // service items and extra warnings are told apart by their state at render
  // time (classifyCarBinaries), so discovery doesn't depend on states loaded.
  binaries: string[];
}

export interface CarCandidate {
  entityId: string;
  deviceId: string;
}

// Longest suffix first, so `_last_trip_top_speed` never counts as `_top_speed…`.
const BY_LENGTH = [...CAR_EXTRA_KEYS].sort((a, b) => b.length - a.length);

export function carExtras(anchorId: string, entities: CarCandidate[], known: Iterable<string>): CarExtras {
  const device = entities.find((e) => e.entityId === anchorId)?.deviceId;
  const out: CarExtras = { sensors: {}, binaries: [] };
  if (!device) return out;
  const skip = new Set(known);
  for (const e of entities) {
    if (e.deviceId !== device || skip.has(e.entityId)) continue;
    const key = BY_LENGTH.find((k) => e.entityId.endsWith(`_${k}`));
    if (key) {
      if (!out.sensors[key]) out.sensors[key] = e.entityId;
    } else if (e.entityId.startsWith('binary_sensor.')) out.binaries.push(e.entityId);
  }
  out.binaries.sort();
  return out;
}

// "MY CAR Engine Oil" on a device named "My car" -> "Engine oil";
// "Car Oil Level Warning" -> "Oil level".
export function shortName(friendly: string | undefined, deviceName: string | undefined, fallbackId: string): string {
  let n = (friendly ?? '').trim();
  if (!n) n = fallbackId.split('.')[1]?.replace(/_/g, ' ') ?? fallbackId;
  if (deviceName && n.toLowerCase().startsWith(`${deviceName.toLowerCase()} `)) n = n.slice(deviceName.length + 1);
  n = n.replace(/\s+warning$/i, '').trim();
  return n ? n[0].toUpperCase() + n.slice(1).toLowerCase() : fallbackId;
}

export interface ServiceItem {
  entity: string;
  name: string;
  due: boolean; // the integration's own verdict (binary sensor on)
  remainingKm?: number;
  remainingMonths?: number;
  intervalKm?: number;
  intervalMonths?: number;
  used: number; // share of the interval used, 0..1 (1 when overdue)
}

interface Binary {
  entity: string;
  state?: string;
  attributes?: Record<string, unknown>;
}

const fin = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isService = (a?: Record<string, unknown>) => !!a && (fin(a.interval_km) !== undefined || fin(a.remaining_km) !== undefined);

export function serviceItem(b: Binary, deviceName?: string): ServiceItem {
  const a = b.attributes ?? {};
  const remainingKm = fin(a.remaining_km);
  const remainingMonths = fin(a.remaining_months);
  const intervalKm = fin(a.interval_km);
  const intervalMonths = fin(a.interval_months);
  const share = (rem?: number, int?: number) => (rem !== undefined && int ? 1 - rem / int : 0);
  const used = Math.min(1, Math.max(0, share(remainingKm, intervalKm), share(remainingMonths, intervalMonths)));
  const due = b.state === 'on' || (remainingKm !== undefined && remainingKm <= 0) || (remainingMonths !== undefined && remainingMonths <= 0);
  return { entity: b.entity, name: shortName(a.friendly_name as string | undefined, deviceName, b.entity), due, remainingKm, remainingMonths, intervalKm, intervalMonths, used };
}

// Most urgent first: due items, then by how much of the interval is used.
export function sortService(items: ServiceItem[]): ServiceItem[] {
  return [...items].sort((a, b) => Number(b.due) - Number(a.due) || b.used - a.used || a.name.localeCompare(b.name));
}

const km = (n: number) => `${Math.round(Math.abs(n)).toLocaleString('en-US')} km`;
const months = (n: number) => `${Math.abs(n)} month${Math.abs(n) === 1 ? '' : 's'}`;

// "Overdue by 1,192 km · 1 month", "In 8,808 km or 11 months", "In 198,808 km".
export function serviceText(s: ServiceItem): string {
  const k = s.remainingKm;
  const m = s.remainingMonths;
  if (s.due) {
    const parts = [k !== undefined && k < 0 ? km(k) : '', m !== undefined && m < 0 ? months(m) : ''].filter(Boolean);
    return parts.length ? `Overdue by ${parts.join(' · ')}` : 'Due now';
  }
  const parts = [k !== undefined ? km(k) : '', m !== undefined ? months(m) : ''].filter(Boolean);
  return parts.length ? `In ${parts.join(' or ')}` : 'OK';
}

export interface CarProblem {
  entity: string;
  name: string;
}

// Service items, and problem sensors nobody configured (e.g. an oil level warning).
export function classifyCarBinaries(binaries: Binary[], deviceName?: string): { service: ServiceItem[]; problems: CarProblem[] } {
  const service: ServiceItem[] = [];
  const problems: CarProblem[] = [];
  for (const b of binaries) {
    if (isService(b.attributes)) service.push(serviceItem(b, deviceName));
    else if (b.attributes?.device_class === 'problem') {
      problems.push({ entity: b.entity, name: shortName(b.attributes.friendly_name as string | undefined, deviceName, b.entity) });
    }
  }
  return { service: sortService(service), problems };
}

// 95 -> "1 h 35 min", 1795 -> "29 h 55 min", 5 -> "5 min".
export function fmtMinutes(min: number | undefined): string {
  if (min === undefined || !Number.isFinite(min)) return '–';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

// A short place name from a geocoded address (OpenStreetMap-style parts),
// else the first two parts of the full address text.
const PLACE_PARTS = ['amenity', 'building', 'residential', 'road', 'neighbourhood', 'quarter', 'suburb', 'village', 'town', 'city_district', 'city'];
export function shortPlace(state: string | undefined, address: unknown): string | undefined {
  if (address && typeof address === 'object') {
    const a = address as Record<string, unknown>;
    const parts = PLACE_PARTS.map((k) => a[k]).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    const uniq = [...new Set(parts)].slice(0, 2);
    if (uniq.length) return uniq.join(', ');
  }
  if (!state || /^(unknown|unavailable)$/.test(state)) return undefined;
  return state.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 2).join(', ') || undefined;
}

// Cabin PM2.5 in µg/m³, banded like common air-quality scales.
export function pm25Band(v: number): { label: string; tone: 'ok' | 'fair' | 'warn' | 'danger' } {
  if (v <= 15) return { label: 'Good', tone: 'ok' };
  if (v <= 35) return { label: 'Fair', tone: 'fair' };
  if (v <= 55) return { label: 'Poor', tone: 'warn' };
  return { label: 'Very poor', tone: 'danger' };
}

const compassPoints = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
// Heading in degrees as an 8-point direction.
export function heading8(deg: number): string {
  return compassPoints[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// How a trip's driving went: hard braking, rapid acceleration, speeding counts.
export function tripEvents(hard?: number, rapid?: number, speeding?: number): { label: string; count: number }[] {
  const out: { label: string; count: number }[] = [];
  const add = (count: number | undefined, none: string, one: string, many: string) => {
    if (count === undefined) return;
    out.push({ label: count === 0 ? none : count === 1 ? one : many.replace('#', String(count)), count });
  };
  add(hard, 'No hard braking', '1 hard brake', '# hard brakes');
  add(rapid, 'No rapid starts', '1 rapid start', '# rapid starts');
  add(speeding, 'No speeding', 'Speeding once', 'Speeding # times');
  return out;
}
