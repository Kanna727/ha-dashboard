import { useEffect, useState } from 'react';
import { MEALS } from '../config/entities';
import type { MealSlot } from '../config/types';
import { PanelHead, useModal } from '../components/Modal';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const { people: MEAL_PEOPLE, slots: MEAL_SLOTS, plan: MEAL_PLAN, notes: KITCHEN_NOTES } = MEALS;

export const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

// The meal to eat next: the first slot whose eating window hasn't ended (each
// slot's `end` in config), else tomorrow's first slot (offset 1). Once the last
// window has passed the panel defaults to tomorrow's plan until midnight.
export function upcoming(now: Date, slots = MEAL_SLOTS): { offset: 0 | 1; slot: MealSlot } {
  const m = now.getHours() * 60 + now.getMinutes();
  const next = slots.find((s) => m < minutes(s.end));
  return next ? { offset: 0, slot: next.id } : { offset: 1, slot: slots[0]?.id ?? 'breakfast' };
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function DayMeals({ day, active }: { day: number; active: MealSlot | null }) {
  const plan = MEAL_PLAN[day];
  if (!plan) return <div className="muted empty meal-none">No delivery planned</div>;
  return (
    <div className="meal-list">
      {MEAL_SLOTS.map((s) => (
        <div key={s.id} className={`meal-row ${active === s.id ? 'now' : ''}`}>
          <div className="meal-slot">
            <span className="meal-slot-name">
              {s.label}
              {active === s.id && <span className="meal-next">Next up</span>}
            </span>
            <span className="meal-slot-time">{s.time}</span>
          </div>
          {MEAL_PEOPLE.map((p) => (
            <div key={p.id} className="meal-item">
              <span className="meal-who">{p.name}</span>
              <span className="meal-what">{plan[p.id]?.[s.id]}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function MealsPanel() {
  const modal = useModal();
  const now = useNow();
  const today = now.getDay();
  const next = upcoming(now);
  const auto = next.offset === 1 ? 1 : 0;
  // A manual tap overrides the default only until the default flips (evening, or midnight).
  const [pick, setPick] = useState<{ offset: 0 | 1; auto: 0 | 1; day: number } | null>(null);
  const offset = pick && pick.auto === auto && pick.day === today ? pick.offset : auto;
  const setOffset = (o: 0 | 1) => setPick({ offset: o, auto, day: today });
  const day = (today + offset) % 7;
  const active = next.offset === offset ? next.slot : null;

  const openWeek = () =>
    modal.open({
      title: 'Meal plan',
      icon: 'utensils',
      accent: 'var(--accent-energy)',
      wide: true,
      subtitle: 'Weekly delivery schedule',
      body: (
        <div className="meal-week">
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <section key={d} className={`card meal-day ${d === today ? 'today' : ''}`}>
              <h3 className="label">{DAYS[d]}{d === today ? ' · today' : ''}</h3>
              <DayMeals day={d} active={null} />
            </section>
          ))}
          <section className="card meal-day">
            <h3 className="label">Kitchen instructions</h3>
            <ul className="meal-notes">
              {KITCHEN_NOTES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        </div>
      ),
    });

  return (
    <section className="panel meals-panel">
      <PanelHead label="Meals" summary={DAYS[day]} summaryClass="accent" onMore={openWeek} />
      <div className="segmented small">
        <button className={offset === 0 ? 'active' : ''} onClick={() => setOffset(0)}>Today</button>
        <button className={offset === 1 ? 'active' : ''} onClick={() => setOffset(1)}>Tomorrow</button>
      </div>
      <DayMeals day={day} active={active} />
    </section>
  );
}
