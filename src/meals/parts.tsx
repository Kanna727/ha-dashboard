// Pieces of the meals panel and its week popup.
import type { CSSProperties } from 'react';
import { MEALS } from '../config/entities';
import type { MealSlot } from '../config/types';
import { Icon, type IconName } from '../components/Icon';
import { DAYS, dishesFor, nextPlanned, shared, type DayPlan } from './plan';

export const SLOT_ICON: Record<MealSlot, IconName> = { breakfast: 'sunrise', lunch: 'sun', dinner: 'night' };
const WHO = ['#38bdf8', '#f472b6', '#a78bfa', '#34d399'];
export const whoColor = (i: number) => ({ '--who': WHO[i % WHO.length] }) as CSSProperties;

export function Avatar({ i, name }: { i: number; name: string }) {
  return (
    <span className="meal-avatar" style={whoColor(i)} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// One slot's dishes: a single line when everyone has the same, else one line
// per person. `only` shows one person's dish.
export function Dishes({ plan, slot, only }: { plan: DayPlan; slot: MealSlot; only?: string }) {
  const people = only ? MEALS.people.filter((p) => p.id === only) : MEALS.people;
  const all = dishesFor(plan, slot, people);
  const same = people.length > 1 ? shared(all) : null;
  if (same)
    return (
      <div className="meal-dishes">
        <div className="meal-dish both">
          <span className="meal-avatars">
            {people.map((p) => (
              <Avatar key={p.id} i={MEALS.people.indexOf(p)} name={p.name} />
            ))}
          </span>
          <span className="meal-dish-name">{same}</span>
        </div>
      </div>
    );
  return (
    <div className="meal-dishes">
      {people.map((p, i) => (
        <div key={p.id} className="meal-dish">
          <Avatar i={MEALS.people.indexOf(p)} name={p.name} />
          <span className="meal-dish-name">{all[i] || <span className="muted">—</span>}</span>
        </div>
      ))}
    </div>
  );
}

// A day without deliveries: says so and previews the next delivery day.
export function NoPlan({ day }: { day: number }) {
  const next = nextPlanned(day);
  const plan = next && MEALS.plan[next.day];
  const first = MEALS.slots[0];
  return (
    <div className="meal-noplan">
      <div className="meal-noplan-head">
        <Icon name="utensils" size={20} />
        <div>
          <strong>No deliveries {DAYS[day]}</strong>
          <span className="muted">Eating out</span>
        </div>
      </div>
      {plan && first && (
        <div className="meal-noplan-next">
          <span className="label">
            Next · {next.ahead === 1 ? 'tomorrow' : DAYS[next.day]} {first.label.toLowerCase()}
          </span>
          <Dishes plan={plan} slot={first.id} />
        </div>
      )}
    </div>
  );
}

export function DayToggle({ offset, setOffset }: { offset: 0 | 1; setOffset: (o: 0 | 1) => void }) {
  return (
    <span className="meal-daytoggle" role="group" aria-label="Day">
      <button className={offset === 0 ? 'active' : ''} onClick={() => setOffset(0)}>
        Today
      </button>
      <button className={offset === 1 ? 'active' : ''} onClick={() => setOffset(1)}>
        Tomorrow
      </button>
    </span>
  );
}

export function KitchenNotes() {
  if (!MEALS.notes.length) return null;
  return (
    <section className="meal-kitchen">
      <h3 className="label">
        <Icon name="chef" size={16} /> Kitchen instructions
      </h3>
      <ul>
        {MEALS.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}

// Person filter for the week views: everyone, or one person.
export function PersonPicker({ who, setWho }: { who: string | null; setWho: (w: string | null) => void }) {
  if (MEALS.people.length < 2) return null;
  return (
    <div className="meal-people" role="group" aria-label="Person">
      <button className={`chip-btn ${who === null ? 'active' : ''}`} onClick={() => setWho(null)}>
        Everyone
      </button>
      {MEALS.people.map((p, i) => (
        <button key={p.id} className={`chip-btn ${who === p.id ? 'active' : ''}`} onClick={() => setWho(p.id)}>
          <Avatar i={i} name={p.name} /> {p.name}
        </button>
      ))}
    </div>
  );
}
