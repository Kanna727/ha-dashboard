import { describe, expect, it } from 'vitest';
import type { HassEntity } from 'home-assistant-js-websocket';
import { brightnessPct, canColor, canDim, canWarmth, hsToRgb, hsToWheel, isMixed, kelvinRange, kelvinToRgb, lightRgb, luminance, wheelToHs } from './lightColor';

const light = (state: string, attributes: Record<string, unknown> = {}) => ({ entity_id: 'light.x', state, attributes }) as unknown as HassEntity;
const white = { supported_color_modes: ['color_temp'], min_color_temp_kelvin: 2700, max_color_temp_kelvin: 6500 };
const rgbw = { supported_color_modes: ['color_temp', 'hs', 'xy'], min_color_temp_kelvin: 2202, max_color_temp_kelvin: 6535 };

describe('light capabilities', () => {
  it('reads them from supported_color_modes', () => {
    expect([canDim, canWarmth, canColor].map((f) => f(light('on', white)))).toEqual([true, true, false]);
    expect([canDim, canWarmth, canColor].map((f) => f(light('on', rgbw)))).toEqual([true, true, true]);
    expect([canDim, canWarmth, canColor].map((f) => f(light('on', { supported_color_modes: ['onoff'] })))).toEqual([false, false, false]);
    expect(canDim(undefined)).toBe(false);
  });

  it('gives brightness as a percentage, 0 when off', () => {
    expect(brightnessPct(light('on', { brightness: 128 }))).toBe(50);
    expect(brightnessPct(light('on'))).toBe(100);
    expect(brightnessPct(light('off', { brightness: 128 }))).toBe(0);
  });

  it('takes the overlapping warmth range', () => {
    expect(kelvinRange([light('on', white), light('on', rgbw)])).toEqual([2700, 6500]);
    expect(kelvinRange([light('on', rgbw)])).toEqual([2202, 6535]);
    expect(kelvinRange([])).toEqual([2700, 6500]);
  });
});

describe('colour maths', () => {
  it('turns warm whites orange and cool whites bluish', () => {
    const warm = kelvinToRgb(2700);
    const cool = kelvinToRgb(6500);
    expect(warm[0]).toBe(255);
    expect(warm[2]).toBeLessThan(warm[1]);
    expect(cool[2]).toBeGreaterThan(warm[2]);
  });

  it('converts hue and saturation', () => {
    expect(hsToRgb([0, 100])).toEqual([255, 0, 0]);
    expect(hsToRgb([120, 100])).toEqual([0, 255, 0]);
    expect(hsToRgb([240, 100])).toEqual([0, 0, 255]);
    expect(hsToRgb([200, 0])).toEqual([255, 255, 255]);
  });

  it('maps the wheel with red at the top, clockwise', () => {
    expect(wheelToHs(0, -1)).toEqual([0, 100]);
    expect(wheelToHs(1, 0)).toEqual([90, 100]);
    expect(wheelToHs(0, 0.5)).toEqual([180, 50]);
    expect(wheelToHs(3, 0)).toEqual([90, 100]); // clamped to the rim
    for (const hs of [[30, 80], [275, 40], [350, 100]] as [number, number][]) {
      const { x, y } = hsToWheel(hs);
      expect(wheelToHs(x, y)).toEqual(hs);
    }
  });

  it('knows what colour a light gives off', () => {
    expect(lightRgb(light('on', { ...rgbw, color_mode: 'hs', hs_color: [0, 100], rgb_color: [255, 0, 0] }))).toEqual([255, 0, 0]);
    expect(lightRgb(light('on', { ...rgbw, color_mode: 'hs', hs_color: [240, 100] }))).toEqual([0, 0, 255]);
    expect(lightRgb(light('on', { ...white, color_mode: 'color_temp', color_temp_kelvin: 2700 }))).toEqual(kelvinToRgb(2700));
    expect(lightRgb(light('off', { ...rgbw, color_mode: 'hs', hs_color: [0, 100] }))).toBeUndefined();
    expect(lightRgb(light('on', { supported_color_modes: ['brightness'], color_mode: 'brightness' }))).toBeUndefined();
  });

  it('ranks luminance', () => {
    expect(luminance([255, 255, 255])).toBeCloseTo(1);
    expect(luminance([0, 0, 255])).toBeLessThan(luminance([255, 200, 0]));
  });
});

describe('mixed settings', () => {
  const ct = (k: number, b = 255) => light('on', { ...rgbw, color_mode: 'color_temp', color_temp_kelvin: k, brightness: b });
  const hs = (h: number, s: number) => light('on', { ...rgbw, color_mode: 'hs', hs_color: [h, s], brightness: 255 });

  it('spots lights that are set differently', () => {
    expect(isMixed([ct(3000), ct(3050)])).toBe(false);
    expect(isMixed([ct(3000), ct(5000)])).toBe(true);
    expect(isMixed([ct(3000, 255), ct(3000, 100)])).toBe(true);
    expect(isMixed([ct(3000), hs(30, 80)])).toBe(true);
    expect(isMixed([hs(358, 80), hs(3, 82)])).toBe(false); // either side of red
    expect(isMixed([hs(200, 80), hs(260, 80)])).toBe(true);
  });

  it('ignores lights that are off', () => {
    expect(isMixed([ct(3000), light('off', rgbw)])).toBe(false);
  });
});
