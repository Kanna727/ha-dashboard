// The calendar's "+ Add" on a day: pick what to add (an appointment, todo,
// reminder, habit or shopping item), then that kind's form, dated that day.
// The kind picked last is remembered per device.
import { useState, type CSSProperties, type FormEvent } from 'react';
import { PLANNER } from '../config/entities';
import { Icon, type IconName } from '../components/Icon';
import { useModal } from '../components/Modal';
import { readCache, writeCache } from '../ha/useRegistry';
import { dayName, dayOf } from '../lib/planner';
import { AppointmentForm } from './AppointmentsPanel';
import { HabitForm } from './HabitsPanel';
import { TodoForm } from './TodoPanel';
import { useHasList, useTodoActions } from './usePlanner';

export type EntryKind = 'appointments' | 'todos' | 'reminders' | 'habits' | 'shopping';
const KIND_KEY = 'plannerAddKind';
const KINDS: { id: EntryKind; label: string; icon: IconName }[] = [
  { id: 'appointments', label: 'Appointment', icon: 'calendar' },
  { id: 'todos', label: 'Todo', icon: 'todo' },
  { id: 'reminders', label: 'Reminder', icon: 'alarm' },
  { id: 'habits', label: 'Habit', icon: 'habit' },
  { id: 'shopping', label: 'Shopping', icon: 'cart' },
];
// "today", "tomorrow", "Friday", "21 Nov".
const dayText = (day: string) => {
  const n = dayName(dayOf(day), new Date());
  return /^(Today|Tomorrow|Yesterday)$/.test(n) ? n.toLowerCase() : n;
};

type ModalApi = ReturnType<typeof useModal>;
export function openAddEntry(modal: ModalApi, day: string) {
  modal.open({ title: `Add to ${dayName(dayOf(day), new Date())}`, icon: 'plus', accent: 'var(--src-appointments)', body: <AddEntry day={day} /> });
}

function AddEntry({ day }: { day: string }) {
  const [kind, setKindState] = useState<EntryKind>(() => {
    const k = readCache<EntryKind>(KIND_KEY, 'appointments');
    return KINDS.some((x) => x.id === k) ? k : 'appointments';
  });
  const setKind = (k: EntryKind) => (setKindState(k), writeCache(KIND_KEY, k));
  return (
    <div className="pl-addentry">
      <div className="pl-kinds" role="tablist" aria-label="What to add">
        {KINDS.map((k) => (
          <button
            key={k.id}
            role="tab"
            aria-selected={kind === k.id}
            className={`pl-kind ${kind === k.id ? 'on' : ''}`}
            style={{ '--c': `var(--src-${k.id})` } as CSSProperties}
            onClick={() => setKind(k.id)}
          >
            <Icon name={k.icon} size={20} />
            <span>{k.label}</span>
          </button>
        ))}
      </div>
      {kind === 'appointments' && <AppointmentForm key={`a${day}`} day={day} />}
      {(kind === 'todos' || kind === 'reminders') && <TodoForm key={`${kind}${day}`} kind={kind} day={day} />}
      {kind === 'habits' && (
        <>
          <p className="muted pl-hint">It counts from {dayText(day)} on.</p>
          <HabitForm key={`h${day}`} since={day} />
        </>
      )}
      {kind === 'shopping' && <ShoppingForm />}
    </div>
  );
}

// Shopping items have no date: they go straight on the list.
function ShoppingForm() {
  const exists = useHasList(PLANNER.shopping);
  const act = useTodoActions(PLANNER.shopping);
  const modal = useModal();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  if (!exists)
    return (
      <p className="muted pl-missing">
        No <code>{PLANNER.shopping}</code> list in Home Assistant. Add the Shopping List integration.
      </p>
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = name.trim();
    if (!t) return;
    void act.add(t.charAt(0).toUpperCase() + t.slice(1)).then(
      () => modal.close(),
      (err) => setError(String((err as { message?: unknown })?.message ?? err)),
    );
  };
  return (
    <form className="pl-form" onSubmit={submit}>
      <label>
        <span className="label">Item</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Milk" />
      </label>
      <p className="muted pl-hint">The shopping list has no dates: this goes straight on the list.</p>
      {error && <p className="med-error">{error}</p>}
      <div className="med-actions">
        <button type="submit" className="chip-btn active" disabled={!name.trim()}>
          <Icon name="plus" size={16} /> Add to the list
        </button>
      </div>
    </form>
  );
}
