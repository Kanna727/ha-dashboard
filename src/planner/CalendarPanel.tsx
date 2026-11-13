// The master calendar (the owner picked "Today first" on 2026-11-12): opens on
// today, with a week strip to pick a day, the day's things without a time on
// top, then the day by time with a NOW line. Day / Week / Month switch it to
// the whole week or a month grid with the picked day under it. Chips hide a
// source. Everything time-based on the dashboard is here (usePlanner, useCalendar).
import { useMemo, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { useModal } from '../components/Modal';
import { useNow } from '../hooks/useNow';
import { usePage, type Page } from '../layout/pages';
import { readCache, writeCache } from '../ha/useRegistry';
import { ymd } from '../lib/medicines';
import { addDays, CAL_SOURCES, clockText, dayName, dayOf, minutesOf, monthDays, startOfDay, weekStart, type CalEvent, type CalSource } from '../lib/planner';
import { PLANNER } from '../config/entities';
import { openAddEntry } from './AddEntry';
import { openAppointment } from './AppointmentsPanel';
import { LIST_ENTITY, openTodo, Tick, useFailToast } from './TodoPanel';
import { useCalendar, useHiddenSources, useTodoActions, useTodoItems } from './usePlanner';

type View = 'day' | 'week' | 'month';
const VIEW_KEY = 'plannerView';
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const srcColor = (s: string) => ({ '--c': `var(--src-${s})` }) as CSSProperties;
const LABEL = Object.fromEntries(CAL_SOURCES.map((s) => [s.id, s.label])) as Record<CalSource, string>;
// Where a source's things live on the dashboard.
const PAGE_OF: Partial<Record<CalSource, Page>> = { medicines: 'health', meals: 'health', money: 'money', commute: 'commute' };

export function CalendarPanel() {
  const now = useNow(30_000);
  const today = ymd(now);
  const [view, setViewState] = useState<View>(() => readCache<View>(VIEW_KEY, 'day'));
  const setView = (v: View) => (setViewState(v), writeCache(VIEW_KEY, v));
  // The picked day; null follows today (past midnight too).
  const [picked, setPicked] = useState<string | null>(null);
  const sel = picked ? dayOf(picked) : startOfDay(now);
  // The month grid holds the picked day's week, so one range covers every view.
  const grid = useMemo(() => monthDays(sel.getFullYear(), sel.getMonth()), [sel.getFullYear(), sel.getMonth()]);
  const cal = useCalendar(grid[0], grid.length, now);
  const [hidden, toggle] = useHiddenSources();
  const pick = (d: Date) => setPicked(ymd(d) === today ? null : ymd(d));

  // Chips for the sources that have anything in these days (or are hidden).
  const present = new Set<CalSource>([...cal.values()].flat().map((e) => e.src));
  const chips = CAL_SOURCES.filter((s) => present.has(s.id) || hidden.has(s.id));
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(sel), i));
  const moveMonth = (n: number) => {
    const first = new Date(sel.getFullYear(), sel.getMonth() + n, 1);
    pick(first.getFullYear() === now.getFullYear() && first.getMonth() === now.getMonth() ? now : first);
  };

  return (
    <section className="panel pl-panel pl-calendar">
      <header className="panel-head">
        <h2 className="label">Calendar</h2>
        {picked && (
          <button className="chip-btn small pl-today" onClick={() => setPicked(null)}>
            Today
          </button>
        )}
        <div className="pl-seg" role="tablist" aria-label="Calendar view">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </header>
      {chips.length > 1 && (
        <div className="pl-chips">
          {chips.map((s) => (
            <button key={s.id} className={`pl-chip ${hidden.has(s.id) ? '' : 'on'}`} style={srcColor(s.id)} aria-pressed={!hidden.has(s.id)} onClick={() => toggle(s.id)}>
              <i /> {s.label}
            </button>
          ))}
        </div>
      )}
      {view === 'month' ? (
        <>
          <div className="pl-mhead">
            <h3>
              {MONTHS[sel.getMonth()]} {sel.getFullYear()}
            </h3>
            <button className="round small" onClick={() => moveMonth(-1)} aria-label="Previous month">
              <Icon name="back" size={20} />
            </button>
            <button className="round small" onClick={() => moveMonth(1)} aria-label="Next month">
              <Icon name="chevronRight" size={20} />
            </button>
          </div>
          <MonthGrid days={grid} month={sel.getMonth()} cal={cal} sel={ymd(sel)} today={today} onPick={pick} />
          <DayHead day={sel} now={now} />
          <Agenda events={cal.get(ymd(sel)) ?? []} day={sel} now={now} compact />
        </>
      ) : (
        <>
          <WeekStrip days={week} cal={cal} sel={ymd(sel)} today={today} onPick={pick} onMove={(n) => pick(addDays(sel, n))} />
          {view === 'day' ? (
            <>
              <DayHead day={sel} now={now} />
              <Agenda events={cal.get(ymd(sel)) ?? []} day={sel} now={now} />
            </>
          ) : (
            week.map((d) => (
              <div key={ymd(d)} className="pl-weekday">
                <DayHead day={d} now={now} />
                <Agenda events={cal.get(ymd(d)) ?? []} day={d} now={now} compact />
              </div>
            ))
          )}
        </>
      )}
    </section>
  );
}

