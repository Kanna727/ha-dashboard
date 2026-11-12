// Habits: each person ticks their own every day. A ring per person for today,
// then a row per habit with its streak, the last six days (tap one to fix a day
// you forgot) and today's tick per person. Kept in HA's hidden PLANNER.store
// dashboard, so every screen shows the same ticks.
import { useState, type CSSProperties, type FormEvent } from 'react';
import { PLANNER } from '../config/entities';
import { Icon } from '../components/Icon';
import { useModal } from '../components/Modal';
import { Avatar, whoColor } from '../meals/parts';
import { useNow } from '../hooks/useNow';
import { saveErrorText } from '../money/useTxEdits';
import { addDays, habitOn, isTicked, recentDays, removeHabit, streak, upsertHabit, withTick, type Habit } from '../lib/planner';
import { ymd } from '../lib/medicines';
import { useFailToast } from './TodoPanel';
import { useHabits, useSaveHabits } from './usePlanner';

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const personIndex = (id: string) => Math.max(0, PLANNER.people.findIndex((p) => p.id === id));

export function HabitsPanel() {
  const doc = useHabits();
  const save = useSaveHabits();
  const modal = useModal();
  const fail = useFailToast();
  const now = useNow(60_000);
  const habits = doc.habits;
  const people = PLANNER.people.filter((p) => habits.some((h) => h.who.includes(p.id)));
  const toggle = (h: Habit, person: string, day: Date, want: boolean) =>
    save((d) => withTick(d, day, h.id, person, want, new Date())).catch((e) => fail(saveErrorText(e)));
  const add = () => modal.open({ title: 'Add a habit', icon: 'habit', accent: 'var(--src-habits)', body: <HabitForm /> });
  const edit = (h: Habit) => modal.open({ title: h.name, icon: 'habit', accent: 'var(--src-habits)', body: <HabitForm key={h.id} id={h.id} /> });
  const active = habits.filter((h) => !h.paused);
  const paused = habits.filter((h) => h.paused);

  return (
    <section className="panel pl-panel pl-habits">
      <header className="panel-head">
        <h2 className="label">Habits</h2>
        {people.length > 0 && (
          <span className="panel-summary">
            {(() => {
              const p = people.flatMap((x) => active.filter((h) => h.who.includes(x.id) && habitOn(h, now)).map((h) => isTicked(doc, now, h.id, x.id)));
              return `${p.filter(Boolean).length}/${p.length} today`;
            })()}
          </span>
        )}
        <button className="round small pl-head-add" onClick={add} aria-label="Add a habit">
          <Icon name="plus" size={20} />
        </button>
      </header>
      {!habits.length ? (
        <button className="pl-empty-add" onClick={add}>
          <Icon name="habit" size={22} />
          <span>
            <strong>No habits yet</strong>
            <small className="muted">Add one, and who it's for</small>
          </span>
        </button>
      ) : (
        <>
          <div className="pl-rings">
            {people.map((p) => {
              const mine = active.filter((h) => h.who.includes(p.id) && habitOn(h, now));
              const n = mine.filter((h) => isTicked(doc, now, h.id, p.id)).length;
              return (
                <div key={p.id} className="pl-ring-tile" style={whoColor(personIndex(p.id))}>
                  <span className="pl-ring" style={{ '--p': mine.length ? (n / mine.length) * 100 : 0 } as CSSProperties} />
                  <span>
                    <strong>
                      {n}/{mine.length}
                    </strong>
                    <small>{p.name} today</small>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="pl-hgrid" style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${people.length}, auto)` }}>
            <span />
            {people.map((p) => (
              <span key={p.id} className="pl-hhead">
                <Avatar i={personIndex(p.id)} name={p.name} />
              </span>
            ))}
            {[...active, ...paused].map((h) => {
              const best = Math.max(...h.who.map((p) => streak(doc, h, p, now)));
              return (
                <div key={h.id} className={`pl-hrow ${h.paused ? 'paused' : ''}`} style={{ gridColumn: `1 / span ${people.length + 1}` }}>
                  <button className="pl-hname" onClick={() => edit(h)}>
                    <strong>{h.name}</strong>
                    <small>
                      {h.paused ? (
                        <>
                          <Icon name="pause" size={12} /> Paused
                        </>
                      ) : best >= 2 ? (
                        <span className="pl-streak">
                          <Icon name="fire" size={13} /> {best} days
                        </span>
                      ) : h.days ? (
                        ORDER.filter((d) => h.days!.includes(d))
                          .map((d) => WEEK[d])
                          .join(', ')
                      ) : (
                        'Every day'
                      )}
                    </small>
                  </button>
                  {people.map((p) => {
                    if (!h.who.includes(p.id)) return <span key={p.id} />;
                    const due = habitOn(h, now);
                    const on = isTicked(doc, now, h.id, p.id);
                    return (
                      <span key={p.id} className="pl-hcell" style={whoColor(personIndex(p.id))}>
                        <span className="pl-week">
                          {recentDays(doc, h, p.id, now).map((s, i) => {
                            const day = addDays(now, i - 6);
                            return (
                              <button
                                key={i}
                                className={`pl-day ${s}`}
                                disabled={h.paused}
                                onClick={() => toggle(h, p.id, day, s !== 'done')}
                                aria-label={`${h.name}, ${p.name}, ${WEEK[day.getDay()]} ${day.getDate()}: ${s === 'done' ? 'done (tap to undo)' : 'not done (tap if done)'}`}
                              />
                            );
                          })}
                        </span>
                        <button
                          className={`pl-tick person ${on ? 'on' : ''} ${!due ? 'off' : ''}`}
                          disabled={h.paused}
                          onClick={() => toggle(h, p.id, now, !on)}
                          aria-pressed={on}
                          aria-label={`${h.name}, ${p.name}, today: ${on ? 'done (tap to undo)' : 'tap when done'}`}
                        >
                          {on ? <Icon name="tick" size={16} /> : !due ? '–' : null}
                        </button>
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

const newId = (name: string) =>
  `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24) || 'habit'}_${Date.now().toString(36)}`;

// Add or edit a habit: name, who, which days; pause and delete when editing.
// A new one counts from `since` (default today; the calendar's "+" passes its day).
export function HabitForm({ id, since }: { id?: string; since?: string }) {
  const doc = useHabits();
  const save = useSaveHabits();
  const modal = useModal();
  const h = id ? doc.habits.find((x) => x.id === id) : undefined;
  const [name, setName] = useState(h?.name ?? '');
  const [who, setWho] = useState<string[]>(h?.who ?? PLANNER.people.map((p) => p.id));
  const [days, setDays] = useState<number[] | undefined>(h?.days);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState('');
  if (id && !h) return <p className="muted">This habit was deleted.</p>;
  const write = (change: Parameters<typeof save>[0]) =>
    save(change).then(
      () => modal.close(),
      (e) => setError(saveErrorText(e)),
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !who.length || (days && !days.length)) return;
    const next: Habit = { ...h, id: h?.id ?? newId(name), name: name.trim(), who, days: days && days.length < 7 ? days : undefined, since: h?.since ?? since ?? ymd(new Date()) };
    if (!next.days) delete next.days;
    void write((d) => upsertHabit(d, next));
  };
  const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <form className="pl-form" onSubmit={submit}>
      <label>
        <span className="label">Habit</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Drink 2 L water" />
      </label>
      <div>
        <span className="label">Who</span>
        <div className="chips-row">
          {PLANNER.people.map((p) => (
            <button key={p.id} type="button" className={`chip-btn ${who.includes(p.id) ? 'active' : ''}`} onClick={() => setWho(flip(who, p.id))}>
              <Avatar i={personIndex(p.id)} name={p.name} /> {p.name}
            </button>
          ))}
        </div>
        {who.length > 1 && <p className="muted pl-hint">Each person ticks it on their own.</p>}
      </div>
      <div>
        <span className="label">Days</span>
        <div className="chips-row">
          <button type="button" className={`chip-btn ${!days ? 'active' : ''}`} onClick={() => setDays(undefined)}>
            Every day
          </button>
          {ORDER.map((d) => (
            <button key={d} type="button" className={`chip-btn ${days?.includes(d) ? 'active' : ''}`} onClick={() => setDays(flip(days ?? [], d))}>
              {WEEK[d]}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="med-error">{error}</p>}
      <div className="med-actions">
        <button type="submit" className="chip-btn active" disabled={!name.trim() || !who.length || (!!days && !days.length)}>
          <Icon name="save" size={16} /> {h ? 'Save' : 'Add habit'}
        </button>
        {h && (
          <>
            <button type="button" className="chip-btn" onClick={() => void write((d) => upsertHabit(d, { ...h, paused: h.paused ? undefined : true }))}>
              <Icon name={h.paused ? 'play' : 'pause'} size={16} /> {h.paused ? 'Resume' : 'Pause'}
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
                void write((d) => removeHabit(d, h.id));
              }}
            >
              <Icon name="trash" size={16} /> {armed ? 'Tap again to delete' : 'Delete'}
            </button>
          </>
        )}
      </div>
      {h && <p className="muted pl-hint">Pausing keeps the history; deleting removes the habit and its ticks for good.</p>}
    </form>
  );
}
