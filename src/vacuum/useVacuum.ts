import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { VACUUM } from '../config/entities';
import { useHass } from '../ha/api';
import { loadRegistry, REGISTRY_REFRESH_MS } from '../ha/registry';
import { store } from '../ha/store';
import { siblingKey } from '../lib/vacuum';

export interface VacuumInfo {
  id: string; // the vacuum entity ('' when the home has none)
  map?: string; // live map camera
  savedMaps: string[]; // saved map cameras ("<base>_map_<n>")
  // Every other entity of the vacuum: key ("suction_level") → entity ID.
  keys: Record<string, string>;
  // Entities on the vacuum's device whose names don't follow the pattern (renamed by the owner).
  extra: string[];
  // The integration (registry platform), whose services do rooms, zones and map edits.
  platform: string;
}

const NONE: VacuumInfo = { id: '', savedMaps: [], keys: {}, extra: [], platform: '' };
// The map features follow the Dreame Vacuum custom integration (dreame_vacuum);
// assumed until the registry says otherwise.
const DEFAULT_PLATFORM = 'dreame_vacuum';

// The vacuum and its sibling entities, as one string so the store hook only
// re-renders when the set of entities changes, not on every state update.
let memo: { states: HassEntities; sig: string } | null = null;
function signature(states: HassEntities): string {
  if (memo?.states === states) return memo.sig;
  const ids = Object.keys(states);
  const id = VACUUM.entity && states[VACUUM.entity] ? VACUUM.entity : ids.filter((e) => e.startsWith('vacuum.')).sort()[0] ?? '';
  const sig = id ? [id, ...ids.filter((e) => siblingKey(id, e) !== undefined).sort()].join(',') : '';
  memo = { states, sig };
  return sig;
}

export function useVacuumId(): string {
  const sig = useSyncExternalStore(store.subscribe, () => signature(store.getAll()));
  return sig.split(',')[0];
}

// Finds the vacuum (config, else the first vacuum.* entity) and everything that
// belongs to it, so new settings the integration adds show up without config.
export function useVacuum(): VacuumInfo {
  const hass = useHass();
  const sig = useSyncExternalStore(store.subscribe, () => signature(store.getAll()));
  const [extra, setExtra] = useState<string[]>([]);
  const [platform, setPlatform] = useState(DEFAULT_PLATFORM);

  const base = useMemo((): VacuumInfo => {
    if (!sig) return NONE;
    const [id, ...siblings] = sig.split(',');
    const keys: Record<string, string> = {};
    for (const e of siblings) keys[siblingKey(id, e)!] = e;
    const cams = siblings.filter((e) => e.startsWith('camera.'));
    const map =
      (VACUUM.map && store.getAll()[VACUUM.map] ? VACUUM.map : undefined) ??
      cams.find((e) => siblingKey(id, e) === 'map') ??
      cams.find((e) => !/_data$|_map_\d+$/.test(e));
    const savedMaps = cams.filter((e) => /_map_\d+$/.test(e)).sort();
    return { id, map, savedMaps, keys, extra: [], platform: DEFAULT_PLATFORM };
  }, [sig]);

  // Entities on the same device that don't share the vacuum's name prefix.
  useEffect(() => {
    if (!base.id) return;
    let alive = true;
    const load = () =>
      loadRegistry(hass)
        .then((r) => {
          if (!alive) return;
          const me = r.entities.find((e) => e.entityId === base.id);
          const device = me?.deviceId;
          if (me?.platform) setPlatform(me.platform);
          const known = new Set([base.id, ...Object.values(base.keys)]);
          const more = device ? r.entities.filter((e) => e.deviceId === device && !known.has(e.entityId)).map((e) => e.entityId) : [];
          setExtra((prev) => (prev.join() === more.join() ? prev : more));
        })
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, REGISTRY_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [hass, base]);

  return useMemo(() => (base.id ? { ...base, extra, platform } : base), [base, extra, platform]);
}
