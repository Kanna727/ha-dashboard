// Todos and Reminders: HA to-do lists (Local To-do by default), followed live.
// Open items first, dated ones by when they're due (overdue in orange), done
// ones folded away with "Clear". The add field reads a date and time out of
// what's typed ("call the bank friday 6pm"); a tap on an item opens its editor.
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { PLANNER } from '../config/entities';
import { Icon } from '../components/Icon';
import { useModal } from '../components/Modal';
import { useToasts } from '../components/Toasts';
import { useNow } from '../hooks/useNow';
import { ymd } from '../lib/medicines';
import { dueText, isOverdue, parseDue, parseQuickAdd, sortOpen, type TodoEntry } from '../lib/planner';
import { useTodoActions, useTodoItems, useHasList } from './usePlanner';

export type ListKind = 'todos' | 'reminders';
export const LIST_ENTITY = (k: ListKind) => (k === 'todos' ? PLANNER.todos : PLANNER.reminders);
const LABEL: Record<ListKind, string> = { todos: 'Todos', reminders: 'Reminders' };
const srcColor = (k: string) => ({ '--c': `var(--src-${k})` }) as CSSProperties;

export function Tick({ on, kind, onClick, label }: { on: boolean; kind: string; onClick?: () => void; label: string }) {
  return (
    <button className={`pl-tick ${on ? 'on' : ''}`} style={srcColor(kind)} onClick={onClick} aria-pressed={on} aria-label={label}>
      {on && <Icon name="tick" size={16} />}
    </button>
  );
}

// Shows a failed write as a toast.
export function useFailToast() {
  const { push } = useToasts();
  return (e: unknown) => push({ id: `planner-${Date.now()}`, title: 'Not saved', text: String((e as { message?: unknown })?.message ?? e), icon: 'planner', tone: 'warn' });
}

// The add field, with what it understood shown under it.
export function QuickAdd({ kind, placeholder, onAdd }: { kind: string; placeholder: string; onAdd: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const now = useNow(60_000);
  const parsed = kind === 'shopping' || !text.trim() ? null : parseQuickAdd(text, now);
  const when = parsed?.date ? dueText({ day: parsed.date, time: parsed.time }, now) : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    void onAdd(t).then(() => setText(''));
  };
  return (
    <form className="pl-add" style={srcColor(kind)} onSubmit={submit}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} enterKeyHint="done" aria-label={placeholder} />
      <button type="submit" className="pl-add-btn" disabled={!text.trim()} aria-label="Add">
        <Icon name="plus" size={20} />
      </button>
      {parsed && (
        <span className={`pl-add-when ${kind === 'reminders' && !parsed.time ? 'warn' : ''}`}>
          {parsed.summary ? `“${parsed.summary}”` : ''} {when ? `· ${when}` : kind === 'reminders' ? '· add a time to be reminded' : kind === 'appointments' ? '· pick the day next' : '· no date'}
        </span>
      )}
    </form>
  );
}

export function TodoPanel({ kind }: { kind: ListKind }) {
  const entity = LIST_ENTITY(kind);
  const exists = useHasList(entity);
  const items = useTodoItems(entity);
  const act = useTodoActions(entity);
  const modal = useModal();
  const fail = useFailToast();
  const now = useNow(60_000);
  const [showDone, setShowDone] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  if (!exists)
    return (
      <section className="panel pl-panel">
        <header className="panel-head">
          <h2 className="label">{LABEL[kind]}</h2>
        </header>
        <p className="muted pl-missing">
          No <code>{entity}</code> list in Home Assistant. Add the Local To-do integration with a list named “{LABEL[kind]}”.
        </p>
      </section>
    );

  const open = sortOpen((items ?? []).filter((i) => i.status !== 'completed'));
  const done = (items ?? []).filter((i) => i.status === 'completed');
  const coming = kind === 'reminders' ? open.filter((i) => parseDue(i.due)).length : open.length;
  const add = (text: string) => {
    const q = parseQuickAdd(text, new Date());
    return act.add(q.summary || text, q.date, q.time).catch(fail);
  };

  return (
    <section className={`panel pl-panel pl-${kind}`} style={srcColor(kind)}>
      <header className="panel-head">
        <h2 className="label">{LABEL[kind]}</h2>
        <span className="panel-summary">{items === null ? '…' : kind === 'reminders' ? `${coming} coming` : `${open.length} open`}</span>
      </header>
      {items !== null && !open.length && <p className="pl-empty">{done.length ? 'All done' : kind === 'reminders' ? 'No reminders' : 'Nothing to do'}</p>}
      <ul className="pl-list">
        {open.map((it) => (
          <TodoRow key={it.uid} it={it} kind={kind} now={now} onTick={() => act.setDone(it, true).catch(fail)} onOpen={() => openTodo(modal, kind, it)} />
        ))}
      </ul>
      {done.length > 0 && (
        <div className="pl-done-head">
          <button onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            Done · {done.length} <Icon name={showDone ? 'arrowUp' : 'arrowDown'} size={14} />
          </button>
          <button className={`pl-clear ${armed ? 'armed' : ''}`} onClick={() => (armed ? (setArmed(false), void act.clearDone().catch(fail)) : setArmed(true))}>
            {armed ? 'Tap again to clear' : 'Clear'}
          </button>
        </div>
      )}
      {showDone && (
        <ul className="pl-list">
          {done.map((it) => (
            <TodoRow key={it.uid} it={it} kind={kind} now={now} onTick={() => act.setDone(it, false).catch(fail)} onOpen={() => openTodo(modal, kind, it)} />
          ))}
        </ul>
      )}
      <QuickAdd kind={kind} placeholder={kind === 'todos' ? 'Add a todo… “call the bank friday”' : 'Add a reminder… “gas cylinder tomorrow 9am”'} onAdd={add} />
    </section>
  );
}

