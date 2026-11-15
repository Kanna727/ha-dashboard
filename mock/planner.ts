// The Planner page's mock data: the three to-do lists (todos, reminders,
// shopping) as HA's Local To-do and Shopping List integrations would keep them,
// the habits document (the hidden 'dashboard-habits' dashboard) and a family
// calendar. Fictional, dated from today, so the page always has something on.
// The lists follow todo.* service calls and are kept in localStorage, so edits
// survive a reload; `localStorage.removeItem('mockTodo:<entity>')` resets one.
import type { HassEntity } from 'home-assistant-js-websocket';
import type { CalendarChange } from '../src/ha/api';
import type { ExternalEvent, HabitsDoc, TodoEntry } from '../src/lib/planner';
import { addDays, startOfDay } from '../src/lib/planner';
import { atTime, ymd } from '../src/lib/medicines';

const today = () => startOfDay(new Date());
const on = (n: number) => ymd(addDays(today(), n));
const at = (n: number, hhmm: string) => atTime(addDays(today(), n), hhmm).toISOString();

function seed(id: string): TodoEntry[] {
  let n = 0;
  const item = (summary: string, extra: Partial<TodoEntry> = {}): TodoEntry => ({ uid: `${id}-${++n}`, summary, status: 'needs_action', ...extra });
  if (id === 'todo.dashboard_data') return []; // the storage inbox (storage/inbox.ts) starts empty
  if (id === 'todo.todos')
    return [
      item('Fix the balcony light', { due: on(-2) }),
      item('Call the plumber about the sink', { due: on(0) }),
      item('Pay the cleaner', { due: on(1) }),
      item('Renew the car insurance', { due: on(4), description: 'Compare two quotes first' }),
      item('Book a dentist visit'),
      item('Return the parcel', { due: on(-1), status: 'completed' }),
    ];
  if (id === 'todo.reminders')
    return [
      item('Pick up the dry cleaning', { due: at(0, '17:30') }),
      item('Take out the trash', { due: at(0, '21:00') }),
      item('Water the plants', { due: at(1, '08:00') }),
      item('Call Mum', { due: at(2, '18:30') }),
      item('Change the purifier filter', { due: at(9, '10:00') }),
    ];
  return ['Milk', 'Eggs', 'Bananas', 'Bread', 'Detergent', 'Dish soap', 'Tomatoes', 'Rice'].map((s) => item(s, s === 'Bread' ? { status: 'completed' } : {}));
}

export const TODO_LISTS = ['todo.todos', 'todo.reminders', 'todo.shopping_list', 'todo.dashboard_data'];
const NAMES: Record<string, string> = { 'todo.dashboard_data': 'Dashboard data', 'todo.todos': 'Todos', 'todo.reminders': 'Reminders', 'todo.shopping_list': 'Shopping list', 'calendar.family': 'Family', 'calendar.appointments': 'Appointments' };

export const PLANNER_STATES: Record<string, HassEntity> = Object.fromEntries(
  [...TODO_LISTS, 'calendar.family', 'calendar.appointments'].map((id) => [
    id,
    {
      entity_id: id,
      state: id.startsWith('calendar') ? 'off' : '0',
      attributes: { friendly_name: NAMES[id], supported_features: id === 'calendar.family' ? 0 : id.startsWith('calendar') ? 7 : id.startsWith('todo.shopping') ? 15 : 127 },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      context: { id: '', parent_id: null, user_id: null },
    },
  ]),
);

const lists = new Map<string, TodoEntry[]>();
const listeners = new Map<string, Set<(items: TodoEntry[]) => void>>();
const key = (id: string) => `mockTodo:${id}`;

// Read from localStorage every time, so two tabs (two screens) share a list.
function get(id: string): TodoEntry[] {
  try {
    const saved: TodoEntry[] | null = JSON.parse(localStorage.getItem(key(id)) ?? 'null');
    if (saved) {
      lists.set(id, saved);
      return saved;
    }
  } catch {
    /* storage blocked */
  }
  if (!lists.has(id)) lists.set(id, seed(id));
  return lists.get(id)!;
}
function set(id: string, items: TodoEntry[]) {
  lists.set(id, items);
  try {
    localStorage.setItem(key(id), JSON.stringify(items));
  } catch {
    /* storage blocked */
  }
  listeners.get(id)?.forEach((l) => l(items));
}

// The list's items as todo/item/list would answer, for the lists this mock keeps.
export const mockTodoItems = (id: string): TodoEntry[] | null => (TODO_LISTS.includes(id) ? get(id) : null);

// Another tab changed a list: tell the ones following it here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    const id = TODO_LISTS.find((l) => key(l) === e.key);
    if (id) listeners.get(id)?.forEach((l) => l(get(id)));
  });
}

export function subscribeMockTodo(id: string, cb: (items: TodoEntry[]) => void): () => void {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(cb);
  queueMicrotask(() => cb(get(id)));
  return () => listeners.get(id)?.delete(cb);
}

// HA's due fields: `due_date`, or `due_datetime` ('YYYY-MM-DD HH:MM:SS', local).
function dueOf(data: Record<string, unknown>): string | null | undefined {
  if (typeof data.due_datetime === 'string') return new Date(data.due_datetime.replace(' ', 'T')).toISOString();
  if ('due_date' in data) return (data.due_date as string | null) ?? null;
  return undefined;
}

