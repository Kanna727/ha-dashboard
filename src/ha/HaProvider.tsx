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
import { setAdmin } from '../storage/admin';
import { playCamera } from './cameraStream';
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
// JSON documents kept as the config of hidden storage dashboards (the shared
// layout, the client names). Reading works for any logged-in user; saving and
// creating the dashboard need an admin. Only storage/ uses these, through
// fetchStore / saveStore / subscribeStore below.
async function fetchDoc(urlPath: string): Promise<unknown | null> {
  const conn = await getConnection();
  try {
    return await conn.sendMessagePromise({ type: 'lovelace/config', url_path: urlPath, force: false });
  } catch (e) {
    // No such dashboard yet, or it was never saved.
    if ((e as { code?: string }).code === 'config_not_found') return null;
    throw e;
  }
}

async function saveDoc(urlPath: string, config: object, title: string, icon: string): Promise<void> {
  const conn = await getConnection();
  const save = () => conn.sendMessagePromise({ type: 'lovelace/config/save', url_path: urlPath, config });
  try {
    await save();
  } catch (e) {
    if ((e as { code?: string }).code !== 'config_not_found') throw e;
    await conn.sendMessagePromise({
      type: 'lovelace/dashboards/create',
      url_path: urlPath,
      title,
      icon,
      show_in_sidebar: false,
      require_admin: false,
      mode: 'storage',
    });
    await save();
  }
}

function subscribeDoc(urlPath: string, cb: () => void): () => void {
  let cancelled = false;
  // HA fires lovelace_updated (with the dashboard's url_path) on every save; non-admins may subscribe to it.
  const unsub = getConnection().then((conn) =>
    cancelled ? undefined : conn.subscribeEvents<{ data?: { url_path?: string } }>((ev) => ev.data?.url_path === urlPath && cb(), 'lovelace_updated'),
  );
  return () => {
    cancelled = true;
    unsub.then((u) => u?.()).catch(() => undefined);
  };
}

