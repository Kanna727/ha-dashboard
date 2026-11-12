import { useState, type CSSProperties } from 'react';
import { MEDICINES } from '../config/entities';
import { Icon } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';
import { useToasts } from '../components/Toasts';
import { Avatar } from '../meals/parts';
import { DAYS, clock } from '../meals/plan';
import { saveErrorText } from '../money/useTxEdits';
import {
  amount,
  daysAway,
  dayText,
  perDay,
  remaining,
  removeMedicine,
  scheduleText,
  shortDate,
  SLOT_LABEL,
  smallestDose,
  stockStatus,
  unitOf,
  upsertMedicine,
  withCount,
  withPaused,
  withTaken,
  type MedicineDef,
  type StockStatus,
} from '../lib/medicines';
import { MedicineForm } from './MedicineForm';
import { MED_TIMES, personIndex, useMedicineList, useMedicines, useSaveMedicines } from './useMedicines';

export const units = (m: MedicineDef, n: number) => {
  const u = unitOf(m);
  return n === 1 || /s$|ml$|drops?$/i.test(u) ? u : `${u}s`;
};

// "Lasts till Tuesday", "Runs out Friday", "Enough for the course".
function lastsText(s: StockStatus, now: Date): string {
  if (s.med.paused) return 'Paused';
  if (s.left === null) return 'Not counted yet';
  if (!perDay(s.med)) return 'Not scheduled';
  if (!s.out) return s.med.until ? 'Enough till the course ends' : 'Lasts over a year';
  if (s.left + 1e-9 < smallestDose(s.med)) return 'Run out';
  return `${s.low ? 'Runs out' : 'Lasts till'} ${dayText(s.out, now)}`;
}

// The date or time beside "Runs out Friday" (dayText already gives the date beyond a week).
function whenExactly(t: Date, now: Date): string {
  const d = daysAway(t, now);
  if (d >= 7) return '';
  return ` · ${d === 0 ? clock(`${t.getHours()}:${t.getMinutes()}`) : shortDate(t)}`;
}

function Who({ med }: { med: MedicineDef }) {
  return (
    <span className="meal-avatars">
      {med.who.map((id) => {
        const p = MEDICINES.people.find((x) => x.id === id);
        return p ? <Avatar key={id} i={personIndex(id)} name={p.name} /> : null;
      })}
    </span>
  );
}

