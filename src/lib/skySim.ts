// Simulated sun for ?skyTest (components/SkyTestPanel.tsx): a plain day with
// sunrise at 06:00 and sunset at 18:00, so any hour can be previewed. Pure, unit-tested.
import { modelBody } from './astro';
import type { SunInput } from './skyScene';

const HOUR = 3_600_000;

// `hour` is 0–24 (fractions allowed); `base` supplies the date.
export function simSun(hour: number, base: Date): { sun: SunInput; now: number } {
  const h = ((hour % 24) + 24) % 24;
  const midnight = new Date(base);
  midnight.setHours(0, 0, 0, 0);
  const now = midnight.getTime() + h * HOUR;
  const at = (hh: number) => midnight.getTime() + hh * HOUR;
  const day = h >= 6 && h < 18;
  const { altitude, azimuth } = modelBody(h);
  return {
    now,
    sun: {
      aboveHorizon: day,
      elevation: altitude,
      azimuth,
      rising: h < 12, // solar midnight to solar noon
      nextRising: new Date(h < 6 ? at(6) : at(30)).toISOString(),
      nextSetting: new Date(h < 18 ? at(18) : at(42)).toISOString(),
    },
  };
}

// The conditions HA's weather entities report, for the test panel's picker.
export const CONDITIONS = [
  'sunny',
  'clear-night',
  'partlycloudy',
  'cloudy',
  'windy',
  'fog',
  'rainy',
  'pouring',
  'hail',
  'lightning',
  'lightning-rainy',
  'snowy',
  'snowy-rainy',
] as const;

export const fmtHour = (hour: number) => {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// A short name for a moon phase (0 new, 0.5 full).
export function moonName(phase: number) {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.03 || p > 0.97) return 'new moon';
  if (Math.abs(p - 0.5) < 0.03) return 'full moon';
  if (Math.abs(p - 0.25) < 0.03) return 'first quarter';
  if (Math.abs(p - 0.75) < 0.03) return 'last quarter';
  return `${p < 0.5 ? 'waxing' : 'waning'} ${p < 0.25 || p > 0.75 ? 'crescent' : 'gibbous'}`;
}
