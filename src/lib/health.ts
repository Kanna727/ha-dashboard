import type { RegistrySnapshot, StatPoint } from '../ha/api';
import { deviceRoles, idsByDevice } from './deviceRoles';

// Three kinds of health devices, each recognised by the readings its
// integration names on the device. Nothing to configure: HEALTH.people only
// says whose they are.
export const SCALE_KEYS = [
  'weight',
  'real_time_weight',
  'target_weight',
  'body_fat',
  'muscle_mass',
  'bmi',
  'water_percentage',
  'water',
  'bone_mass',
  'bone_mass_percentage',
  'body_fat_mass',
  'lean_body_mass',
  'muscle_mass_percentage',
  'bmr',
  'body_age',
  'visceral_fat',
  'protein_ratio',
] as const;

// A scale built from template helpers has no device in the registry, so it
// can't be found by device. Its readings are `sensor.<name>_<key>`; HEALTH.people
// names one of them and the rest follow from the prefix.
export const HELPER_SCALE_KEYS = [
  'weight',
  'body_fat',
  'body_fat_mass',
  'lean_body_mass',
  'muscle_mass',
  'muscle_mass_percentage',
  'bone_mass',
  'bone_mass_percentage',
  'water',
  'bmi',
  'bmr',
  'visceral_fat',
] as const;

export function helperScale(entity: string): HealthSource | undefined {
  if (!entity.startsWith('sensor.')) return undefined;
  const o = entity.slice('sensor.'.length);
  const key = [...HELPER_SCALE_KEYS].sort((a, b) => b.length - a.length).find((k) => o.endsWith(`_${k}`));
  if (!key) return undefined;
  const prefix = o.slice(0, -key.length - 1);
  if (!prefix) return undefined;
  const roles: Record<string, string> = {};
  for (const k of HELPER_SCALE_KEYS) roles[k] = `sensor.${prefix}_${k}`;
  const name = prefix.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return { kind: 'scale', device: `helpers:${prefix}`, deviceName: name, roles };
}

// A recovery/sleep/strain wearable.
export const WEARABLE_KEYS = [
  'weight',
  'recovery_score',
  'hrv',
  'resting_heart_rate',
  'spo2',
  'skin_temperature',
  'max_heart_rate',
  'day_strain',
  'day_calories',
  'day_average_heart_rate',
  'day_max_heart_rate',
  'sleep_performance',
  'sleep_efficiency',
  'sleep_consistency',
  'sleep_respiratory_rate',
  'sleep_time_in_bed',
  'sleep_time_awake',
  'sleep_light_sleep_time',
  'sleep_sws_time',
  'sleep_rem_sleep_time',
  'sleep_cycles',
  'sleep_disturbances',
  'sleep_baseline_need',
  'sleep_debt_need',
  'sleep_strain_need',
  'sleep_nap_credit',
  'last_workout_strain',
  'last_workout_average_hr',
  'last_workout_max_hr',
  'last_workout_calories',
  'last_workout_distance',
  'last_workout_zone_0_time',
  'last_workout_zone_1_time',
  'last_workout_zone_2_time',
  'last_workout_zone_3_time',
  'last_workout_zone_4_time',
  'last_workout_zone_5_time',
] as const;

// An indoor-cycling (virtual riding) account.
export const CYCLING_KEYS = [
  'online',
  'heart_rate',
  'speed',
  'cadence',
  'power',
  'distance',
  'gradient',
  'level',
  'run_level',
  'cycle_progress',
  'run_progress',
  'total_distance',
  'total_distance_climbed',
  'total_time',
  'drops',
  'current_streak',
  'max_streak',
  'racing_score',
  'racing_category',
  'ftp',
  'weight',
  'power_zone_name',
  'sport',
] as const;

export type SourceKind = 'scale' | 'wearable' | 'cycling';
export type ScaleRoles = Partial<Record<(typeof SCALE_KEYS)[number], string>>;
export type WearableRoles = Partial<Record<(typeof WEARABLE_KEYS)[number], string>>;
export type CyclingRoles = Partial<Record<(typeof CYCLING_KEYS)[number], string>>;

export interface HealthSource {
  kind: SourceKind;
  device: string;
  deviceName: string;
  roles: Record<string, string>;
}

const KEYS: Record<SourceKind, readonly string[]> = { scale: SCALE_KEYS, wearable: WEARABLE_KEYS, cycling: CYCLING_KEYS };

