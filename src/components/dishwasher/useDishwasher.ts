import { useEffect, useMemo, useRef, useState } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { APPLIANCES } from '../../config/entities';
import { useHass, type HistoryPoint } from '../../ha/api';
import { useEntities, useEntity } from '../../ha/store';
import { domainOf, isUnavailable, num } from '../../ha/format';
import { loadRegistry } from '../../ha/registry';
import { useNow } from '../../hooks/useNow';
import type { DishState } from '../../dishwasher3d/viewer';

export const STATE_LABEL: Record<string, string> = {
  inactive: 'Idle',
  ready: 'Ready',
  run: 'Running',
  pause: 'Paused',
  delayedstart: 'Delayed start',
  actionrequired: 'Needs attention',
  finished: 'Finished',
  error: 'Error',
  aborting: 'Stopping',
};
export const DELAYS = [0, 1, 2, 3, 4, 6, 8, 12].map((h) => h * 3600);
export const HISTORY_HOURS = 24;
const PROGRAM_PREFIX = 'dishcare_dishwasher_program_';
// Operation states in which a program is under way (Home Connect).
const ACTIVE = ['run', 'pause', 'delayedstart', 'aborting'];
// Sensors that only speak up when something needs doing, and the values that mean "all fine".
export const ALERT_NAME = /lack|empty|reminder|error|abort/i;
export const CLEAR = ['off', 'unknown', 'unavailable', 'closed', 'confirmed'];

