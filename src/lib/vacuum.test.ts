import { describe, expect, it } from 'vitest';
import {
  AUTO_OPEN_START,
  autoOpenStep,
  calibration,
  chipStatus,
  commonPrefix,
  consumables,
  fmtMinutes,
  moveLineEnd,
  normRect,
  optionIndex,
  parseHistory,
  parseRestrictions,
  parseRooms,
  parseSchedule,
  resizeRect,
  restrictionsPayload,
  roomAt,
  roomKey,
  sameRestrictions,
  sequenced,
  shortName,
  siblingKey,
  vacuumStatus,
} from './vacuum';

const CAL = [
  { vacuum: { x: 0, y: 0 }, map: { x: 400, y: 300 } },
  { vacuum: { x: 1000, y: 0 }, map: { x: 450, y: 300 } },
  { vacuum: { x: 0, y: 1000 }, map: { x: 400, y: 250 } },
];

describe('calibration', () => {
  it('maps vacuum mm to image pixels and back', () => {
    const c = calibration(CAL)!;
    expect(c.toImg({ x: 2000, y: -1000 })).toEqual({ x: 500, y: 350 });
    const back = c.toVac({ x: 500, y: 350 });
    expect(back.x).toBeCloseTo(2000);
    expect(back.y).toBeCloseTo(-1000);
    expect(c.scale).toBeCloseTo(0.05);
  });

  it('handles a rotated map', () => {
    // 90°: vacuum +x goes down the image, +y goes right.
    const c = calibration([
      { vacuum: { x: 0, y: 0 }, map: { x: 100, y: 100 } },
      { vacuum: { x: 1000, y: 0 }, map: { x: 100, y: 180 } },
      { vacuum: { x: 0, y: 1000 }, map: { x: 180, y: 100 } },
    ])!;
    expect(c.toImg({ x: 500, y: 250 })).toEqual({ x: 120, y: 140 });
  });

  it('rejects missing or degenerate points', () => {
    expect(calibration(undefined)).toBeNull();
    expect(calibration([CAL[0], CAL[0], CAL[0]])).toBeNull();
  });
});

const ROOMS = {
  1: { x0: 0, y0: 0, x1: 4000, y1: 3000, x: 2000, y: 1500, room_id: 1, name: 'Bedroom', custom_name: 'Bedroom', order: 2 },
  2: { x0: 3500, y0: 0, x1: 8000, y1: 3000, x: 6000, y: 1500, room_id: 2, name: 'Hall', custom_name: '', order: 1 },
  3: { x0: 0, y0: 3000, x1: 4000, y1: 6000, x: 2000, y: 4500, room_id: 3, name: 'Kitchen', order: 0 },
};

describe('rooms', () => {
  it('parses the camera rooms attribute', () => {
    const rooms = parseRooms(ROOMS);
    expect(rooms.map((r) => r.name)).toEqual(['Bedroom', 'Hall', 'Kitchen']);
    expect(rooms[1].box).toEqual([3500, 0, 8000, 3000]);
    expect(parseRooms({ 'Map 1': [{ id: 1, name: 'x' }] })).toEqual([]);
    expect(parseRooms(undefined)).toEqual([]);
  });

  it('picks the room under a point, by colour then nearest centre', () => {
    const rooms = parseRooms(ROOMS);
    expect(roomAt({ x: 1000, y: 1000 }, rooms)?.id).toBe(1);
    // In the overlap both boxes contain the point; without colour the nearer centre wins.
    expect(roomAt({ x: 3900, y: 1500 }, rooms)?.id).toBe(1);
    expect(roomAt({ x: 3900, y: 1500 }, rooms, (r) => r.id === 2)?.id).toBe(2);
    expect(roomAt({ x: 9000, y: 9000 }, rooms)).toBeUndefined();
  });

  it('orders by cleaning sequence, unsequenced last', () => {
    expect(sequenced(parseRooms(ROOMS)).map((r) => r.id)).toEqual([2, 1, 3]);
  });
});

describe('shapes', () => {
  it('normalises and resizes rectangles', () => {
    expect(normRect({ x: 5, y: 9 }, { x: 1, y: 2 })).toEqual([1, 2, 5, 9]);
    // Corner 2 is (x1, y1); dragging it past corner 0 flips the rect.
    expect(resizeRect([0, 0, 10, 10], 2, { x: -5, y: 20 })).toEqual([-5, 0, 0, 20]);
    expect(moveLineEnd([0, 0, 10, 10], 1, { x: 3, y: 4 })).toEqual([0, 0, 3, 4]);
  });
});

