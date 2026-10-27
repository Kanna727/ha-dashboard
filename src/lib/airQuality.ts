import type { RegistrySnapshot } from '../ha/api';

// Outdoor air quality from Google Air Quality (`google_air_quality`, found by
// itself from the registry): Google's Universal AQI (0 = worst, 100 = best),
// its category and the dominant pollutant. Without the integration, nothing shows.
export interface AirQualityIds {
  index?: string;
  category?: string;
  pollutant?: string;
}

export function findAirQuality(r: RegistrySnapshot): AirQualityIds | undefined {
  const ids = r.entities.filter((e) => e.platform === 'google_air_quality' && e.entityId.startsWith('sensor.'));
  const key = (e: (typeof ids)[number]) => `${e.translationKey ?? ''} ${e.entityId}`;
  const pick = (re: RegExp) => ids.find((e) => re.test(key(e)))?.entityId;
  const found = {
    index: pick(/uaqi(?!_?(category|dominant))(\s|$)/) ?? pick(/uaqi(?!_?(category|dominant))/),
    category: pick(/uaqi_?category/),
    pollutant: pick(/uaqi_?dominant/),
  };
  return found.index ? found : undefined;
}

export type AirTone = 'good' | 'fair' | 'poor';

// Universal AQI: 60+ good (green), 40–59 moderate (amber), under 40 low or poor (red).
export function airTone(uaqi: number): AirTone {
  return uaqi >= 60 ? 'good' : uaqi >= 40 ? 'fair' : 'poor';
}

// "Good air quality" → "Good"; pollutant codes as people write them.
export const shortCategory = (c: string | undefined) => (c ? c.replace(/\s*air quality$/i, '') : undefined);
const POLLUTANTS: Record<string, string> = { pm25: 'PM2.5', pm10: 'PM10', o3: 'Ozone', no2: 'NO₂', so2: 'SO₂', co: 'CO' };
export const pollutantName = (p: string | undefined) => (p ? (POLLUTANTS[p.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? p) : undefined);
