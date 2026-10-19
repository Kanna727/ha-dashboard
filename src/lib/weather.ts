// Weather card helpers. Pure, unit-tested.

// Extra "now" readings some weather integrations add as sensors on the weather
// entity's device (Google Weather does), beyond the weather entity's own
// attributes. Matched by translation key, else by entity ID suffix.
export const EXTRA_KEYS = [
  'weather_condition', // text, e.g. "Light rain"
  'precipitation_probability', // %
  'precipitation_intensity', // mm/h (Google's has no translation key: matched by device class)
  'thunderstorm_probability', // %
  'heat_index', // °C
  'wind_chill', // °C
] as const;
export type ExtraKey = (typeof EXTRA_KEYS)[number];
export type WeatherExtras = Partial<Record<ExtraKey, string>>;

export interface ExtraCandidate {
  entityId: string;
  deviceId: string;
  translationKey?: string;
  deviceClass?: string;
}

// The weather entity's sibling sensors, by what they measure.
export function weatherExtras(weatherId: string, entities: ExtraCandidate[]): WeatherExtras {
  const device = entities.find((e) => e.entityId === weatherId)?.deviceId;
  if (!device) return {};
  const out: WeatherExtras = {};
  for (const e of entities) {
    if (e.deviceId !== device || !e.entityId.startsWith('sensor.')) continue;
    const key = EXTRA_KEYS.find(
      (k) => e.translationKey === k || e.entityId.endsWith(`_${k}`) || (k === 'precipitation_intensity' && e.deviceClass === k),
    );
    if (key && !out[key]) out[key] = e.entityId;
  }
  return out;
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// Wind bearing (where it blows from) as a 16-point compass name.
export function compass(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// WHO UV index bands.
export function uvLevel(uv: number): { label: string; tone: 'low' | 'moderate' | 'high' | 'very-high' | 'extreme' } {
  const i = Math.round(uv);
  if (i <= 2) return { label: 'Low', tone: 'low' };
  if (i <= 5) return { label: 'Moderate', tone: 'moderate' };
  if (i <= 7) return { label: 'High', tone: 'high' };
  if (i <= 10) return { label: 'Very high', tone: 'very-high' };
  return { label: 'Extreme', tone: 'extreme' };
}

// Where a day's low–high sits on the bar spanning every shown day, in %.
export function rangeBar(lo: number, hi: number, min: number, max: number): { left: number; width: number } {
  const span = max - min || 1;
  const left = ((Math.min(lo, hi) - min) / span) * 100;
  const width = (Math.abs(hi - lo) / span) * 100;
  return { left: clamp(left), width: Math.max(4, Math.min(100 - clamp(left), width)) };
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));

// The "now" description, in sentence case: the integration's own text when it
// has one ("Light rain"), else the HA condition made readable ("Partly cloudy").
export function conditionText(state: string | undefined, text?: string): string {
  const t = text?.trim();
  const s = t && t !== 'unknown' && t !== 'unavailable' ? t : (state ?? '').replace('partlycloudy', 'partly cloudy').replace('clear-night', 'clear').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Rain chance worth calling out in the hourly strip.
export const showRainChance = (p: number | undefined) => p !== undefined && p >= 10;

// Night for an hour, from sun.sun's next rising/setting (works either side of sunset).
export function nightAt(t: number, rising?: string, setting?: string) {
  if (!rising || !setting) {
    const h = new Date(t).getHours();
    return h < 6 || h >= 18;
  }
  const r = new Date(rising).getTime();
  const s = new Date(setting).getTime();
  if (s < r) return t >= s && t < r; // currently day: night runs sunset -> next sunrise
  return t < r || t >= s; // currently night: until sunrise, and again after the next sunset
}