// "dishcare_dishwasher_program_eco_50" -> "Eco 50".
export function programLabel(key: string) {
  const s = key.replace(PROGRAM_PREFIX, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export const programKey = (short: string) => PROGRAM_PREFIX + short;

// "Dishwasher Salt nearly empty" -> "Salt nearly empty".
export const nameOf = (e: HassEntity) => String(e.attributes.friendly_name ?? e.entity_id).replace(/^Dishwasher\s+/i, '');

export function clock(iso: string | number | undefined) {
  if (iso === undefined || iso === '') return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// "1 h 05 min", "40 min".
export function duration(min: number | undefined) {
  if (min === undefined) return '';
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

// The same object while its contents don't change, so the 3D viewer only redraws on real changes.
function useStable<T>(value: T): T {
  const ref = useRef(value);
  if (JSON.stringify(ref.current) !== JSON.stringify(value)) ref.current = value;
  return ref.current;
}

// Everything the dishwasher modal shows and does, for whichever layout draws it.
// Entities of the dishwasher's device that the config doesn't name (options,
// care sensors) are found through the registry from `control.program`.
export function useDishwasher() {
  const hass = useHass();
  const cfg = APPLIANCES.dishwasher;
  const ctl = cfg.control;
  const state = useEntity(cfg.state);
  const progress = num(useEntity(cfg.progress));
  const finish = useEntity(cfg.finish);
  const conn = useEntity(cfg.connectivity);
  const watts = useEntity(ctl?.watts);
  const program = useEntity(ctl?.program);
  const power = useEntity(ctl?.power);
  const plug = useEntity(ctl?.plug);
  const remote = useEntity(ctl?.remoteStart);
  const stopBtn = useEntity(ctl?.stop);
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>();
  const [error, setError] = useState<string>();
  const now = useNow(30_000).getTime();

  useEffect(() => {
    let live = true;
    loadRegistry(hass)
      .then((reg) => {
        const dev = reg.entities.find((e) => e.entityId === (ctl?.program ?? cfg.state))?.deviceId;
        if (live && dev) setDeviceIds(reg.entities.filter((e) => e.deviceId === dev).map((e) => e.entityId));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hass, cfg, ctl]);

  const wattsId = ctl?.watts;
  useEffect(() => {
    if (!wattsId) return;
    let live = true;
    hass
      .fetchHistory([wattsId], HISTORY_HOURS)
      .then((h) => live && setHistory(h[wattsId] ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hass, wattsId]);

  // Device entities not already named in the config.
  const named = useMemo(() => new Set([cfg.state, cfg.progress, cfg.finish, cfg.connectivity, ...Object.values(ctl ?? {})]), [cfg, ctl]);
  const found = useEntities(deviceIds);
  const rest = found.filter((e): e is HassEntity => !!e && !named.has(e.entity_id));
  const activeProgram = rest.find((e) => e.entity_id.endsWith('_active_program'));
  const door = rest.find((e) => e.entity_id.endsWith('_door'));
  const switches = rest.filter((e) => domainOf(e.entity_id) === 'switch');
  const readings = rest.filter((e) => ['sensor', 'binary_sensor'].includes(domainOf(e.entity_id)) && e !== activeProgram && e !== door);
  const care = readings.filter((e) => ALERT_NAME.test(e.entity_id));
  const warnings = care.filter((e) => !CLEAR.includes(e.state));
  const other = readings.filter((e) => !ALERT_NAME.test(e.entity_id));
  const option = (suffix: string) => switches.find((e) => e.entity_id.endsWith(suffix));

  const op = state?.state ?? '';
  const asleep = isUnavailable(state);
  const active = ACTIVE.includes(op);
  const running = ['run', 'pause', 'delayedstart'].includes(op);
  const unplugged = plug?.state === 'off';
  const programs = (program?.attributes.options as string[] | undefined) ?? [];
  const current = activeProgram && !isUnavailable(activeProgram) ? activeProgram.state : program?.state;
  const finishAt = finish ? new Date(finish.state).getTime() : NaN;
  const remainingMin = running && Number.isFinite(finishAt) ? Math.max(0, Math.round((finishAt - now) / 60_000)) : undefined;
  const on = !asleep && !unplugged && (power ? power.state === 'on' : true);

  const scene = useStable<DishState>({
    power: on,
    op,
    program: current,
    remainingMin,
    door: door?.state,
    remoteStart: remote?.state === 'on',
    connected: conn?.state === 'on',
    halfLoad: option('_half_load')?.state === 'on',
    intensiveZone: option('_intensive_zone')?.state === 'on',
    childLock: option('_child_lock')?.state === 'on',
    saltLow: care.some((e) => /salt/.test(e.entity_id) && !CLEAR.includes(e.state)),
    rinseLow: care.some((e) => /rinse_aid/.test(e.entity_id) && !CLEAR.includes(e.state)),
  });

  // Actions: errors show in the layout; nothing retries on its own.
  const run = (what: string, p: Promise<unknown>) => {
    setError(undefined);
    p.catch((err: unknown) => setError(`${what}: ${err instanceof Error ? err.message : 'failed'}`));
  };
  const actions = {
    selectProgram: (key: string) => ctl && run('Program', hass.callService('select', 'select_option', { option: key }, { entity_id: ctl.program })),
    // start_selected_program wants the device, which the program entity belongs to.
    start: (delay = 0) =>
      ctl &&
      run(
        'Start',
        (async () => {
          const reg = await loadRegistry(hass);
          const deviceId = reg.entities.find((e) => e.entityId === ctl.program)?.deviceId;
          if (!deviceId) throw new Error('device not found');
          await hass.callService('home_connect', 'start_selected_program', {
            device_id: deviceId,
            ...(delay > 0 ? { b_s_h_common_option_start_in_relative: delay } : {}),
          });
        })(),
      ),
    stop: () => ctl && run('Stop', hass.callService('button', 'press', {}, { entity_id: ctl.stop })),
    setPower: (to: boolean) => ctl?.power && run('Power', hass.callService('switch', to ? 'turn_on' : 'turn_off', {}, { entity_id: ctl.power })),
    plugOn: () => ctl?.plug && run('Plug', hass.callService('switch', 'turn_on', {}, { entity_id: ctl.plug })),
    setOption: (id: string, to: boolean) => run('Option', hass.callService('switch', to ? 'turn_on' : 'turn_off', {}, { entity_id: id })),
  };

  return {
    cfg,
    ctl,
    state,
    op,
    label: asleep ? 'Asleep' : (STATE_LABEL[op] ?? op),
    asleep,
    active,
    running,
    on,
    unplugged,
    progress: running ? progress : undefined,
    finish,
    finishAt: Number.isFinite(finishAt) ? finishAt : undefined,
    remainingMin,
    conn,
    door,
    program,
    programs,
    current,
    power,
    remote,
    noRemote: remote !== undefined && remote.state !== 'on',
    stopBtn,
    switches,
    option,
    care,
    warnings,
    other,
    watts,
    history,
    scene,
    error,
    actions,
  };
}

export type Dishwasher = ReturnType<typeof useDishwasher>;
