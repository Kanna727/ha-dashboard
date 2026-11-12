// The Planner page: habits (kept in a hidden HA dashboard and ticked per person
// per day), to-do items from HA's todo lists (todos, reminders, shopping), and
// the master calendar, which gathers everything time-based on the dashboard.
// Pure (no React, no config import). Unit-tested (planner.test.ts).
import type { MealsConfig, MedSlot } from '../config/types';
import { atTime, daySchedule, SLOT_LABEL, ymd, type MedicineDef, type StockStatus } from './medicines';

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};
// "09:30" → "9:30 AM", "14:00" → "2 PM".
export function clockText(t: string): string {
  const m = minutesOf(t);
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}${m % 60 ? `:${pad(m % 60)}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export function dayOf(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
// Whole days from `from` to `to` (calendar days, so DST can't skew it).
export const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
// Monday of the week `d` is in.
export const weekStart = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Today", "Tomorrow", "Yesterday", "Friday" (within a week), else "21 Nov".
export function dayName(d: Date, now: Date): string {
  const n = daysBetween(now, d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return WEEKDAYS[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// ---------------------------------------------------------------- habits

export interface Habit {
  id: string;
  name: string;
  who: string[]; // people ids; each ticks it on their own
  days?: number[]; // 0 = Sunday; missing = every day
  since?: string; // 'YYYY-MM-DD' it was added: earlier days don't count
  paused?: boolean;
}
export interface HabitsDoc {
  version: 1;
  habits: Habit[];
  // 'YYYY-MM-DD' → habit id → the people who did it that day.
  ticks: Record<string, Record<string, string[]>>;
}
// Ticks are kept this long (streaks and the month calendar read them).
export const HABIT_KEEP_DAYS = 400;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isDayStr = (v: unknown): v is string => isStr(v) && /^\d{4}-\d\d-\d\d$/.test(v);

export function parseHabits(doc: unknown): HabitsDoc {
  const d = (doc && typeof doc === 'object' ? doc : {}) as { habits?: unknown; ticks?: unknown };
  const habits: Habit[] = [];
  for (const h of Array.isArray(d.habits) ? d.habits : []) {
    if (!h || typeof h !== 'object') continue;
    const x = h as Record<string, unknown>;
    if (!isStr(x.id) || !isStr(x.name) || !x.name.trim() || !Array.isArray(x.who)) continue;
    const who = x.who.filter(isStr);
    if (!who.length) continue;
    const days = Array.isArray(x.days) ? x.days.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 6) : undefined;
    habits.push({
      id: x.id,
      name: x.name.trim(),
      who,
      ...(days && days.length ? { days } : {}),
      ...(isDayStr(x.since) ? { since: x.since } : {}),
      ...(x.paused === true ? { paused: true } : {}),
    });
  }
  const ticks: HabitsDoc['ticks'] = {};
  if (d.ticks && typeof d.ticks === 'object')
    for (const [day, byHabit] of Object.entries(d.ticks as Record<string, unknown>)) {
      if (!isDayStr(day) || !byHabit || typeof byHabit !== 'object') continue;
      const row: Record<string, string[]> = {};
      for (const [id, who] of Object.entries(byHabit as Record<string, unknown>)) if (Array.isArray(who) && who.some(isStr)) row[id] = who.filter(isStr);
      if (Object.keys(row).length) ticks[day] = row;
    }
  return { version: 1, habits, ticks };
}

// Is `habit` expected on `day`?
export const habitOn = (h: Habit, day: Date) => !h.paused && (!h.days || h.days.includes(day.getDay())) && (!h.since || ymd(day) >= h.since);
export const isTicked = (doc: HabitsDoc, day: Date, habitId: string, person: string) => !!doc.ticks[ymd(day)]?.[habitId]?.includes(person);

// Ticks (`want`) or unticks one person's habit on one day. Asking for the state
// it's already in changes nothing, so two screens can't fight. Ticks older than
// HABIT_KEEP_DAYS are dropped.
export function withTick(doc: HabitsDoc, day: Date, habitId: string, person: string, want: boolean, now: Date): HabitsDoc {
  const key = ymd(day);
  const ticks = { ...doc.ticks };
  const row = { ...ticks[key] };
  const who = new Set(row[habitId] ?? []);
  if (want) who.add(person);
  else who.delete(person);
  if (who.size) row[habitId] = [...who];
  else delete row[habitId];
  if (Object.keys(row).length) ticks[key] = row;
  else delete ticks[key];
  const oldest = ymd(addDays(now, -HABIT_KEEP_DAYS));
  for (const k of Object.keys(ticks)) if (k < oldest) delete ticks[k];
  return { ...doc, ticks };
}

export function upsertHabit(doc: HabitsDoc, h: Habit): HabitsDoc {
  const i = doc.habits.findIndex((x) => x.id === h.id);
  const habits = i < 0 ? [...doc.habits, h] : doc.habits.map((x, j) => (j === i ? h : x));
  return { ...doc, habits };
}

// Removes a habit and its ticks.
export function removeHabit(doc: HabitsDoc, id: string): HabitsDoc {
  const ticks: HabitsDoc['ticks'] = {};
  for (const [day, row] of Object.entries(doc.ticks)) {
    const { [id]: _gone, ...rest } = row;
    if (Object.keys(rest).length) ticks[day] = rest;
  }
  return { ...doc, habits: doc.habits.filter((h) => h.id !== id), ticks };
}

// Every (habit, person) expected on `day`, and how many of them were ticked.
export function habitProgress(doc: HabitsDoc, day: Date): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const h of doc.habits) {
    if (!habitOn(h, day)) continue;
    for (const p of h.who) {
      total++;
      if (isTicked(doc, day, h.id, p)) done++;
    }
  }
  return { done, total };
}

// Days in a row the person did it, counting only the days it was expected.
// Today counts once ticked; an unticked today doesn't break the streak yet.
export function streak(doc: HabitsDoc, h: Habit, person: string, now: Date): number {
  let n = 0;
  let d = startOfDay(now);
  if (!isTicked(doc, d, h.id, person)) d = addDays(d, -1);
  for (let i = 0; i < HABIT_KEEP_DAYS; i++, d = addDays(d, -1)) {
    if (h.since && ymd(d) < h.since) break;
    const expected = !h.days || h.days.includes(d.getDay());
    if (!expected) continue;
    if (!isTicked(doc, d, h.id, person)) break;
    n++;
  }
  return n;
}

// The `n` days before today, oldest first: done, missed, or not expected.
export function recentDays(doc: HabitsDoc, h: Habit, person: string, now: Date, n = 6): ('done' | 'missed' | 'off')[] {
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(now, i - n);
    if (isTicked(doc, d, h.id, person)) return 'done';
    const expected = (!h.days || h.days.includes(d.getDay())) && (!h.since || ymd(d) >= h.since);
    return expected ? 'missed' : 'off';
  });
}

// ---------------------------------------------------------------- to-do items

// One item as HA's todo/item/list and todo/item/subscribe give it.
export interface TodoEntry {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
  due?: string | null; // 'YYYY-MM-DD' or an ISO date-time
  description?: string | null;
  completed?: string | null;
}
export interface Due {
  day: string; // 'YYYY-MM-DD', local
  time?: string; // 'HH:MM', local; none = any time that day
}

export function parseDue(due: string | null | undefined): Due | undefined {
  if (!due) return undefined;
  if (/^\d{4}-\d\d-\d\d$/.test(due)) return { day: due };
  const t = new Date(due);
  if (Number.isNaN(t.getTime())) return undefined;
  return { day: ymd(t), time: hhmm(t) };
}
// The moment it's due (a date alone: the end of that day).
export const dueAt = (d: Due) => (d.time ? atTime(dayOf(d.day), d.time) : new Date(dayOf(d.day).getTime() + DAY_MS - 60_000));
export const isOverdue = (d: Due, now: Date) => (d.time ? dueAt(d).getTime() < now.getTime() : d.day < ymd(now));

// "Today 5:30 PM", "Tomorrow", "Friday 9 AM", "21 Nov", "2 days ago".
export function dueText(d: Due, now: Date): string {
  const day = dayOf(d.day);
  const n = daysBetween(now, day);
  const name = n < -1 ? `${-n} days ago` : dayName(day, now);
  return d.time && n >= -1 ? `${name} ${clockText(d.time)}` : name;
}

// Open items: overdue and dated ones first by when they're due, then undated in list order.
export function sortOpen(items: TodoEntry[]): TodoEntry[] {
  const key = (i: TodoEntry) => {
    const d = parseDue(i.due);
    return d ? dueAt(d).getTime() : Infinity;
  };
  return items
    .map((it, i) => ({ it, i, k: key(it) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.it);
}

// The service data that sets an item's due date (and time): HA wants
// `due_date` for a date and `due_datetime` ('YYYY-MM-DD HH:MM:SS', in HA's
// time zone) for a time. `clear` sends nulls to remove both (update only).
export function dueData(date: string | undefined, time: string | undefined, clear = false): Record<string, string | null> {
  if (date && time) return { due_datetime: `${date} ${time}:00` };
  if (date) return { due_date: date };
  return clear ? { due_date: null } : {};
}

// "call bank friday 6pm" → { summary: 'Call bank', date: <Friday>, time: '18:00' }.
// Understands today, tonight, tomorrow, weekdays (the next one; today's weekday
// means next week), "in 3 days", "in 2 weeks", "21 nov", "nov 21", and times
// (9am, 9:30 pm, 18:00, noon, "at 6"). Whatever isn't a date or time stays the summary.
export function parseQuickAdd(text: string, now: Date): { summary: string; date?: string; time?: string } {
  let s = ` ${text.trim()} `;
  let date: Date | undefined;
  let time: string | undefined;
  const take = (re: RegExp, f: (m: RegExpMatchArray) => void) => {
    const m = s.match(re);
    if (!m) return;
    f(m);
    s = s.replace(m[0], ' ');
  };
  const today = startOfDay(now);
  // Times first ("9:30" mustn't read as a date).
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d\d))?\s*(am|pm)(?=\s)/i, (m) => {
    const h = (+m[1] % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
    if (+m[1] <= 12 && +(m[2] ?? 0) < 60) time = `${pad(h)}:${m[2] ?? '00'}`;
  });
  if (!time)
    take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m) => {
      time = `${pad(+m[1])}:${m[2]}`;
    });
  if (!time)
    take(/\s(?:at\s+)?(noon|midday|midnight)(?=\s)/i, (m) => {
      time = /mid(night)$/i.test(m[1]) ? '00:00' : '12:00';
    });
  if (!time)
    take(/\sat\s+(\d{1,2})(?=\s)/i, (m) => {
      const h = +m[1];
      // "at 6" is the evening, "at 9" the morning.
      if (h >= 1 && h <= 12) time = `${pad(h < 7 ? h + 12 : h)}:00`;
    });
  take(/\s(?:on\s+)?(today|tonight|tomorrow|tmrw|tmr)(?=\s)/i, (m) => {
    const w = m[1].toLowerCase();
    date = w === 'today' || w === 'tonight' ? today : addDays(today, 1);
    if (w === 'tonight' && !time) time = '20:00';
  });
  if (!date)
    take(/\sin\s+(\d{1,3})\s+(day|days|week|weeks)(?=\s)/i, (m) => {
      date = addDays(today, +m[1] * (/^week/i.test(m[2]) ? 7 : 1));
    });
  if (!date)
    take(/\s(?:on\s+|next\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?(?=\s)/i, (m) => {
      const want = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[1].slice(0, 3).toLowerCase());
      date = addDays(today, ((want - today.getDay() + 7) % 7) || 7);
    });
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const onDay = (d: number, mon: string) => {
    const mi = MON.indexOf(mon.slice(0, 3).toLowerCase());
    if (mi < 0 || d < 1 || d > 31) return;
    let t = new Date(today.getFullYear(), mi, d);
    if (t.getMonth() !== mi) return;
    if (t < today) t = new Date(today.getFullYear() + 1, mi, d);
    date = t;
  };
  if (!date) take(/\s(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?=\s)/i, (m) => onDay(+m[1], m[2]));
  if (!date) take(/\s(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?=\s)/i, (m) => onDay(+m[2], m[1]));
  // A time with no day: today, or tomorrow if that time has passed.
  if (time && !date) date = minutesOf(time) > now.getHours() * 60 + now.getMinutes() ? today : addDays(today, 1);
  const summary = s.replace(/\s+/g, ' ').trim().replace(/\s+(on|at|by)$/i, '');
  return { summary: summary.charAt(0).toUpperCase() + summary.slice(1), ...(date ? { date: ymd(date) } : {}), ...(time ? { time } : {}) };
}

// ---------------------------------------------------------------- calendar

export type CalSource = 'habits' | 'appointments' | 'todos' | 'reminders' | 'medicines' | 'meals' | 'money' | 'commute' | 'calendar';
export const CAL_SOURCES: { id: CalSource; label: string }[] = [
  { id: 'habits', label: 'Habits' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'todos', label: 'Todos' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'medicines', label: 'Medicines' },
  { id: 'meals', label: 'Meals' },
  { id: 'money', label: 'Money' },
  { id: 'commute', label: 'Commute' },
  { id: 'calendar', label: 'Calendars' },
];

export interface CalEvent {
  id: string;
  src: CalSource;
  title: string;
  sub?: string;
  time?: string; // 'HH:MM'; none = all day
  end?: string; // 'HH:MM'
  done?: boolean; // ticked (todo, reminder, the day's doses)
  late?: boolean; // overdue
  ref?: { list: 'todos' | 'reminders'; uid: string };
  appt?: ExternalEvent; // an appointment (opens its editor)
  progress?: { done: number; total: number }; // habits
  // Small, frequent items left out of the month cells (meals, dose times, commute days, the habits line).
  minor?: boolean;
}

// An event from one of HA's calendar.* entities (calendar.get_events).
export interface ExternalEvent {
  calendar: string; // its calendar's name
  entity?: string; // its calendar's entity ID
  summary: string;
  start: string; // 'YYYY-MM-DD' (all day) or an ISO date-time
  end?: string; // exclusive end, the same kind
  location?: string;
  description?: string;
  uid?: string; // to edit or delete it
  recurrenceId?: string; // one occurrence of a repeating event
  appointment?: boolean; // from the Appointments calendar (PLANNER.appointments)
}

export interface CalendarInputs {
  now: Date;
  habits?: HabitsDoc;
  todos?: TodoEntry[];
  reminders?: TodoEntry[];
  medicines?: { list: MedicineDef[]; times: Record<MedSlot, string>; stock: StockStatus[]; people: { id: string; name: string }[] };
  meals?: MealsConfig;
  money?: { bill?: { card: string; due?: string }; upcoming?: { date: string; name: string }[]; premiumDue?: string };
  commute?: { days: number[]; arriveBy?: string };
  external?: ExternalEvent[];
}

// When a meal slot starts, from its window text: "9:30 AM – 2 PM" → 09:30,
// "6 – 8 PM" → 18:00 (the meridiem comes from the end), "Before 9:30 AM" → an
// hour before its end.
export function mealStart(slot: { time: string; end: string }): string {
  const end = minutesOf(slot.end);
  const fallback = () => {
    const m = Math.max(0, end - 60);
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  };
  if (/^\s*(before|by|until)\b/i.test(slot.time)) return fallback();
  const times = [...slot.time.matchAll(/(\d{1,2})(?::(\d\d))?\s*(am|pm)?/gi)];
  if (!times.length) return fallback();
  const [first] = times;
  const mer = (first[3] ?? times.find((t) => t[3])?.[3])?.toLowerCase();
  const n = +first[1];
  // With a meridiem, 12-hour; without, 24-hour, unless an hour under 12 would end up hours before the end.
  let h = mer ? (n % 12) + (mer === 'pm' ? 12 : 0) : n;
  if (!mer && n < 12 && n * 60 < end - 12 * 60) h += 12;
  return `${pad(h)}:${first[2] ?? '00'}`;
}

function dishText(plan: Record<string, Record<string, string>>, slot: string, people: { id: string; name: string }[]): string {
  const dishes = people.map((p) => ({ p, d: plan[p.id]?.[slot] })).filter((x) => x.d);
  const unique = [...new Set(dishes.map((x) => x.d!.toLowerCase()))];
  if (unique.length === 1) return dishes[0].d!;
  return dishes.map((x) => `${x.p.name}: ${x.d}`).join(' · ');
}

// Without a time: the habits line, then overdue things, then the rest.
const untimedRank = (e: CalEvent) => (e.src === 'habits' ? 0 : e.late ? 1 : 2);
const sortEvents = (a: CalEvent, b: CalEvent) =>
  (a.time ? 1 : 0) - (b.time ? 1 : 0) ||
  (a.time && b.time ? minutesOf(a.time) - minutesOf(b.time) || Number(!!a.minor) - Number(!!b.minor) : untimedRank(a) - untimedRank(b));

// Everything on the calendar from `from` for `days` days, by 'YYYY-MM-DD',
// each day's things without a time first, then by time.
export function buildCalendar(from: Date, days: number, inp: CalendarInputs): Map<string, CalEvent[]> {
  const out = new Map<string, CalEvent[]>();
  const start = startOfDay(from);
  const today = startOfDay(inp.now);
  const todayKey = ymd(today);
  const keys = new Set<string>();
  for (let i = 0; i < days; i++) {
    const k = ymd(addDays(start, i));
    keys.add(k);
    out.set(k, []);
  }
  const add = (day: string, e: CalEvent) => keys.has(day) && out.get(day)!.push(e);

  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    const k = ymd(day);
    const past = day < today;
    // The day's habits, up to today.
    if (inp.habits && day <= today) {
      const p = habitProgress(inp.habits, day);
      if (p.total) add(k, { id: `habits|${k}`, src: 'habits', title: `Habits ${p.done} of ${p.total}`, sub: p.done === p.total ? 'All done' : past ? `${p.total - p.done} missed` : `${p.total - p.done} to go`, progress: p, minor: true, done: p.done === p.total });
    }
    // Delivered meals.
    const plan = inp.meals?.plan[day.getDay()];
    if (inp.meals && plan)
      for (const slot of inp.meals.slots) {
        const sub = dishText(plan as Record<string, Record<string, string>>, slot.id, inp.meals.people);
        if (sub) add(k, { id: `meal|${k}|${slot.id}`, src: 'meals', title: slot.label, sub, time: mealStart(slot), end: slot.end, minor: true });
      }
    // Dose times (ticks are kept a week, so older days show no tick state).
    if (inp.medicines)
      for (const s of daySchedule(inp.medicines.list, day, inp.medicines.times)) {
        const doses = Object.values(s.byPerson).flat();
        const names = [...new Set(doses.map((d) => d.med.name))];
        const tracked = daysBetween(day, today) < 7;
        add(k, {
          id: `med|${k}|${s.slot}`,
          src: 'medicines',
          title: `Medicines · ${SLOT_LABEL[s.slot].toLowerCase()}`,
          sub: names.join(', '),
          time: s.time,
          done: tracked && day <= today ? doses.every((d) => d.taken) : undefined,
          minor: true,
        });
      }
    // Commute days.
    if (inp.commute?.arriveBy && inp.commute.days.includes(day.getDay()))
      add(k, { id: `commute|${k}`, src: 'commute', title: 'Commute', sub: `Arrive by ${clockText(inp.commute.arriveBy)}`, time: inp.commute.arriveBy, minor: true });
  }

  // Medicines running out.
  for (const s of inp.medicines?.stock ?? []) {
    if (!s.out || s.med.paused) continue;
    const day = s.out < inp.now ? todayKey : ymd(s.out);
    add(day, { id: `medout|${s.med.id}`, src: 'medicines', title: s.out < inp.now ? `${s.med.name} has run out` : `${s.med.name} runs out`, sub: 'Refill' });
  }

  // Money: no amounts (anyone can read the wall screens).
  const m = inp.money;
  if (m?.bill?.due) add(m.bill.due, { id: `bill|${m.bill.due}`, src: 'money', title: `${m.bill.card} bill due`, sub: 'Card bill' });
  for (const u of m?.upcoming ?? []) add(u.date.slice(0, 10), { id: `pay|${u.date}|${u.name}`, src: 'money', title: u.name, sub: 'Payment due' });
  if (m?.premiumDue) add(m.premiumDue, { id: `premium|${m.premiumDue}`, src: 'money', title: 'Insurance premium due', sub: 'Insurance' });

  // To-do items with a due date; open overdue ones also show on today.
  for (const list of ['todos', 'reminders'] as const)
    for (const it of inp[list] ?? []) {
      const d = parseDue(it.due);
      if (!d) continue;
      const done = it.status === 'completed';
      const late = !done && isOverdue(d, inp.now);
      const base = { src: list, title: it.summary, ref: { list, uid: it.uid }, done } as const;
      add(d.day, { ...base, id: `${list}|${it.uid}`, time: d.time, sub: list === 'todos' ? 'Todo' : 'Reminder', late: late && d.day === todayKey });
      if (late && d.day < todayKey) add(todayKey, { ...base, id: `${list}|${it.uid}|late`, sub: `Overdue · ${dueText(d, inp.now)}`, late: true });
    }

  // HA calendars: all-day events on every day they cover.
  for (const e of inp.external ?? []) {
    const src: CalSource = e.appointment ? 'appointments' : 'calendar';
    const sub = e.location || (e.appointment ? 'Appointment' : e.calendar);
    const allDay = /^\d{4}-\d\d-\d\d$/.test(e.start);
    if (allDay) {
      const first = dayOf(e.start);
      const last = e.end && /^\d{4}-\d\d-\d\d$/.test(e.end) ? addDays(dayOf(e.end), -1) : first;
      for (let d = first, i = 0; d <= last && i < 62; d = addDays(d, 1), i++)
        add(ymd(d), { id: `cal|${e.calendar}|${e.start}|${e.summary}|${i}`, src, title: e.summary, sub, ...(e.appointment ? { appt: e } : {}) });
    } else {
      const t = new Date(e.start);
      if (Number.isNaN(t.getTime())) continue;
      const end = e.end ? new Date(e.end) : undefined;
      add(ymd(t), {
        id: `cal|${e.calendar}|${e.start}|${e.summary}`,
        src,
        title: e.summary,
        sub,
        time: hhmm(t),
        end: end && !Number.isNaN(end.getTime()) && ymd(end) === ymd(t) ? hhmm(end) : undefined,
        ...(e.appointment ? { appt: e } : {}),
      });
    }
  }

  for (const list of out.values()) list.sort(sortEvents);
  return out;
}

// The month grid's days: Monday first, whole weeks (5 or 6 rows).
export function monthDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = weekStart(first);
  const last = new Date(year, month + 1, 0);
  const n = daysBetween(start, last) + 1;
  return Array.from({ length: Math.ceil(n / 7) * 7 }, (_, i) => addDays(start, i));
}

// ---------------------------------------------------------------- appointments

// A local time as an ISO string with the device's offset ("2026-11-21T16:00:00+05:30"),
// which HA's calendar takes as is.
export function localIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${ymd(d)}T${hhmm(d)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
export const atClock = (day: string, t: string) => {
  const d = dayOf(day);
  d.setMinutes(minutesOf(t));
  return d;
};

export interface ApptFields {
  summary: string;
  day: string; // 'YYYY-MM-DD'
  start?: string; // 'HH:MM'; none = all day
  end?: string; // 'HH:MM'; none = an hour after the start (before the start: the next day)
  location?: string;
  description?: string;
}

// HA's calendar event for an appointment (calendar/event/create and update):
// all-day events end the next day (exclusive), timed ones an hour later by default.
export function apptEvent(f: ApptFields): Record<string, string> {
  const extra = { ...(f.location?.trim() ? { location: f.location.trim() } : {}), ...(f.description?.trim() ? { description: f.description.trim() } : {}) };
  if (!f.start) return { summary: f.summary, dtstart: f.day, dtend: ymd(addDays(dayOf(f.day), 1)), ...extra };
  const start = atClock(f.day, f.start);
  let end = f.end ? atClock(f.day, f.end) : new Date(start.getTime() + 3_600_000);
  if (end <= start) end = f.end ? atClock(ymd(addDays(dayOf(f.day), 1)), f.end) : new Date(start.getTime() + 3_600_000);
  return { summary: f.summary, dtstart: localIso(start), dtend: localIso(end), ...extra };
}

// The form's fields for an event read back from HA.
export function apptFields(e: ExternalEvent): ApptFields {
  const base = { summary: e.summary, location: e.location ?? '', description: e.description ?? '' };
  if (/^\d{4}-\d\d-\d\d$/.test(e.start)) return { ...base, day: e.start };
  const s = new Date(e.start);
  const end = e.end ? new Date(e.end) : undefined;
  return { ...base, day: ymd(s), start: hhmm(s), ...(end && !Number.isNaN(end.getTime()) ? { end: hhmm(end) } : {}) };
}

// When an event starts and ends (all-day ones: midnight to midnight).
export function eventSpan(e: ExternalEvent): { start: Date; end: Date; allDay: boolean } {
  const allDay = /^\d{4}-\d\d-\d\d$/.test(e.start);
  const start = allDay ? dayOf(e.start) : new Date(e.start);
  const end = e.end ? (allDay ? dayOf(e.end) : new Date(e.end)) : allDay ? addDays(start, 1) : start;
  return { start, end, allDay };
}

// "4 – 5 PM", "11 AM – 12:30 PM", "All day", "Until Friday".
export function spanText(e: ExternalEvent): string {
  const { start, end, allDay } = eventSpan(e);
  if (allDay) return daysBetween(start, end) > 1 ? `Until ${dayName(addDays(end, -1), start)}` : 'All day';
  const a = clockText(hhmm(start));
  if (end <= start) return a;
  const b = clockText(hhmm(end));
  return a.slice(-2) === b.slice(-2) && ymd(start) === ymd(end) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

