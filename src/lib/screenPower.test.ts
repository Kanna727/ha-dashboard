import { describe, expect, it } from 'vitest';
import { inQuietHours, screenOn, sinceSeenMs } from './screenPower';

const at = (hh: number, mm = 0) => new Date(2026, 10, 2, hh, mm);

describe('screen power', () => {
  it('finds quiet hours that cross midnight', () => {
    const w: [string, string] = ['23:00', '06:00'];
    expect(inQuietHours(at(23, 0), w)).toBe(true);
    expect(inQuietHours(at(2, 30), w)).toBe(true);
    expect(inQuietHours(at(5, 59), w)).toBe(true);
    expect(inQuietHours(at(6, 0), w)).toBe(false);
    expect(inQuietHours(at(22, 59), w)).toBe(false);
    expect(inQuietHours(at(12, 0), w)).toBe(false);
  });

  it('finds quiet hours within a day, and none when from equals to', () => {
    expect(inQuietHours(at(13, 30), ['13:00', '15:00'])).toBe(true);
    expect(inQuietHours(at(15, 0), ['13:00', '15:00'])).toBe(false);
    expect(inQuietHours(at(3, 0), ['00:00', '00:00'])).toBe(false);
  });

  it('measures time since someone was seen', () => {
    const now = Date.parse('2026-11-02T23:30:00Z');
    const off = (min: number) => ({ state: 'off', last_changed: new Date(now - min * 60_000).toISOString() });
    expect(sinceSeenMs([off(10), { state: 'on', last_changed: '' }], now)).toBe(0);
    expect(sinceSeenMs([off(10), off(3)], now)).toBe(3 * 60_000);
    expect(sinceSeenMs([{ state: 'unavailable', last_changed: new Date(now).toISOString() }, off(20)], now)).toBe(20 * 60_000);
    expect(sinceSeenMs([undefined], now)).toBe(Infinity);
    expect(sinceSeenMs([], now)).toBe(Infinity);
  });

  it('keeps the screen on by day, lets it go at night or on vacation once nobody is around', () => {
    const base = { quiet: false, vacation: false, sinceSeenMs: Infinity, holdMinutes: 5 };
    expect(screenOn(base)).toBe(true);
    expect(screenOn({ ...base, quiet: true })).toBe(false);
    expect(screenOn({ ...base, vacation: true })).toBe(false);
    expect(screenOn({ ...base, quiet: true, sinceSeenMs: 0 })).toBe(true);
    expect(screenOn({ ...base, vacation: true, sinceSeenMs: 4 * 60_000 })).toBe(true);
    expect(screenOn({ ...base, quiet: true, sinceSeenMs: 5 * 60_000 })).toBe(false);
  });
});
