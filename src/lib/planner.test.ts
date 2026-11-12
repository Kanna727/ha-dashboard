import { describe, expect, it } from 'vitest';
import {
  apptEvent,
  apptFields,
  buildCalendar,
  dueData,
  dueText,
  habitProgress,
  isOverdue,
  mealStart,
  monthDays,
  parseDue,
  parseHabits,
  parseQuickAdd,
  recentDays,
  removeHabit,
  sortOpen,
  spanText,
  streak,
  upsertHabit,
  withTick,
  type HabitsDoc,
  type TodoEntry,
} from './planner';
import { doseKey, timesOf, ymd, type MedicineDef } from './medicines';

// Thursday 12 Nov 2026, 3 pm.
const now = new Date(2026, 10, 12, 15, 0);
const d = (date: number, month = 10) => new Date(2026, month, date);

const empty: HabitsDoc = { version: 1, habits: [], ticks: {} };
const water = { id: 'water', name: 'Water', who: ['a', 's'] };
const gym = { id: 'gym', name: 'Gym', who: ['a'], days: [1, 3, 5] }; // Mon, Wed, Fri

describe('habits', () => {
  it('parses and drops anything malformed', () => {
    const doc = parseHabits({
      habits: [water, { id: 'x', name: ' ', who: ['a'] }, { id: 'y', name: 'No one', who: [] }, { ...gym, days: [1, 3, 9, 5] }, 'junk'],
      ticks: { '2026-11-12': { water: ['a', 3] }, bad: { water: ['a'] }, '2026-11-11': { water: [] } },
    });
    expect(doc.habits.map((h) => h.id)).toEqual(['water', 'gym']);
    expect(doc.habits[1].days).toEqual([1, 3, 5]);
    expect(doc.ticks).toEqual({ '2026-11-12': { water: ['a'] } });
    expect(parseHabits(null)).toEqual(empty);
  });

  it('ticks and unticks without doubling, and prunes old ticks', () => {
    let doc = upsertHabit(empty, water);
    doc = withTick(doc, now, 'water', 'a', true, now);
    doc = withTick(doc, now, 'water', 'a', true, now);
    expect(doc.ticks['2026-11-12'].water).toEqual(['a']);
    doc = withTick(doc, now, 'water', 's', true, now);
    expect(habitProgress(doc, now)).toEqual({ done: 2, total: 2 });
    doc = withTick(doc, now, 'water', 'a', false, now);
    doc = withTick(doc, now, 'water', 's', false, now);
    expect(doc.ticks).toEqual({});
    doc = { ...doc, ticks: { '2025-01-01': { water: ['a'] } } };
    expect(withTick(doc, now, 'water', 'a', true, now).ticks['2025-01-01']).toBeUndefined();
  });

  it('counts only the days a habit is expected', () => {
    const doc = upsertHabit(upsertHabit(empty, water), gym);
    expect(habitProgress(doc, d(12))).toEqual({ done: 0, total: 2 }); // Thursday: no gym
    expect(habitProgress(doc, d(13))).toEqual({ done: 0, total: 3 }); // Friday
    expect(habitProgress({ ...doc, habits: [{ ...water, paused: true }] }, d(12)).total).toBe(0);
    expect(habitProgress({ ...doc, habits: [{ ...water, since: '2026-11-13' }] }, d(12)).total).toBe(0);
  });

  it('keeps a streak over days off and an unticked today', () => {
    let doc = upsertHabit(empty, gym);
    for (const day of [2, 4, 6, 9, 11]) doc = withTick(doc, d(day), 'gym', 'a', true, now);
    // Wed 11, Mon 9, Fri 6, Wed 4, Mon 2 in a row (Thursday today isn't a gym day).
    expect(streak(doc, gym, 'a', now)).toBe(5);
    expect(streak(doc, gym, 'a', d(13, 10))).toBe(5); // Friday, not ticked yet
    doc = withTick(doc, d(13), 'gym', 'a', true, now);
    expect(streak(doc, gym, 'a', d(13))).toBe(6);
    expect(streak(withTick(doc, d(6), 'gym', 'a', false, now), gym, 'a', d(13))).toBe(3);
    expect(recentDays(doc, gym, 'a', now, 4)).toEqual(['off', 'done', 'off', 'done']); // Sun 8 … Wed 11
  });

  it('removes a habit with its ticks', () => {
    let doc = upsertHabit(upsertHabit(empty, water), gym);
    doc = withTick(withTick(doc, now, 'water', 'a', true, now), d(11), 'gym', 'a', true, now);
    doc = removeHabit(doc, 'gym');
    expect(doc.habits.map((h) => h.id)).toEqual(['water']);
    expect(doc.ticks).toEqual({ '2026-11-12': { water: ['a'] } });
  });
});

