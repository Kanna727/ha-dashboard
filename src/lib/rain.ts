import type { ForecastDay } from '../ha/api';

const RAINY = new Set(['rainy', 'pouring', 'lightning-rainy', 'snowy-rainy', 'hail']);
const HOUR = 3_600_000;

const wet = (h: ForecastDay) => RAINY.has(h.condition) || (h.precipitation ?? 0) > 0.2 || (h.precipitation_probability ?? 0) >= 60;

// Rain expected within `horizonH` hours while it isn't raining now: the start
// of the first wet hourly slot (the current hour's slot counts). Hourly
// forecasts only resolve to the hour, so callers say "around", not a minute.
export function rainSoon(hourly: ForecastDay[], current: string | undefined, now: number, horizonH = 3): number | null {
  if (current && RAINY.has(current)) return null;
  const hit = hourly.find((h) => {
    const t = Date.parse(h.datetime);
    return t > now - HOUR && t <= now + horizonH * HOUR && wet(h);
  });
  return hit ? Date.parse(hit.datetime) : null;
}

// "Rain likely soon" for the current hour, else "Rain likely around 4 PM".
export function rainText(at: number, now: number): string {
  if (at <= now) return 'Rain likely soon';
  return `Rain likely around ${new Date(at).toLocaleTimeString([], { hour: 'numeric' })}`;
}
