import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { ENERGY } from '../config/entities';
import { useHass, type HassApi, type HistoryPoint, type RegistrySnapshot } from '../ha/api';
import { REGISTRY_REFRESH_MS, loadRegistry } from '../ha/registry';
import { store, useEntities, useEntity } from '../ha/store';
import { num } from '../ha/format';
import type { IconName } from './Icon';

export interface ConsumerPower {
  entity: string;
  name: string;
  icon: IconName;
  color: string;
  w: number;
  offline: boolean;
}

// Icon and colour for a plug that isn't in ENERGY.plugs, from its name.
// Order matters: "dishwasher" must hit dish before wash.
const PLUG_GUESSES: [RegExp, IconName, string][] = [
  [/fridge|refrigerator|freezer/i, 'fridge', '#38bdf8'],
  [/\btv\b|television/i, 'tv', '#60a5fa'],
  [/\bpc\b|computer|desktop|laptop|monitor/i, 'pc', '#f472b6'],
  [/geyser|heater|boiler|kettle/i, 'geyser', '#fb923c'],
  [/dish/i, 'dishwasher', '#2dd4bf'],
  [/wash|dryer/i, 'washer', '#34d399'],
  [/oven|microwave|stove|cooker/i, 'oven', '#f87171'],
  [/\bac\b|air ?con|cooler/i, 'ac', '#22d3ee'],
  [/fan/i, 'fan', '#a3e635'],
  [/light|lamp/i, 'light', '#facc15'],
  [/mixer|blender|grinder|appliance/i, 'blender', '#fbbf24'],
];
const SPARE_COLORS = ['#a78bfa', '#fb7185', '#4ade80', '#e879f9', '#fcd34d', '#93c5fd'];

function plugLook(entity: string, state: HassEntity | undefined) {
  const o = ENERGY.plugs[entity] ?? {};
  const friendly = String(state?.attributes.friendly_name ?? entity.replace(/^sensor\.|_power$/g, '').replace(/_/g, ' '));
  const name = o.name ?? (friendly.replace(/\s*power$/i, '').trim() || friendly);
  const guess = PLUG_GUESSES.find(([re]) => re.test(name));
  const hash = [...entity].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  return {
    name,
    icon: (o.icon as IconName | undefined) ?? guess?.[1] ?? 'flash',
    color: o.color ?? guess?.[2] ?? SPARE_COLORS[hash % SPARE_COLORS.length],
  };
}

// Same rule as the sensor.home_power template in HA: a power reading on a
// device that also has a switch. Bulbs (no switch), Zwift (no state_class) and
// the totals (no device) fall out.
const isPlugPower = (e: HassEntity | undefined) => {
  const a = e?.attributes;
  return a?.device_class === 'power' && a.state_class === 'measurement' && (a.unit_of_measurement === 'W' || a.unit_of_measurement === 'kW');
};

function plugCandidates(r: RegistrySnapshot): string[] {
  const withSwitch = new Set(r.entities.filter((e) => e.entityId.startsWith('switch.')).map((e) => e.deviceId));
  return r.entities
    .filter((e) => e.entityId.startsWith('sensor.') && !e.category && withSwitch.has(e.deviceId))
    .map((e) => e.entityId)
    .sort();
}

const PLUGS_KEY = 'dashPowerPlugs';
function cachedPlugs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PLUGS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// Entity IDs of every smart plug's power sensor. Until the registry arrives the
// last list seen on this device is used (so reloads draw rows straight away),
// falling back to the known plugs in ENERGY.plugs on a first load.
export function usePowerPlugs(): string[] {
  const hass = useHass();
  const [registry, setRegistry] = useState<RegistrySnapshot>();
  const [initial] = useState(() => {
    const c = cachedPlugs();
    return c.length ? c : Object.keys(ENERGY.plugs);
  });

  useEffect(() => {
    let alive = true;
    const load = () =>
      loadRegistry(hass)
        .then((r) => alive && setRegistry(r))
        .catch(() => undefined);
    load();
    const id = window.setInterval(load, REGISTRY_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hass]);

  const candidates = useMemo(() => (registry ? plugCandidates(registry) : undefined), [registry]);
  const known = useMemo(() => new Set(initial), [initial]);
  const last = useRef<string[]>(initial);

  const plugs = useSyncExternalStore(store.subscribe, () => {
    if (!candidates) return last.current;
    const all = store.getAll();
    // A plug that was offline when HA started can lack its attributes, so keep
    // ones already known on this device as long as they still sit on a plug.
    const next = candidates.filter((id) => isPlugPower(all[id]) || (known.has(id) && all[id]));
    const prev = last.current;
    if (prev.length === next.length && prev.every((id, i) => id === next[i])) return prev;
    last.current = next;
    return next;
  });

  useEffect(() => {
    if (!candidates) return;
    try {
      localStorage.setItem(PLUGS_KEY, JSON.stringify(plugs));
    } catch {
      // private mode or storage full: discovery still works, just not cached
    }
  }, [plugs, candidates]);

  return plugs;
}

// Live home power. ENERGY.total is the sensor.home_power template helper, which
// sums every plug that is reporting, so an offline WiZ socket only drops its own
// share. If the helper itself is missing, sum the plugs here. Either way, say
// which plugs are missing.
export function useHomePower() {
  const total = useEntity(ENERGY.total);
  const ids = usePowerPlugs();
  const states = useEntities(ids);

  return useMemo(() => {
    const consumers: ConsumerPower[] = ids.map((entity, i) => {
      const s = states[i];
      const w = num(s);
      const kw = s?.attributes.unit_of_measurement === 'kW';
      return { entity, ...plugLook(entity, s), w: w === undefined ? 0 : kw ? w * 1000 : w, offline: w === undefined };
    });
    const offline = consumers.filter((c) => c.offline);
    const live = consumers.filter((c) => !c.offline);
    const totalW = num(total) ?? (live.length ? live.reduce((s, c) => s + c.w, 0) : undefined);
    return { totalW, consumers, offline };
  }, [total, ids, states]);
}

// 24h of home power. Before ENERGY.total has that much history, the older
// legacyTotal fills in the start (its `unknown` gaps are already dropped).
export async function fetchHomePowerHistory(hass: HassApi, hours: number): Promise<HistoryPoint[]> {
  const h = await hass.fetchHistory([ENERGY.total, ENERGY.legacyTotal], hours);
  const pts = h[ENERGY.total] ?? [];
  const first = pts.length ? pts[0].t : Infinity;
  const older = (h[ENERGY.legacyTotal] ?? []).filter((p) => p.t < first);
  return [...older, ...pts];
}

// "Oven offline", "Oven, Washer offline", "4 plugs offline".
export function offlineLabel(names: string[]): string {
  return names.length > 2 ? `${names.length} plugs offline` : `${names.join(', ')} offline`;
}
