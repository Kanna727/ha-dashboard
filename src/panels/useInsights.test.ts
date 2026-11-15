import { describe, expect, it } from 'vitest';
import { homeDevices, homeDoors } from './useInsights';

describe('what the insights read from the config', () => {
  it('takes the lights, fans, switches and geysers on the room cards, once each', () => {
    const d = homeDevices();
    expect(d.length).toBeGreaterThan(5);
    expect(new Set(d.map((x) => x.entity)).size).toBe(d.length);
    expect(d.every((x) => ['light', 'fan', 'switch', 'climate'].includes(x.entity.split('.')[0]))).toBe(true);
    expect(d.filter((x) => x.kind === 'geyser').map((x) => x.entity)).toEqual(expect.arrayContaining(['switch.common_bathroom_common_bathroom_geyser']));
    expect(d.find((x) => x.entity === 'fan.sofa_fan')!.kind).toBe('fan');
  });

  it('takes every room’s doors once and names them', () => {
    const doors = homeDoors();
    expect(doors.length).toBeGreaterThan(3);
    expect(new Set(doors.map((x) => x.entity)).size).toBe(doors.length);
    expect(doors.every((x) => x.name.endsWith('door'))).toBe(true);
  });
});
