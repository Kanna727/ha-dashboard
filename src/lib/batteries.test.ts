import { describe, expect, it } from 'vitest';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { batteryName, batteryOutlook, batteryRows, clusterByPosition, fmtDaysLeft, fmtOutlook, labelRows } from './batteries';

const e = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity =>
  ({ entity_id, state, attributes, last_changed: '', last_updated: '', context: { id: '', parent_id: null, user_id: null } }) as HassEntity;
const pct = (id: string, state: string, name: string) => e(id, state, { device_class: 'battery', unit_of_measurement: '%', friendly_name: name });
const states = (...list: HassEntity[]): HassEntities => Object.fromEntries(list.map((s) => [s.entity_id, s]));
const DAY = 86_400_000;

describe('batteryName', () => {
  it('drops the trailing Battery and a repeated area prefix', () => {
    expect(batteryName('Bedroom Bedroom Dual Button Battery')).toBe('Bedroom Dual Button');
    expect(batteryName('Master Bathroom Master Bathroom Door Sensor Battery')).toBe('Master Bathroom Door Sensor');
    expect(batteryName('Phone Battery level')).toBe('Phone');
    expect(batteryName('Kitchen Oven Battery')).toBe('Kitchen Oven');
    expect(batteryName('Battery')).toBe('Battery');
  });
});

describe('batteryRows', () => {
  it('finds % sensors and battery-low binaries, worst first', () => {
    const rows = batteryRows(
      states(
        pct('sensor.door_battery', '64', 'Door Battery'),
        pct('sensor.button_battery', '8', 'Button Battery'),
        pct('sensor.motion_battery', '18', 'Motion Battery'),
        pct('sensor.wheel_battery', 'unavailable', 'Wheel Battery'),
        e('binary_sensor.lock_battery', 'on', { device_class: 'battery', friendly_name: 'Lock Battery' }),
        e('sensor.door_temperature', '24', { device_class: 'temperature' }),
        e('sensor.voltage', '3', { device_class: 'battery', unit_of_measurement: 'V' }),
      ),
      undefined,
      20,
    );
    expect(rows.map((r) => [r.name, r.status, r.level])).toEqual([
      ['Button', 'critical', 8],
      ['Motion', 'low', 18],
      ['Lock', 'low', undefined],
      ['Wheel', 'offline', undefined],
      ['Door', 'ok', 64],
    ]);
  });

  it('skips a battery-low binary when its device has a % sensor, and hidden ones', () => {
    const registry = {
      devices: [{ id: 'd1', name: 'Lock', areaId: 'hall', disabled: false }],
      entities: [
        { entityId: 'sensor.lock_battery', deviceId: 'd1', platform: 'x' },
        { entityId: 'binary_sensor.lock_battery_low', deviceId: 'd1', platform: 'x' },
      ],
    };
    const rows = batteryRows(
      states(
        pct('sensor.lock_battery', '50', 'Lock Battery'),
        e('binary_sensor.lock_battery_low', 'off', { device_class: 'battery' }),
        pct('sensor.toothbrush_battery', '40', 'Toothbrush Battery'),
      ),
      registry,
      20,
      ['sensor.toothbrush_battery'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: 'sensor.lock_battery', area: 'hall', rechargeable: false });
  });

  it('reads charging from a battery state sibling', () => {
    const rows = batteryRows(
      states(pct('sensor.phone_battery_level', '35', 'Phone Battery level'), e('sensor.phone_battery_state', 'Charging')),
      undefined,
      20,
    );
    expect(rows[0]).toMatchObject({ charging: true, rechargeable: true });
  });
});

describe('batteryOutlook', () => {
  const now = Date.UTC(2026, 9, 26);
  // Daily means for `values`, the last one yesterday.
  const days = (values: number[]) => values.map((v, i) => ({ start: now - (values.length - i) * DAY, mean: v }));
  const steps = (from: number, perDay: number, n: number) => Array.from({ length: n }, (_, i) => from + perDay * i);

  it('extrapolates a drain to empty', () => {
    expect(batteryOutlook(days(steps(80, -1, 30)), 50, now)).toEqual({ kind: 'drain', days: 50 });
  });

  it('says "slow" for a drain past a year, like a presence sensor losing a percent a week', () => {
    const o = batteryOutlook(days([...Array(30).fill(78), ...Array(30).fill(76), ...Array(30).fill(71), ...Array(30).fill(68)]), 67, now);
    expect(o.kind).toBe('slow');
    expect(o.days).toBeGreaterThan(365);
  });

  it('starts after a battery change, counting a change over two days once', () => {
    const o = batteryOutlook(days([...steps(40, -0.5, 10), 70, 100, ...steps(99, -0.5, 30)]), 85, now);
    expect(o.kind).toBe('drain');
    expect(o.days).toBeGreaterThanOrEqual(165);
    expect(o.days).toBeLessThanOrEqual(175);
  });

  it('treats a battery charged now and then as rechargeable, timing the current cycle', () => {
    const cycle = (top: number) => steps(top, -3.5, 16);
    const o = batteryOutlook(days([...cycle(96), 72, ...cycle(92), 80, ...steps(95, -3, 18)]), 41, now);
    expect(o.kind).toBe('recharge');
    expect(o.days).toBe(14);
    expect(batteryOutlook(days([...cycle(96), 100, ...cycle(96), 100, 100]), 100, now)).toEqual({ kind: 'recharge' });
  });

  it('tells "no drop yet" from "still measuring"', () => {
    expect(batteryOutlook(days(Array(60).fill(100)), 100, now)).toEqual({ kind: 'flat' });
    expect(batteryOutlook(days([...steps(40, -0.5, 30), 100, 100, 100]), 100, now)).toEqual({ kind: 'short' });
    expect(batteryOutlook([], 50, now)).toEqual({ kind: 'none' });
  });

  it('formats', () => {
    expect(fmtOutlook({ kind: 'drain', days: 21 })).toBe('~3 weeks left');
    expect(fmtOutlook({ kind: 'slow', days: 500 })).toBe('over a year left');
    expect(fmtOutlook({ kind: 'recharge', days: 12 })).toBe('needs charging in ~12 days');
    expect(fmtOutlook({ kind: 'recharge' })).toBe('recharged now and then');
    expect(fmtOutlook({ kind: 'flat' })).toBe('no drop measured yet');
    expect(fmtDaysLeft(0)).toBe('any day now');
    expect(fmtDaysLeft(120)).toBe('~4 months');
  });
});

describe('timeline labels', () => {
  it('groups dots at nearly the same spot', () => {
    const g = clusterByPosition([{ at: 1 }, { at: 0.3 }, { at: 0.31 }, { at: 1 }, { at: 0.5 }]);
    expect(g.map((c) => c.length)).toEqual([2, 1, 2]);
  });
  it('stacks only labels that would touch', () => {
    // 600 px axis: 0.1 and 0.15 collide, 0.6 is clear of both, 0.62 collides with 0.6.
    expect(labelRows([{ at: 0.1, width: 120 }, { at: 0.15, width: 120 }, { at: 0.6, width: 100 }, { at: 0.62, width: 100 }], 600)).toEqual([0, 1, 0, 1]);
  });
});
