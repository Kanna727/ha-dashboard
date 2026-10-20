import { useEffect, useState } from 'react';
import { MEALS } from '../config/entities';
import { slotStates, upcoming } from './plan';

// The clock the meals panel reads. The mock's Meals test panel can pin it to
// a time and day; nothing else sets it, so the app always follows real time.
let pinned: Date | null = null;
const clockListeners = new Set<() => void>();
export function setMealsClock(d: Date | null) {
  pinned = d;
  clockListeners.forEach((f) => f());
}
export const mealsClockPinned = () => pinned;

export function useMealsNow(): Date {
  const [now, setNow] = useState(() => pinned ?? new Date());
  useEffect(() => {
    const tick = () => setNow(pinned ?? new Date());
    const t = setInterval(tick, 60_000);
    clockListeners.add(tick);
    return () => {
      clearInterval(t);
      clockListeners.delete(tick);
    };
  }, []);
  return now;
}

// Today/Tomorrow: defaults to the day of the next meal (tomorrow after the
// last window). A manual tap overrides it only until the default flips
// (evening, or midnight).
export function useMealDay() {
  const now = useMealsNow();
  const today = now.getDay();
  const next = upcoming(now);
  const auto = next.offset;
  const [pick, setPick] = useState<{ offset: 0 | 1; auto: 0 | 1; day: number } | null>(null);
  const offset = pick && pick.auto === auto && pick.day === today ? pick.offset : auto;
  const setOffset = (o: 0 | 1) => setPick({ offset: o, auto, day: today });
  const day = (today + offset) % 7;
  return {
    now,
    today,
    day,
    offset,
    setOffset,
    next,
    // The slot to highlight on the shown day, if the next meal is on it.
    active: next.offset === offset ? next.slot : null,
    states: slotStates(now, offset, MEALS.slots),
    plan: MEALS.plan[day],
  };
}