// Today's doses (tomorrow's once the last one is past): times down, people
// across, like the meals board; then every medicine's stock, low ones first,
// paused ones last. A medicine opens its popup (stock, edit, pause, delete);
// "Add medicine" opens the form. The list is kept in HA (useMedicines).
export function MedicinesPanel({ full = false }: { full?: boolean }) {
  const modal = useModal();
  const save = useSaveMedicines();
  const { push } = useToasts();
  const { now, list, day, doses, stock } = useMedicines();
  if (!MEDICINES.people.length) return null;
  const people = MEDICINES.people.filter((p) => list.some((m) => !m.paused && m.who.includes(p.id)));
  const openMed = (m: MedicineDef) => openMedicine(modal, m);
  const add = () => modal.open({ title: 'Add a medicine', icon: 'pill', accent: 'var(--accent-fan)', body: <MedicineForm onDone={() => modal.close()} /> });
  // Ticks a dose as taken (or unticks it), on the stored list.
  const tick = (med: MedicineDef, key: string, dose: number, want: boolean) =>
    save((current) => {
      const cur = current.find((m) => m.id === med.id);
      return cur ? upsertMedicine(current, withTaken(cur, key, dose, want, new Date())) : current;
    }).catch((e) => push({ id: `med-tick-${Date.now()}`, title: 'Not saved', text: saveErrorText(e), icon: 'pill', tone: 'warn' }));
  const sorted = [...stock].sort(
    (a, b) => Number(!!a.med.paused) - Number(!!b.med.paused) || Number(b.low) - Number(a.low) || (a.out?.getTime() ?? Infinity) - (b.out?.getTime() ?? Infinity),
  );

  return (
    <section className={`panel meds-panel ${full ? 'full' : ''}`}>
      <PanelHead label="Medicines" summary={list.length ? (day.offset ? 'Tomorrow' : 'Today') : undefined} />
      {!list.length ? (
        <div className="meal-noplan-head">
          <Icon name="pill" size={20} />
          <div>
            <strong>No medicines yet</strong>
            <span className="muted">Add one with its times and how many you have</span>
          </div>
        </div>
      ) : !day.slots.length ? (
        <div className="meal-noplan-head">
          <Icon name="pill" size={20} />
          <strong>Nothing to take {day.offset ? 'tomorrow' : 'today'}</strong>
        </div>
      ) : (
        <div className="mc-table med-table" style={{ gridTemplateColumns: `minmax(76px, 0.8fr) repeat(${people.length}, minmax(0, 1fr))` }}>
          <span className="mc-corner">{DAYS[(now.getDay() + day.offset) % 7].slice(0, 3)}</span>
          {people.map((p) => (
            <span key={p.id} className="mc-person">
              <Avatar i={personIndex(p.id)} name={p.name} /> {p.name}
            </span>
          ))}
          {day.slots.map((s, i) => {
            const state = day.offset ? 'later' : doses[i];
            return (
              <div key={s.slot} className={`mc-row ${state} ${state === 'next' ? 'now' : ''}`} style={{ gridColumn: `1 / span ${people.length + 1}` }}>
                <span className="mc-slot">
                  <span className="mc-slot-name">
                    {state === 'done' && <Icon name="tick" size={14} />} {SLOT_LABEL[s.slot]}
                  </span>
                  <small>{state === 'missed' ? `${clock(s.time)} · not taken` : clock(s.time)}</small>
                </span>
                {people.map((p) => (
                  <span key={p.id} className="med-doses">
                    {(s.byPerson[p.id] ?? []).map(({ med, dose, key, taken }) => (
                      <button
                        key={med.id}
                        className={`med-dose ${taken ? 'taken' : ''} ${state === 'missed' && !taken ? 'missed' : ''}`}
                        aria-pressed={day.offset ? undefined : taken}
                        aria-label={`${med.name}${dose !== 1 ? ` ${amount(dose)}` : ''}, ${p.name}: ${day.offset ? 'tomorrow' : taken ? 'taken (tap to undo)' : 'not taken yet (tap when taken)'}`}
                        onClick={() => (day.offset ? openMed(med) : tick(med, key, dose, !taken))}
                      >
                        <span className="med-check">{taken ? <Icon name="tick" size={13} /> : day.offset ? <Icon name="pill" size={12} /> : null}</span>
                        <span>{med.name}</span>
                        {dose !== 1 && <em>{amount(dose)}</em>}
                      </button>
                    ))}
                    {!s.byPerson[p.id] && <span className="muted">—</span>}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {list.length > 0 && <h3 className="label med-stock-title">Stock</h3>}
      <ul className="med-stock">
        {sorted.map((s) => {
          const days = s.out ? (s.out.getTime() - now.getTime()) / 86_400_000 : s.left === null || s.med.paused ? 0 : 30;
          return (
            <li key={s.med.id}>
              <button
                className={`med-stock-row ${s.low ? 'low' : ''} ${s.left === null ? 'untracked' : ''} ${s.med.paused ? 'paused' : ''}`}
                onClick={() => openMed(s.med)}
              >
                <span className="med-stock-fill" style={{ '--fill': `${Math.max(0, Math.min(1, days / 30)) * 100}%` } as CSSProperties} />
                <span className="med-stock-name">
                  <strong>{s.med.name}</strong>
                  <Who med={s.med} />
                  <small>
                    {s.med.paused && <Icon name="pause" size={12} />} {lastsText(s, now)}
                  </small>
                </span>
                <span className="med-stock-left">
                  {s.left === null ? '—' : amount(s.left)}
                  <small>{s.left === null ? '' : `${units(s.med, s.left)} left`}</small>
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button className="med-add" onClick={add}>
            <Icon name="plus" size={18} /> Add medicine
          </button>
        </li>
      </ul>
    </section>
  );
}

type ModalApi = ReturnType<typeof useModal>;
function openMedicine(modal: ModalApi, m: MedicineDef) {
  modal.open({ title: m.name, icon: 'pill', accent: 'var(--accent-fan)', subtitle: scheduleText(m), body: <MedicineSheet key={`${m.id}:${m.name}`} id={m.id} /> });
}

// One medicine's popup: what's left and till when, buttons for a refill or a
// correction, the note, and Edit / Pause / Delete. Follows the stored list
// live, so a change made on another screen shows here too.
function MedicineSheet({ id }: { id: string }) {
  const modal = useModal();
  const list = useMedicineList();
  const save = useSaveMedicines();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const med = list.find((m) => m.id === id);
  if (!med) return <p className="muted">This medicine was deleted.</p>;
  if (editing)
    return (
      <MedicineForm
        med={med}
        onDone={(saved) => {
          setEditing(false);
          if (saved) openMedicine(modal, saved); // the header shows the new name and times
        }}
      />
    );

  const now = new Date();
  const s = stockStatus(med, now, MED_TIMES, MEDICINES.lowDays);
  // Every write starts from the medicine as stored right now.
  const change = (f: (m: MedicineDef, at: Date) => MedicineDef | null) =>
    save((current) => {
      const at = new Date();
      const cur = current.find((m) => m.id === id);
      if (!cur) return current;
      const next = f(cur, at);
      return next ? upsertMedicine(current, next) : removeMedicine(current, id);
    }).then(
      () => (setError(''), true),
      (e) => (setError(saveErrorText(e)), false),
    );
  const addN = (n: number) => change((m, at) => withCount(m, (remaining(m) ?? 0) + n, at));
  const step = Math.max(1, Math.ceil(smallestDose(med))) || 1;

  return (
    <div className="med-detail">
      <div className={`med-detail-count ${s.low ? 'low' : ''} ${med.paused ? 'paused' : ''}`}>
        <strong>{s.left === null ? '—' : amount(s.left)}</strong>
        <span>
          {s.left === null ? 'Not counted yet' : `${units(med, s.left)} left`}
          <small>
            {lastsText(s, now)}
            {s.out && whenExactly(s.out, now)}
          </small>
        </span>
        <Who med={med} />
      </div>
      {med.note && <p className="med-note">{med.note}</p>}
      <div className="med-adjust">
        <button className="chip-btn" aria-label={`Take ${step} off`} disabled={!s.left} onClick={() => addN(-step)}>
          <Icon name="minus" size={18} />
        </button>
        <button className="chip-btn" aria-label={`Add ${step}`} onClick={() => addN(step)}>
          <Icon name="plus" size={18} />
        </button>
        {med.pack ? (
          <button className="chip-btn active" onClick={() => addN(med.pack!)}>
            <Icon name="plus" size={16} /> Refill {med.pack}
          </button>
        ) : null}
      </div>
      <form
        className="med-setcount"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(draft);
          if (!draft.trim() || !Number.isFinite(n) || n < 0) return;
          void change((m, at) => withCount(m, n, at));
          setDraft('');
        }}
      >
        <label>
          <span className="label">Counted</span>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} inputMode="decimal" placeholder={s.left === null ? '0' : amount(s.left)} />
        </label>
        <button className="chip-btn" type="submit" disabled={!draft.trim()}>
          Set
        </button>
      </form>
      {error && <p className="med-error">{error}</p>}
      <div className="med-actions">
        <button className="chip-btn" onClick={() => setEditing(true)}>
          <Icon name="pencil" size={16} /> Edit
        </button>
        <button className="chip-btn" onClick={() => change((m) => withPaused(m, !m.paused))}>
          <Icon name={med.paused ? 'play' : 'pause'} size={16} /> {med.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          className={`chip-btn med-delete ${confirmDelete ? 'armed' : ''}`}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              setTimeout(() => setConfirmDelete(false), 4000);
              return;
            }
            void change(() => null).then((ok) => ok && modal.close());
          }}
        >
          <Icon name="trash" size={16} /> {confirmDelete ? 'Tap again to delete' : 'Delete'}
        </button>
      </div>
      <p className="muted med-hint">
        {med.paused
          ? 'Paused: no doses are shown or warned about until you resume it.'
          : 'Tick each dose on the board when it’s taken and it comes off the count. Count a refill here, or set the count after counting.'}
      </p>
    </div>
  );
}
