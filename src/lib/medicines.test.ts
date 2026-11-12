import { describe, expect, it } from 'vitest';
import {
  dayText,
  daySchedule,
  doseStates,
  dosesBetween,
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
  type MedicineDef,
} from './medicines';

const times = timesOf({});
// Wednesday 11 Nov 2026.
const at = (hhmm: string, date = 11) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 10, date, h, m);
};
const counted = (n: number | null, when: Date) => ({ count: n, countedAt: when.toISOString() });
const omega: MedicineDef = { id: 'omega', name: 'Omega-3', who: ['a'], doses: { after_lunch: 1, after_dinner: 1 } };
const vitd: MedicineDef = { id: 'vitd', name: 'Vitamin D3', who: ['a', 's'], doses: { after_breakfast: 1 }, days: [0] };

describe('medicines', () => {
  it('counts the use per day, shared and weekly', () => {
    expect(perDay(omega)).toBe(2);
    expect(perDay(vitd)).toBeCloseTo(2 / 7);
  });

  it('takes the doses since the last count off it', () => {
    expect(dosesBetween(omega, at('10:00'), at('10:00', 13), times)).toBe(4); // Wed L, D, Thu L, D
    expect(dosesBetween(omega, at('13:30'), at('20:30'), times)).toBe(1); // a dose at the count's own time was already in it
    const m = { ...omega, ...counted(10, at('10:00')) };
    expect(remaining(m, at('21:00'), times)).toBe(8);
    expect(remaining(m, at('10:00', 20), times)).toBe(0); // never below zero
    expect(remaining({ ...m, count: null }, at('21:00'), times)).toBeNull();
    expect(remaining({ ...m, paused: true }, at('21:00'), times)).toBe(10);
  });

  it('pausing keeps what was left, resuming counts from then', () => {
    let m: MedicineDef = { ...omega, ...counted(10, at('10:00')) };
    m = withPaused(m, true, at('21:00'), times);
    expect(m).toMatchObject({ count: 8, paused: true });
    expect(remaining(m, at('21:00', 14), times)).toBe(8);
    m = withPaused(m, false, at('21:00', 14), times);
    expect(m.paused).toBeUndefined();
    expect(remaining(m, at('21:00', 15), times)).toBe(6);
  });

  it('stores a new count in halves', () => {
    expect(withCount(omega, 7.3, at('10:00'))).toMatchObject({ count: 7.5, countedAt: at('10:00').toISOString() });
    expect(withCount(omega, -2, at('10:00')).count).toBe(0);
  });

  it('finds the first dose there are not enough for', () => {
    // 10:00 Wed, 3 left: lunch + dinner today, lunch Thu, then Thu dinner is missing.
    expect(runOut(omega, 3, at('10:00'), times)).toEqual(at('20:30', 12));
    expect(runOut(omega, 3, at('14:00'), times)).toEqual(at('13:30', 13));
    expect(runOut(omega, 0, at('10:00'), times)).toEqual(at('13:30'));
    // Shared weekly: 2 a Sunday; 3 left covers one Sunday (15 Nov), not the next.
    expect(runOut(vitd, 3, at('10:00'), times)).toEqual(at('08:30', 22));
    expect(runOut({ ...omega, paused: true }, 0, at('10:00'), times)).toBeNull();
  });

  it('ignores the stock when the course ends first', () => {
    expect(runOut({ ...omega, until: '2026-11-12' }, 10, at('10:00'), times)).toBeNull();
    expect(runOut({ ...omega, until: '2026-11-12' }, 2, at('10:00'), times)).toEqual(at('13:30', 12));
    expect(runOut({ ...omega, doses: {} }, 0, at('10:00'), times)).toBeNull();
  });

  it('flags medicines running out within the low days', () => {
    const now = at('10:00');
    expect(stockStatus({ ...omega, ...counted(9, now) }, now, times, 5).low).toBe(true); // runs out Sun dinner
    expect(stockStatus({ ...omega, ...counted(12, now) }, now, times, 5).low).toBe(false);
    expect(stockStatus({ ...omega, ...counted(null, now) }, now, times, 5)).toMatchObject({ left: null, low: false });
    expect(stockStatus({ ...omega, ...counted(0, now), paused: true }, now, times, 5).low).toBe(false);
  });

  it('words the attention item', () => {
    const now = at('10:00');
    const s = (n: number) => stockStatus({ ...omega, ...counted(n, now) }, now, times, 5);
    expect(lowText(s(0), now)).toBe('Omega-3 has run out');
    expect(lowText(s(3), now)).toBe('Omega-3 runs out tomorrow');
    expect(lowText(s(6), now, 'Alex')).toBe("Alex's Omega-3 runs out Saturday");
    expect(dayText(at('09:00', 25), now)).toBe('25 Nov');
  });

  it('lays out a day by time and person, without paused medicines', () => {
    const sunday = daySchedule([omega, vitd], at('07:00', 15), times);
    expect(sunday.map((s) => s.slot)).toEqual(['after_breakfast', 'after_lunch', 'after_dinner']);
    expect(Object.keys(sunday[0].byPerson)).toEqual(['a', 's']);
    expect(daySchedule([omega, vitd], at('07:00'), times).map((s) => s.slot)).toEqual(['after_lunch', 'after_dinner']);
    expect(daySchedule([{ ...omega, paused: true }], at('07:00'), times)).toEqual([]);
  });

  it('moves on to tomorrow after the last dose', () => {
    const today = shownDay([omega], at('20:40'), times);
    expect(today.offset).toBe(0);
    expect(doseStates(today.slots, at('20:40'))).toEqual(['done', 'next']);
    expect(shownDay([omega], at('21:01'), times).offset).toBe(1);
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
        { id: 'a', name: 'A', who: ['x', 3], doses: { after_lunch: 1, at_noon: 2, after_dinner: -1 }, days: [1, 9], count: 4, countedAt: 'x', paused: true },
        { id: 'b' },
        'junk',
        { id: 'c', name: 'C', doses: {}, days: [] },
      ],
    });
    expect(list.map((m) => m.id)).toEqual(['a', 'c']);
    expect(list[0]).toMatchObject({ who: ['x'], doses: { after_lunch: 1 }, days: [1], count: 4, paused: true });
    expect(list[1]).toMatchObject({ who: [], days: undefined, count: null });
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
});
