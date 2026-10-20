import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  callService,
  createConnection,
  ERR_INVALID_AUTH,
  getAuth,
  getUser,
  subscribeEntities,
  type AuthData,
  type Connection,
} from 'home-assistant-js-websocket';
import {
  HassContext,
  HassStatusContext,
  type ConnectionStatus,
  type ForecastDay,
  type HassApi,
  type HistoryPoint,
  type LastState,
  type StatChange,
  type StatPoint,
  type TodoItem,
} from './api';
import { loadSnapshot, persistSnapshots } from './snapshot';
import { store } from './store';

const TOKEN_KEY = 'hassTokens';
// Served from HA's /local/, so the page origin is HA itself. VITE_HA_URL
// lets `npm run dev` on the Mac talk to the real instance.
const HASS_URL = (import.meta.env.VITE_HA_URL as string | undefined) ?? window.location.origin;

function loadTokens(): Promise<AuthData | null> {
  try {
    return Promise.resolve(JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null'));
  } catch {
    return Promise.resolve(null);
  }
}

function saveTokens(data: AuthData | null) {
  if (data) localStorage.setItem(TOKEN_KEY, JSON.stringify(data));
  else localStorage.removeItem(TOKEN_KEY);
}

// Drop the OAuth callback params so a reload doesn't replay a spent code.
function cleanAuthParams() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('auth_callback')) return;
  ['auth_callback', 'code', 'state'].forEach((p) => url.searchParams.delete(p));
  history.replaceState(null, '', url.toString());
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

// One connection per page, shared across StrictMode double-mounts. Network
// failures retry with backoff; only a rejected login resets the tokens.
let connection: Promise<Connection> | null = null;
let onRetry: (() => void) | null = null;

function getConnection(): Promise<Connection> {
  if (!connection) {
    connection = (async () => {
      for (let delay = 2000; ; delay = Math.min(delay * 2, 30_000)) {
        try {
          const auth = await getAuth({ hassUrl: HASS_URL, loadTokens, saveTokens });
          cleanAuthParams();
          return await createConnection({ auth });
        } catch (err) {
          if (err === ERR_INVALID_AUTH) {
            saveTokens(null);
            cleanAuthParams();
            window.location.reload();
            await new Promise(() => undefined); // page is going away
          }
          onRetry?.();
          await sleep(delay);
        }
      }
    })();
  }
  return connection;
}

