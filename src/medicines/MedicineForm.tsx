import { useState } from 'react';
import { MEDICINES } from '../config/entities';
import type { MedSlot } from '../config/types';
import { Icon } from '../components/Icon';
import { Avatar } from '../meals/parts';
import { clock } from '../meals/plan';
import { saveErrorText } from '../money/useTxEdits';
import { amount, newMedicineId, remaining, upsertMedicine, withCount, type MedicineDef } from '../lib/medicines';
import { MED_TIMES, personIndex, useSaveMedicines } from './useMedicines';

const MEALS3 = [
  ['breakfast', 'Breakfast'],
  ['lunch', 'Lunch'],
  ['dinner', 'Dinner'],
] as const;
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const UNITS = ['tablet', 'capsule', 'ml', 'sachet', 'drop', 'puff', 'injection'];
const STEP = 0.5;

// Add or edit a medicine: name, who takes it, how many at each time (before
// and after each meal), which days, when the course ends, what's counted, the
// pack size, how many there are now and a note. Saved into HA (useSaveMedicines).
export function MedicineForm({ med, onDone }: { med?: MedicineDef; onDone: (saved: MedicineDef | null) => void }) {
  const save = useSaveMedicines();
  const people = MEDICINES.people;
  const opened = useState(() => new Date())[0];
  const left = med ? remaining(med, opened, MED_TIMES) : null;
  const [name, setName] = useState(med?.name ?? '');
  const [who, setWho] = useState<string[]>(med?.who ?? (people.length === 1 ? [people[0].id] : []));
  const [doses, setDoses] = useState<Partial<Record<MedSlot, number>>>(med?.doses ?? {});
  const [days, setDays] = useState<number[] | null>(med?.days ?? null);
  const [until, setUntil] = useState(med?.until ?? '');
  const [unit, setUnit] = useState(med?.unit ?? 'tablet');
  const [pack, setPack] = useState(med?.pack ? String(med.pack) : '');
  const startCount = left === null ? '' : String(left);
  const [count, setCount] = useState(startCount);
  const [note, setNote] = useState(med?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const bump = (slot: MedSlot, d: number) => setDoses((x) => ({ ...x, [slot]: Math.max(0, Math.min(20, (x[slot] ?? 0) + d)) }));
  const toggleDay = (d: number) =>
    setDays((x) => {
      const cur = x ?? [0, 1, 2, 3, 4, 5, 6];
      const next = cur.includes(d) ? cur.filter((y) => y !== d) : [...cur, d];
      return next.length === 7 ? null : next;
    });
  const countN = count.trim() === '' ? null : Number(count);
  const problem = !name.trim()
    ? 'Give it a name'
    : !who.length
      ? 'Pick who takes it'
      : !Object.values(doses).some((n) => n && n > 0)
        ? 'Pick at least one time'
        : days && !days.length
          ? 'Pick at least one day'
          : countN !== null && (!Number.isFinite(countN) || countN < 0)
            ? 'The count must be a number'
            : pack.trim() && !(Number(pack) > 0)
              ? 'The pack size must be a number'
              : '';

  const submit = async () => {
    if (problem || busy) return;
    setBusy(true);
    let saved: MedicineDef | null = null;
    try {
      await save((current) => {
        const at = new Date();
        const stored = med && current.find((m) => m.id === med.id);
        const fields: MedicineDef = {
          id: stored?.id ?? med?.id ?? newMedicineId(name, current),
          name: name.trim(),
          who,
          doses: Object.fromEntries(Object.entries(doses).filter(([, n]) => n && n > 0)),
          days: days ? [...days].sort() : undefined,
          until: until || undefined,
          unit: unit.trim() || undefined,
          pack: pack.trim() ? Number(pack) : undefined,
          note: note.trim() || undefined,
          paused: stored?.paused,
        };
        // An untouched count means "what's left now", worked out with the old
        // schedule at the moment of saving; a typed one is taken as counted now.
        const n = count === startCount && stored ? remaining(stored, at, MED_TIMES) : countN;
        saved = withCount(fields, n, at);
        return upsertMedicine(current, saved);
      });
      onDone(saved);
    } catch (e) {
      setError(saveErrorText(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="med-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="med-field">
        <span className="label">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vitamin D3 60K" autoFocus={!med} />
      </label>

      {people.length > 1 && (
        <div className="med-field">
          <span className="label">Who takes it</span>
          <div className="meal-people">
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip-btn ${who.includes(p.id) ? 'active' : ''}`}
                aria-pressed={who.includes(p.id)}
                onClick={() => setWho((w) => (w.includes(p.id) ? w.filter((x) => x !== p.id) : people.filter((q) => q.id === p.id || w.includes(q.id)).map((q) => q.id)))}
              >
                <Avatar i={personIndex(p.id)} name={p.name} /> {p.name}
              </button>
            ))}
          </div>
          {who.length > 1 && <small className="muted">One shared stock: each dose counts for both.</small>}
        </div>
      )}

      <div className="med-field">
        <span className="label">How many, when{who.length > 1 ? ' (each)' : ''}</span>
        <div className="med-dose-grid">
          {MEALS3.map(([meal, label]) => (
            <div key={meal} className="med-dose-meal">
              <strong>{label}</strong>
              {(['before', 'after'] as const).map((when) => {
                const slot = `${when}_${meal}` as MedSlot;
                const n = doses[slot] ?? 0;
                return (
                  <div key={slot} className={`med-stepper ${n ? 'on' : ''}`}>
                    <span>
                      {when === 'before' ? 'Before' : 'After'}
                      <small>{clock(MED_TIMES[slot])}</small>
                    </span>
                    <button type="button" aria-label={`Fewer ${when} ${meal}`} disabled={!n} onClick={() => bump(slot, -STEP)}>
                      <Icon name="minus" size={16} />
                    </button>
                    <b>{amount(n)}</b>
                    <button type="button" aria-label={`More ${when} ${meal}`} onClick={() => bump(slot, STEP)}>
                      <Icon name="plus" size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="med-field">
        <span className="label">Days</span>
        <div className="med-days">
          <button type="button" className={`chip-btn ${days ? '' : 'active'}`} onClick={() => setDays(null)}>
            Every day
          </button>
          {WEEK.map((d) => (
            <button
              key={d}
              type="button"
              className={`chip-btn med-day ${!days || days.includes(d) ? 'active' : ''}`}
              aria-label={DAY_NAME[d]}
              aria-pressed={!days || days.includes(d)}
              onClick={() => toggleDay(d)}
            >
              {DAY_LETTER[d]}
            </button>
          ))}
        </div>
      </div>

      <div className="med-row">
        <label className="med-field">
          <span className="label">In stock now</span>
          <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="decimal" placeholder="Not counted" />
        </label>
        <label className="med-field">
          <span className="label">Counted in</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} list="med-units" />
          <datalist id="med-units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </label>
        <label className="med-field">
          <span className="label">Pack of</span>
          <input value={pack} onChange={(e) => setPack(e.target.value)} inputMode="numeric" placeholder="e.g. 10" />
        </label>
        <label className="med-field">
          <span className="label">Course ends</span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      </div>

      <label className="med-field">
        <span className="label">Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Empty stomach, with water" />
      </label>

      {error && <p className="med-error">{error}</p>}
      <div className="med-actions">
        <button type="submit" className="chip-btn active" disabled={!!problem || busy}>
          <Icon name="tick" size={16} /> {med ? 'Save' : 'Add'}
        </button>
        <button type="button" className="chip-btn" onClick={() => onDone(null)}>
          Cancel
        </button>
        {problem && <small className="muted">{problem}</small>}
      </div>
    </form>
  );
}