describe('to-do items', () => {
  it('reads due dates and times', () => {
    expect(parseDue('2026-11-14')).toEqual({ day: '2026-11-14' });
    const t = new Date(2026, 10, 12, 17, 30);
    expect(parseDue(t.toISOString())).toEqual({ day: '2026-11-12', time: '17:30' });
    expect(parseDue(null)).toBeUndefined();
    expect(parseDue('soon')).toBeUndefined();
  });

  it('says when, and what is overdue', () => {
    expect(dueText({ day: '2026-11-12', time: '17:30' }, now)).toBe('Today 5:30 PM');
    expect(dueText({ day: '2026-11-13' }, now)).toBe('Tomorrow');
    expect(dueText({ day: '2026-11-16', time: '09:00' }, now)).toBe('Monday 9 AM');
    expect(dueText({ day: '2026-11-30' }, now)).toBe('30 Nov');
    expect(dueText({ day: '2026-11-09', time: '09:00' }, now)).toBe('3 days ago');
    expect(isOverdue({ day: '2026-11-12', time: '14:00' }, now)).toBe(true);
    expect(isOverdue({ day: '2026-11-12' }, now)).toBe(false);
    expect(isOverdue({ day: '2026-11-11' }, now)).toBe(true);
  });

  it('sorts dated items first, keeping list order otherwise', () => {
    const items: TodoEntry[] = [
      { uid: '1', summary: 'Undated', status: 'needs_action' },
      { uid: '2', summary: 'Friday', status: 'needs_action', due: '2026-11-13' },
      { uid: '3', summary: 'Also undated', status: 'needs_action' },
      { uid: '4', summary: 'Late', status: 'needs_action', due: '2026-11-10' },
    ];
    expect(sortOpen(items).map((i) => i.uid)).toEqual(['4', '2', '1', '3']);
  });

  it('builds the due fields for HA', () => {
    expect(dueData('2026-11-13', '09:30')).toEqual({ due_datetime: '2026-11-13 09:30:00' });
    expect(dueData('2026-11-13', undefined)).toEqual({ due_date: '2026-11-13' });
    expect(dueData(undefined, undefined)).toEqual({});
    expect(dueData(undefined, undefined, true)).toEqual({ due_date: null });
  });

  it('reads dates and times out of a quick add', () => {
    expect(parseQuickAdd('call the bank friday 6pm', now)).toEqual({ summary: 'Call the bank', date: '2026-11-13', time: '18:00' });
    expect(parseQuickAdd('gas cylinder tomorrow at 9:30 am', now)).toEqual({ summary: 'Gas cylinder', date: '2026-11-13', time: '09:30' });
    expect(parseQuickAdd('Trash tonight', now)).toEqual({ summary: 'Trash', date: '2026-11-12', time: '20:00' });
    expect(parseQuickAdd('pay rent on 1 dec', now)).toEqual({ summary: 'Pay rent', date: '2026-12-01' });
    expect(parseQuickAdd('renew passport nov 3', now)).toEqual({ summary: 'Renew passport', date: '2027-11-03' });
    expect(parseQuickAdd('water plants in 3 days', now)).toEqual({ summary: 'Water plants', date: '2026-11-15' });
    expect(parseQuickAdd('standup thursday', now)).toEqual({ summary: 'Standup', date: '2026-11-19' }); // today is Thursday
    expect(parseQuickAdd('call mum at 6', now)).toEqual({ summary: 'Call mum', date: '2026-11-12', time: '18:00' });
    expect(parseQuickAdd('meds 08:00', now)).toEqual({ summary: 'Meds', date: '2026-11-13', time: '08:00' }); // passed today
    expect(parseQuickAdd('buy 2 kg rice', now)).toEqual({ summary: 'Buy 2 kg rice' });
  });
});

