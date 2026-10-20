import { useEffect, useMemo, useState } from 'react';
import { CAR, CAR_DETAIL } from '../config/entities';
import { useHass } from '../ha/api';
import { loadRegistry, REGISTRY_REFRESH_MS } from '../ha/registry';
import { useEntities } from '../ha/store';
import { carExtras, classifyCarBinaries, type CarExtras, type CarProblem, type ServiceItem } from '../lib/carInfo';

const CACHE_KEY = 'dashCarExtras';
type Found = CarExtras & { deviceName?: string };
const EMPTY: Found = { sensors: {}, binaries: [] };

function cached(): Found {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { lock: string; found: Found } | null;
    return c?.lock === CAR.lock ? c.found : EMPTY;
  } catch {
    return EMPTY;
  }
}

// Every entity ID the config already names for the car, so discovery only adds new ones.
function configured(): string[] {
  const ids: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (/^[a-z_]+\.[a-z0-9_]+$/.test(v)) ids.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(CAR);
  walk(CAR_DETAIL);
  return ids;
}

// The car device's other entities (lib/carInfo.ts), found in the registry and
// cached per car so reloads show them at once. Nothing to configure.
export function useCarExtras(): Found {
  const hass = useHass();
  const [found, setFound] = useState(cached);

  useEffect(() => {
    if (!CAR.lock) return;
    let alive = true;
    const load = () =>
      loadRegistry(hass)
        .then((r) => {
          if (!alive) return;
          const x = carExtras(CAR.lock, r.entities, configured());
          const device = r.entities.find((e) => e.entityId === CAR.lock)?.deviceId;
          const next: Found = { ...x, deviceName: r.devices.find((d) => d.id === device)?.name };
          setFound((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ lock: CAR.lock, found: next }));
          } catch {
            /* storage blocked: rediscover next time */
          }
        })
        .catch(() => undefined);
    load();
    const id = window.setInterval(load, REGISTRY_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hass]);

  return found;
}

// Service schedule and unconfigured problem sensors, from live states.
export function useCarService(found: Found): { service: ServiceItem[]; problems: (CarProblem & { on: boolean })[] } {
  const states = useEntities(found.binaries);
  return useMemo(() => {
    const live = found.binaries.map((entity, i) => ({ entity, state: states[i]?.state, attributes: states[i]?.attributes }));
    const { service, problems } = classifyCarBinaries(
      live.filter((b) => b.state !== undefined),
      found.deviceName,
    );
    return { service, problems: problems.map((p) => ({ ...p, on: live.find((b) => b.entity === p.entity)?.state === 'on' })) };
  }, [found, states]);
}
