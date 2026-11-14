import { describe, expect, it } from 'vitest';
import {
  dayText,
  daySchedule,
  doseKey,
  doseStates,
  findHaSensor,
  haSummary,
  lowText,
  newMedicineId,
  parseMedicines,
  perDay,
  remaining,
  removeMedicine,
  runOut,
  scheduleText,
  shownDay,
  stockStatus,
  timesOf,
  upsertMedicine,
  withCount,
  withPaused,
  withTaken,
  type MedicineDef,
} from './medicines';

const times = timesOf({});
// Wednesday 11 Nov 2026.
const at = (hhmm: string, date = 11) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 10, date, h, m);
};
const counted = (n: number | null) => ({ count: n, countedAt: at('07:00').toISOString() });
const omega: MedicineDef = { id: 'omega', name: 'Omega-3', who: ['a'], doses: { after_lunch: 1, after_dinner: 1 } };
const vitd: MedicineDef = { id: 'vitd', name: 'Vitamin D3', who: ['a', 's'], doses: { after_breakfast: 1 }, days: [0] };
const lunch = doseKey(at('10:00'), 'after_lunch', 'a');

describe('medicines', () => {
  it('counts the use per day, shared and weekly', () => {
    expect(perDay(omega)).toBe(2);
    expect(perDay(vitd)).toBeCloseTo(2 / 7);
  });

  it('keys a dose by day, time and person', () => {
    expect(lunch).toBe('2026-11-11|after_lunch|a');
  });

  it('takes a ticked dose off the count, once, and puts it back on untick', () => {
    const m = { ...omega, ...counted(10) };
    const ticked = withTaken(m, lunch, 1, true, at('14:00'));
    expect(ticked).toMatchObject({ count: 9, taken: { [lunch]: 1 } });
    expect(withTaken(ticked, lunch, 1, true, at('14:00')).count).toBe(9); // a second screen's tick changes nothing
    const unticked = withTaken(ticked, lunch, 1, false, at('14:05'));
    expect(unticked.count).toBe(10);
    expect(unticked.taken).toBeUndefined();
    expect(withTaken(m, lunch, 1, false, at('14:00')).count).toBe(10); // unticking an untaken dose changes nothing
  });

  it('never takes more than is left, and gives back only what it took', () => {
    const half = withTaken({ ...omega, ...counted(0.5) }, lunch, 1, true, at('14:00'));
    expect(half).toMatchObject({ count: 0, taken: { [lunch]: 0.5 } });
    expect(withTaken(half, lunch, 1, false, at('14:00')).count).toBe(0.5);
    // Not counted yet: the tick is remembered, the count stays unknown.
    expect(withTaken({ ...omega, count: null }, lunch, 1, true, at('14:00'))).toMatchObject({ count: null, taken: { [lunch]: 0 } });
  });

  it('forgets ticks older than a week', () => {
    const old = doseKey(at('10:00', 2), 'after_lunch', 'a');
    const m = { ...omega, ...counted(10), taken: { [old]: 1 } };
    expect(Object.keys(withTaken(m, lunch, 1, true, at('14:00')).taken!)).toEqual([lunch]);
  });

  it('reads what is left from the count', () => {
    expect(remaining({ ...omega, ...counted(8) })).toBe(8);
    expect(remaining({ ...omega, ...counted(-1) })).toBe(0);
    expect(remaining({ ...omega, ...counted(null) })).toBeNull();
  });

  it('pauses and resumes without touching the count', () => {
    const m = withPaused({ ...omega, ...counted(10) }, true);
    expect(m).toMatchObject({ count: 10, paused: true });
    expect(withPaused(m, false).paused).toBeUndefined();
  });

  it('stores a new count in halves', () => {
    expect(withCount(omega, 7.3, at('10:00'))).toMatchObject({ count: 7.5, countedAt: at('10:00').toISOString() });
    expect(withCount(omega, -2, at('10:00')).count).toBe(0);
  });

  it('finds the dose that uses up the last one', () => {
    // 3 left, nothing ticked: Wed lunch + dinner, then Thu lunch takes the last one.
    expect(runOut(omega, 3, at('10:00'), times)).toEqual(at('13:30', 12));
    // Today's lunch not ticked by 14:00 is still expected (taken late).
    expect(runOut(omega, 3, at('14:00'), times)).toEqual(at('13:30', 12));
    // Ticked: it's no longer expected, so 3 last a dose longer.
    expect(runOut({ ...omega, taken: { [lunch]: 1 } }, 3, at('14:00'), times)).toEqual(at('20:30', 12));
    // 1 left with tonight's dose still to take: it runs out tonight, not tomorrow.
    expect(runOut({ ...omega, taken: { [lunch]: 1 } }, 1, at('14:00'), times)).toEqual(at('20:30'));
    // Not enough for the next dose: that dose.
    expect(runOut(omega, 0, at('10:00'), times)).toEqual(at('13:30'));
    // Shared weekly: 2 a Sunday; 3 left cover Sunday 15 Nov and one of the two on the 22nd, which takes the last one.
    expect(runOut(vitd, 3, at('10:00'), times)).toEqual(at('08:30', 22));
    expect(runOut(vitd, 4, at('10:00'), times)).toEqual(at('08:30', 22));
    expect(runOut(vitd, 2, at('10:00'), times)).toEqual(at('08:30', 15));
    expect(runOut({ ...omega, paused: true }, 0, at('10:00'), times)).toBeNull();
  });

  it('ignores the stock when the course ends first', () => {
    expect(runOut({ ...omega, until: '2026-11-12' }, 10, at('10:00'), times)).toBeNull();
    expect(runOut({ ...omega, until: '2026-11-12' }, 2, at('10:00'), times)).toEqual(at('20:30'));
    expect(runOut({ ...omega, doses: {} }, 0, at('10:00'), times)).toBeNull();
  });

  it('flags medicines running out within the low days', () => {
    const now = at('10:00');
    expect(stockStatus({ ...omega, ...counted(9) }, now, times, 5).low).toBe(true); // the last one goes Sun lunch
    expect(stockStatus({ ...omega, ...counted(12) }, now, times, 5).low).toBe(false);
    expect(stockStatus({ ...omega, ...counted(null) }, now, times, 5)).toMatchObject({ left: null, low: false });
    expect(stockStatus({ ...omega, ...counted(0), paused: true }, now, times, 5).low).toBe(false);
  });

  it('words the attention item', () => {
    const now = at('10:00');
    const s = (n: number) => stockStatus({ ...omega, ...counted(n) }, now, times, 5);
    expect(lowText(s(0), now)).toBe('Omega-3 has run out');
    expect(lowText(s(0.5), now)).toBe('Omega-3 has run out'); // less than one dose
    expect(lowText(s(3), now)).toBe('Omega-3 runs out tomorrow');
    expect(lowText(s(1), now)).toBe('Omega-3 runs out today'); // the last one goes at lunch
    expect(lowText(s(6), now, 'Alex')).toBe("Alex's Omega-3 runs out Friday");
    expect(dayText(at('09:00', 25), now)).toBe('25 Nov');
  });

  it('lays out a day by time and person, with ticks, without paused medicines', () => {
    const sunday = daySchedule([omega, vitd], at('07:00', 15), times);
    expect(sunday.map((s) => s.slot)).toEqual(['after_breakfast', 'after_lunch', 'after_dinner']);
    expect(Object.keys(sunday[0].byPerson)).toEqual(['a', 's']);
    const wed = daySchedule([{ ...omega, taken: { [lunch]: 1 } }, vitd], at('07:00'), times);
    expect(wed.map((s) => s.slot)).toEqual(['after_lunch', 'after_dinner']);
    expect(wed[0].byPerson.a[0]).toMatchObject({ key: lunch, taken: true, dose: 1 });
    expect(wed[1].byPerson.a[0].taken).toBe(false);
    expect(daySchedule([{ ...omega, paused: true }], at('07:00'), times)).toEqual([]);
  });

  it('marks doses done when ticked and missed when late', () => {
    const ticked = { ...omega, taken: { [lunch]: 1 } };
    expect(doseStates(daySchedule([omega], at('10:00'), times), at('14:30'))).toEqual(['missed', 'next']);
    expect(doseStates(daySchedule([ticked], at('10:00'), times), at('14:30'))).toEqual(['done', 'next']);
    expect(doseStates(daySchedule([ticked], at('10:00'), times), at('10:00'))).toEqual(['done', 'next']);
    expect(doseStates(daySchedule([omega], at('10:00'), times), at('10:00'))).toEqual(['next', 'later']);
  });

  it('shows today until midnight, even once everything is ticked or long past', () => {
    expect(shownDay([omega], at('21:00'), times).offset).toBe(0);
    expect(shownDay([omega], at('23:59'), times).offset).toBe(0);
    const all = { ...omega, taken: { [lunch]: 1, [doseKey(at('10:00'), 'after_dinner', 'a')]: 1 } };
    expect(shownDay([all], at('20:31'), times).offset).toBe(0);
  });

  it('describes the schedule', () => {
    expect(scheduleText(omega)).toBe('1 after lunch · 1 after dinner');
    expect(scheduleText(vitd)).toBe('1 after breakfast · Sundays');
    expect(scheduleText({ ...omega, doses: { before_breakfast: 0.5 }, days: [4, 1] })).toBe('½ before breakfast · Mon, Thu');
  });

  it('reads the stored document, dropping what is malformed', () => {
    const list = parseMedicines({
      version: 1,
      medicines: [
        {
          id: 'a',
          name: 'A',
          who: ['x', 3],
          doses: { after_lunch: 1, at_noon: 2, after_dinner: -1 },
          days: [1, 9],
          count: 4,
          countedAt: 'x',
          paused: true,
          taken: { '2026-11-11|after_lunch|x': 1, junk: 1, '2026-11-11|after_dinner|x': 'one' },
        },
        { id: 'b' },
        'junk',
        { id: 'c', name: 'C', doses: {}, days: [], taken: [1] },
      ],
    });
    expect(list.map((m) => m.id)).toEqual(['a', 'c']);
    expect(list[0]).toMatchObject({ who: ['x'], doses: { after_lunch: 1 }, days: [1], count: 4, paused: true, taken: { '2026-11-11|after_lunch|x': 1 } });
    expect(list[1]).toMatchObject({ who: [], days: undefined, count: null, taken: undefined });
    expect(parseMedicines(null)).toEqual([]);
  });

  it('adds, replaces and removes by id', () => {
    expect(newMedicineId('Vitamin D3 60K', [])).toBe('vitamin_d3_60k');
    expect(newMedicineId('Omega-3', [omega, { ...omega, id: 'omega_3' }])).toBe('omega_3_2');
    expect(newMedicineId('!!', [])).toBe('medicine');
    const list = upsertMedicine([omega], vitd);
    expect(list.map((m) => m.id)).toEqual(['omega', 'vitd']);
    expect(upsertMedicine(list, { ...omega, name: 'Fish oil' }).map((m) => m.name)).toEqual(['Fish oil', 'Vitamin D3']);
    expect(removeMedicine(list, 'omega').map((m) => m.id)).toEqual(['vitd']);
  });

  it('finds the sensor that keeps the summary in Home Assistant', () => {
    const a = (attributes: Record<string, unknown>) => ({ attributes });
    expect(findHaSensor({ 'sensor.x': a({}), 'sensor.meds_copy': a({ friendly_name: 'Dashboard medicines' }) })).toBe('sensor.meds_copy');
    expect(findHaSensor({ 'sensor.renamed': a({ friendly_name: 'Pills', doses: [], taken: [], low_days: 5 }) })).toBe('sensor.renamed');
    expect(findHaSensor({ 'binary_sensor.y': a({ friendly_name: 'Dashboard medicines' }), 'sensor.z': a({}) })).toBeUndefined();
    expect(findHaSensor({ 'sensor.mine': a({}), 'sensor.other': a({ friendly_name: 'Dashboard medicines' }) }, 'sensor.mine')).toBe('sensor.mine');
    expect(findHaSensor({}, 'sensor.mine')).toBeUndefined();
  });

  it('sums the medicines up for Home Assistant', () => {
    const now = at('10:00');
    const people = [
      { id: 'a', name: 'Alex' },
      { id: 's', name: 'Sam' },
    ];
    const yesterday = doseKey(at('10:00', 10), 'after_dinner', 'a');
    const old = doseKey(at('10:00', 9), 'after_dinner', 'a');
    const list: MedicineDef[] = [
      { ...omega, ...counted(3), taken: { [lunch]: 1, [yesterday]: 1, [old]: 1 } },
      { ...vitd, ...counted(0), unit: 'capsule' },
      { ...omega, id: 'iron', name: 'Iron', paused: true, ...counted(10) },
    ];
    const s = haSummary(list, now, times, people, 5);
    expect(s.people).toEqual({ a: 'Alex', s: 'Sam' });
    expect(s.low_days).toBe(5);
    expect(s.times.after_dinner).toBe('20:30');
    expect(s.labels.before_breakfast).toBe('Before breakfast');
    expect(s.medicines[0]).toMatchObject({ id: 'omega', left: 3, runs_out: '2026-11-12', low: true, empty: false, paused: false, unit: 'tablet' });
    expect(s.medicines[1]).toMatchObject({ id: 'vitd', left: 0, low: true, empty: true, unit: 'capsule' });
    expect(s.medicines[2]).toMatchObject({ id: 'iron', paused: true, low: false, runs_out: null });
    // Paused medicines have no doses; a shared one has one per person.
    expect(s.doses.map((d) => `${d.id}/${d.slot}/${d.person}`)).toEqual(['omega/after_lunch/a', 'omega/after_dinner/a', 'vitd/after_breakfast/a', 'vitd/after_breakfast/s']);
    expect(s.doses[2]).toMatchObject({ days: [0], until: null, dose: 1 });
    expect(s.taken).toEqual([yesterday, lunch].sort()); // today's and yesterday's only
    expect(s.hash).toBe(haSummary(list, now, times, people, 5).hash);
    expect(s.hash).not.toBe(haSummary([list[0]], now, times, people, 5).hash);
  });
});
