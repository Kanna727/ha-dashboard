// The Planner page's data: the habits document, HA's to-do lists (followed
// live, one subscription per list for every reader), HA's calendars, and the
// master calendar built from every time-based part of the dashboard
// (lib/planner.ts, buildCalendar).
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { COMMUTE, MEALS, MEDICINES, PLANNER } from '../config/entities';
import { useHass, type HassApi } from '../ha/api';
import { store } from '../ha/store';
import { readCache, writeCache } from '../ha/useRegistry';
import { stockStatus } from '../lib/medicines';
import {
  apptEvent,
  buildCalendar,
  dueData,
  type ApptFields,
  parseHabits,
  type CalEvent,
  type CalSource,
  type ExternalEvent,
  type HabitsDoc,
  type TodoEntry,
} from '../lib/planner';
import { MED_TIMES, useMedicineList } from '../medicines/useMedicines';
import { useFinance } from '../money/useFinance';
import { useMoneyHistory, useSaveStoreDoc, useStoreDoc } from '../money/useMoneyHistory';

// The deployed preview shares the live dashboard's origin, so the mock keeps its own copies.
const PREFIX = import.meta.env.VITE_MOCK ? 'mock' : 'dash';

// ------------------------------------------------------------- habits

export function useHabits(): HabitsDoc {
  const doc = useStoreDoc(PLANNER.store, 'Habits');
  return useMemo(() => parseHabits(doc), [doc]);
}

// Saves a change to the habits: `change` gets the document as stored right now
// (re-read first), so two screens ticking at once don't undo each other.
// Needs an admin login (HA's lovelace/config/save).
export function useSaveHabits(): (change: (doc: HabitsDoc) => HabitsDoc) => Promise<void> {
  const save = useSaveStoreDoc(PLANNER.store, 'Habits', 'Habits');
  return useCallback((change) => save((current) => change(parseHabits(current))), [save]);
}

// ------------------------------------------------------------- to-do lists

// Is there such a list in HA? (Re-renders only when that changes.)
export function useHasList(entityId: string): boolean {
  return useSyncExternalStore(store.subscribe, () => !!store.getAll()[entityId]);
}

interface ListStore {
  items: TodoEntry[] | null;
  listeners: Set<() => void>;
  stop?: () => void;
}
const lists = new Map<string, ListStore>();
function listFor(id: string): ListStore {
  let s = lists.get(id);
  if (!s) {
    s = { items: readCache<TodoEntry[] | null>(`${PREFIX}Todo:${id}`, null), listeners: new Set() };
    lists.set(id, s);
  }
  return s;
}
function subscribeList(hass: HassApi, id: string, listener: () => void): () => void {
  const s = listFor(id);
  s.listeners.add(listener);
  if (!s.stop)
    s.stop = hass.subscribeTodo(id, (items) => {
      s.items = items;
      writeCache(`${PREFIX}Todo:${id}`, items);
      s.listeners.forEach((l) => l());
    });
  return () => {
    s.listeners.delete(listener);
    if (!s.listeners.size && s.stop) {
      s.stop();
      s.stop = undefined;
    }
  };
}

// A list's items, live; null until they first arrive (and for no list).
export function useTodoItems(entityId: string): TodoEntry[] | null {
  const hass = useHass();
  const exists = useHasList(entityId);
  const subscribe = useCallback((l: () => void) => (exists ? subscribeList(hass, entityId, l) : () => undefined), [hass, entityId, exists]);
  const items = useSyncExternalStore(subscribe, () => listFor(entityId).items);
  return exists ? items : null;
}

export interface TodoChange {
  summary?: string;
  date?: string; // 'YYYY-MM-DD'; '' clears the due date
  time?: string; // 'HH:MM'
  description?: string; // '' clears it
}

// Writes to a list (any logged-in user may: these are plain service calls).
export function useTodoActions(entityId: string) {
  const hass = useHass();
  return useMemo(() => {
    const call = (service: string, data: Record<string, unknown>) => hass.callService('todo', service, data, { entity_id: entityId });
    return {
      add: (summary: string, date?: string, time?: string, description?: string) =>
        call('add_item', { item: summary, ...dueData(date, time), ...(description ? { description } : {}) }),
      setDone: (it: TodoEntry, done: boolean) => call('update_item', { item: it.uid, status: done ? 'completed' : 'needs_action' }),
      update: (it: TodoEntry, c: TodoChange) =>
        call('update_item', {
          item: it.uid,
          ...(c.summary !== undefined && c.summary !== it.summary ? { rename: c.summary } : {}),
          ...(c.date !== undefined ? dueData(c.date || undefined, c.date ? c.time : undefined, true) : {}),
          ...(c.description !== undefined ? { description: c.description || null } : {}),
        }),
      remove: (it: TodoEntry) => call('remove_item', { item: [it.uid] }),
      clearDone: () => call('remove_completed_items', {}),
    };
  }, [hass, entityId]);
}

// ------------------------------------------------------------- HA calendars

// The calendars shown: PLANNER.calendars or every calendar.*, and the
// appointments calendar whenever it exists.
const calendarIds = () => {
  const all = store.getAll();
  const ids = PLANNER.calendars ?? Object.keys(all).filter((id) => id.startsWith('calendar.'));
  return [...new Set([...ids, ...(all[PLANNER.appointments] ? [PLANNER.appointments] : [])])].sort().join(',');
};

