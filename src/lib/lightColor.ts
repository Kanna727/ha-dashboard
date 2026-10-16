// Light capabilities and colour maths for the lights button and the room
// lights sheet. Pure, unit-tested. Capabilities come from each light's
// supported_color_modes, so new lights show whatever they can do without config.
import type { HassEntity } from 'home-assistant-js-websocket';

export type RGB = [number, number, number];
export type HS = [number, number]; // hue 0–360, saturation 0–100

const COLOR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];
const modesOf = (e?: HassEntity) => (e?.attributes.supported_color_modes as string[] | undefined) ?? [];

export const canDim = (e?: HassEntity) => modesOf(e).some((m) => m !== 'onoff');
export const canWarmth = (e?: HassEntity) => modesOf(e).includes('color_temp');
export const canColor = (e?: HassEntity) => modesOf(e).some((m) => COLOR_MODES.includes(m));
export const inColorMode = (e?: HassEntity) => COLOR_MODES.includes(e?.attributes.color_mode as string);

// 0–100, 0 when off; on without a brightness (on/off-only lights) counts as 100.
export const brightnessPct = (e?: HassEntity) =>
  e?.state === 'on' ? Math.round(((e.attributes.brightness as number | undefined) ?? 255) / 2.55) : 0;

export const kelvinOf = (e?: HassEntity) => e?.attributes.color_temp_kelvin as number | undefined;
export const hsOf = (e?: HassEntity) => e?.attributes.hs_color as HS | undefined;

// Warmth range all the given lights can do (the overlap), falling back to 2700–6500 K.
export function kelvinRange(lights: (HassEntity | undefined)[]): [number, number] {
  const ct = lights.filter(canWarmth);
  if (!ct.length) return [2700, 6500];
  const lo = Math.max(...ct.map((e) => (e!.attributes.min_color_temp_kelvin as number | undefined) ?? 2700));
  const hi = Math.min(...ct.map((e) => (e!.attributes.max_color_temp_kelvin as number | undefined) ?? 6500));
  return lo < hi ? [lo, hi] : [2700, 6500];
}

const clamp = (v: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, v));

// Colour of a black body at `k` kelvin (Tanner Helland's fit), good enough to tint a UI.
export function kelvinToRgb(k: number): RGB {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map((v) => Math.round(clamp(v))) as RGB;
}

// Full-value colour for a hue and saturation.
export function hsToRgb([h, s]: HS): RGB {
  const sat = clamp(s, 0, 100) / 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 1 - sat * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map((v) => Math.round(v * 255)) as RGB;
}

// The colour wheel puts hue 0 (red) at the top, going clockwise (like CSS
// conic-gradient), and saturation from the centre (0) to the rim (100).
// Points are relative to the centre, in radii (-1..1, y down).
export function wheelToHs(x: number, y: number): HS {
  const h = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
  return [Math.round(h), Math.round(Math.min(1, Math.hypot(x, y)) * 100)];
}
export function hsToWheel([h, s]: HS): { x: number; y: number } {
  const a = (h * Math.PI) / 180;
  return { x: (Math.sin(a) * s) / 100, y: (-Math.cos(a) * s) / 100 };
}

export const cssRgb = ([r, g, b]: RGB) => `rgb(${r} ${g} ${b})`;

// What colour a light that's on is giving off: its colour in a colour mode,
// the white of its temperature otherwise, or undefined (plain dimmable light).
export function lightRgb(e?: HassEntity): RGB | undefined {
  if (e?.state !== 'on') return undefined;
  if (inColorMode(e)) {
    const rgb = e.attributes.rgb_color as RGB | undefined;
    const hs = hsOf(e);
    return rgb ?? (hs ? hsToRgb(hs) : undefined);
  }
  const k = kelvinOf(e);
  return k ? kelvinToRgb(k) : undefined;
}

// Relative luminance (sRGB), for picking a readable icon colour on a tinted button.
export function luminance([r, g, b]: RGB) {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Whether the lights that are on are set differently (brightness, white vs
// colour, temperature or colour), so the sheet can say "Mixed".
export function isMixed(lights: (HassEntity | undefined)[]): boolean {
  const on = lights.filter((e) => e?.state === 'on');
  if (on.length < 2) return false;
  const [a, ...rest] = on;
  return rest.some((e) => {
    if (Math.abs(brightnessPct(e) - brightnessPct(a)) > 3) return true;
    if (inColorMode(e) !== inColorMode(a)) return true;
    if (inColorMode(a)) {
      const [h1, s1] = hsOf(a) ?? [0, 0];
      const [h2, s2] = hsOf(e) ?? [0, 0];
      const dh = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
      return dh > 8 || Math.abs(s1 - s2) > 8;
    }
    return Math.abs((kelvinOf(e) ?? 0) - (kelvinOf(a) ?? 0)) > 100;
  });
}
