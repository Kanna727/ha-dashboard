import { useEffect, useState } from 'react';
import type { ForecastDay, HassApi } from './api';

// One forecast subscription per (entity, type) for the whole page, shared by
// every component that shows or uses it (Weather card, rain nudge, night mode).
// The HA subscription starts with the first user and stops with the last.
type Type = 'daily' | 'hourly';
interface Entry {
  data: ForecastDay[];
  listeners: Set<(d: ForecastDay[]) => void>;
  stop?: () => void;
}
const entries = new Map<string, Entry>();

function subscribe(hass: HassApi, entityId: string, type: Type, cb: (d: ForecastDay[]) => void) {
  const key = `${entityId}|${type}`;
  let e = entries.get(key);
  if (!e) {
    e = { data: [], listeners: new Set() };
    entries.set(key, e);
  }
  const entry = e;
  entry.listeners.add(cb);
  if (!entry.stop) {
    entry.stop = hass.subscribeForecast(entityId, type, (d) => {
      entry.data = d;
      entry.listeners.forEach((l) => l(d));
    });
  }
  return () => {
    entry.listeners.delete(cb);
    if (entry.listeners.size === 0) {
      entry.stop?.();
      entry.stop = undefined;
    }
  };
}

export function useForecast(hass: HassApi, entityId: string, type: Type): ForecastDay[] {
  const [data, setData] = useState<ForecastDay[]>(() => entries.get(`${entityId}|${type}`)?.data ?? []);
  useEffect(() => {
    if (!entityId) return;
    const cached = entries.get(`${entityId}|${type}`)?.data;
    if (cached?.length) setData(cached);
    return subscribe(hass, entityId, type, setData);
  }, [hass, entityId, type]);
  return data;
}
