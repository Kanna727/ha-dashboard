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

export interface Outlook {
  text: string;
  tone: 'dry' | 'chance' | 'wet' | 'storm';
}

const hourFmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric' });
const STORMY = new Set(['lightning', 'lightning-rainy', 'hail']);
const WETTISH = new Set(['rainy', 'pouring', 'lightning-rainy', 'snowy-rainy', 'hail']);
const HOUR = 3_600_000;

// Rain worth planning around in an hourly slot: a 40 % chance, or (without
// chances) a rainy condition or a measurable amount.
const wetSlot = (h: { condition: string; precipitation?: number; precipitation_probability?: number }) =>
  h.precipitation_probability !== undefined ? h.precipitation_probability >= 40 : WETTISH.has(h.condition) || (h.precipitation ?? 0) > 0.2;

// One line about rain over the next `horizonH` hours, from the hourly forecast:
// "Rain likely 3 PM – 6 PM", "Rain easing around 5 PM", "No rain expected …".
export function rainOutlook(
  hourly: { datetime: string; condition: string; precipitation?: number; precipitation_probability?: number }[],
  now: number,
  rainingNow: boolean,
  horizonH = 12,
  fmt: (t: number) => string = hourFmt,
): Outlook {
  const slots = hourly.filter((h) => {
    const t = Date.parse(h.datetime);
    return t > now - HOUR && t < now + horizonH * HOUR;
  });
  if (!slots.length) return { text: '', tone: 'dry' };
  const at = (i: number) => Date.parse(slots[i].datetime);

  if (rainingNow) {
    const dry = slots.findIndex((h, i) => i > 0 && !wetSlot(h));
    return dry < 0 ? { text: `Rain for the next ${horizonH} hours`, tone: 'wet' } : { text: `Rain easing around ${fmt(at(dry))}`, tone: 'wet' };
  }
  const start = slots.findIndex(wetSlot);
  if (start >= 0) {
    let end = start;
    while (end + 1 < slots.length && wetSlot(slots[end + 1])) end++;
    const storm = slots.slice(start, end + 1).some((h) => STORMY.has(h.condition));
    const what = storm ? 'Storms' : 'Rain';
    const until = end + 1 < slots.length ? fmt(at(end) + HOUR) : undefined;
    if (at(start) <= now) return { text: until ? `${what} likely now, until about ${until}` : `${what} likely from now on`, tone: storm ? 'storm' : 'wet' };
    return { text: until ? `${what} likely ${fmt(at(start))} – ${until}` : `${what} likely from ${fmt(at(start))}`, tone: storm ? 'storm' : 'wet' };
  }
  const peak = Math.max(...slots.map((h) => h.precipitation_probability ?? 0));
  if (peak >= 20) return { text: `Small chance of rain (up to ${Math.round(peak)}%)`, tone: 'chance' };
  return { text: `No rain expected in the next ${horizonH} hours`, tone: 'dry' };
}

const MIN_HOURS = 6; // late evening: spill into tomorrow so the strip isn't nearly empty

// Rest of today's hourly forecast (from the current hour), at least MIN_HOURS long.
export function hoursForToday<T extends { datetime: string }>(hourly: T[], now = new Date()): T[] {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const upcoming = hourly.filter((h) => new Date(h.datetime).getTime() >= start.getTime());
  const today = upcoming.filter((h) => new Date(h.datetime) < midnight);
  return today.length >= MIN_HOURS ? today : upcoming.slice(0, MIN_HOURS);
}

// An hour's or day's rain line: the chance when the forecast has one, else millimetres.
export function rainNote(f: { precipitation?: number; precipitation_probability?: number }): string {
  if (f.precipitation_probability !== undefined) return showRainChance(f.precipitation_probability) ? `${Math.round(f.precipitation_probability)}%` : '';
  return f.precipitation ? `${f.precipitation.toFixed(1)}mm` : '';
}
