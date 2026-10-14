import { describe, expect, it } from 'vitest';
import { percentToSend, snapPercent, speedCount, speedOf } from './fanSpeed';

// HA's percentage -> speed mapping for ordered speed lists.
const haSpeed = (pct: number, speeds: number) => Math.ceil((pct * speeds) / 100);

describe('fan speed', () => {
  // percentage_step values seen from HA and plausible rounded variants.
  for (const step of [100 / 6, 16.666666666666668, 16.67, 25, 100 / 3]) {
    it(`every speed lands on itself (step ${step})`, () => {
      const n = speedCount(step);
      for (let speed = 1; speed <= n; speed++) {
        const sent = percentToSend(snapPercent(speed * step, step));
        expect(haSpeed(sent, n)).toBe(speed);
        expect(speedOf(sent, step)).toBe(speed);
      }
    });
  }

  it('sends the values HA reports for a 6-speed fan', () => {
    const step = 100 / 6;
    expect([1, 2, 3, 4, 5, 6].map((s) => percentToSend(snapPercent(s * step, step)))).toEqual([16, 33, 50, 66, 83, 100]);
  });

  it('clamps and snaps', () => {
    expect(snapPercent(-20, 100 / 6)).toBe(0);
    expect(snapPercent(140, 100 / 6)).toBe(100);
    expect(snapPercent(7, 100 / 6)).toBe(0);
    expect(snapPercent(9, 100 / 6)).toBeCloseTo(100 / 6);
  });
});
