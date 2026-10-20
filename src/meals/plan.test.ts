import { describe, expect, it } from 'vitest';
import type { MealsConfig } from '../config/types';
import { clock, nextPlanned, shared, slotStates } from './plan';

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 9, 14, h, m);
};
const slots: MealsConfig['slots'] = [
  { id: 'breakfast', label: 'Breakfast', time: '', end: '09:30', delivery: '' },
  { id: 'lunch', label: 'Lunch', time: '', end: '14:00', delivery: '' },
  { id: 'dinner', label: 'Dinner', time: '', end: '19:00', delivery: '' },
];

describe('meals plan helpers', () => {
  it('formats clock times', () => {
    expect(clock('09:30')).toBe('9:30 AM');
    expect(clock('14:00')).toBe('2 PM');
    expect(clock('00:15')).toBe('12:15 AM');
    expect(clock('12:00')).toBe('12 PM');
  });

  it("marks today's slots eaten, next or later", () => {
    expect(slotStates(at('07:00'), 0, slots)).toEqual({ breakfast: 'next', lunch: 'later', dinner: 'later' });
    expect(slotStates(at('15:00'), 0, slots)).toEqual({ breakfast: 'done', lunch: 'done', dinner: 'next' });
    expect(slotStates(at('20:00'), 0, slots)).toEqual({ breakfast: 'done', lunch: 'done', dinner: 'done' });
  });

  it("only tomorrow's first slot is next, and only after today's last window", () => {
    expect(slotStates(at('20:00'), 1, slots)).toEqual({ breakfast: 'next', lunch: 'later', dinner: 'later' });
    expect(slotStates(at('12:00'), 1, slots)).toEqual({ breakfast: 'later', lunch: 'later', dinner: 'later' });
  });

  it('finds the next day with a plan', () => {
    const day = { p: { breakfast: 'a', lunch: 'b', dinner: 'c' } };
    const weekdays = { 1: day, 2: day, 3: day, 4: day, 5: day };
    expect(nextPlanned(5, weekdays)).toEqual({ day: 1, ahead: 3 });
    expect(nextPlanned(6, weekdays)).toEqual({ day: 1, ahead: 2 });
    expect(nextPlanned(1, weekdays)).toEqual({ day: 2, ahead: 1 });
    expect(nextPlanned(1, {})).toBeNull();
  });

  it('merges a dish everyone shares', () => {
    expect(shared(['Oats Bowl', 'oats bowl '])).toBe('Oats Bowl');
    expect(shared(['Oats Bowl', 'Idli'])).toBeNull();
    expect(shared(['Oats Bowl', undefined])).toBeNull();
    expect(shared([undefined, undefined])).toBeNull();
  });
});
