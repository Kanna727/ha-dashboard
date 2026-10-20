import { useCallback, useEffect, useMemo, useState } from 'react';
import { COMMUTE } from '../config/entities';
import { useHass } from '../ha/api';
import { useNow } from '../hooks/useNow';
import {
  computeRoutes,
  delayMin,
  extractCommuteConfig,
  inCommuteWindow,
  speedSegments,
  trafficLevel,
  type CommuteConfig,
  type LatLng,
  type Route,
  type SpeedSegment,
  type TrafficLevel,
  type TravelMode,
} from './routes';
import type { Place } from './views';

const REFRESH_MS = 2 * 60_000;
const OVERRIDE_TIMEOUT_MS = 5 * 60_000;
export const STALE_MS = 5 * 60_000;
export const LEAVE_LATER_MIN = [15, 30, 45];
const MAX_RECENTS = 5;

// The mock's test panel fires this to make every commute view fetch again.
export const COMMUTE_TEST_EVENT = 'commute-test';

// Commute settings live on the Lovelace card; undefined = loading, null = not found.
export function useCommuteConfig(): { config: CommuteConfig | null | undefined; error?: string } {
  const hass = useHass();
  const [config, setConfig] = useState<CommuteConfig | null>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    hass
      .fetchLovelaceConfig(COMMUTE.dashboard)
      .then((lovelace) => alive && setConfig(extractCommuteConfig(lovelace)))
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [hass]);
  return { config, error };
}

export function commuteMissingText(config: CommuteConfig | null | undefined, error?: string) {
  if (error) return `Couldn't read the commute card: ${error}`;
  if (config === null) return `No ${COMMUTE.cardType} card with an API key found on the "${COMMUTE.dashboard}" dashboard.`;
  return 'Loading…';
}

export interface LeaveOption {
  offset: number; // minutes from now
  seconds: number;
}

export interface CommuteRoute extends Route {
  segs: SpeedSegment[];
  level: TrafficLevel;
  delay?: number;
}

export interface Commute {
  config: CommuteConfig;
  mode: TravelMode;
  setMode: (m: TravelMode) => void;
  swapped: boolean;
  setSwapped: (s: boolean) => void;
  override: Place | null;
  choosePlace: (p: Place) => void;
  clearPlace: () => void;
  recents: Place[];
  routes: CommuteRoute[] | null;
  origin?: LatLng;
  dest?: LatLng;
  selected: number;
  select: (i: number) => void;
  route?: CommuteRoute; // the selected one
  fastest: number;
  error?: string;
  busy: boolean;
  lastUpdate: number | null;
  stale: boolean;
  leaveLater: LeaveOption[] | null;
  inWindow: boolean;
  alert: boolean; // over the alert threshold inside the commute window
  from: string;
  to: string;
  refresh: () => void;
  now: Date;
}

