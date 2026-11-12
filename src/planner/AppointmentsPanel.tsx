// Appointments: a Home Assistant calendar (PLANNER.appointments, a Local
// Calendar by default), so they also show in HA's own calendar and the phone
// apps. The coming weeks by day; a tap opens the editor. The add field reads a
// date and time out of what's typed ("dentist friday 4pm", an hour long); with
// no date it opens the form. The calendar's "+" adds one on its day too.
import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { PLANNER } from '../config/entities';
import { Icon } from '../components/Icon';
import { useModal } from '../components/Modal';
import { useNow } from '../hooks/useNow';
import { ymd } from '../lib/medicines';
import { apptFields, dayName, dayOf, eventSpan, parseQuickAdd, spanText, startOfDay, type ApptFields, type ExternalEvent } from '../lib/planner';
import { QuickAdd, useFailToast } from './TodoPanel';
import { useAppointmentActions, useCalendarEvents, useHasList } from './usePlanner';

const DAYS_AHEAD = 60;
const accent = { '--c': 'var(--src-appointments)' } as CSSProperties;

export function MissingAppointments() {
  return (
    <p className="muted pl-missing">
      No <code>{PLANNER.appointments}</code> calendar in Home Assistant. Add the Local Calendar integration with a calendar named “Appointments”.
    </p>
  );
}

