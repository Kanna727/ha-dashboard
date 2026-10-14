import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ConnectionStatus } from '../src/ha/api';
import type { HassEntity } from 'home-assistant-js-websocket';
import { HassContext, HassStatusContext, type HassApi, type HistoryPoint } from '../src/ha/api';
import { store } from '../src/ha/store';
import { FIXTURES, FORECAST, FORECAST_HOURLY, REGISTRY, TODO_ITEMS, TODO_ITEMS_2 } from './fixtures';

// Offline stand-in for HA: serves fixtures, applies service calls locally
// and logs them, so layouts can be exercised without touching the house.
let states = { ...FIXTURES };

function patch(id: string, update: Partial<HassEntity> & { attributes?: Record<string, unknown> }) {
  const prev = states[id];
  if (!prev) return;
  states = {
    ...states,
    [id]: { ...prev, ...update, attributes: { ...prev.attributes, ...update.attributes }, last_changed: new Date().toISOString() },
  };
  store.set(states);
}

function ids(target?: { entity_id?: string | string[] }): string[] {
  const t = target?.entity_id;
  return t ? (Array.isArray(t) ? t : [t]) : [];
}

function applyService(domain: string, service: string, data: Record<string, unknown>, targetIds: string[]) {
  for (const id of targetIds) {
    const cur = states[id];
    if (!cur) continue;
    const on = cur.state === 'on';
    switch (service) {
      case 'toggle':
        patch(id, { state: on ? 'off' : 'on', attributes: !on && domain === 'light' ? { brightness: 255 } : {} });
        break;
      case 'turn_on':
        if (domain === 'climate') patch(id, { state: 'cool', attributes: { temperature: cur.attributes.temperature ?? 24 } });
        else if (domain === 'script') patch(id, { state: 'on' });
        else if (domain === 'media_player') patch(id, { state: 'idle' });
        else patch(id, { state: 'on', attributes: data.brightness_pct ? { brightness: Math.round((data.brightness_pct as number) * 2.55) } : {} });
        break;
      case 'turn_off':
        patch(id, { state: 'off' });
        break;
      case 'set_percentage':
        patch(id, { state: 'on', attributes: { percentage: data.percentage } });
        break;
      case 'set_temperature':
        patch(id, { attributes: { temperature: data.temperature } });
        break;
      case 'set_hvac_mode':
        patch(id, { state: data.hvac_mode as string });
        break;
      case 'set_fan_mode':
        patch(id, { attributes: { fan_mode: data.fan_mode } });
        break;
      case 'media_play_pause':
        patch(id, { state: cur.state === 'playing' ? 'paused' : 'playing' });
        break;
      case 'lock':
        patch(id, { state: 'locked' });
        break;
      case 'unlock':
        patch(id, { state: 'unlocked' });
        break;
      case 'set_value':
        patch(id, { state: String(data.value) });
        break;
    }
  }
}

// ?mockFreeze=1 makes the mock deterministic for screenshot tests: no power
// jitter and no artificial delays. (History is always seeded, see below.)
const FROZEN = new URLSearchParams(window.location.search).has('mockFreeze');

// Small seeded PRNG (mulberry32), so fake history is the same on every load.
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeHistory(base: number, hours: number): HistoryPoint[] {
  const rand = seeded(base * 31 + hours);
  const pts: HistoryPoint[] = [];
  // Align to 10-minute slots so the series doesn't shift with the clock's seconds.
  const end = Math.floor(Date.now() / 600_000) * 600_000;
  for (let t = end - hours * 3600_000; t <= end; t += 10 * 60_000) {
    const hour = new Date(t).getHours();
    const daily = hour >= 7 && hour <= 23 ? 1 : 0.45;
    const spike = rand() > 0.93 ? 1800 : 0;
    pts.push({ t, v: Math.max(80, base * daily * (0.7 + rand() * 0.5) + spike) });
  }
  return pts;
}