function TodoRow({ it, kind, now, onTick, onOpen }: { it: TodoEntry; kind: ListKind; now: Date; onTick: () => void; onOpen: () => void }) {
  const done = it.status === 'completed';
  const due = parseDue(it.due);
  const late = !done && due && isOverdue(due, now);
  return (
    <li className={`pl-row ${done ? 'done' : ''}`}>
      <Tick on={done} kind={kind} onClick={onTick} label={`${it.summary}: ${done ? 'done (tap to undo)' : 'tap when done'}`} />
      <button className="pl-row-text" onClick={onOpen}>
        <span className="pl-row-name">{it.summary}</span>
        {it.description && <small>{it.description}</small>}
      </button>
      {due && <span className={`pl-due ${late ? 'late' : due.day === ymd(now) ? 'today' : ''}`}>{dueText(due, now)}</span>}
    </li>
  );
}

type ModalApi = ReturnType<typeof useModal>;
export function openTodo(modal: ModalApi, kind: ListKind, it: TodoEntry) {
  modal.open({ title: it.summary, icon: kind === 'todos' ? 'todo' : 'alarm', accent: `var(--src-${kind})`, body: <TodoForm key={it.uid} kind={kind} uid={it.uid} /> });
}

// A new reminder's time on `day`: the next whole hour today, else 9 AM.
function defaultTime(day: string): string {
  const now = new Date();
  if (day !== ymd(now)) return '09:00';
  return `${String(Math.min(23, now.getHours() + 1)).padStart(2, '0')}:00`;
}

// One item's editor: name, date and time, notes; done, delete. Follows the list
// live, so a change made elsewhere shows here too. Without `uid` it adds a new
// item dated `day` (the calendar's "+").
export function TodoForm({ kind, uid, day }: { kind: ListKind; uid?: string; day?: string }) {
  const entity = LIST_ENTITY(kind);
  const exists = useHasList(entity);
  const items = useTodoItems(entity);
  const act = useTodoActions(entity);
  const modal = useModal();
  const it = uid ? items?.find((i) => i.uid === uid) : undefined;
  const due = parseDue(it?.due);
  const [name, setName] = useState(it?.summary ?? '');
  const [date, setDate] = useState(due?.day ?? day ?? '');
  const [time, setTime] = useState(due?.time ?? (!uid && kind === 'reminders' && day ? defaultTime(day) : ''));
  const [notes, setNotes] = useState(it?.description ?? '');
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState('');
  if (!exists)
    return (
      <p className="muted pl-missing">
        No <code>{entity}</code> list in Home Assistant. Add the Local To-do integration with a list named “{LABEL[kind]}”.
      </p>
    );
  if (uid && !it) return <p className="muted">This item was removed.</p>;
  const run = (p: Promise<unknown>) =>
    p.then(
      () => modal.close(),
      (e) => setError(String((e as { message?: unknown })?.message ?? e)),
    );
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!it) return void run(act.add(name.trim(), date || undefined, date ? time || undefined : undefined, notes.trim() || undefined));
    void run(act.update(it, { summary: name.trim(), date, time: date ? time || undefined : undefined, description: notes.trim() }));
  };
  const done = it?.status === 'completed';
  return (
    <form className="pl-form" onSubmit={save}>
      <label>
        <span className="label">{kind === 'todos' ? 'Todo' : 'Reminder'}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!it} placeholder={kind === 'todos' ? 'Call the bank' : 'Take out the trash'} />
      </label>
      <div className="pl-form-row">
        <label>
          <span className="label">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span className="label">Time</span>
          <input type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} />
        </label>
        {date && (
          <button type="button" className="chip-btn small" onClick={() => (setDate(''), setTime(''))}>
            No date
          </button>
        )}
      </div>
      {kind === 'reminders' && <p className="muted pl-hint">{date && time ? 'The wall screens and phones get an alert at this time.' : 'Give it a date and time to be reminded.'}</p>}
      <label>
        <span className="label">Notes</span>
        <textarea value={notes} rows={3} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="med-error">{error}</p>}
      <div className="med-actions">
        <button type="submit" className="chip-btn active" disabled={!name.trim()}>
          <Icon name={it ? 'save' : 'plus'} size={16} /> {it ? 'Save' : kind === 'todos' ? 'Add todo' : 'Add reminder'}
        </button>
        {it && (
          <>
            <button type="button" className="chip-btn" onClick={() => void run(act.setDone(it, !done))}>
              <Icon name={done ? 'undo' : 'tick'} size={16} /> {done ? 'Not done' : 'Done'}
            </button>
            <button
              type="button"
              className={`chip-btn med-delete ${armed ? 'armed' : ''}`}
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  window.setTimeout(() => setArmed(false), 4000);
                  return;
                }
                void run(act.remove(it));
              }}
            >
              <Icon name="trash" size={16} /> {armed ? 'Tap again to delete' : 'Delete'}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
