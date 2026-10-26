import { useMemo } from 'react';
import { num, isUnavailable } from '../ha/format';
import { useEntities } from '../ha/store';
import { useRegistry } from '../ha/useRegistry';
import { airTone, findAirQuality, pollutantName, shortCategory, type AirTone } from '../lib/airQuality';

export interface AirQuality {
  index: number; // Universal AQI, 0 (worst) to 100 (best)
  tone: AirTone;
  category?: string; // "Good"
  pollutant?: string; // "PM2.5"
}

// Outdoor air quality (Google Air Quality, lib/airQuality.ts), or undefined
// when the integration isn't set up or has no reading.
export function useAirQuality(): AirQuality | undefined {
  const registry = useRegistry();
  const ids = useMemo(() => (registry ? findAirQuality(registry) : undefined), [registry]);
  const [i, c, p] = useEntities([ids?.index ?? '', ids?.category ?? '', ids?.pollutant ?? '']);
  const index = num(i);
  if (!ids || index === undefined) return undefined;
  return {
    index,
    tone: airTone(index),
    category: c && !isUnavailable(c) ? shortCategory(c.state) : undefined,
    pollutant: p && !isUnavailable(p) ? pollutantName(p.state) : undefined,
  };
}

export const AIR_COLOR: Record<AirTone, string> = { good: 'var(--ok)', fair: 'var(--accent-light)', poor: 'var(--danger)' };
