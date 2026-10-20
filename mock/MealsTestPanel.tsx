import { useState } from 'react';
import { MEALS } from '../src/config/entities';
import { DAYS } from '../src/meals/plan';
import { mealsClockPinned, setMealsClock } from '../src/meals/useMeals';

// Meals test panel (preview builds, like the car test panel): pins the meals
// clock to a time and day, so every state (next up, all eaten, tomorrow, no
// deliveries) can be tried. Only the meals panel follows it.
const TIMES = [
  ['07:30', 'Breakfast'],
  ['12:00', 'Lunch'],
  ['18:00', 'Dinner'],
  ['21:00', 'Evening'],
] as const;
const WEEK = [1, 2, 3, 4, 5, 6, 0];
export const MEALS_TEST = new URLSearchParams(window.location.search).has('mealsTest');

// "Same breakfast": gives everyone the first person's breakfast every day, to
// try the merged "Both" line (the mock's people all eat differently).
let sharedBreakfast: Map<string, string> | null = null;
function toggleSharedBreakfast() {
  const first = MEALS.people[0]?.id;
  if (sharedBreakfast) {
    for (const [key, dish] of sharedBreakfast) {
      const [d, p] = key.split('/');
      MEALS.plan[Number(d)]![p].breakfast = dish;
    }
    sharedBreakfast = null;
  } else if (first) {
    sharedBreakfast = new Map();
    for (const [d, plan] of Object.entries(MEALS.plan)) {
      if (!plan) continue;
      for (const p of MEALS.people) {
        sharedBreakfast.set(`${d}/${p.id}`, plan[p.id].breakfast);
        plan[p.id].breakfast = plan[first].breakfast;
      }
    }
  }
  setMealsClock(mealsClockPinned()); // redraw the meals panel
}

export function MealsTestPanel() {
  const [open, setOpen] = useState(MEALS_TEST);
  const [, redraw] = useState(0);
  const pinned = mealsClockPinned();

  const pin = (time: string | null, day: number | null) => {
    if (time === null && day === null) setMealsClock(null);
    else {
      const base = pinned ?? new Date();
      const d = new Date(base);
      if (day !== null) d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7));
      if (time !== null) {
        const [h, m] = time.split(':').map(Number);
        d.setHours(h, m, 0, 0);
      }
      setMealsClock(d);
    }
    redraw((n) => n + 1);
  };
  const hhmm = pinned && `${String(pinned.getHours()).padStart(2, '0')}:${String(pinned.getMinutes()).padStart(2, '0')}`;

  if (!open) {
    return (
      <button className="car-test car-test-chip meals-test" onClick={() => setOpen(true)}>
        Meals test
      </button>
    );
  }
  return (
    <div className="car-test" role="group" aria-label="Meals test">
      <div className="sky-test-head">
        <strong>Meals test</strong>
        <button onClick={() => setOpen(false)} aria-label="Minimise">
          –
        </button>
      </div>
      <div className="car-test-body">
        <div className="car-test-group">
          <div className="car-test-title">Time</div>
          <div className="car-test-chips">
            <button className={`chip-btn small ${!pinned ? 'active' : ''}`} onClick={() => pin(null, null)}>
              Live
            </button>
            {TIMES.map(([t, label]) => (
              <button key={t} className={`chip-btn small ${hhmm === t ? 'active' : ''}`} onClick={() => pin(t, null)}>
                {label} {t}
              </button>
            ))}
          </div>
        </div>
        <div className="car-test-group">
          <div className="car-test-title">Plan</div>
          <div className="car-test-chips">
            <button className={`chip-btn small ${sharedBreakfast ? 'active' : ''}`} onClick={() => (toggleSharedBreakfast(), redraw((n) => n + 1))}>
              Same breakfast for everyone
            </button>
          </div>
        </div>
        <div className="car-test-group">
          <div className="car-test-title">Day</div>
          <div className="car-test-chips">
            {WEEK.map((d) => (
              <button key={d} className={`chip-btn small ${pinned?.getDay() === d ? 'active' : ''}`} onClick={() => pin(null, d)}>
                {DAYS[d].slice(0, 3)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