describe('calendar', () => {
  it('finds when a meal slot starts', () => {
    expect(mealStart({ time: 'Before 9:30 AM', end: '09:30' })).toBe('08:30');
    expect(mealStart({ time: '9:30 AM – 2 PM', end: '14:00' })).toBe('09:30');
    expect(mealStart({ time: '6 – 8 PM', end: '20:00' })).toBe('18:00');
    expect(mealStart({ time: '17:00 – 19:00', end: '19:00' })).toBe('17:00');
    expect(mealStart({ time: 'Dinner', end: '20:00' })).toBe('19:00');
  });

  it('gathers every source by day, untimed first', () => {
    const habits = withTick(upsertHabit(empty, water), now, 'water', 'a', true, now);
    const med: MedicineDef = { id: 'omega', name: 'Omega-3', who: ['a'], doses: { after_dinner: 1 }, count: 1, taken: { [doseKey(now, 'after_dinner', 'a')]: 1 } };
    const todos: TodoEntry[] = [
      { uid: 't1', summary: 'Plumber', status: 'needs_action', due: '2026-11-10' },
      { uid: 't2', summary: 'Parcel', status: 'completed', due: '2026-11-12' },
    ];
    const reminders: TodoEntry[] = [{ uid: 'r1', summary: 'Trash', status: 'needs_action', due: new Date(2026, 10, 12, 21, 0).toISOString() }];
    const cal = buildCalendar(d(10), 4, {
      now,
      habits,
      todos,
      reminders,
      medicines: { list: [med], times: timesOf({}), stock: [{ med, left: 0, out: new Date(2026, 10, 13, 20, 30), low: true }], people: [{ id: 'a', name: 'A' }] },
      meals: {
        people: [{ id: 'a', name: 'A' }, { id: 's', name: 'S' }],
        slots: [{ id: 'lunch', label: 'Lunch', time: '12 – 2 PM', end: '14:00', delivery: '' }],
        plan: { 4: { a: { breakfast: '', lunch: 'Dal', dinner: '' }, s: { breakfast: '', lunch: 'Dal', dinner: '' } } },
        notes: [],
      },
      money: { bill: { card: 'Amex', due: '2026-11-13' }, upcoming: [{ date: '2026-11-11', name: 'Rent' }], premiumDue: '2026-12-01' },
      commute: { days: [4], arriveBy: '10:30' },
      external: [
        { calendar: 'Family', summary: 'Trip', start: '2026-11-12', end: '2026-11-14' },
        { calendar: 'Family', summary: 'Dentist', start: new Date(2026, 10, 11, 16, 0).toISOString(), end: new Date(2026, 10, 11, 17, 0).toISOString() },
      ],
    });
    expect([...cal.keys()]).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    const today = cal.get('2026-11-12')!;
    expect(today.map((e) => e.title)).toEqual([
      'Habits 1 of 2',
      'Plumber',
      'Parcel',
      'Trip',
      'Commute',
      'Lunch',
      'Medicines · after dinner',
      'Trash',
    ]);
    expect(today.find((e) => e.title === 'Plumber')).toMatchObject({ late: true, sub: 'Overdue · 2 days ago' });
    expect(today.find((e) => e.title === 'Parcel')).toMatchObject({ done: true });
    expect(today.find((e) => e.title === 'Lunch')).toMatchObject({ sub: 'Dal', time: '12:00' });
    expect(today.find((e) => e.src === 'medicines')).toMatchObject({ done: true, time: '20:30' });
    expect(cal.get('2026-11-13')!.map((e) => e.title)).toEqual(['Omega-3 runs out', 'Amex bill due', 'Trip', 'Medicines · after dinner']);
    expect(cal.get('2026-11-11')!.map((e) => e.title)).toEqual(['Habits 0 of 2', 'Rent', 'Dentist', 'Medicines · after dinner']);
    expect(cal.get('2026-11-10')!.find((e) => e.title === 'Plumber')!.late).toBe(false); // the late copy is today's
    expect(ymd(d(14))).toBe('2026-11-14');
  });

  it('lays out a month from Monday', () => {
    const days = monthDays(2026, 10); // November 2026 starts on a Sunday
    expect(ymd(days[0])).toBe('2026-10-26');
    expect(days.length).toBe(42);
    expect(ymd(days.at(-1)!)).toBe('2026-12-06');
    expect(monthDays(2027, 1).length).toBe(28); // February 2027: Mon 1 … Sun 28
  });
});