export function AppointmentsPanel() {
  const exists = useHasList(PLANNER.appointments);
  const now = useNow(60_000);
  const today = startOfDay(now);
  const events = useCalendarEvents(exists ? PLANNER.appointments : '', today, DAYS_AHEAD);
  const act = useAppointmentActions();
  const modal = useModal();
  const fail = useFailToast();

  // Not over yet, soonest first, by day (one over several days shows on its first, or today).
  const minute = Math.floor(now.getTime() / 60_000);
  const byDay = useMemo(() => {
    const at = new Date(minute * 60_000);
    const first = ymd(startOfDay(at));
    const m = new Map<string, ExternalEvent[]>();
    const list = (events ?? []).filter((e) => eventSpan(e).end > at).sort((a, b) => eventSpan(a).start.getTime() - eventSpan(b).start.getTime());
    for (const e of list) {
      const k = ymd(eventSpan(e).start);
      const day = k < first ? first : k;
      m.set(day, [...(m.get(day) ?? []), e]);
    }
    return m;
  }, [events, minute]);
  const count = [...byDay.values()].flat().length;

  const add = (text: string) => {
    const q = parseQuickAdd(text, new Date());
    if (!q.date) return Promise.resolve(openAppointment(modal, undefined, { summary: q.summary || text }));
    return act.add({ summary: q.summary || text, day: q.date, start: q.time }).catch(fail);
  };

  return (
    <section className="panel pl-panel pl-appointments" style={accent}>
      <header className="panel-head">
        <h2 className="label">Appointments</h2>
        {exists && <span className="panel-summary">{events === null ? '…' : count ? `${count} coming` : 'None coming'}</span>}
      </header>
      {!exists ? (
        <MissingAppointments />
      ) : (
        <>
          {events !== null && !count && <p className="pl-empty">Nothing booked</p>}
          {[...byDay].map(([k, evs]) => (
            <div key={k} className="pl-appt-day">
              <h3 className={`label pl-dayhead ${k === ymd(now) ? 'today' : ''}`}>{dayName(dayOf(k), now)}</h3>
              <ul className="pl-list">
                {evs.map((e) => (
                  <li key={`${e.uid}|${e.recurrenceId ?? ''}|${e.start}`} className={`pl-row pl-appt ${eventSpan(e).start <= now ? 'now' : ''}`}>
                    <span className="pl-appt-time">{spanText(e)}</span>
                    <button className="pl-row-text" onClick={() => openAppointment(modal, e)}>
                      <span className="pl-row-name">{e.summary}</span>
                      {(e.location || e.description) && <small>{[e.location, e.description].filter(Boolean).join(' · ')}</small>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <QuickAdd kind="appointments" placeholder="Add an appointment… “dentist friday 4pm”" onAdd={add} />
        </>
      )}
    </section>
  );
}

type ModalApi = ReturnType<typeof useModal>;
// The editor for an appointment, or a new one (prefilled with `init`).
export function openAppointment(modal: ModalApi, e?: ExternalEvent, init?: Partial<ApptFields>) {
  modal.open({
    title: e ? e.summary : 'New appointment',
    icon: 'calendar',
    accent: 'var(--src-appointments)',
    body: <AppointmentForm key={e?.uid ?? 'new'} event={e} init={init} />,
  });
}

// Name, day, all day or from–to, place, notes; delete when editing. A new one
// is on `day` (the calendar's "+"), else today.
export function AppointmentForm({ event, init, day }: { event?: ExternalEvent; init?: Partial<ApptFields>; day?: string }) {
  const exists = useHasList(PLANNER.appointments);
  const act = useAppointmentActions();
  const modal = useModal();
  const f = event ? apptFields(event) : undefined;
  const [name, setName] = useState(f?.summary ?? init?.summary ?? '');
  const [date, setDate] = useState(f?.day ?? init?.day ?? day ?? ymd(new Date()));
  const [allDay, setAllDay] = useState(f ? !f.start : false);
  const [start, setStart] = useState(f?.start ?? init?.start ?? '10:00');
  const [end, setEnd] = useState(f?.end ?? init?.end ?? '');
  const [place, setPlace] = useState(f?.location ?? '');
  const [notes, setNotes] = useState(f?.description ?? '');
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState('');
  if (!exists) return <MissingAppointments />;
  // Events read back without a uid can't be addressed.
  const editable = !event || !!event.uid;
  const ready = editable && !!name.trim() && !!date && (allDay || !!start);
  const run = (p: Promise<unknown>) =>
    p.then(
      () => modal.close(),
      (e) => setError(String((e as { message?: unknown })?.message ?? e)),
    );
  const fields = (): ApptFields => ({ summary: name.trim(), day: date, ...(allDay ? {} : { start, ...(end ? { end } : {}) }), location: place, description: notes });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    void run(event ? act.update(event, fields()) : act.add(fields()));
  };
  return (
    <form className="pl-form" onSubmit={submit}>
      <label>
        <span className="label">Appointment</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!event} placeholder="Dentist" />
      </label>
      <div className="pl-form-row">
        <label>
          <span className="label">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="button" className={`chip-btn small ${allDay ? 'active' : ''}`} onClick={() => setAllDay(!allDay)} aria-pressed={allDay}>
          All day
        </button>
      </div>
      {!allDay && (
        <div className="pl-form-row">
          <label>
            <span className="label">From</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            <span className="label">To</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
      )}
      {!allDay && !end && <p className="muted pl-hint">No end time: it's booked for an hour.</p>}
      <label>
        <span className="label">Place</span>
        <input value={place} onChange={(e) => setPlace(e.target.value)} />
      </label>
      <label>
        <span className="label">Notes</span>
        <textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {event?.recurrenceId && <p className="muted pl-hint">This one repeats: a change here is for this time only.</p>}
      {!editable && <p className="muted pl-hint">Home Assistant didn't say which event this is, so it can't be changed here.</p>}
      {error && <p className="med-error">{error}</p>}
      <div className="med-actions">
        <button type="submit" className="chip-btn active" disabled={!ready}>
          <Icon name={event ? 'save' : 'plus'} size={16} /> {event ? 'Save' : 'Add appointment'}
        </button>
        {event && editable && (
          <button
            type="button"
            className={`chip-btn med-delete ${armed ? 'armed' : ''}`}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                window.setTimeout(() => setArmed(false), 4000);
                return;
              }
              void run(act.remove(event));
            }}
          >
            <Icon name="trash" size={16} /> {armed ? 'Tap again to delete' : 'Delete'}
          </button>
        )}
      </div>
    </form>
  );
}