describe('restrictions', () => {
  const attrs = {
    virtual_walls: [{ x0: 1, y0: 2, x1: 3, y1: 4 }],
    no_go_areas: [{ x0: 10, y0: 20, x1: 30, y1: 20, x2: 30, y2: 40, x3: 10, y3: 40, angle: 0 }],
    no_mopping_areas: [[5, 6, 1, 2]],
  };

  it('parses walls and areas into boxes', () => {
    expect(parseRestrictions(attrs)).toEqual({ walls: [[1, 2, 3, 4]], noGo: [[10, 20, 30, 40]], noMop: [[1, 2, 5, 6]] });
    expect(parseRestrictions(undefined)).toEqual({ walls: [], noGo: [], noMop: [] });
  });

  it('builds the full replacement payload with whole numbers', () => {
    const r = parseRestrictions(attrs);
    r.noGo.push([0.4, 0.6, 99.5, 100.2]);
    expect(restrictionsPayload(r)).toEqual({ walls: [[1, 2, 3, 4]], zones: [[10, 20, 30, 40], [0, 1, 100, 100]], no_mops: [[1, 2, 5, 6]] });
    expect(sameRestrictions(parseRestrictions(attrs), parseRestrictions(attrs))).toBe(true);
    expect(sameRestrictions(r, parseRestrictions(attrs))).toBe(false);
  });
});

describe('status', () => {
  it('describes the state', () => {
    expect(vacuumStatus('docked', { charging: true })).toEqual({ label: 'Charging', tone: 'ok' });
    expect(vacuumStatus('docked', { error: 'No error' })).toEqual({ label: 'Docked', tone: 'ok' });
    expect(vacuumStatus('cleaning', { segment_cleaning: true })).toEqual({ label: 'Cleaning rooms', tone: 'active' });
    expect(vacuumStatus('error', { error: 'Wheels stuck' })).toEqual({ label: 'Wheels stuck', tone: 'warn' });
    expect(vacuumStatus('unavailable')).toEqual({ label: 'Offline', tone: 'idle' });
  });

  it('words the room card chip', () => {
    expect(chipStatus('docked', { charging: true }, { battery: 87 })).toEqual({ short: '87%', long: 'Vacuum: Charging · 87%', on: false, tone: 'ok' });
    expect(chipStatus('cleaning', { segment_cleaning: true }, { room: 'Kitchen', area: 12.4 })).toMatchObject({ short: 'Kitchen', long: 'Vacuum: Cleaning rooms · Kitchen · 12 m²', on: true });
    expect(chipStatus('cleaning', {}, {})).toMatchObject({ short: 'Cleaning', on: true });
    expect(chipStatus('returning')).toMatchObject({ short: 'Docking', on: true });
    expect(chipStatus('error', { error: 'Main brush is tangled up' })).toMatchObject({ short: 'Needs help', on: true, tone: 'warn' });
    expect(chipStatus('unavailable')).toMatchObject({ short: '', on: false, tone: 'idle' });
  });

  it('formats durations', () => {
    expect(fmtMinutes(42)).toBe('42 min');
    expect(fmtMinutes(1544)).toBe('25 h 44 min');
    expect(fmtMinutes(120)).toBe('2 h');
    expect(fmtMinutes(undefined)).toBe('–');
  });
});