export const haApi: HassApi = {
  callService: async (domain, service, data, target) => callService(await getConnection(), domain, service, data, target),
  async fireEvent(eventType, data) {
    const conn = await getConnection();
    await conn.sendMessagePromise({ type: 'fire_event', event_type: eventType, event_data: data });
  },
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
  async fetchStateHistory(entityIds, hours) {
    const conn = await getConnection();
    const res = await conn.sendMessagePromise<Record<string, { s: string; lu: number }[]>>({
      type: 'history/history_during_period',
      start_time: new Date(Date.now() - hours * 3600_000).toISOString(),
      entity_ids: entityIds,
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    return Object.fromEntries(Object.entries(res).map(([id, rows]) => [id, rows.map((r) => ({ t: r.lu * 1000, s: r.s }))]));
  },
  async createAutomation(id, config) {
    const conn = await getConnection();
    const auth = conn.options.auth;
    if (!auth) throw new Error('Not signed in');
    if (auth.expired) await auth.refreshAccessToken();
    const r = await fetch(`${HASS_URL}/api/config/automation/config/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...config }),
    });
    if (!r.ok) throw Object.assign(new Error(r.status === 401 || r.status === 403 ? 'Unauthorized' : `Home Assistant answered ${r.status}`), { code: r.status === 401 || r.status === 403 ? 'unauthorized' : 'failed' });
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
  async fetchStatistics(ids, days, period, types = ['mean']) {
    const conn = await getConnection();
    const start = new Date(Date.now() - days * 86_400_000);
    start.setHours(0, 0, 0, 0);
    const res = await conn.sendMessagePromise<Record<string, { start: number | string; mean?: number | null; max?: number | null }[]>>({
      type: 'recorder/statistics_during_period',
      start_time: start.toISOString(),
      statistic_ids: ids,
      period,
      types,
    });
    const out: Record<string, StatPoint[]> = {};
    for (const id of ids) {
      out[id] = (res[id] ?? []).map((r) => ({
        start: typeof r.start === 'number' ? r.start : Date.parse(r.start),
        mean: r.mean ?? undefined,
        max: r.max ?? undefined,
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
  subscribeTodo(entityId, cb) {
    let cancelled = false;
    const unsub = getConnection().then((conn) =>
      cancelled ? undefined : conn.subscribeMessage<{ items: TodoItem[] }>((msg) => cb(msg.items ?? []), { type: 'todo/item/subscribe', entity_id: entityId }),
    );
    unsub.catch((e) => console.warn('todo subscribe', entityId, e));
    return () => {
      cancelled = true;
      unsub.then((u) => u?.()).catch(() => undefined);
    };
  },
  // HA's REST calendar API, which (unlike calendar.get_events) gives each event's uid.
  async fetchCalendarEvents(entityIds, start, end) {
    if (!entityIds.length) return [];
    const conn = await getConnection();
    const auth = conn.options.auth;
    if (!auth) return [];
    if (auth.expired) await auth.refreshAccessToken();
    type When = { date?: string; dateTime?: string };
    type Ev = { summary?: string; start?: When; end?: When; location?: string | null; description?: string | null; uid?: string | null; recurrence_id?: string | null };
    const q = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
    const lists = await Promise.all(
      entityIds.map(async (calendar) => {
        const r = await fetch(`${HASS_URL}/api/calendars/${calendar}?${q}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
        // One calendar failing (its integration offline) leaves the others.
        if (!r.ok) {
          console.warn('calendar', calendar, r.status);
          return [];
        }
        return ((await r.json()) as Ev[]).flatMap((e) => {
          const s = e.start?.dateTime ?? e.start?.date;
          if (!e.summary || !s) return [];
          const end = e.end?.dateTime ?? e.end?.date;
          return [{ calendar, summary: e.summary, start: s, end, location: e.location || undefined, description: e.description || undefined, uid: e.uid || undefined, recurrenceId: e.recurrence_id || undefined }];
        });
      }),
    );
    return lists.flat();
  },
  async changeCalendarEvent(entityId, c) {
    const conn = await getConnection();
    const occurrence = c.action !== 'create' ? { uid: c.uid, ...(c.recurrenceId ? { recurrence_id: c.recurrenceId } : {}) } : {};
    await conn.sendMessagePromise({ type: `calendar/event/${c.action}`, entity_id: entityId, ...occurrence, ...(c.action !== 'delete' ? { event: c.event } : {}) });
  },
  async fetchRegistry() {
    const conn = await getConnection();
    type Dev = {
      id: string;
      name: string | null;
      name_by_user: string | null;
      area_id: string | null;
      model: string | null;
      disabled_by: string | null;
      connections?: [string, string][];
      identifiers?: [string, string][];
      serial_number?: string | null;
    };
    type Ents = { entity_categories: Record<string, string>; entities: { ei: string; di?: string; pl: string; ec?: number; tk?: string; ai?: string; hb?: boolean; en?: string }[] };
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
        macs: d.connections?.filter(([kind]) => kind === 'mac').map(([, mac]) => mac.toLowerCase()),
        identifiers: d.identifiers?.map(([, id]) => String(id)),
        serial: d.serial_number,
      })),
      entities: ents.entities
        .filter((e) => e.di)
        .map((e) => ({
          entityId: e.ei,
          deviceId: e.di!,
          platform: e.pl,
          category: e.ec !== undefined ? ents.entity_categories[e.ec] : undefined,
          translationKey: e.tk,
          areaId: e.ai,
          hidden: e.hb,
          name: e.en,
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
  fetchStore(urlPath) {
    return fetchDoc(urlPath);
  },
  saveStore(urlPath, data, title) {
    return saveDoc(urlPath, data, title, 'mdi:database-outline');
  },
  subscribeStore(urlPath, cb) {
    return subscribeDoc(urlPath, cb);
  },
  subscribeNotifyCalls(cb, ready) {
    let cancelled = false;
    type Call = { data?: { domain?: string; service?: string; service_data?: Record<string, unknown> } };
    // call_service is admin-only: a non-admin login gets "unauthorized" here.
    // The library re-subscribes on its own after a reconnect.
    const unsub = getConnection().then((conn) =>
      cancelled
        ? undefined
        : conn.subscribeEvents<Call>((ev) => {
            if (ev.data?.domain === 'notify' && ev.data.service) cb(ev.data.service, ev.data.service_data ?? {});
          }, 'call_service'),
    );
    unsub.then(
      () => !cancelled && ready(true),
      () => !cancelled && ready(false),
    );
    return () => {
      cancelled = true;
      unsub.then((u) => u?.()).catch(() => undefined);
    };
  },
  playCamera(entityId, video, onState) {
    return playCamera(getConnection(), HASS_URL, entityId, video, onState);
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
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);

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
          setAdmin(u.is_admin);
          setIsAdmin(u.is_admin);
        })
        .catch(() => undefined);
    });

    return () => {
      alive = false;
      onRetry = null;
      unsubEntities?.();
    };
  }, []);

  const statusValue = useMemo(() => ({ status, userName, isAdmin }), [status, userName, isAdmin]);

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