// A day's name, with "+ Add" to put something on that day.
function DayHead({ day, now }: { day: Date; now: Date }) {
  const modal = useModal();
  const k = ymd(day);
  const name = dayName(day, now);
  return (
    <div className={`pl-dayrow ${k === ymd(now) ? 'today' : ''}`}>
      <h3 className="label pl-dayhead">{name}</h3>
      <button className="pl-dayadd" onClick={() => openAddEntry(modal, k)} aria-label={`Add to ${name}`}>
        <Icon name="plus" size={18} />
        <span>Add</span>
      </button>
    </div>
  );
}

// The distinct sources of a day's main things, as dots (meals, dose times and
// the habits line are left out: they're there most days).
function Dots({ events }: { events: CalEvent[] }) {
  const srcs = [...new Set(events.filter((e) => !e.minor).map((e) => e.src))].slice(0, 4);
  return (
    <span className="pl-dots">
      {srcs.map((s) => (
        <i key={s} style={srcColor(s)} />
      ))}
    </span>
  );
}

function WeekStrip({ days, cal, sel, today, onPick, onMove }: { days: Date[]; cal: Map<string, CalEvent[]>; sel: string; today: string; onPick: (d: Date) => void; onMove: (n: number) => void }) {
  return (
    <div className="pl-wstrip">
      <button className="pl-warrow" onClick={() => onMove(-7)} aria-label="Previous week">
        <Icon name="back" size={18} />
      </button>
      {days.map((d) => {
        const k = ymd(d);
        return (
          <button key={k} className={`pl-wday ${k === today ? 'today' : ''} ${k === sel ? 'sel' : ''}`} onClick={() => onPick(d)} aria-pressed={k === sel}>
            <small>{WEEKDAY[d.getDay()]}</small>
            <strong>{d.getDate()}</strong>
            <Dots events={cal.get(k) ?? []} />
          </button>
        );
      })}
      <button className="pl-warrow" onClick={() => onMove(7)} aria-label="Next week">
        <Icon name="chevronRight" size={18} />
      </button>
    </div>
  );
}