// Routes for the commute: fetched on mount, on refresh, when the trip changes
// and every 2 min inside the commute window (or while a searched destination
// is set). `alternatives` and `leaveLater` cost extra Routes API calls, so the
// card asks for them only when it shows them; leave-later times are only
// fetched inside the commute window and never for a searched destination.
export function useCommute(config: CommuteConfig, opts: { alternatives?: boolean; leaveLater?: boolean } = {}): Commute {
  const now = useNow(15_000);
  const [mode, setMode] = useState<TravelMode>(config.defaultVehicle);
  const [swapped, setSwapped] = useState(false);
  const [override, setOverride] = useState<Place | null>(null);
  const [recents, setRecents] = useState<Place[]>([]);
  const [result, setResult] = useState<{ routes: Route[]; origin: LatLng; dest: LatLng } | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [leaveLater, setLeaveLater] = useState<LeaveOption[] | null>(null);
  const [tick, setTick] = useState(0);

  const choosePlace = useCallback((p: Place) => {
    setOverride(p);
    setRecents((prev) => [p, ...prev.filter((r) => r.label !== p.label)].slice(0, MAX_RECENTS));
  }, []);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    const home = config.origin;
    const away = override?.latLng ?? config.dest;
    const origin = swapped ? away : home;
    const dest = swapped ? home : away;
    setBusy(true);
    computeRoutes({ apiKey: config.apiKey, origin, dest, mode, alternatives: !!opts.alternatives, signal: ctrl.signal })
      .then(async (routes) => {
        if (ctrl.signal.aborted) return;
        const best = routes.reduce((bi, r, i) => (r.seconds < routes[bi].seconds ? i : bi), 0);
        setResult({ routes, origin, dest });
        setSelected(best);
        setError(undefined);
        setLastUpdate(Date.now());
        if (!opts.leaveLater || override || !inCommuteWindow()) return setLeaveLater(null);
        const later = await Promise.all(
          LEAVE_LATER_MIN.map((m) =>
            computeRoutes({ apiKey: config.apiKey, origin, dest, mode, alternatives: false, departureOffsetMin: m, signal: ctrl.signal })
              .then((r) => ({ offset: m, seconds: r[0].seconds }))
              .catch(() => null),
          ),
        );
        if (!ctrl.signal.aborted) setLeaveLater([{ offset: 0, seconds: routes[best].seconds }, ...later.filter((x): x is LeaveOption => !!x)]);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      })
      .finally(() => !ctrl.signal.aborted && setBusy(false));
    return () => ctrl.abort();
  }, [config, mode, swapped, override, tick, opts.alternatives, opts.leaveLater]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (override || inCommuteWindow()) setTick((t) => t + 1);
    }, REFRESH_MS);
    const onTest = () => setTick((t) => t + 1);
    window.addEventListener(COMMUTE_TEST_EVENT, onTest);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(COMMUTE_TEST_EVENT, onTest);
    };
  }, [override]);

  // A searched destination falls back to the configured one after 5 minutes.
  useEffect(() => {
    if (!override) return;
    const id = window.setTimeout(() => setOverride(null), OVERRIDE_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [override]);

  const routes = useMemo<CommuteRoute[] | null>(
    () =>
      result?.routes.map((r) => {
        const segs = speedSegments(r);
        // A trip over the configured alert threshold always counts as heavy.
        const level = Math.round(r.seconds / 60) >= config.alertThresholdMin ? 'heavy' : trafficLevel(r, segs);
        return { ...r, segs, level, delay: delayMin(r) };
      }) ?? null,
    [result, config.alertThresholdMin],
  );
  const route = routes?.[selected];
  const fastest = routes ? routes.reduce((bi, r, i) => (r.seconds < routes[bi].seconds ? i : bi), 0) : 0;
  const inWindow = inCommuteWindow(now);
  const [homeName, workName] = splitTitle(config.title);
  const away = override?.label ?? workName;

  return {
    config,
    mode,
    setMode,
    swapped,
    setSwapped,
    override,
    choosePlace,
    clearPlace: () => setOverride(null),
    recents,
    routes,
    origin: result?.origin,
    dest: result?.dest,
    selected,
    select: setSelected,
    route,
    fastest,
    error,
    busy,
    lastUpdate,
    stale: lastUpdate !== null && now.getTime() - lastUpdate > STALE_MS,
    leaveLater,
    inWindow,
    alert: !!route && Math.round(route.seconds / 60) >= config.alertThresholdMin && inWindow,
    from: swapped ? away : homeName,
    to: swapped ? homeName : away,
    refresh,
    now,
  };
}

// "Home → Office", "Home to Office" or "Home - Office" give the two ends;
// any other title is the destination, from Home.
export function splitTitle(title: string): [string, string] {
  const m = title.match(/^(.+?)\s*(?:→|->|–|—| - | to )\s*(.+)$/i);
  return m ? [m[1].trim(), m[2].trim()] : ['Home', title];
}

// The quickest start, but leaving now unless waiting saves 2 minutes or more.
export function bestLeave(opts: LeaveOption[] | null): LeaveOption | undefined {
  if (!opts?.length) return undefined;
  const best = opts.reduce((b, o) => (o.seconds < b.seconds ? o : b));
  return opts[0].seconds - best.seconds < 120 ? opts[0] : best;
}