// Methods wait for the connection, so the UI can render (from the snapshot)
// before it exists. The object itself never changes. Exported for main.tsx,
// which fetches the config through it before the app renders.
export const haApi: HassApi = {
  callService: async (domain, service, data, target) => callService(await getConnection(), domain, service, data, target),
  async fetchHistory(entityIds, hours) {
    const conn = await getConnection();
    const start = new Date(Date.now() - hours * 3600_000).toISOString();
    const res = await conn.sendMessagePromise<Record<string, { s: string; lu: number }[]>>({
      type: 'history/history_during_period',
      start_time: start,
      entity_ids: entityIds,
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    const out: Record<string, HistoryPoint[]> = {};
    for (const [id, rows] of Object.entries(res)) {
      out[id] = rows.map((r) => ({ t: r.lu * 1000, v: parseFloat(r.s) })).filter((p) => Number.isFinite(p.v));
    }
    return out;
  },
  async fetchLastStates(entityIds, hours) {
    const conn = await getConnection();
    const start = new Date(Date.now() - hours * 3600_000).toISOString();
    const res = await conn.sendMessagePromise<Record<string, { s: string; lu: number }[]>>({
      type: 'history/history_during_period',
      start_time: start,
      entity_ids: entityIds,
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    const out: Record<string, LastState | undefined> = {};
    for (const id of entityIds) {
      const rows = (res[id] ?? []).filter((r) => r.s !== 'unavailable' && r.s !== 'unknown');
      const r = rows[rows.length - 1];
      out[id] = r ? { state: r.s, t: r.lu * 1000 } : undefined;
    }
    return out;
  },
  async fetchStatistics(ids, days, period) {
    const conn = await getConnection();
    const start = new Date(Date.now() - days * 86_400_000);
    start.setHours(0, 0, 0, 0);
    const res = await conn.sendMessagePromise<Record<string, { start: number | string; mean?: number | null }[]>>({
      type: 'recorder/statistics_during_period',
      start_time: start.toISOString(),
      statistic_ids: ids,
      period,
      types: ['mean'],
    });
    const out: Record<string, StatPoint[]> = {};
    for (const id of ids) {
      out[id] = (res[id] ?? []).map((r) => ({
        start: typeof r.start === 'number' ? r.start : Date.parse(r.start),
        mean: r.mean ?? undefined,
      }));
    }
    return out;
  },
  async fetchStatChanges(ids, days, period) {
    const conn = await getConnection();
    const start = new Date(Date.now() - days * 86_400_000);
    start.setHours(0, 0, 0, 0);
    const res = await conn.sendMessagePromise<Record<string, { start: number | string; change?: number | null }[]>>({
      type: 'recorder/statistics_during_period',
      start_time: start.toISOString(),
      statistic_ids: ids,
      period,
      types: ['change'],
    });
    const out: Record<string, StatChange[]> = {};
    for (const id of ids) {
      out[id] = (res[id] ?? []).flatMap((r) =>
        typeof r.change === 'number' ? [{ start: typeof r.start === 'number' ? r.start : Date.parse(r.start), change: r.change }] : [],
      );
    }
    return out;
  },
  subscribeForecast(entityId, type, cb) {
    let cancelled = false;
    const unsub = getConnection().then((conn) =>
      cancelled
        ? undefined
        : conn.subscribeMessage<{ forecast: ForecastDay[] | null }>((msg) => cb(msg.forecast ?? []), {
            type: 'weather/subscribe_forecast',
            entity_id: entityId,
            forecast_type: type,
          }),
    );
    return () => {
      cancelled = true;
      unsub.then((u) => u?.()).catch(() => undefined);
    };
  },
  async fetchTodo(entityId) {
    const conn = await getConnection();
    const res = await conn.sendMessagePromise<{ items: TodoItem[] }>({ type: 'todo/item/list', entity_id: entityId });
    return res.items;
  },
  async fetchRegistry() {
    const conn = await getConnection();
    type Dev = { id: string; name: string | null; name_by_user: string | null; area_id: string | null; model: string | null; disabled_by: string | null };
    type Ents = { entity_categories: Record<string, string>; entities: { ei: string; di?: string; pl: string; ec?: number; tk?: string }[] };
    const [devices, ents] = await Promise.all([
      conn.sendMessagePromise<Dev[]>({ type: 'config/device_registry/list' }),
      conn.sendMessagePromise<Ents>({ type: 'config/entity_registry/list_for_display' }),
    ]);
    return {
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name_by_user || d.name || 'Unnamed device',
        areaId: d.area_id,
        model: d.model,
        disabled: !!d.disabled_by,
      })),
      entities: ents.entities
        .filter((e) => e.di)
        .map((e) => ({
          entityId: e.ei,
          deviceId: e.di!,
          platform: e.pl,
          category: e.ec !== undefined ? ents.entity_categories[e.ec] : undefined,
          translationKey: e.tk,
        })),
    };
  },
  async fetchLovelaceConfig(urlPath) {
    const conn = await getConnection();
    return conn.sendMessagePromise({ type: 'lovelace/config', url_path: urlPath, force: false });
  },
  async fetchAutomationConfigs() {
    const conn = await getConnection();
    const ents = await conn.sendMessagePromise<{ entities: { ei: string }[] }>({ type: 'config/entity_registry/list_for_display' });
    const ids = ents.entities.map((e) => e.ei).filter((id) => id.startsWith('automation.'));
    const res = await Promise.allSettled(
      ids.map((entityId) => conn.sendMessagePromise<{ config: unknown }>({ type: 'automation/config', entity_id: entityId }).then((r) => ({ entityId, config: r.config }))),
    );
    // One that can't be read (e.g. removed meanwhile) is skipped rather than failing them all.
    return res.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  },
  logout() {
    saveTokens(null);
    window.location.reload();
  },
};

export function HaProvider({ children }: { children: ReactNode }) {
  // Hydrate from the last snapshot before the first paint.
  const [hasSnapshot] = useState(() => {
    const snap = loadSnapshot();
    if (snap) store.set(snap);
    return !!snap;
  });
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [userName, setUserName] = useState<string | undefined>(() => localStorage.getItem('dashUserName') ?? undefined);

  useEffect(() => {
    let unsubEntities: (() => void) | undefined;
    let alive = true;
    onRetry = () => alive && setStatus('reconnecting');
    persistSnapshots();

    getConnection().then((conn) => {
      if (!alive) return;
      conn.addEventListener('disconnected', () => setStatus('reconnecting'));
      conn.addEventListener('reconnect-error', () => setStatus('reconnecting'));
      // After a reconnect subscribeEntities re-syncs on its own; the next
      // state dump flips us back to live.
      unsubEntities = subscribeEntities(conn, (ents) => {
        store.set(ents);
        setStatus('live');
      });
      getUser(conn)
        .then((u) => {
          setUserName(u.name);
          localStorage.setItem('dashUserName', u.name);
        })
        .catch(() => undefined);
    });

    return () => {
      alive = false;
      onRetry = null;
      unsubEntities?.();
    };
  }, []);

  const statusValue = useMemo(() => ({ status, userName }), [status, userName]);

  // First visit on this device: nothing cached yet, so wait for live data.
  if (!hasSnapshot && status !== 'live') {
    return (
      <div className="splash">
        <span className="sync-spinner big" />
        {status === 'reconnecting' ? "Can't reach Home Assistant, retrying…" : 'Connecting…'}
      </div>
    );
  }
  return (
    <HassContext.Provider value={haApi}>
      <HassStatusContext.Provider value={statusValue}>{children}</HassStatusContext.Provider>
    </HassContext.Provider>
  );
}
