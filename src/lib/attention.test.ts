import { describe, expect, it } from 'vitest';
import { isNight, washerDone } from './attention';

const at = (iso: string) => Date.parse(iso);
const s = (state: string, iso: string) => ({ state, last_changed: iso });

describe('washerDone', () => {
  const now = at('2026-10-27T10:00:00Z');
  it('is done after a cycle while the door stays shut', () => {
    expect(washerDone(s('off', '2026-10-27T09:30:00Z'), s('off', '2026-10-27T07:00:00Z'), now)).toBe(at('2026-10-27T09:30:00Z'));
  });
  it('clears once the door was opened, while running, or after 4 h', () => {
    expect(washerDone(s('off', '2026-10-27T09:30:00Z'), s('off', '2026-10-27T09:40:00Z'), now)).toBeNull();
    expect(washerDone(s('off', '2026-10-27T09:30:00Z'), s('on', '2026-10-27T07:00:00Z'), now)).toBeNull();
    expect(washerDone(s('on', '2026-10-27T09:30:00Z'), undefined, now)).toBeNull();
    expect(washerDone(s('off', '2026-10-27T05:00:00Z'), undefined, now)).toBeNull();
  });
});

describe('isNight', () => {
  it('runs from 21:00 to 06:00', () => {
    expect(isNight(new Date(2026, 9, 27, 21, 0))).toBe(true);
    expect(isNight(new Date(2026, 9, 27, 5, 59))).toBe(true);
    expect(isNight(new Date(2026, 9, 27, 6, 0))).toBe(false);
    expect(isNight(new Date(2026, 9, 27, 20, 59))).toBe(false);
  });
});
