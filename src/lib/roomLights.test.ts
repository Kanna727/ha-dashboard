import { describe, expect, it } from 'vitest';
import type { RegistryDevice, RegistryEntity } from '../ha/api';
import type { RoomDef } from '../config/types';
import { findRoomLights, lightLabel, withRoomLights } from './roomLights';

const room = (id: string, name: string, controls: RoomDef['controls'] = [], area?: string): RoomDef => ({
  id,
  name,
  icon: 'bed',
  presence: [],
  doors: [],
  controls,
  ...(area ? { area } : {}),
});
const device = (id: string, name: string, areaId: string | null, disabled = false): RegistryDevice => ({ id, name, areaId, disabled });
const light = (entityId: string, deviceId: string, more: Partial<RegistryEntity> = {}): RegistryEntity => ({ entityId, deviceId, platform: 'matter', ...more });

describe('lightLabel', () => {
  const bath = room('common_bathroom', 'Common Bath');
  it('drops the room and a trailing "Light"', () => {
    expect(lightLabel('Common Area Light', bath)).toBe('Common Area');
    expect(lightLabel('Bedroom Light 3', room('bedroom', 'Bedroom'))).toBe('Light 3');
    expect(lightLabel('Living room Lamp', room('living_room', 'Lounge'))).toBe('Lamp');
  });
  it('matches the HA area when the room has a shorter name', () => {
    expect(lightLabel('Common Bathroom Mirror', bath)).toBe('Mirror');
  });
  it('never ends up empty', () => {
    expect(lightLabel('Bedroom Light', room('bedroom', 'Bedroom'))).toBe('Light');
    expect(lightLabel('Lights', bath)).toBe('Lights');
  });
});

describe('findRoomLights', () => {
  const rooms = [room('bedroom', 'Bedroom', [{ entity: 'light.listed', name: 'Light' }]), room('bath', 'Bath', [], 'common_bathroom')];

  it('finds a bulb from its device area and a room id', () => {
    const found = findRoomLights(rooms, { devices: [device('d', 'Reading Lamp', 'bedroom')], entities: [light('light.reading', 'd')] });
    expect(found).toEqual({ bedroom: [{ entity: 'light.reading', name: 'Reading Lamp' }] });
  });

  it("uses a room's area when it has one, and an entity's own area over its device's", () => {
    const found = findRoomLights(rooms, {
      devices: [device('d', 'Mirror', 'bedroom')],
      entities: [light('light.mirror', 'd', { areaId: 'common_bathroom' })],
    });
    expect(found).toEqual({ bath: [{ entity: 'light.mirror', name: 'Mirror' }] });
  });

  it('keeps a light whose own name is the device name', () => {
    const found = findRoomLights(rooms, { devices: [device('d', 'Lamp', 'bedroom')], entities: [light('light.lamp', 'd', { name: 'lamp' })] });
    expect(found.bedroom).toHaveLength(1);
  });

  it('leaves out lights that are part of something else', () => {
    const found = findRoomLights(rooms, {
      devices: [device('fan', 'Bedroom Fan', 'bedroom'), device('rider', 'Rider', 'bedroom')],
      entities: [light('light.fan_led', 'fan', { name: 'LED' }), light('light.rider_zone', 'rider', { name: 'Power Zone Color' })],
    });
    expect(found).toEqual({});
  });

  it('leaves out listed, hidden, config and disabled lights, other areas and unknown devices', () => {
    const found = findRoomLights(rooms, {
      devices: [device('a', 'A', 'bedroom'), device('off', 'Off', 'bedroom', true), device('far', 'Far', 'parking'), device('none', 'None', null)],
      entities: [
        light('light.listed', 'a'),
        light('light.hidden', 'a', { hidden: true }),
        light('light.config', 'a', { category: 'config' }),
        light('light.off', 'off'),
        light('light.far', 'far'),
        light('light.none', 'none'),
        light('light.lost', 'gone'),
        light('switch.not_a_light', 'a'),
      ],
    });
    expect(found).toEqual({});
  });

  it("sorts a room's lights", () => {
    const found = findRoomLights(rooms, {
      devices: [device('a', 'B', 'bedroom'), device('b', 'A', 'bedroom')],
      entities: [light('light.z', 'a'), light('light.c', 'b')],
    });
    expect(found.bedroom.map((l) => l.entity)).toEqual(['light.c', 'light.z']);
  });
});

describe('withRoomLights', () => {
  const extra = { entity: 'light.new', name: 'New' };
  it('adds found lights after the listed ones', () => {
    const r = room('bedroom', 'Bedroom', [
      { entity: 'light.a', name: 'A' },
      { entity: 'fan.a', name: 'Fan' },
      { entity: 'light.b', name: 'B' },
      { entity: 'switch.a', name: 'Plug' },
    ]);
    expect(withRoomLights([r], { bedroom: [extra] })[0].controls.map((c) => c.entity)).toEqual(['light.a', 'fan.a', 'light.b', 'light.new', 'switch.a']);
  });
  it('puts them first in a room with no lights', () => {
    const r = room('bedroom', 'Bedroom', [{ entity: 'fan.a', name: 'Fan' }]);
    expect(withRoomLights([r], { bedroom: [extra] })[0].controls.map((c) => c.entity)).toEqual(['light.new', 'fan.a']);
  });
  it('returns a room with nothing new unchanged', () => {
    const r = room('bedroom', 'Bedroom');
    expect(withRoomLights([r], {})[0]).toBe(r);
  });
});
