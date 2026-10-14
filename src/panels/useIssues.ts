import { FRIDGE, NETWORK, ROOMS, WEATHER } from '../config/entities';
import { useHass } from '../ha/api';
import { useForecast } from '../ha/forecast';
import { useNow } from '../hooks/useNow';
import { rainSoon, rainText } from '../lib/rain';
import { useAllEntities } from '../ha/store';
import { useOfflineDevices } from './useOfflineDevices';

export interface Issue {
  id: string;
  text: string;
  severity: 'warn' | 'info';
}

const doorName = (entityId: string) => {
  const room = ROOMS.find((r) => r.doors.includes(entityId));
  if (entityId === FRIDGE.door) return 'Fridge door';
  if (entityId.includes('washing_machine')) return 'Washer door';
  if (entityId.includes('oven')) return 'Oven door';
  return `${room?.name ?? 'A'} door`;
};

// Everything that should turn the header's "All systems normal" pill amber.
export function useIssues(): Issue[] {
  const all = useAllEntities();
  const offline = useOfflineDevices().devices;
  const hourly = useForecast(useHass(), WEATHER, 'hourly');
  const now = useNow(5 * 60_000).getTime();
  const issues: Issue[] = [];

  if (all[NETWORK.wan]?.state === 'off') issues.push({ id: 'wan', text: 'Internet is down', severity: 'warn' });

  for (const id of new Set([...ROOMS.flatMap((r) => r.doors), FRIDGE.door])) {
    if (all[id]?.state === 'on') issues.push({ id, text: `${doorName(id)} open`, severity: 'warn' });
  }

  // Heads-up from the hourly forecast, e.g. to bring the washing in.
  const rainAt = rainSoon(hourly, all[WEATHER]?.state, now);
  if (rainAt !== null) issues.push({ id: 'rain', text: rainText(rainAt, now), severity: 'info' });

  if (offline.length) {
    issues.push({ id: 'offline', text: `${offline.length} device${offline.length > 1 ? 's' : ''} offline`, severity: 'info' });
  }
  return issues;
}