// todo.add_item / update_item / remove_item / remove_completed_items. Returns
// false for anything else.
export function todoService(domain: string, service: string, data: Record<string, unknown>, targets: string[]): boolean {
  if (domain !== 'todo') return false;
  for (const id of targets.filter((t) => TODO_LISTS.includes(t))) {
    const items = get(id);
    const match = (it: TodoEntry, ref: unknown) => it.uid === ref || it.summary === ref;
    if (service === 'add_item') {
      const due = dueOf(data);
      set(id, [...items, { uid: `${id}-${Date.now()}`, summary: String(data.item), status: 'needs_action', ...(due ? { due } : {}), ...(data.description ? { description: String(data.description) } : {}) }]);
    } else if (service === 'update_item') {
      const due = dueOf(data);
      set(
        id,
        items.map((it) =>
          match(it, data.item)
            ? {
                ...it,
                ...(data.rename !== undefined ? { summary: String(data.rename) } : {}),
                ...(data.status ? { status: data.status as TodoEntry['status'] } : {}),
                ...(due !== undefined ? { due } : {}),
                ...('description' in data ? { description: (data.description as string | null) ?? null } : {}),
              }
            : it,
        ),
      );
    } else if (service === 'remove_item') {
      const refs = [data.item].flat();
      set(id, items.filter((it) => !refs.some((r) => match(it, r))));
    } else if (service === 'remove_completed_items') set(id, items.filter((it) => it.status !== 'completed'));
  }
  return true;
}

// The habits document, as the dashboard would have saved it: about a month of
// ticks (seeded, so it's the same every load), today partly done.
export function mockHabits(): HabitsDoc {
  const habits = [
    { id: 'water', name: 'Drink 2 L water', who: ['a', 's'] },
    { id: 'walk', name: 'Walk 8,000 steps', who: ['a'] },
    { id: 'read', name: 'Read 20 minutes', who: ['s'] },
    { id: 'stretch', name: 'Stretch', who: ['a', 's'], days: [1, 2, 3, 4, 5] },
    { id: 'sugar', name: 'No sugar', who: ['a'] },
  ];
  let x = 7;
  const rand = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  const ticks: HabitsDoc['ticks'] = {};
  for (let n = -35; n <= 0; n++) {
    const day = addDays(today(), n);
    for (const h of habits) {
      if (h.days && !h.days.includes(day.getDay())) continue;
      for (const p of h.who) {
        if (n === 0 && (h.id !== 'water' || p !== 'a') && h.id !== 'walk') continue;
        if (rand() < (h.id === 'water' ? 0.92 : 0.72)) ((ticks[ymd(day)] ??= {})[h.id] ??= []).push(p);
      }
    }
  }
  return { version: 1, habits, ticks };
}

// The Appointments calendar (a Local Calendar): seeded, then kept in
// localStorage ('mockAppointments') and changed by calendar/event/* messages.
const APPT_KEY = 'mockAppointments';
let appts: ExternalEvent[] | null = null;
function appointments(): ExternalEvent[] {
  if (!appts) {
    try {
      appts = JSON.parse(localStorage.getItem(APPT_KEY) ?? 'null');
    } catch {
      /* storage blocked */
    }
    appts ??= [
      { calendar: 'calendar.appointments', uid: 'appt-1', summary: 'Dentist', start: at(0, '16:00'), end: at(0, '16:45'), location: 'Smile Dental' },
      { calendar: 'calendar.appointments', uid: 'appt-2', summary: 'Haircut', start: at(2, '11:00'), end: at(2, '11:30') },
      { calendar: 'calendar.appointments', uid: 'appt-3', summary: 'Plumber visit', start: at(5, '09:30'), end: at(5, '10:30'), description: 'Kitchen sink' },
      { calendar: 'calendar.appointments', uid: 'appt-4', summary: 'Passport office', start: on(8), end: on(9) },
    ];
  }
  return appts;
}
const isDay = (v: string) => /^\d{4}-\d\d-\d\d$/.test(v);
const iso = (v: string) => (isDay(v) ? v : new Date(v).toISOString());
// calendar/event/create, update and delete on the appointments (the family calendar is read-only).
export function mockCalendarChange(entityId: string, c: CalendarChange) {
  if (entityId !== 'calendar.appointments') throw new Error('This calendar is read-only');
  const list = appointments();
  const fields = (ev: Record<string, string>) => ({
    summary: ev.summary,
    start: iso(ev.dtstart),
    end: iso(ev.dtend),
    ...(ev.location ? { location: ev.location } : {}),
    ...(ev.description ? { description: ev.description } : {}),
  });
  if (c.action === 'create') appts = [...list, { calendar: entityId, uid: `appt-${Date.now()}`, ...fields(c.event) }];
  else if (c.action === 'update') appts = list.map((e) => (e.uid === c.uid ? { calendar: entityId, uid: e.uid, ...fields(c.event) } : e));
  else appts = list.filter((e) => e.uid !== c.uid);
  try {
    localStorage.setItem(APPT_KEY, JSON.stringify(appts));
  } catch {
    /* storage blocked */
  }
}

// The family calendar's and the appointments' events in [start, end).
export function mockCalendarEvents(start: Date, end: Date): ExternalEvent[] {
  const evs: ExternalEvent[] = [
    { calendar: 'calendar.family', summary: 'Dinner with friends', start: at(3, '19:30'), end: at(3, '22:00'), location: 'Their place' },
    { calendar: 'calendar.family', summary: 'School holiday', start: on(6), end: on(8) },
    { calendar: 'calendar.family', summary: 'Car service', start: at(11, '10:00'), end: at(11, '12:00') },
    ...appointments(),
  ];
  const t = (v: string) => (isDay(v) ? new Date(`${v}T00:00`) : new Date(v));
  return evs.filter((e) => t(e.start) < end && t(e.end ?? e.start) > start);
}