describe('appointments', () => {
  it('makes HA calendar events: all day, timed, an hour by default, past midnight', () => {
    expect(apptEvent({ summary: 'Passport office', day: '2026-11-20', location: ' ', description: 'Bring the form' })).toEqual({
      summary: 'Passport office',
      dtstart: '2026-11-20',
      dtend: '2026-11-21',
      description: 'Bring the form',
    });
    const at = (e: Record<string, string>) => [new Date(e.dtstart).getTime(), new Date(e.dtend).getTime()];
    const timed = apptEvent({ summary: 'Dentist', day: '2026-11-13', start: '16:00', location: 'Smile Dental' });
    expect(timed.location).toBe('Smile Dental');
    expect(timed.dtstart).toMatch(/^2026-11-13T16:00:00[+-]\d\d:\d\d$/);
    expect(at(timed)).toEqual([new Date(2026, 10, 13, 16).getTime(), new Date(2026, 10, 13, 17).getTime()]);
    expect(at(apptEvent({ summary: 'Show', day: '2026-11-13', start: '22:00', end: '00:30' }))).toEqual([new Date(2026, 10, 13, 22).getTime(), new Date(2026, 10, 14, 0, 30).getTime()]);
  });

  it('reads events back into the form and shows their times', () => {
    const e = { calendar: 'Appointments', summary: 'Dentist', start: new Date(2026, 10, 13, 16).toISOString(), end: new Date(2026, 10, 13, 16, 45).toISOString(), location: 'Clinic' };
    expect(apptFields(e)).toEqual({ summary: 'Dentist', day: '2026-11-13', start: '16:00', end: '16:45', location: 'Clinic', description: '' });
    expect(spanText(e)).toBe('4 – 4:45 PM');
    expect(spanText({ ...e, start: new Date(2026, 10, 13, 11).toISOString() })).toBe('11 AM – 4:45 PM');
    expect(apptFields({ calendar: 'A', summary: 'Trip', start: '2026-11-20', end: '2026-11-21' })).toEqual({ summary: 'Trip', day: '2026-11-20', location: '', description: '' });
    expect(spanText({ calendar: 'A', summary: 'Trip', start: '2026-11-20', end: '2026-11-21' })).toBe('All day');
    expect(spanText({ calendar: 'A', summary: 'Trip', start: '2026-11-20', end: '2026-11-23' })).toBe('Until Sunday');
  });

  it('puts appointments on the calendar as their own source', () => {
    const appt = { calendar: 'Appointments', summary: 'Haircut', start: new Date(2026, 10, 12, 11).toISOString(), end: new Date(2026, 10, 12, 11, 30).toISOString(), uid: 'x', appointment: true };
    const cal = buildCalendar(d(12), 1, { now, external: [appt, { calendar: 'Family', summary: 'Dinner', start: new Date(2026, 10, 12, 19).toISOString() }] });
    expect(cal.get('2026-11-12')!.map((e) => [e.src, e.title, e.sub, e.time, e.end])).toEqual([
      ['appointments', 'Haircut', 'Appointment', '11:00', '11:30'],
      ['calendar', 'Dinner', 'Family', '19:00', undefined],
    ]);
    expect(cal.get('2026-11-12')![0].appt).toBe(appt);
  });
});

