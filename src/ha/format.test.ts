import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HassEntity } from 'home-assistant-js-websocket';
import { fmtWatts, num, relTime } from './format';

const ent = (state: string): HassEntity =>
  ({ entity_id: 'sensor.x', state, attributes: {}, last_changed: '', last_updated: '', context: { id: '', parent_id: null, user_id: null } }) as HassEntity;

describe('relTime', () => {
  afterEach(() => vi.useRealTimers());

  it('formats ages', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    expect(relTime('2026-10-14T11:59:30Z')).toBe('just now');
    expect(relTime('2026-10-14T11:45:00Z')).toBe('15m ago');
    expect(relTime(Date.parse('2026-10-14T09:00:00Z'))).toBe('3h ago');
    expect(relTime('2026-10-12T12:00:00Z')).toBe('2d ago');
  });

  it('is empty for missing or unparseable times (never "NaNd ago")', () => {
    expect(relTime(undefined)).toBe('');
    expect(relTime('')).toBe('');
    expect(relTime('unavailable')).toBe('');
    expect(relTime(Number.NaN)).toBe('');
  });
});

describe('num / fmtWatts', () => {
  it('parses numbers and rejects unavailable states', () => {
    expect(num(ent('42.5'))).toBe(42.5);
    expect(num(ent('unavailable'))).toBeUndefined();
    expect(num(ent('unknown'))).toBeUndefined();
    expect(num(ent('abc'))).toBeUndefined();
    expect(num(undefined)).toBeUndefined();
  });

  it('formats watts', () => {
    expect(fmtWatts(undefined)).toBe('–');
    expect(fmtWatts(312.4)).toBe('312 W');
    expect(fmtWatts(1649)).toBe('1.65 kW');
  });
});
