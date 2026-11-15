import { describe, expect, it } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import example from '../../config/dashboard.config.example';
import type { DashboardConfig } from '../config/types';
import type { RegistrySnapshot } from '../ha/api';
import { createEngine, type Backend } from '../storage/engine';
import { configAsTs } from './exportConfig';
import { setAt } from './draft';
import { configHash } from './hash';
import { roomIcon, starterConfig } from './starter';
import { configChange } from './useConfigSave';
import { errorsOf, validateConfig } from './validate';

const ent = (id: string, attrs: Record<string, unknown> = {}, state = 'on') => ({ entity_id: id, state, attributes: attrs, last_changed: '', last_updated: '', context: { id: '', parent_id: null, user_id: null } });
const states = (...list: ReturnType<typeof ent>[]): HassEntities => Object.fromEntries(list.map((e) => [e.entity_id, e])) as unknown as HassEntities;

const registry: RegistrySnapshot = {
  devices: [{ id: 'd1', name: 'Hub', areaId: 'kitchen', disabled: false }],
  entities: [
    { entityId: 'light.kitchen_main', deviceId: 'd1', platform: 'x' },
    { entityId: 'sensor.kitchen_temp', deviceId: 'd1', platform: 'x' },
    { entityId: 'binary_sensor.kitchen_motion', deviceId: 'd1', platform: 'x' },
    { entityId: 'binary_sensor.kitchen_door', deviceId: 'd1', platform: 'x' },
    { entityId: 'fan.bedroom_fan', deviceId: '', platform: 'x', areaId: 'master_bedroom' },
    { entityId: 'sensor.outdoor_temp', deviceId: '', platform: 'x' },
  ],
};

describe('the starter config', () => {
  const s = states(
    ent('light.kitchen_main', { friendly_name: 'Kitchen Main Light' }),
    ent('sensor.kitchen_temp', { device_class: 'temperature', friendly_name: 'Kitchen Temperature' }, '24'),
    ent('binary_sensor.kitchen_motion', { device_class: 'motion' }),
    ent('binary_sensor.kitchen_door', { device_class: 'door' }, 'off'),
    ent('fan.bedroom_fan', { friendly_name: 'Fan' }),
    ent('sensor.outdoor_temp', { device_class: 'temperature', friendly_name: 'Outdoor temperature' }, '30'),
    ent('weather.home', {}, 'sunny'),
    ent('sun.sun', {}, 'above_horizon'),
    ent('zone.home', {}, '0'),
    ent('climate.living_ac', {}, 'cool'),
    ent('media_player.tv', { friendly_name: 'TV' }, 'off'),
    ent('person.asha', { friendly_name: 'Asha' }, 'home'),
  );
  const c = starterConfig(s, registry);

  it('makes a room of each area with its lights, fans and sensors', () => {
    expect(c.ROOMS.map((r) => r.id).sort()).toEqual(['kitchen', 'master_bedroom']);
    const kitchen = c.ROOMS.find((r) => r.id === 'kitchen')!;
    expect(kitchen).toMatchObject({ name: 'Kitchen', icon: 'stove', temperature: 'sensor.kitchen_temp', presence: ['binary_sensor.kitchen_motion'], doors: ['binary_sensor.kitchen_door'] });
    expect(kitchen.controls).toEqual([{ entity: 'light.kitchen_main', name: 'Main Light' }]);
    expect(c.ROOMS.find((r) => r.id === 'master_bedroom')).toMatchObject({ name: 'Master Bedroom', icon: 'bed', controls: [{ entity: 'fan.bedroom_fan', name: 'Fan' }] });
  });

  it('finds the weather, sun, zone, outdoor temperature, climate device, players and people', () => {
    expect(c).toMatchObject({ WEATHER: 'weather.home', SUN: 'sun.sun', HOME_ZONE: 'zone.home', OUTDOOR_TEMP: 'sensor.outdoor_temp' });
    expect(c.CLIMATE.entity).toBe('climate.living_ac');
    expect(c.MUSIC_PLAYERS).toEqual([{ entity: 'media_player.tv', name: 'TV' }]);
    expect(c.MEALS.people).toEqual([{ id: 'asha', name: 'Asha' }]);
  });

  it('has no errors, only what is left to pick as warnings, and every required section', () => {
    expect(errorsOf(validateConfig(c, { entities: new Set(Object.keys(s)) }))).toEqual([]);
    expect(validateConfig(c).some((i) => i.level === 'warn')).toBe(true);
    for (const k of ['CAR', 'CAR_DETAIL', 'FRIDGE', 'APPLIANCES', 'COMMUTE', 'NETWORK', 'ENERGY']) expect(c).toHaveProperty(k);
    expect(c.ENERGY.plugs).toEqual({});
  });

  it('copes with nothing at all', () => {
    const empty = starterConfig({} as HassEntities);
    expect(empty.ROOMS).toEqual([]);
    expect(errorsOf(validateConfig(empty))).toEqual([]);
  });

  it('picks an icon from a room name', () => {
    expect(roomIcon('Living Room')).toBe('sofa');
    expect(roomIcon('Common Bathroom')).toBe('bathtub');
    expect(roomIcon('Garage')).toBe('car');
    expect(roomIcon('Attic')).toBe('home');
  });
});

