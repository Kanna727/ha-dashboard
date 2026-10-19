import { describe, expect, it } from 'vitest';
import type { HassEntity } from 'home-assistant-js-websocket';
import { upcoming, minutes, plannedDays } from './MealsPanel';
import { nightAt } from '../lib/weather';
import { distanceKm } from './CarPanel';
import type { MealsConfig } from '../config/types';

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2026, 9, 14, h, m);
  return d;
};

describe('meals: next up', () => {
  const slots: MealsConfig['slots'] = [
    { id: 'breakfast', label: 'Breakfast', time: '', end: '09:30', delivery: '' },
    { id: 'lunch', label: 'Lunch', time: '', end: '14:00', delivery: '' },
    { id: 'dinner', label: 'Dinner', time: '', end: '19:00', delivery: '' },
  ];

  it('parses HH:MM', () => {
    expect(minutes('09:30')).toBe(570);
    expect(minutes('19')).toBe(1140);
  });

  it('picks the first slot whose window has not ended', () => {
    expect(upcoming(at('07:00'), slots)).toEqual({ offset: 0, slot: 'breakfast' });
    expect(upcoming(at('09:30'), slots)).toEqual({ offset: 0, slot: 'lunch' });
    expect(upcoming(at('13:59'), slots)).toEqual({ offset: 0, slot: 'lunch' });
    expect(upcoming(at('18:00'), slots)).toEqual({ offset: 0, slot: 'dinner' });
  });

  it("rolls over to tomorrow's breakfast after the last window", () => {
    expect(upcoming(at('19:00'), slots)).toEqual({ offset: 1, slot: 'breakfast' });
    expect(upcoming(at('23:30'), slots)).toEqual({ offset: 1, slot: 'breakfast' });
  });

  it('lists only planned days in the week view, Monday first', () => {
    const day = { p1: { breakfast: 'a', lunch: 'b', dinner: 'c' } };
    expect(plannedDays({ 1: day, 2: day, 5: day })).toEqual([1, 2, 5]);
    expect(plannedDays({ 0: day, 6: day, 1: day })).toEqual([1, 6, 0]);
    expect(plannedDays({})).toEqual([]);
  });
});

describe('weather: night', () => {
  it('knows night from sun.sun next rising/setting on either side of sunset', () => {
    const rising = '2026-10-15T06:10:00';
    const setting = '2026-10-14T18:00:00';
    expect(nightAt(Date.parse('2026-10-14T12:00:00'), rising, setting)).toBe(false);
    expect(nightAt(Date.parse('2026-10-14T21:00:00'), rising, setting)).toBe(true);
  });
});

describe('car: distance from home', () => {
  const loc = (lat: number, lng: number) => ({ attributes: { latitude: lat, longitude: lng } }) as unknown as HassEntity;

  it('is ~0 at the same point and ~111 km per degree of latitude', () => {
    expect(distanceKm(loc(10, 10), loc(10, 10))).toBeCloseTo(0);
    expect(distanceKm(loc(10, 10), loc(11, 10))!).toBeCloseTo(111.2, 0);
  });

  it('is undefined without coordinates', () => {
    expect(distanceKm(undefined, loc(1, 1))).toBeUndefined();
  });
});
