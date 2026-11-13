import { describe, expect, it } from 'vitest';
import { changeOver, findHealthSources, fmtHours, healthPeople, helperScale, recoveryTone, sleepStages } from './health';

const ent = (entityId: string, deviceId: string) => ({ entityId, deviceId, platform: 'x' });
const registry = {
  devices: [
    { id: 's1', name: 'Scale A', areaId: null, disabled: false },
    { id: 's2', name: 'Scale B', areaId: null, disabled: false },
    { id: 'w1', name: 'Band', areaId: null, disabled: false },
    { id: 'c1', name: 'Rides', areaId: null, disabled: false },
    { id: 'x', name: 'Thermometer', areaId: null, disabled: false },
  ],
  entities: [
    ent('sensor.scale_a_weight', 's1'),
    ent('sensor.scale_a_body_fat', 's1'),
    ent('sensor.scale_a_bmi', 's1'),
    ent('sensor.scale_b_weight', 's2'),
    ent('sensor.scale_b_body_fat', 's2'),
    ent('sensor.band_alex_recovery_score', 'w1'),
    ent('sensor.band_alex_hrv', 'w1'),
    ent('sensor.band_alex_weight', 'w1'),
    ent('sensor.ride_alex_ftp', 'c1'),
    ent('sensor.ride_alex_level', 'c1'),
    ent('sensor.ride_alex_run_level', 'c1'),
    ent('sensor.ride_alex_cycle_progress', 'c1'),
    ent('sensor.ride_alex_weight', 'c1'),
    ent('sensor.room_temperature', 'x'),
  ],
};

describe('findHealthSources', () => {
  it('recognises scales, wearables and cycling accounts by their readings', () => {
    const s = findHealthSources(registry);
    expect(s.map((x) => [x.deviceName, x.kind])).toEqual([
      ['Band', 'wearable'],
      ['Rides', 'cycling'],
      ['Scale A', 'scale'],
      ['Scale B', 'scale'],
    ]);
    expect(s[1].roles).toEqual({
      ftp: 'sensor.ride_alex_ftp',
      level: 'sensor.ride_alex_level',
      run_level: 'sensor.ride_alex_run_level',
      cycle_progress: 'sensor.ride_alex_cycle_progress',
      weight: 'sensor.ride_alex_weight',
    });
  });
});

describe('healthPeople', () => {
  const sources = findHealthSources(registry);
  const deviceOf = (id: string) => registry.entities.find((e) => e.entityId === id)?.deviceId;

  it('gives configured people their devices and leaves unclaimed ones out', () => {
    const people = healthPeople(sources, [{ name: 'Alex', scale: 'sensor.scale_a_bmi', wearable: 'sensor.band_alex_hrv', cycling: 'sensor.ride_alex_ftp' }], deviceOf);
    expect(people.map((p) => [p.name, p.scale?.deviceName, p.wearable?.deviceName, p.cycling?.deviceName])).toEqual([['Alex', 'Scale A', 'Band', 'Rides']]);
  });

  it('lists every device by its name when nobody is configured', () => {
    expect(healthPeople(sources, [], deviceOf).map((p) => p.name)).toEqual(['Band', 'Rides', 'Scale A', 'Scale B']);
  });

  it('reads a scale of device-less template helpers by entity-ID prefix', () => {
    const people = healthPeople(sources, [{ name: 'Sam', scale: 'sensor.sam_weight' }, { name: 'Lee', scale: 'sensor.lee_body_fat_mass' }], deviceOf);
    expect(people[0].scale?.roles.weight).toBe('sensor.sam_weight');
    expect(people[0].scale?.roles.body_fat).toBe('sensor.sam_body_fat');
    expect(people[0].scale?.roles.muscle_mass_percentage).toBe('sensor.sam_muscle_mass_percentage');
    expect(people[1].scale?.roles.weight).toBe('sensor.lee_weight');
    expect(people[0].scale?.deviceName).toBe('Sam');
    expect(helperScale('sensor.room_temperature')).toBeUndefined();
    expect(helperScale('light.sam_weight')).toBeUndefined();
  });

  it('ignores an entity that is not on a device of that kind', () => {
    const people = healthPeople(sources, [{ name: 'Sam', scale: 'sensor.band_alex_hrv' }], deviceOf);
    expect(people[0].scale).toBeUndefined();
    expect(people).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('bands recovery', () => {
    expect([80, 67, 66, 34, 33].map(recoveryTone)).toEqual(['good', 'good', 'fair', 'fair', 'poor']);
  });

  it('measures the change inside the window', () => {
    const now = Date.UTC(2026, 9, 26);
    const pts = [40, 20, 10, 1].map((d, i) => ({ start: now - d * 86_400_000, mean: 96 - i * 0.5 }));
    expect(changeOver(pts, 30, now)).toBeCloseTo(-1);
    expect(changeOver(pts.slice(0, 2), 30, now)).toBeUndefined();
  });

  it('adds up sleep stages and need', () => {
    const v: Record<string, number> = {
      sleep_light_sleep_time: 3.2,
      sleep_sws_time: 1.5,
      sleep_rem_sleep_time: 2,
      sleep_time_awake: 0.9,
      sleep_baseline_need: 7.6,
      sleep_debt_need: 1.1,
      sleep_strain_need: 0.2,
    };
    const s = sleepStages((k) => v[k])!;
    expect(s.asleep).toBeCloseTo(6.7);
    expect(s.need).toBeCloseTo(8.9);
    expect(sleepStages(() => undefined)).toBeUndefined();
    expect(fmtHours(6.65)).toBe('6 h 39 m');
    expect(fmtHours(0.5)).toBe('30 m');
  });
});