// Bumped after every change made here, so every reader fetches again at once.
let calVersion = 0;
const calListeners = new Set<() => void>();
const calChanged = () => {
  calVersion++;
  calListeners.forEach((l) => l());
};

// Events of some calendars (comma-separated IDs) from `from` for `days` days,
// refreshed every 15 minutes, after a change made here and whenever the days
// change; null until they first arrive. `calendar` is the calendar's friendly
// name; the appointments are marked.
export function useCalendarEvents(ids: string, from: Date, days: number): ExternalEvent[] | null {
  const hass = useHass();
  const version = useSyncExternalStore(
    (l) => (calListeners.add(l), () => calListeners.delete(l)),
    () => calVersion,
  );
  const [events, setEvents] = useState<ExternalEvent[] | null>(null);
  const start = from.getTime();
  useEffect(() => {
    const list = ids ? ids.split(',') : [];
    if (!list.length) return setEvents([]);
    let live = true;
    const load = () =>
      hass
        .fetchCalendarEvents(list, new Date(start), new Date(start + days * 86_400_000))
        .then((evs) => {
          if (!live) return;
          const all = store.getAll();
          setEvents(
            evs.map((e) => ({
              ...e,
              entity: e.calendar,
              calendar: String(all[e.calendar]?.attributes.friendly_name ?? e.calendar),
              ...(e.calendar === PLANNER.appointments ? { appointment: true } : {}),
            })),
          );
        })
        .catch((e) => console.warn('calendar events', e));
    void load();
    const t = window.setInterval(load, 15 * 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [hass, ids, start, days, version]);
  return events;
}

// Every shown calendar's events in the days shown.
export function useExternalEvents(from: Date, days: number): ExternalEvent[] {
  const ids = useSyncExternalStore(store.subscribe, calendarIds);
  return useCalendarEvents(ids, from, days) ?? [];
}

// Adds, changes and deletes appointments (Local Calendar; any logged-in user may).
export function useAppointmentActions() {
  const hass = useHass();
  return useMemo(() => {
    const run = (p: Promise<void>) => p.finally(calChanged);
    const id = PLANNER.appointments;
    return {
      add: (f: ApptFields) => run(hass.changeCalendarEvent(id, { action: 'create', event: apptEvent(f) })),
      update: (e: ExternalEvent, f: ApptFields) => run(hass.changeCalendarEvent(id, { action: 'update', uid: e.uid!, recurrenceId: e.recurrenceId, event: apptEvent(f) })),
      remove: (e: ExternalEvent) => run(hass.changeCalendarEvent(id, { action: 'delete', uid: e.uid!, recurrenceId: e.recurrenceId })),
    };
  }, [hass]);
}

// ------------------------------------------------------------- the master calendar

const HIDDEN_KEY = 'plannerHidden';
let hidden = new Set<CalSource>(readCache<CalSource[]>(HIDDEN_KEY, []));
const hiddenListeners = new Set<() => void>();
// The sources hidden with the chips (per device).
export function useHiddenSources(): [Set<CalSource>, (s: CalSource) => void] {
  const h = useSyncExternalStore(
    (l) => (hiddenListeners.add(l), () => hiddenListeners.delete(l)),
    () => hidden,
  );
  const toggle = useCallback((s: CalSource) => {
    hidden = new Set(hidden);
    if (hidden.has(s)) hidden.delete(s);
    else hidden.add(s);
    writeCache(HIDDEN_KEY, [...hidden]);
    hiddenListeners.forEach((l) => l());
  }, []);
  return [h, toggle];
}

// Everything on the calendar from `from` for `days` days (by 'YYYY-MM-DD'),
// with the hidden sources left out. `now` should tick (every minute).
export function useCalendar(from: Date, days: number, now: Date): Map<string, CalEvent[]> {
  const habits = useHabits();
  const todos = useTodoItems(PLANNER.todos);
  const reminders = useTodoItems(PLANNER.reminders);
  const meds = useMedicineList();
  const finance = useFinance();
  const money = useMoneyHistory();
  const external = useExternalEvents(from, days);
  const [hiddenSet] = useHiddenSources();
  const minute = Math.floor(now.getTime() / 60_000);
  const start = from.getTime();
  return useMemo(() => {
    const at = new Date(minute * 60_000);
    const cal = buildCalendar(new Date(start), days, {
      now: at,
      habits,
      todos: todos ?? [],
      reminders: reminders ?? [],
      medicines: MEDICINES.people.length
        ? { list: meds, times: MED_TIMES, stock: meds.map((m) => stockStatus(m, at, MED_TIMES, MEDICINES.lowDays)), people: MEDICINES.people }
        : undefined,
      meals: MEALS.people.length ? MEALS : undefined,
      money: {
        bill: finance?.bill?.due ? { card: finance.bill.card.replace(/\s*[•·*]+\s*\d+$/, ''), due: finance.bill.due } : undefined,
        upcoming: money.upcoming,
        premiumDue: finance?.premiumDue,
      },
      commute: { days: COMMUTE.windowDays, arriveBy: COMMUTE.arriveBy },
      external,
    });
    if (hiddenSet.size) for (const [k, evs] of cal) cal.set(k, evs.filter((e) => !hiddenSet.has(e.src)));
    return cal;
  }, [start, days, minute, habits, todos, reminders, meds, finance, money, external, hiddenSet]);
}