describe('exporting', () => {
  it('writes a TypeScript module like config/dashboard.config.ts', () => {
    const ts = configAsTs(example);
    expect(ts).toContain("import type { DashboardConfig } from '../src/config/types';");
    expect(ts).toContain('const config: DashboardConfig = {');
    expect(ts.trim().endsWith('export default config;')).toBe(true);
    // The data itself round-trips.
    const body = ts.slice(ts.indexOf('= {') + 2, ts.lastIndexOf('};') + 1);
    expect(JSON.parse(body)).toEqual(JSON.parse(JSON.stringify(example)));
  });
});

describe('saving the config from two screens', () => {
  const base = example as unknown as DashboardConfig;
  const server = () => {
    let doc: unknown = { hash: configHash(base), config: structuredClone(base) };
    const backend: Backend = {
      read: async () => (await new Promise((r) => setTimeout(r, Math.random() * 3)), structuredClone(doc)),
      write: async (d) => {
        await new Promise((r) => setTimeout(r, Math.random() * 3));
        doc = structuredClone(d);
      },
    };
    return { backend, get: () => doc as { hash: string; config: DashboardConfig } };
  };

  it('keeps both admins’ edits when they change different settings', async () => {
    const srv = server();
    const a = createEngine({ primary: srv.backend, device: 'a', verifyAfterMs: 2, watchMs: 30 });
    const b = createEngine({ primary: srv.backend, device: 'b', verifyAfterMs: 2, watchMs: 30 });
    const draftA = setAt(base, ['ROOMS', 0, 'name'], 'Lounge');
    const draftB = setAt(base, ['CAR', 'name'], 'Runabout');
    await Promise.all([a.update(configChange(base, draftA)), b.update(configChange(base, draftB))]);
    for (let i = 0; i < 6; i++) await Promise.all([a.flush(), b.flush()]);
    const stored = srv.get();
    expect(stored.config.ROOMS[0].name).toBe('Lounge');
    expect(stored.config.CAR.name).toBe('Runabout');
    expect(stored.hash).toBe(configHash(stored.config));
  });

  it('starts from the editor’s own config when nothing is stored yet', () => {
    const change = configChange({} as DashboardConfig, { WEATHER: 'weather.home' } as unknown as DashboardConfig);
    expect(change(null).config).toEqual({ WEATHER: 'weather.home' });
  });

  it('gives a new hash to a changed config', () => {
    const out = configChange(base, setAt(base, ['CAR', 'name'], 'X'))({ hash: 'old', config: base });
    expect(out.hash).not.toBe(configHash(base));
  });
});
