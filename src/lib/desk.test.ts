import { describe, expect, it } from 'vitest';
import { columnStages, dailyStanding, deskBase, deskIds, displayHeight, fmtDuration, fmtIdle, heightToPosition, motion, positionToHeight, postureStats, presetOf, standLine } from './desk';

const IDS = [
  'cover.office_desk_height_slider',
  'number.office_desk_desk_height',
  'number.office_desk_min_height',
  'number.office_desk_max_height',
  'number.office_desk_offset_up_by',
  'number.office_desk_nudge_delay',
  'sensor.office_desk_desk_height',
  'sensor.office_desk_desk_height_percent',
  'sensor.office_desk_desk_status',
  'button.office_desk_desk_m2',
  'button.office_desk_desk_m1',
  'button.office_desk_desk_m3_stand',
  'button.office_desk_desk_m4_sit',
  'button.office_desk_set_desk_m1',
  'button.office_desk_set_desk_m3_stand',
  'button.office_desk_desk_nudge_up',
  'button.office_desk_desk_nudge_down',
  'button.office_desk_desk_stop',
  'button.office_desk_child_lock',
  'binary_sensor.office_desk_child_lock',
  'switch.office_desk_enable_idle_counter',
  'button.office_desk_reset_idle_timer',
  'sensor.office_desk_idle_time',
  'sensor.office_desk_idle_timestamp',
  'button.office_desk_esp32_restart',
  'sensor.office_desk_esp32_uptime',
  'sensor.office_desk_desk_m1_height',
  'sensor.office_desk_something_new',
  'light.office_lamp',
];

describe('deskBase', () => {
  it('strips the height or cover suffix', () => {
    expect(deskBase('number.office_desk_desk_height')).toBe('office_desk');
    expect(deskBase('cover.office_desk_desk')).toBe('office_desk');
    expect(deskBase('number.desk_height')).toBe('desk');
  });
});

describe('presetOf', () => {
  it('reads the slot and role', () => {
    expect(presetOf('desk_m3_stand')).toEqual({ slot: 3, role: 'stand', label: 'Stand' });
    expect(presetOf('desk_m2')).toEqual({ slot: 2, role: undefined, label: '2' });
    expect(presetOf('m4_sit')?.role).toBe('sit');
    expect(presetOf('preset_1')?.slot).toBe(1);
    expect(presetOf('desk_stop')).toBeUndefined();
    expect(presetOf('desk_m1_height')).toBeUndefined();
  });
});

describe('deskIds', () => {
  const d = deskIds('number.office_desk_desk_height', IDS, [], ['switch.office_desk_enable_idle_counter']);
  it('finds the height, range, movement and controls', () => {
    expect(d.cover).toBe('cover.office_desk_height_slider');
    expect(d.height).toBe('sensor.office_desk_desk_height');
    expect(d.setHeight).toBe('number.office_desk_desk_height');
    expect(d.minHeight).toBe('number.office_desk_min_height');
    expect(d.maxHeight).toBe('number.office_desk_max_height');
    expect(d.status).toBe('sensor.office_desk_desk_status');
    expect(d.nudgeUp).toBe('button.office_desk_desk_nudge_up');
    expect(d.stop).toBe('button.office_desk_desk_stop');
    expect(d.childLock).toBe('binary_sensor.office_desk_child_lock');
    expect(d.childLockToggle).toBe('button.office_desk_child_lock');
    expect(d.idleTime).toBe('sensor.office_desk_idle_time');
    expect(d.idleEnabled).toBe('switch.office_desk_enable_idle_counter');
    expect(d.restart).toBe('button.office_desk_esp32_restart');
    expect(d.uptime).toBe('sensor.office_desk_esp32_uptime');
  });
  it('orders the memory keys and pairs their save buttons and heights', () => {
    expect(d.presets.map((p) => p.label)).toEqual(['1', '2', 'Stand', 'Sit']);
    expect(d.presets[0].set).toBe('button.office_desk_set_desk_m1');
    expect(d.presets[0].heightSensor).toBe('sensor.office_desk_desk_m1_height');
    expect(d.presets[2].set).toBe('button.office_desk_set_desk_m3_stand');
    expect(d.presets[3].set).toBeUndefined();
  });
  it('puts calibration in settings, drops repeats and keeps unknowns', () => {
    expect(d.settings).toEqual(['number.office_desk_nudge_delay', 'number.office_desk_offset_up_by']);
    expect(d.rest).toEqual(['sensor.office_desk_something_new']);
  });
  it('takes in renamed entities on the same device', () => {
    expect(deskIds('cover.office_desk_desk', IDS, ['update.desk_firmware']).firmware).toBe('update.desk_firmware');
  });
});

describe('standLine', () => {
  const presets = deskIds('number.office_desk_desk_height', IDS).presets;
  it('is halfway between the Sit and Stand keys', () => {
    expect(standLine(presets, { desk_m4_sit: 72, desk_m3_stand: 108 })).toBe(90);
    expect(standLine(presets, { desk_m4_sit: 70, desk_m3_stand: 112 }, 95)).toBe(95);
    expect(standLine(presets, { desk_m4_sit: 72 })).toBe(90);
  });
});

describe('postureStats', () => {
  const H = 3600_000;
  const pts = [
    { t: 0, v: 72 },
    { t: 1 * H, v: 108 },
    { t: 2 * H, v: 72 },
    { t: 3 * H, v: 110 },
  ];
  it('adds up standing time and stand-ups in the window', () => {
    const s = postureStats(pts, 0, 4 * H, 90);
    expect(s.standMs).toBe(2 * H);
    expect(s.standUps).toBe(2);
    expect(s.longestStandMs).toBe(H);
    expect(s.since).toBe(3 * H);
  });
  it('clips to the window and does not count a stand-up before it', () => {
    const s = postureStats(pts, 1.5 * H, 4 * H, 90);
    expect(s.standMs).toBe(1.5 * H);
    expect(s.standUps).toBe(1);
  });
  it('splits by day', () => {
    const now = new Date(2026, 9, 21, 12).getTime();
    const day0 = new Date(2026, 9, 20).getTime();
    const days = dailyStanding([{ t: day0 + 10 * H, v: 100 }, { t: day0 + 12 * H, v: 70 }, { t: now - H, v: 100 }], 2, now, 90);
    expect(days.map((d) => d.standMs)).toEqual([2 * H, H]);
  });
});

describe('helpers', () => {
  it('formats', () => {
    expect(fmtDuration(65 * 60_000)).toBe('1h 05m');
    expect(fmtDuration(12 * 60_000)).toBe('12m');
    expect(fmtIdle(435)).toBe('7m 15s');
    expect(fmtIdle(3900)).toBe('1h 05m');
    expect(fmtIdle(2 * 86_400 + 4 * 3600)).toBe('2d 4h');
    expect(displayHeight(72.46)).toBe('72.5');
    expect(displayHeight(undefined)).toBe('--.-');
  });
  it('maps height and position', () => {
    expect(heightToPosition(105, 66, 131)).toBe(60);
    expect(positionToHeight(60, 66, 131)).toBeCloseTo(105);
  });
  it('reads movement from the status or a cover', () => {
    expect(motion('Raising')).toBe('up');
    expect(motion('Lowering')).toBe('down');
    expect(motion('opening')).toBe('up');
    expect(motion('Idle')).toBeUndefined();
  });
  it('splits a column into stages', () => {
    const [a, b, c] = columnStages(1.2);
    expect(a).toBe(0.42);
    expect(b).toBeCloseTo(0.39);
    expect(a + b + c).toBeCloseTo(1.2);
  });
});
