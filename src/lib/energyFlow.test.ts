import { describe, expect, it } from 'vitest';
import { FLOW_GAP, flowDensity, flowDuration, flowLevel, flowSpeed, tweenAt } from './energyFlow';

describe('energy flow particles', () => {
  it('picks a level from the plug’s own watts', () => {
    expect(flowLevel(0)).toBe(0);
    expect(flowLevel(24)).toBe(1); // fridge
    expect(flowLevel(595)).toBe(6); // TV
    expect(flowLevel(2000)).toBe(8); // geyser
    expect(flowLevel(50_000)).toBe(8); // capped
  });

  it('holds its level while a reading wobbles around a boundary', () => {
    // 452 W sits right between levels 5 and 6.
    expect(flowLevel(440, 6)).toBe(6);
    expect(flowLevel(470, 5)).toBe(5);
    // A real change still moves it.
    expect(flowLevel(200, 6)).toBe(4);
    expect(flowLevel(1500, 5)).toBe(7);
  });

  it('gets denser with more power', () => {
    expect(flowDensity(flowLevel(40))).toBe('light');
    expect(flowDensity(flowLevel(450))).toBe('medium');
    expect(flowDensity(flowLevel(1800))).toBe('heavy');
    expect(FLOW_GAP.heavy).toBeLessThan(FLOW_GAP.medium);
    expect(FLOW_GAP.medium).toBeLessThan(FLOW_GAP.light);
  });

  it('moves clearly faster for bigger draws, whatever else is on', () => {
    const speed = (w: number) => FLOW_GAP[flowDensity(flowLevel(w))] / flowDuration(flowLevel(w)); // px/s
    expect(speed(24)).toBeCloseTo(flowSpeed(1));
    expect(speed(595) / speed(24)).toBeGreaterThan(4);
    expect(speed(2000)).toBeGreaterThan(speed(595));
    expect(speed(5)).toBeCloseTo(10);
    expect(speed(3000)).toBeLessThan(120);
  });
});

describe('tweenAt', () => {
  it('eases out from a to b', () => {
    expect(tweenAt(0, 100, 0)).toBe(0);
    expect(tweenAt(0, 100, 1)).toBe(100);
    expect(tweenAt(0, 100, 0.5)).toBeGreaterThan(50); // ease-out: past halfway at half time
    expect(tweenAt(100, 0, 2)).toBe(0); // clamped
  });
});
