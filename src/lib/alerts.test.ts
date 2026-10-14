import { describe, expect, it } from 'vitest';
import { cycleEnded, overdueDoors } from './alerts';

describe('cycle ended', () => {
  it('fires only on a seen running -> stopped transition', () => {
    expect(cycleEnded(true, false)).toBe(true);
    expect(cycleEnded(true, true)).toBe(false);
    expect(cycleEnded(false, false)).toBe(false);
    expect(cycleEnded(undefined, false)).toBe(false); // first reading after load
  });
});

describe('overdue doors', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const min = 60_000;

  it('flags doors open longer than the limit, once per open episode', () => {
    const doors = [
      { id: 'binary_sensor.front', open: true, since: now - 5 * min },
      { id: 'binary_sensor.fridge', open: true, since: now - 1 * min },
      { id: 'binary_sensor.back', open: false, since: now - 30 * min },
    ];
    const first = overdueDoors(doors, now, 3, new Set());
    expect(first).toEqual([{ id: 'binary_sensor.front', key: `binary_sensor.front@${now - 5 * min}`, openMin: 5 }]);
    expect(overdueDoors(doors, now, 3, new Set([first[0].key]))).toEqual([]);
  });

  it('treats a reopen as a new episode', () => {
    const alerted = new Set([`binary_sensor.front@${now - 20 * min}`]);
    expect(overdueDoors([{ id: 'binary_sensor.front', open: true, since: now - 4 * min }], now, 3, alerted)).toHaveLength(1);
  });
});
