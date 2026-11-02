import { useEffect, useRef, useState } from 'react';
import { APPLIANCES } from '../config/entities';
import { useHass, type HistoryPoint } from '../ha/api';
import { useEntities, useEntity } from '../ha/store';
import { isUnavailable, num } from '../ha/format';
import { chartStart, purifierSummary } from '../lib/purifier';

const NO_IDS: string[] = [];
export const PURIFIER_HOURS = 24 * 7;

// Live purifier readings (APPLIANCES.purifier); `cfg` is undefined when the
// home has no purifier configured.
export function usePurifier() {
  const cfg = APPLIANCES.purifier;
  const tank = useEntity(cfg?.tankTds);
  const input = useEntity(cfg?.inputTds);
  const mode = useEntity(cfg?.mode);
  const faultIds = cfg?.faults?.map((f) => f.entity) ?? NO_IDS;
  const faultStates = useEntities(faultIds);
  const faults = (cfg?.faults ?? []).map((f, i) => ({ name: f.name, on: faultStates[i]?.state === 'on', known: !!faultStates[i] && !isUnavailable(faultStates[i]) }));
  const summary = purifierSummary({ tankTds: num(tank), inputTds: num(input), mode: mode?.state, faults });
  return { cfg, name: cfg?.name ?? 'Water purifier', tank, input, mode, faults, ...summary };
}

// The purifier's controls and history, shared by the room popup's section and
// the Clean page's views: the 7-day TDS history, the two-tap mode change and
// the cloud refresh.
export function usePurifierControls() {
  const hass = useHass();
  const p = usePurifier();
  const cfg = p.cfg;
  const tankFull = useEntity(cfg?.tankFull);
  const fallback = useEntity(cfg?.fallbackMode);
  const refreshBtn = useEntity(cfg?.refresh);
  const last = useEntity(cfg?.lastReported);

  const [history, setHistory] = useState<HistoryPoint[]>();
  useEffect(() => {
    if (!cfg) return;
    let live = true;
    hass
      .fetchHistory([cfg.tankTds], PURIFIER_HOURS)
      .then((h) => live && setHistory(h[cfg.tankTds] ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hass, cfg]);

  // Mode change: the first tap arms an option, a second tap within 4 s sends it.
  const [armed, setArmed] = useState<string>();
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(undefined), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const pickMode = (option: string) => {
    if (!cfg?.mode || option === p.mode?.state) return;
    if (armed !== option) return setArmed(option);
    setArmed(undefined);
    hass.callService('select', 'select_option', { option }, { entity_id: cfg.mode });
  };

  // Refresh: busy until "last reported" changes, or 60 s.
  const [refreshing, setRefreshing] = useState(false);
  const pressedAt = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (refreshing && last?.state !== pressedAt.current) setRefreshing(false);
  }, [last?.state, refreshing]);
  useEffect(() => {
    if (!refreshing) return;
    const t = window.setTimeout(() => setRefreshing(false), 60_000);
    return () => window.clearTimeout(t);
  }, [refreshing]);
  const refresh = () => {
    if (!cfg?.refresh) return;
    pressedAt.current = last?.state;
    setRefreshing(true);
    hass.callService('button', 'press', {}, { entity_id: cfg.refresh });
  };

  const since = history ? chartStart(history, PURIFIER_HOURS, Date.now()) : undefined;
  return {
    ...p,
    tankFull,
    fallback,
    last,
    history,
    since,
    offline: isUnavailable(p.tank),
    options: (p.mode?.attributes.options as string[] | undefined) ?? [],
    armed,
    pickMode,
    refreshing,
    canRefresh: !!cfg?.refresh && !refreshing && !(isUnavailable(refreshBtn) && refreshBtn?.state !== 'unknown'),
    refresh,
  };
}