function MonthGrid({ days, month, cal, sel, today, onPick }: { days: Date[]; month: number; cal: Map<string, CalEvent[]>; sel: string; today: string; onPick: (d: Date) => void }) {
  return (
    <div className="pl-month">
      <div className="pl-mgrid">
        {WEEK.map((w) => (
          <span key={w} className="pl-wk">
            <span className="full">{w}</span>
            <span className="short">{w[0]}</span>
          </span>
        ))}
        {days.map((d) => {
          const k = ymd(d);
          const evs = cal.get(k) ?? [];
          const main = evs.filter((e) => !e.minor);
          const hab = evs.find((e) => e.src === 'habits')?.progress;
          return (
            <button key={k} className={`pl-mc ${d.getMonth() !== month ? 'out' : ''} ${k === today ? 'today' : ''} ${k === sel ? 'sel' : ''}`} onClick={() => onPick(d)}>
              <span className="pl-mn">{d.getDate()}</span>
              {main.slice(0, 2).map((e) => (
                <span key={e.id} className={`pl-ml ${e.done ? 'done' : ''}`} style={srcColor(e.src)}>
                  {e.time ? `${clockText(e.time).replace(/ (AM|PM)$/, (m) => m.trim()[0].toLowerCase())} ` : ''}
                  {e.title}
                </span>
              ))}
              {main.length > 2 && <span className="pl-more">+{main.length - 2}</span>}
              <Dots events={evs} />
              {hab && hab.total > 0 && (
                <span className="pl-mhab">
                  <i style={{ width: `${(hab.done / hab.total) * 100}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// One day's things: untimed first, then by time, with a NOW line on today.
// `compact` folds the meals into one line (week and month views).
function Agenda({ events, day, now, compact = false }: { events: CalEvent[]; day: Date; now: Date; compact?: boolean }) {
  const modal = useModal();
  const [, go] = usePage();
  const fail = useFailToast();
  const todos = useTodoItems(PLANNER.todos);
  const reminders = useTodoItems(PLANNER.reminders);
  const actTodos = useTodoActions(LIST_ENTITY('todos'));
  const actReminders = useTodoActions(LIST_ENTITY('reminders'));
  const isToday = ymd(day) === ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const past = day < startOfDay(now);

  let list = events;
  if (compact) {
    const meals = list.filter((e) => e.src === 'meals');
    if (meals.length > 1) {
      list = list.filter((e) => e.src !== 'meals');
      const first = meals[0];
      list.push({ ...first, id: `${first.id}|all`, title: 'Meals', sub: meals.map((m) => m.sub).join(' · '), end: meals.at(-1)!.end });
      list.sort((a, b) => (a.time ? 1 : 0) - (b.time ? 1 : 0) || (a.time && b.time ? minutesOf(a.time) - minutesOf(b.time) : 0));
    }
  }
  if (!list.length) return <p className="pl-empty">Nothing on</p>;

  const item = (e: CalEvent) => (e.ref ? (e.ref.list === 'todos' ? todos : reminders)?.find((i) => i.uid === e.ref!.uid) : undefined);
  const tick = (e: CalEvent) => {
    const it = item(e);
    if (!it) return;
    void (e.ref!.list === 'todos' ? actTodos : actReminders).setDone(it, !e.done).catch(fail);
  };
  const open = (e: CalEvent) => {
    if (e.appt) return openAppointment(modal, e.appt);
    const it = item(e);
    if (it && e.ref) return openTodo(modal, e.ref.list, it);
    const page = PAGE_OF[e.src];
    if (page) go(page);
  };
  const right = (e: CalEvent) =>
    e.ref ? (
      <Tick on={!!e.done} kind={e.src} onClick={() => tick(e)} label={`${e.title}: ${e.done ? 'done (tap to undo)' : 'tap when done'}`} />
    ) : e.src === 'medicines' && e.done !== undefined ? (
      <span className={`pl-tick static ${e.done ? 'on' : ''}`} style={srcColor(e.src)} aria-label={e.done ? 'Taken' : 'Not ticked yet'}>
        {e.done && <Icon name="tick" size={16} />}
      </span>
    ) : (
      <span className="pl-tag">{LABEL[e.src]}</span>
    );

  const allDay = list.filter((e) => !e.time);
  const timed = list.filter((e) => e.time);
  let nowShown = !isToday;
  const nowLine = (
    <div className="pl-now" key="now">
      <b>{clockText(`${now.getHours()}:${now.getMinutes()}`)}</b>
      <i />
    </div>
  );
  return (
    <div className="pl-agenda">
      {allDay.map((e) =>
        e.src === 'habits' && e.progress ? (
          <div key={e.id} className="pl-ad habits" style={srcColor('habits')}>
            <span className="pl-ad-bar">
              <i style={{ width: `${(e.progress.done / e.progress.total) * 100}%` }} />
            </span>
            <strong>{e.title}</strong>
            <span>{e.sub}</span>
          </div>
        ) : (
          <div key={e.id} className={`pl-ad ${e.late ? 'late' : ''} ${e.done ? 'done' : ''}`} style={srcColor(e.src)}>
            {e.ref && <Tick on={!!e.done} kind={e.src} onClick={() => tick(e)} label={`${e.title}: ${e.done ? 'done (tap to undo)' : 'tap when done'}`} />}
            <button className="pl-ad-text" onClick={() => open(e)}>
              <strong>{e.title}</strong>
              <span>{e.sub}</span>
            </button>
          </div>
        ),
      )}
      {timed.map((e) => {
        const end = minutesOf(e.end ?? e.time!);
        const gone = past || (isToday && Math.max(end, minutesOf(e.time!)) < nowMin);
        const late = e.late || (isToday && e.src === 'reminders' && !e.done && minutesOf(e.time!) < nowMin);
        const pre = !nowShown && minutesOf(e.time!) > nowMin ? ((nowShown = true), nowLine) : null;
        return [
          pre,
          <div key={e.id} className={`pl-ev ${gone && !late ? 'gone' : ''} ${late ? 'late' : ''} ${e.done ? 'done' : ''}`} style={srcColor(e.src)}>
            <span className="pl-ev-t">
              {clockText(e.time!).replace(/ (AM|PM)$/, '')}
              <small>{late ? 'LATE' : clockText(e.time!).slice(-2)}</small>
            </span>
            <span className="pl-ev-bar" />
            <button className="pl-ev-what" onClick={() => open(e)}>
              <strong>{e.title}</strong>
              {e.sub && <small>{e.sub}</small>}
            </button>
            {right(e)}
          </div>,
        ];
      })}
      {!nowShown && nowLine}
    </div>
  );
}
