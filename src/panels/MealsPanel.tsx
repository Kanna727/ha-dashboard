import { useState, type CSSProperties } from 'react';
import { MEALS } from '../config/entities';
import { Icon } from '../components/Icon';
import { GlanceTile } from '../components/GlanceTile';
import { PanelHead, useModal } from '../components/Modal';
import { Avatar, DayToggle, Dishes, KitchenNotes, NoPlan, PersonPicker, SLOT_ICON } from '../meals/parts';
import { DAYS, clock, dishesFor, plannedDays, shared } from '../meals/plan';
import { useMealDay } from '../meals/useMeals';

// Menu board: people across, meals down. A dish everyone shares spans the row,
// the next meal is highlighted with its "eat by" time and eaten ones fade.
// `full` (tablet and desktop Health page): the popup's week under it.
export function MealsPanel({ full = false }: { full?: boolean }) {
  const modal = useModal();
  const { day, today, offset, setOffset, active, states, plan } = useMealDay();
  const people = MEALS.people;
  const open = () =>
    modal.open({ title: 'Meal plan', icon: 'utensils', accent: 'var(--accent-energy)', wide: true, subtitle: 'Weekly delivery schedule', body: <MealWeek today={today} /> });

  return (
    <section className={`panel meals-panel ${full ? 'full' : ''}`}>
      <PanelHead label="Meals" summary={<DayToggle offset={offset} setOffset={setOffset} />} onMore={full ? undefined : open} />
      {!plan ? (
        <NoPlan day={day} />
      ) : (
        <div className="mc-table" style={{ gridTemplateColumns: `minmax(78px, auto) repeat(${people.length}, minmax(0, 1fr))` }}>
          <span className="mc-corner">{DAYS[day].slice(0, 3)}</span>
          {people.map((p, i) => (
            <span key={p.id} className="mc-person">
              <Avatar i={i} name={p.name} /> {p.name}
            </span>
          ))}
          {MEALS.slots.map((s) => {
            const all = dishesFor(plan, s.id);
            const same = people.length > 1 ? shared(all) : null;
            return (
              <div key={s.id} className={`mc-row ${states[s.id]} ${active === s.id ? 'now' : ''}`} style={{ gridColumn: `1 / span ${people.length + 1}` }}>
                <span className="mc-slot">
                  <span className="mc-slot-name">
                    <Icon name={states[s.id] === 'done' ? 'tick' : SLOT_ICON[s.id]} size={14} /> {s.label}
                  </span>
                  <small>{active === s.id && offset === 0 ? `by ${clock(s.end)}` : s.time}</small>
                </span>
                {same ? (
                  <span className="mc-dish both" style={{ gridColumn: `span ${people.length}` }}>
                    {same}
                    <em>{people.length === 2 ? 'Both' : 'Everyone'}</em>
                  </span>
                ) : (
                  all.map((d, i) => (
                    <span key={people[i].id} className="mc-dish">
                      {d || '—'}
                    </span>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
      {full && (
        <>
          <h3 className="label meals-week-title">This week</h3>
          <MealWeek today={today} />
        </>
      )}
    </section>
  );
}

// The week: one row per planned day, meals across, with a person filter.
// Phones stack each day's meals instead (CSS), each cell naming its meal.
function MealWeek({ today }: { today: number }) {
  const [who, setWho] = useState<string | null>(null);
  const days = plannedDays();
  return (
    <div className="meal-week">
      <PersonPicker who={who} setWho={setWho} />
      <div className="mc-week-wrap">
        <div className="mc-week" style={{ '--slots': MEALS.slots.length } as CSSProperties}>
          <span className="mc-week-head" />
          {MEALS.slots.map((s) => (
            <span key={s.id} className="mc-week-slot mc-week-head">
              <Icon name={SLOT_ICON[s.id]} size={16} /> {s.label}
              <small>{s.time}</small>
            </span>
          ))}
          {days.map((d) => (
            <div key={d} className={`mc-week-row ${d === today ? 'today' : ''}`}>
              <span className="mc-week-day">
                {DAYS[d]}
                {d === today && <em>Today</em>}
              </span>
              {MEALS.slots.map((s) => (
                <div key={s.id} className="mc-week-cell">
                  <span className="mc-week-cell-slot">
                    <Icon name={SLOT_ICON[s.id]} size={14} /> {s.label}
                  </span>
                  <Dishes plan={MEALS.plan[d]!} slot={s.id} only={who ?? undefined} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <KitchenNotes />
    </div>
  );
}

// Home page tile (GlancePanel): the next meal for everyone, in large type with
// the meal's own icon, across the whole row.
export function MealTile() {
  const { today, next } = useMealDay();
  const people = MEALS.people;
  if (!people.length) return null;
  const day = (today + next.offset) % 7;
  const plan = MEALS.plan[day];
  const slot = MEALS.slots.find((s) => s.id === next.slot);
  const when = next.offset ? 'Tomorrow' : slot ? `by ${clock(slot.end)}` : '';
  const all = plan && slot ? dishesFor(plan, slot.id) : [];
  const same = people.length > 1 ? shared(all) : null;
  return (
    <GlanceTile
      icon={slot ? SLOT_ICON[slot.id] : 'utensils'}
      label={slot ? `${slot.label} · ${when}` : 'Meals'}
      page="health"
      color="var(--accent-light)"
      span="all"
      text
      value={
        !plan ? (
          'No deliveries · eating out'
        ) : same ? (
          <span className="glance-dish">
            {same} <em>{people.length === 2 ? 'Both' : 'Everyone'}</em>
          </span>
        ) : (
          <span className="glance-dishes">
            {people.map((p, i) => (
              <span key={p.id}>
                <Avatar i={i} name={p.name} /> {all[i] || '—'}
              </span>
            ))}
          </span>
        )
      }
    />
  );
}