// Last car readings, for the "Kia Connect not responding" state:
// __mockPatch('lock.car_door_lock', { state: 'unavailable' }) plus the same for
// sensor.car_fuel_level shows them as last known values from 3 hours ago.
const CAR_HISTORY: Record<string, number> = {
  'sensor.car_fuel_level': 38,
  'sensor.car_fuel_driving_range': 312,
  'sensor.car_odometer': 18452,
  'sensor.car_car_battery_level': 82,
};
const carHistory = (v: number): HistoryPoint[] => [{ t: Date.now() - 3 * 3600_000, v }];
// Last known tyre warnings (front left low), for the same offline state.
const CAR_LAST_STATES: Record<string, string> = {
  'binary_sensor.car_tire_pressure_front_left': 'on',
  'binary_sensor.car_tire_pressure_front_right': 'off',
  'binary_sensor.car_tire_pressure_rear_left': 'off',
  'binary_sensor.car_tire_pressure_rear_right': 'off',
};

// ?mockSync=<ms> simulates a slow connect (status 'connecting' -> 'live');
// ?mockSync=reconnect stays in 'reconnecting'. Lets the sync indicator be tested.
function useMockStatus() {
  const param = new URLSearchParams(window.location.search).get('mockSync');
  const [status, setStatus] = useState<ConnectionStatus>(param === 'reconnect' ? 'reconnecting' : param ? 'connecting' : 'live');
  useEffect(() => {
    const ms = Number(param);
    if (!ms) return;
    const id = window.setTimeout(() => setStatus('live'), ms);
    return () => window.clearTimeout(id);
  }, [param]);
  return useMemo(() => ({ status, userName: 'Alex' }), [status]);
}

export default function MockProvider({ children }: { children: ReactNode }) {
  const mockStatus = useMockStatus();
  useEffect(() => {
    store.set(states);
    // Test hook (mock build only): window.__mockPatch('sensor.x', { state: '0' })
    (window as unknown as { __mockPatch: typeof patch }).__mockPatch = patch;
    // Jitter power sensors so live updates are visible.
    if (FROZEN) return;
    const id = window.setInterval(() => {
      const jitter = (eid: string, base: number, spread: number) => {
        if (states[eid]) patch(eid, { state: (base + (Math.random() - 0.5) * spread).toFixed(1) });
      };
      jitter('sensor.home_power', 1650, 120);
      jitter('sensor.kitchen_fridge_power', 700, 60);
      jitter('sensor.workroom_pc_power', 470, 80);
    }, 3000);
    return () => window.clearInterval(id);
  }, []);

  const api = useMemo<HassApi>(
    () => ({
      async callService(domain, service, data = {}, target) {
        console.info('[mock] %s.%s', domain, service, data, target);
        applyService(domain, service, data, ids(target));
        // Pretend a restarted Echo comes back a couple of seconds later.
        if (domain === 'button' && ids(target).includes('button.work_room_dot_restart')) {
          window.setTimeout(() => patch('media_player.work_room_dot', { state: 'idle' }), 2000);
        }
        return {};
      },
      async fetchHistory(entityIds, hours) {
        // The car's 14-day history query is slow on a real Pi; mimic it.
        if (entityIds.some((id) => CAR_HISTORY[id])) if (!FROZEN) await new Promise((r) => setTimeout(r, 1500));
        return Object.fromEntries(
          entityIds.map((id) => [id, CAR_HISTORY[id] ? carHistory(CAR_HISTORY[id]) : fakeHistory(1400, hours)]),
        );
      },
      async fetchLastStates(entityIds) {
        if (entityIds.some((id) => CAR_LAST_STATES[id])) if (!FROZEN) await new Promise((r) => setTimeout(r, 1500));
        return Object.fromEntries(
          entityIds.map((id) => [id, CAR_LAST_STATES[id] ? { state: CAR_LAST_STATES[id], t: Date.now() - 3 * 3600_000 } : undefined]),
        );
      },
      subscribeForecast(_id, type, cb) {
        let live = true;
        queueMicrotask(() => live && cb(type === 'hourly' ? FORECAST_HOURLY : FORECAST));
        return () => {
          live = false;
        };
      },
      async fetchTodo(entityId) {
        return entityId.includes('to_do') ? TODO_ITEMS_2 : TODO_ITEMS;
      },
      // No Maps key offline, so the commute card shows its "not configured" state.
      async fetchRegistry() {
        return REGISTRY;
      },
      async fetchLovelaceConfig() {
        return { views: [] };
      },
      logout() {
        console.info('[mock] logout');
      },
    }),
    [],
  );

  return (
    <HassContext.Provider value={api}>
      <HassStatusContext.Provider value={mockStatus}>{children}</HassStatusContext.Provider>
    </HassContext.Provider>
  );
}