describe('auto open', () => {
  type In = Parameters<typeof autoOpenStep>[1];
  const base: In = { state: 'docked', page: 'home', idleMs: 60_000, busy: false, now: 0 };
  // Runs the steps in order and collects where it went.
  const run = (steps: Partial<In>[]) => {
    let s = AUTO_OPEN_START;
    let page = 'home';
    const went: (string | undefined)[] = [];
    for (const step of steps) {
      const r = autoOpenStep(s, { ...base, page, ...step });
      s = r.next;
      if (r.go) page = r.go;
      went.push(r.go);
    }
    return went;
  };

  it('opens the page once when a run starts, and goes home a minute after it docks', () => {
    expect(run([{}, { state: 'cleaning' }, { state: 'cleaning', now: 5000 }, { state: 'docked', now: 10_000 }, { state: 'docked', now: 40_000 }, { state: 'docked', now: 70_000 }])).toEqual([
      undefined,
      'vacuum',
      undefined,
      undefined,
      undefined,
      'home',
    ]);
  });

  it('opens it on load when a run is under way', () => {
    expect(run([{ state: 'cleaning' }])).toEqual(['vacuum']);
  });

  it('waits until the screen is left alone and nothing is open on it', () => {
    expect(run([{}, { state: 'cleaning', idleMs: 1000 }, { state: 'cleaning', busy: true }, { state: 'cleaning' }])).toEqual([undefined, undefined, undefined, 'vacuum']);
  });

  it('does not reopen it during the run once someone went back, nor send them home after', () => {
    expect(run([{}, { state: 'cleaning' }, { state: 'cleaning', page: 'home' }, { state: 'cleaning', page: 'home' }, { state: 'docked', page: 'home', now: 100_000 }])).toEqual([
      undefined,
      'vacuum',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('treats a pause as part of the run and holds the page on an error', () => {
    expect(run([{}, { state: 'cleaning' }, { state: 'paused' }, { state: 'cleaning' }, { state: 'error', now: 100_000 }])).toEqual([undefined, 'vacuum', undefined, undefined, undefined]);
  });

  it('leaves the page alone when someone opened it themselves', () => {
    expect(run([{ page: 'vacuum' }, { state: 'cleaning', page: 'vacuum' }, { state: 'docked', page: 'vacuum', now: 0 }, { state: 'docked', page: 'vacuum', now: 100_000 }])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('discovery', () => {
  it('finds sibling and per-room keys', () => {
    expect(siblingKey('vacuum.robot', 'select.robot_suction_level')).toBe('suction_level');
    expect(siblingKey('vacuum.robot', 'select.robotic_mode')).toBeUndefined();
    expect(siblingKey('vacuum.robot', 'vacuum.robot')).toBeUndefined();
    expect(roomKey('room_12_water_volume')).toEqual({ room: 12, setting: 'water_volume' });
    expect(roomKey('suction_level')).toBeUndefined();
  });

  it('strips the device name from entity names', () => {
    expect(commonPrefix(['Robot Vac Battery', 'Robot Vac Filter', 'Robot Vac Volume'])).toBe('Robot Vac');
    expect(commonPrefix(['Robot', 'Robot Filter'])).toBe('');
    expect(shortName('Robot Vac Suction Level', 'Robot Vac', 'suction_level')).toBe('Suction Level');
    expect(shortName('Something', 'Robot Vac', 'x')).toBe('Something');
    expect(shortName(undefined, 'Robot Vac', 'side_brush')).toBe('Side brush');
  });

  it('pairs consumable sensors with their reset buttons', () => {
    const keys = [
      ['sensor', 'main_brush_left'],
      ['sensor', 'main_brush_time_left'],
      ['sensor', 'sensor_dirty_left'],
      ['sensor', 'sensor_dirty_time_left'],
      ['sensor', 'filter_left'],
      ['button', 'reset_main_brush'],
      ['button', 'reset_sensor'],
      ['sensor', 'battery_level'],
    ].map(([domain, key]) => ({ domain, key }));
    expect(consumables(keys)).toEqual([
      { key: 'filter', percent: 'filter_left', hours: undefined, reset: undefined },
      { key: 'main_brush', percent: 'main_brush_left', hours: 'main_brush_time_left', reset: 'reset_main_brush' },
      { key: 'sensor_dirty', percent: 'sensor_dirty_left', hours: 'sensor_dirty_time_left', reset: 'reset_sensor' },
    ]);
  });
});

describe('schedule and history', () => {
  it('parses schedules', () => {
    const s = parseSchedule([
      { id: 2, enabled: false, time: '21:00', repeats: '0010010', once: false, suction_level: 1, options: null },
      { id: 1, enabled: true, time: '08:30', repeats: '1111111', once: false, options: ['3', '4'] },
      { id: 3, invalid: true, time: '01:00' },
    ]);
    expect(s.map((x) => [x.time, x.days, x.everyDay, x.rooms])).toEqual([
      ['08:30', 7, true, [3, 4]],
      ['21:00', 2, false, []],
    ]);
  });

  it('parses cleaning runs, newest first', () => {
    const runs = parseHistory({
      '08-10 13:44': { timestamp: 1000, cleaning_time: '64 min', cleaned_area: '43 m²', completed: true, status: 'Cleaning' },
      '08-11 09:00': { timestamp: 2000, cleaning_time: '12 min', cleaned_area: '8 m²', completed: false },
      friendly_name: 'History',
    });
    expect(runs.map((r) => [r.at, r.minutes, r.area, r.completed])).toEqual([
      [2_000_000, 12, 8, false],
      [1_000_000, 64, 43, true],
    ]);
  });

  it('finds option positions', () => {
    expect(optionIndex(['Quiet', 'Standard', 'Strong'], 'strong')).toBe(2);
    expect(optionIndex(['Quiet'], 'Max')).toBeUndefined();
  });
});
