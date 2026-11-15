import { describe, expect, it } from 'vitest';
import { buildInsights, describe as describeDraft, type Automation, type StateRow } from './index';
import { doorInsights, quietWindow } from './doors';
import { energyInsights } from './energy';
import { findHabits } from './habits';
import { leftOn, toRuns } from './runs';
import { clock, clockGap, duration, median, percentile, spread } from './stats';
import { coversDoorAlert, coversOffTimer, coversTime } from './suggest';

const MIN = 60_000;
const HOUR = 3_600_000;
// Saturday 14 November 2026, noon, local time.
const NOW = new Date(2026, 10, 14, 12, 0).getTime();
const at = (daysAgo: number, h: number, m = 0) => new Date(2026, 10, 14 - daysAgo, h, m).getTime();

// On/off rows from [start, end | null] runs, beginning with an "off" at the start of the history.
function rows(entity: string, runs: [number, number | null][], from = at(10, 0)): StateRow[] {
  void entity;
  const out: StateRow[] = [{ t: from, s: 'off' }];
  for (const [a, b] of runs) {
    out.push({ t: a, s: 'on' });
    if (b !== null) out.push({ t: b, s: 'off' });
  }
  return out;
}

const isWeekdayAgo = (n: number) => ![0, 6].includes(new Date(at(n, 12)).getDay());
const GEYSER = { entity: 'switch.geyser', name: 'Geyser', kind: 'geyser' as const };

// Ten days of a geyser that comes on at 06:10 on weekdays for 30 minutes and at 08:00 for 40 at weekends.
const geyserRuns = (): [number, number | null][] =>
  Array.from({ length: 10 }, (_, i) => 10 - i)
    .map((n): [number, number] => (isWeekdayAgo(n) ? [at(n, 6, 10 + (n % 3)), at(n, 6, 40 + (n % 3))] : [at(n, 8, n % 4), at(n, 8, 40 + (n % 4))]))
    .filter(([a]) => a < NOW);

