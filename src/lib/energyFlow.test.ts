import { describe, expect, it } from 'vitest';
import { FLOW_GAP, flowDensity, flowDuration, tweenAt } from './energyFlow';

describe('energy flow particles', () => {
  it('gets denser with more power', () => {
    expect(flowDensity(40)).toBe('light');
    expect(flowDensity(450)).toBe('medium');
    expect(flowDensity(1800)).toBe('heavy');
    expect(FLOW_GAP.heavy).toBeLessThan(FLOW_GAP.medium);
    expect(FLOW_GAP.medium).toBeLessThan(FLOW_GAP.light);
  });

  it('moves faster for bigger consumers', () => {
    const max = 2000;
    const speed = (w: number) => FLOW_GAP[flowDensity(w)] / flowDuration(w, max); // px/s
    expect(speed(100)).toBeLessThan(speed(600));
    expect(speed(600)).toBeLessThan(speed(2000));
    expect(speed(2000)).toBeCloseTo(90);
    expect(flowDuration(0, 0)).toBeCloseTo(FLOW_GAP.light / 20);
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
