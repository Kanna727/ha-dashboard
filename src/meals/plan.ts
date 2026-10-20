// Meal plan maths for the meals panel. Pure: no React, no clock.
import { MEALS } from '../config/entities';
import type { MealSlot, MealsConfig } from '../config/types';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

// "09:30" → "9:30 AM", "14:00" → "2 PM".
export function clock(hhmm: string): string {
  const t = minutes(hhmm);
  const h = Math.floor(t / 60) % 24;
  const m = t % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

// The meal to eat next: the first slot whose eating window hasn't ended (each
// slot's `end` in config), else tomorrow's first slot (offset 1). Once the last
// window has passed the panel defaults to tomorrow's plan until midnight.
export function upcoming(now: Date, slots = MEALS.slots): { offset: 0 | 1; slot: MealSlot } {
  const m = now.getHours() * 60 + now.getMinutes();
  const next = slots.find((s) => m < minutes(s.end));
  return next ? { offset: 0, slot: next.id } : { offset: 1, slot: slots[0]?.id ?? 'breakfast' };
}

// Days with a plan, Monday first, for the week view. Days off (eating out) are left out.
export function plannedDays(plan = MEALS.plan): number[] {
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => plan[d]);
}

// The first day with a plan after `day` (up to a week on), as { day, ahead }.
export function nextPlanned(day: number, plan = MEALS.plan): { day: number; ahead: number } | null {
  for (let ahead = 1; ahead <= 7; ahead++) {
    const d = (day + ahead) % 7;
    if (plan[d]) return { day: d, ahead };
  }
  return null;
}

// Where each of a day's slots stands: eaten (window over), the next one, or later.
export type SlotState = 'done' | 'next' | 'later';
export function slotStates(now: Date, offset: 0 | 1, slots = MEALS.slots): Record<string, SlotState> {
  const next = upcoming(now, slots);
  const out: Record<string, SlotState> = {};
  let seen = false;
  for (const s of slots) {
    if (offset === 1) out[s.id] = next.offset === 1 && s.id === next.slot ? 'next' : 'later';
    else if (next.offset === 1) out[s.id] = 'done';
    else if (s.id === next.slot) (out[s.id] = 'next'), (seen = true);
    else out[s.id] = seen ? 'later' : 'done';
  }
  return out;
}

// The dish everyone has, when they all have the same one.
export function shared(dishes: (string | undefined)[]): string | null {
  const first = dishes[0]?.trim();
  return first && dishes.every((d) => d?.trim().toLowerCase() === first.toLowerCase()) ? first : null;
}

export type DayPlan = NonNullable<MealsConfig['plan'][number]>;
export const dishesFor = (plan: DayPlan, slot: MealSlot, people = MEALS.people) => people.map((p) => plan[p.id]?.[slot]);