describe('helpers', () => {
  it('computes robust statistics', () => {
    expect(median([1, 5, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(spread([10, 10, 10, 11, 9])).toBeLessThan(1);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(clockGap(23 * 60 + 30, 30)).toBe(60);
    expect(clock(1500)).toBe('01:00');
    expect(duration(40_000)).toBe('40 s');
    expect(duration(130 * MIN)).toBe('2 h 10 min');
  });
});

describe('runs', () => {
  it('turns state changes into runs, ignoring unavailable and marking one that began before the history', () => {
    const r = toRuns('switch.x', [
      { t: 0, s: 'on' },
      { t: 10 * MIN, s: 'off' },
      { t: 20 * MIN, s: 'unavailable' },
      { t: 30 * MIN, s: 'on' },
      { t: 40 * MIN, s: 'unknown' },
    ]);
    expect(r).toEqual([
      { start: 0, end: 10 * MIN, truncated: true },
      { start: 30 * MIN, end: null, truncated: false },
    ]);
    expect(toRuns('climate.ac', [{ t: 0, s: 'off' }, { t: 5, s: 'cool' }, { t: 9, s: 'off' }])).toEqual([{ start: 5, end: 9, truncated: false }]);
  });
});

describe('left on', () => {
  const finished = geyserRuns();
  it('notices a run far longer than the usual ones and offers to turn it off after a while', () => {
    const r = rows('switch.geyser', [...finished, [NOW - 3 * HOUR, null]]);
    const i = leftOn(GEYSER, r, NOW)!;
    expect(i).toMatchObject({ kind: 'left-on', entity: 'switch.geyser', severity: 'notice' });
    expect(i.title).toBe('Geyser has been on for 3 h');
    expect(i.detail).toMatch(/usually runs about 3\d min/);
    // Weekend runs are 40 minutes, so the usual longest is 40 and 25 % on top is 50.
    expect(i.suggestion!.title).toBe('Turn Geyser off after 50 min');
    expect(i.suggestion!.draft.triggers[0]).toMatchObject({ trigger: 'state', entity_id: 'switch.geyser', to: 'on', for: { hours: 0, minutes: 50 } });
    expect(i.suggestion!.draft.actions[0]).toEqual({ action: 'switch.turn_off', target: { entity_id: 'switch.geyser' } });
  });

  it('is an alert once it is hours past anything usual', () => {
    expect(leftOn(GEYSER, rows('x', [...finished, [NOW - 6 * HOUR, null]]), NOW)!.severity).toBe('alert');
  });

  it('says nothing for a normal run, or without enough history to know what normal is', () => {
    expect(leftOn(GEYSER, rows('x', [...finished, [NOW - 35 * MIN, null]]), NOW)).toBeUndefined();
    expect(leftOn(GEYSER, rows('x', [...finished.slice(0, 3), [NOW - 3 * HOUR, null]]), NOW)).toBeUndefined();
    expect(leftOn(GEYSER, rows('x', finished), NOW)).toBeUndefined();
  });

  it('notes an automation that already turns it off after a while', () => {
    const autos: Automation[] = [{ entityId: 'automation.geyser_off', config: { alias: 'Geyser auto off', triggers: [{ trigger: 'state', entity_id: 'switch.geyser', to: 'on', for: '00:40:00' }], actions: [{ action: 'switch.turn_off', target: { entity_id: 'switch.geyser' } }] } }];
    expect(coversOffTimer(autos, 'switch.geyser')).toBe('Geyser auto off');
    expect(coversOffTimer(autos, 'switch.other')).toBeUndefined();
    const i = leftOn(GEYSER, rows('x', [...finished, [NOW - 3 * HOUR, null]]), NOW, autos)!;
    expect(i.suggestion!.covered).toBe('Geyser auto off');
  });
});

describe('habits', () => {
  const r = rows('switch.geyser', geyserRuns());
  const h = findHabits('switch.geyser', r, NOW);

  it('finds the usual time on weekdays, on and off, and offers an automation', () => {
    const on = h.find((x) => x.dir === 'on' && x.type === 'weekday')!;
    expect(clock(on.minute)).toMatch(/^06:1\d$/);
    expect(on.count).toBeGreaterThanOrEqual(5);
    const off = h.find((x) => x.dir === 'off' && x.type === 'weekday')!;
    expect(clock(off.minute)).toMatch(/^06:4\d$/);
  });

  it('needs enough weekend days before calling it a habit', () => {
    expect(h.some((x) => x.type === 'weekend')).toBe(false);
  });

  it('turns them into insights with an automation at a sensible time', () => {
    const ins = buildInsights({ now: NOW, devices: [GEYSER], doors: [], history: { 'switch.geyser': r }, energy: [], automations: [] });
    const on = ins.find((i) => i.kind === 'habit' && /goes on/.test(i.title))!;
    expect(on.severity).toBe('info');
    expect(on.title).toMatch(/^Geyser usually goes on around 06:1\d on weekdays$/);
    expect(on.suggestion!.draft.conditions[0]).toEqual({ condition: 'time', weekday: ['mon', 'tue', 'wed', 'thu', 'fri'] });
    expect(on.suggestion!.draft.triggers[0]).toMatchObject({ trigger: 'time', at: expect.stringMatching(/^06:0\d:00$/) });
  });

  it('finds no habit in times that wander', () => {
    const wander = Array.from({ length: 9 }, (_, i): [number, number] => [at(9 - i, 6 + ((i * 7) % 11)), at(9 - i, 7 + ((i * 7) % 11))]);
    expect(findHabits('switch.geyser', rows('x', wander), NOW)).toEqual([]);
  });

  it('notes an automation already at that time', () => {
    const autos: Automation[] = [{ entityId: 'automation.a', config: { alias: 'Morning geyser', triggers: [{ trigger: 'time', at: '06:00:00' }], actions: [{ action: 'switch.turn_on', target: { entity_id: 'switch.geyser' } }] } }];
    expect(coversTime(autos, 'switch.geyser', 'on', 6 * 60 + 5)).toBe('Morning geyser');
    expect(coversTime(autos, 'switch.geyser', 'on', 9 * 60)).toBeUndefined();
    expect(coversTime(autos, 'switch.geyser', 'off', 6 * 60 + 5)).toBeUndefined();
  });
});

describe('doors', () => {
  const DOOR = { entity: 'binary_sensor.main_door', name: 'Main door' };
  // Fifteen openings between 07:00 and 22:00 over the last nine days, each a minute long.
  const usual = Array.from({ length: 15 }, (_, i): [number, number] => {
    const a = at(2 + (i % 8), 7 + ((i * 5) % 15), (i * 7) % 60);
    return [a, a + MIN];
  });

  it('flags an opening at an hour it never happens as an alert, and offers a night alert', () => {
    const night: [number, number] = [NOW - 9 * HOUR, NOW - 9 * HOUR + MIN]; // 03:00 today
    const i = doorInsights(DOOR, rows('d', [...usual, night]), NOW);
    expect(i).toHaveLength(1);
    expect(i[0]).toMatchObject({ kind: 'door-odd-hour', severity: 'alert', title: 'Main door opened at 03:00' });
    expect(i[0].suggestion!.title).toMatch(/Tell me if Main door opens between/);
    expect(i[0].suggestion!.draft.actions[0]).toMatchObject({ action: 'notify.notify' });
  });

  it('leaves an opening at a usual time alone', () => {
    expect(doorInsights(DOOR, rows('d', [...usual, [NOW - 30 * MIN, NOW - 29 * MIN]]), NOW)).toEqual([]);
  });

  it('is only a notice by day, and needs a dozen earlier openings to know what is usual', () => {
    const lateEvening: [number, number] = [at(0, 11), at(0, 11) + MIN];
    const noon = doorInsights(DOOR, rows('d', [...usual.filter(([a]) => new Date(a).getHours() !== 11 && new Date(a).getHours() !== 10 && new Date(a).getHours() !== 12), lateEvening]), NOW);
    for (const x of noon) expect(x.severity).not.toBe('alert');
    expect(doorInsights(DOOR, rows('d', [...usual.slice(0, 5), [NOW - 9 * HOUR, NOW - 9 * HOUR + MIN]]), NOW)).toEqual([]);
  });

  it('notices a door that has been open far longer than usual', () => {
    const i = doorInsights(DOOR, rows('d', [...usual, [NOW - 25 * MIN, null]]), NOW);
    expect(i.map((x) => x.kind)).toContain('door-open-long');
    expect(i.find((x) => x.kind === 'door-open-long')!.title).toBe('Main door has been open for 25 min');
  });

  it('finds the quiet stretch around a time of day', () => {
    expect(quietWindow([8 * 60, 9 * 60, 20 * 60, 22 * 60], 3 * 60)).toEqual({ from: 22 * 60 + 30, to: 7 * 60 + 30 });
    expect(quietWindow([8 * 60, 9 * 60, 10 * 60], 9 * 60 + 30)).toBeUndefined();
  });

  it('is not fooled by several openings at the same minute, or by a single one', () => {
    expect(quietWindow([15 * 60, 15 * 60, 15 * 60, 8 * 60, 8 * 60], 3 * 60)).toEqual({ from: 15 * 60 + 30, to: 7 * 60 + 30 });
    expect(quietWindow([15 * 60, 15 * 60], 3 * 60)).toEqual({ from: 15 * 60 + 30, to: 14 * 60 + 30 });
    expect(quietWindow([12 * 60], 2 * 60)).toEqual({ from: 12 * 60 + 30, to: 11 * 60 + 30 });
  });

  it('notes an automation that already notifies when it opens', () => {
    const autos: Automation[] = [{ entityId: 'automation.door', config: { alias: 'Door alert', triggers: [{ trigger: 'state', entity_id: 'binary_sensor.main_door', to: 'on' }], actions: [{ action: 'notify.notify', data: { message: 'x' } }] } }];
    expect(coversDoorAlert(autos, 'binary_sensor.main_door')).toBe('Door alert');
  });
});

describe('energy', () => {
  const days = (vals: number[]) => vals.map((kwh, i) => ({ start: new Date(2026, 10, 14 - (vals.length - i)).getTime(), kwh }));
  const base = Array.from({ length: 20 }, (_, i) => 1.9 + ((i * 3) % 5) * 0.03);
  const dev = (vals: number[]) => ({ entity: 'sensor.fridge_power', name: 'Fridge', days: days(vals) });

  it('flags a day that used clearly more than usual', () => {
    const i = energyInsights(dev([...base, 3.4]), NOW);
    expect(i).toHaveLength(1);
    expect(i[0]).toMatchObject({ kind: 'energy-high', severity: 'notice', title: 'Fridge used 3.4 kWh yesterday' });
    expect(i[0].detail).toMatch(/usually uses about (1\.9|2\.0) kWh/);
  });

  it('is an alert at three times the usual', () => {
    expect(energyInsights(dev([...base, 6.5]), NOW)[0].severity).toBe('alert');
  });

  it('flags a device that used far less than it should', () => {
    const i = energyInsights(dev([...base, 0.4]), NOW);
    expect(i[0]).toMatchObject({ kind: 'energy-low', title: 'Fridge used only 0.4 kWh yesterday' });
  });

  it('leaves ordinary days and short histories alone', () => {
    expect(energyInsights(dev([...base, 2.1]), NOW)).toEqual([]);
    expect(energyInsights(dev(base.slice(0, 8)), NOW)).toEqual([]);
  });
});

describe('the whole engine', () => {
  it('puts what needs attention first', () => {
    const DOOR = { entity: 'binary_sensor.main_door', name: 'Main door' };
    const usual = Array.from({ length: 15 }, (_, i): [number, number] => {
      const a = at(2 + (i % 8), 7 + ((i * 5) % 15), (i * 7) % 60);
      return [a, a + MIN];
    });
    const ins = buildInsights({
      now: NOW,
      devices: [GEYSER],
      doors: [DOOR],
      history: { 'switch.geyser': rows('g', geyserRuns()), 'binary_sensor.main_door': rows('d', [...usual, [NOW - 9 * HOUR, NOW - 9 * HOUR + MIN]]) },
      energy: [{ entity: 'sensor.fridge_power', name: 'Fridge', days: Array.from({ length: 21 }, (_, i) => ({ start: new Date(2026, 10, 14 - (21 - i)).getTime(), kwh: i === 20 ? 3.4 : 1.9 })) }],
      automations: [],
    });
    expect(ins.map((i) => i.severity)).toEqual([...ins.map((i) => i.severity)].sort((a, b) => ['alert', 'notice', 'info'].indexOf(a) - ['alert', 'notice', 'info'].indexOf(b)));
    expect(ins[0].kind).toBe('door-odd-hour');
    expect(ins.some((i) => i.kind === 'energy-high')).toBe(true);
    expect(ins.some((i) => i.kind === 'habit')).toBe(true);
    expect(new Set(ins.map((i) => i.id)).size).toBe(ins.length);
  });

  it('has nothing to say without history', () => {
    expect(buildInsights({ now: NOW, devices: [GEYSER], doors: [], history: {}, energy: [], automations: [] })).toEqual([]);
  });
});

describe('describing a draft', () => {
  it('writes it in words', () => {
    const ins = buildInsights({ now: NOW, devices: [GEYSER], doors: [], history: { 'switch.geyser': rows('g', geyserRuns()) }, energy: [], automations: [] });
    const lines = describeDraft(ins.find((i) => i.kind === 'habit')!.suggestion!.draft);
    expect(lines[0]).toMatch(/^At 06:0\d$/);
    expect(lines).toContain('Only on mon, tue, wed, thu, fri');
    expect(lines[lines.length - 1]).toBe('Then Turn on switch.geyser');
    expect(describeDraft(ins.find((i) => i.kind === 'habit')!.suggestion!.draft, () => 'Geyser').pop()).toBe('Then Turn on Geyser');
  });
});
