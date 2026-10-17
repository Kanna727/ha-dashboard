import { useEffect, useState } from 'react';
import { useHass, type HassApi } from './api';
import { automationGates, type Gate } from '../lib/thresholds';

// The thresholds the home's automations gate on (see lib/thresholds.ts),
// fetched once for the whole page and refreshed every 30 min like the
// registry. Each device caches them so reloads can colour readings at once.
const REFRESH_MS = 30 * 60_000;
const KEY = 'dashGates';
let cache: { at: number; promise: Promise<Gate[]> } | null = null;

function cached(): Gate[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function loadGates(hass: HassApi): Promise<Gate[]> {
  if (!cache || Date.now() - cache.at > REFRESH_MS) {
    const promise = hass.fetchAutomationConfigs().then((list) => list.flatMap((a) => automationGates(a.entityId, a.config)));
    cache = { at: Date.now(), promise };
    promise.then(
      (gates) => {
        try {
          localStorage.setItem(KEY, JSON.stringify(gates));
        } catch {
          // storage blocked: still works, just not cached
        }
      },
      () => {
        cache = null;
      },
    );
  }
  return cache.promise;
}

export function useGates(): Gate[] {
  const hass = useHass();
  const [gates, setGates] = useState(cached);
  useEffect(() => {
    let alive = true;
    const load = () =>
      loadGates(hass)
        .then((g) => alive && setGates(g))
        .catch(() => undefined);
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hass]);
  return gates;
}