function kindOf(ids: string[]): SourceKind | undefined {
  const has = (k: string) => ids.some((id) => id.startsWith('sensor.') && id.endsWith(`_${k}`));
  if (has('recovery_score')) return 'wearable';
  if (has('ftp') && (has('cycle_progress') || has('racing_score') || has('cadence'))) return 'cycling';
  if (has('body_fat') && has('weight')) return 'scale';
  return undefined;
}

// Every health device in the registry, by kind.
export function findHealthSources(r: RegistrySnapshot): HealthSource[] {
  const out: HealthSource[] = [];
  for (const [device, ids] of idsByDevice(r.entities)) {
    const kind = kindOf(ids);
    if (!kind) continue;
    const roles = deviceRoles(ids, KEYS[kind]);
    if (!Object.keys(roles).length) continue;
    out.push({ kind, device, deviceName: r.devices.find((d) => d.id === device)?.name ?? device, roles });
  }
  return out.sort((a, b) => a.deviceName.localeCompare(b.deviceName));
}

export interface PersonConfig {
  name: string;
  color?: string;
  scale?: string;
  wearable?: string;
  cycling?: string;
}

export interface HealthPerson {
  name: string;
  color?: string;
  scale?: HealthSource;
  wearable?: HealthSource;
  cycling?: HealthSource;
}

// Each configured person gets the devices of the entities named for them (a
// scale of template helpers, which has no device, is read by entity-ID prefix).
// Without HEALTH.people, devices nobody claims show as a "person" named after
// the device, so a first scale or account appears without a config change.
export function healthPeople(sources: HealthSource[], people: PersonConfig[], deviceOf: (entity: string) => string | undefined): HealthPerson[] {
  const claimed = new Set<string>();
  const out: HealthPerson[] = people.map((p) => {
    const person: HealthPerson = { name: p.name, color: p.color };
    for (const kind of ['scale', 'wearable', 'cycling'] as const) {
      const id = p[kind];
      const dev = id ? deviceOf(id) : undefined;
      let src = dev ? sources.find((s) => s.device === dev && s.kind === kind) : undefined;
      if (!src && id && !dev && kind === 'scale') src = helperScale(id);
      if (src) {
        person[kind] = src;
        claimed.add(src.device);
      }
    }
    return person;
  });
  // With people configured only they show: a leftover device (a removed
  // integration's scale) must not appear as an extra person.
  if (!people.length) for (const s of sources) if (!claimed.has(s.device)) out.push({ name: s.deviceName, [s.kind]: s });
  return out;
}

export type Tone = 'good' | 'fair' | 'poor';

// Recovery bands as recovery wearables colour them.
export const recoveryTone = (score: number): Tone => (score >= 67 ? 'good' : score >= 34 ? 'fair' : 'poor');

// Change over the last `days` from daily mean statistics: newest minus the
// first reading inside the window. Undefined with fewer than two readings.
export function changeOver(points: StatPoint[], days: number, now: number): number | undefined {
  const pts = points.filter((p) => p.mean !== undefined && Number.isFinite(p.mean) && p.start >= now - days * 86_400_000);
  if (pts.length < 2) return undefined;
  return pts[pts.length - 1].mean! - pts[0].mean!;
}

export interface SleepStages {
  awake: number;
  light: number;
  deep: number;
  rem: number;
  asleep: number; // light + deep + rem, hours
  need?: number; // hours: baseline + debt + strain − naps
}

// Last night's sleep from the wearable's readings (hours).
export function sleepStages(v: (key: string) => number | undefined): SleepStages | undefined {
  const light = v('sleep_light_sleep_time');
  const deep = v('sleep_sws_time');
  const rem = v('sleep_rem_sleep_time');
  if (light === undefined && deep === undefined && rem === undefined) return undefined;
  const base = v('sleep_baseline_need');
  const need = base === undefined ? undefined : base + (v('sleep_debt_need') ?? 0) + (v('sleep_strain_need') ?? 0) - (v('sleep_nap_credit') ?? 0);
  const s = { awake: v('sleep_time_awake') ?? 0, light: light ?? 0, deep: deep ?? 0, rem: rem ?? 0 };
  return { ...s, asleep: s.light + s.deep + s.rem, need };
}

// "6 h 39 m".
export function fmtHours(h: number | undefined): string {
  if (h === undefined || !Number.isFinite(h)) return '–';
  const m = Math.round(h * 60);
  return m < 60 ? `${m} m` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
}
