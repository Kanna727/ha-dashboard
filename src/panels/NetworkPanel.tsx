import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { NETWORK, ROOMS } from '../config/entities';
import { useClientNames } from './useClientNames';
import { useHass, type HistoryPoint, type StatChange } from '../ha/api';
import { isOn, isUnavailable, num, relTime } from '../ha/format';
import { store, useEntities, useEntity } from '../ha/store';
import { registryError } from '../ha/registry';
import { readCache, useRegistry, writeCache } from '../ha/useRegistry';
import { CopyButton } from '../components/CopyButton';
import { GlanceTile } from '../components/GlanceTile';
import { Icon, type IconName } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';
import { Sparkline } from '../components/Sparkline';
import { ConfirmButton, Row, Toggle, useConfirm } from '../vacuum/controls';
import { areaName } from './BatteriesPanel';
import {
  bytesPer,
  compareIp,
  clientGroups,
  findNetwork,
  matchClients,
  withNames,
  type ClientName,
  meshNodes,
  meshTree,
  fmtBytes,
  fmtRate,
  fmtUptime,
  routerClients,
  toMbps,
  vpnSwitches,
  wifiSwitches,
  type Band,
  type Client,
  type KnownDevice,
  type MeshNode,
  type NetworkFound,
  type RouterRoles,
  type SpeedTest,
} from '../lib/network';

const CACHE_KEY = 'dashNetwork';
const HOURS = 24;
const USAGE_DAYS = 30;
const EMPTY: NetworkFound = { router: {}, wan: {} };

// The router and the internet gateway's entities (lib/network.ts), found in
// the registry and cached so reloads draw the panel at once.
function useNetwork(): NetworkFound {
  const registry = useRegistry();
  const [found, setFound] = useState<NetworkFound>(() => readCache(CACHE_KEY, EMPTY));
  useEffect(() => {
    if (!registry) return;
    const next = findNetwork(registry, NETWORK.wan, NETWORK.router);
    setFound((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    writeCache(CACHE_KEY, next);
  }, [registry]);
  return found;
}

// Connected clients; rescans only when a device tracker changed.
// Connected clients (with `offline`, also the ones seen before); rescans only
// when a device tracker changed.
function useClients(offline = false): Client[] {
  const memo = useRef<{ refs: (HassEntity | undefined)[]; ids: string[]; count: number; key: string; list: Client[] }>();
  return useSyncExternalStore(store.subscribe, () => {
    const all = store.getAll();
    const ids = Object.keys(all);
    const m = memo.current;
    if (m && m.count === ids.length && m.ids.every((id, i) => all[id] === m.refs[i])) return m.list;
    const trackers = ids.filter((id) => id.startsWith('device_tracker.'));
    const list = routerClients(all, offline);
    const key = JSON.stringify(list);
    memo.current = { refs: trackers.map((id) => all[id]), ids: trackers, count: ids.length, key, list: m && m.key === key ? m.list : list };
    return memo.current.list;
  });
}

const mbps = (e: HassEntity | undefined) => {
  const v = num(e);
  return v === undefined ? undefined : toMbps(v, e?.attributes.unit_of_measurement);
};

// 24 h of a speed sensor, in Mbit/s.
function useSpeedHistory(ids: (string | undefined)[]): Record<string, HistoryPoint[]> {
  const hass = useHass();
  const [hist, setHist] = useState<Record<string, HistoryPoint[]>>({});
  const key = ids.filter(Boolean).join(',');
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const list = key.split(',');
    const load = () =>
      hass
        .fetchHistory(list, HOURS)
        .then((h) => {
          if (!alive) return;
          const all = store.getAll();
          setHist(
            Object.fromEntries(
              list.map((id) => {
                const unit = all[id]?.attributes.unit_of_measurement;
                return [id, (h[id] ?? []).map((p) => ({ t: p.t, v: toMbps(p.v, unit) ?? 0 }))];
              }),
            ),
          );
        })
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [hass, key]);
  return hist;
}

interface Usage {
  days: { start: number; down: number; up: number }[]; // bytes
  today?: { down: number; up: number };
}

// Bytes per day from the gateway's counters (long-term statistics "change").
function useUsage(received?: string, sent?: string): Usage | undefined {
  const hass = useHass();
  const [usage, setUsage] = useState<Usage>();
  useEffect(() => {
    if (!received || !sent) return;
    let alive = true;
    const load = () =>
      hass
        .fetchStatChanges([received, sent], USAGE_DAYS, 'day')
        .then((c) => {
          if (!alive) return;
          const all = store.getAll();
          const scale = (id: string) => bytesPer(all[id]?.attributes.unit_of_measurement) ?? 1;
          const m = new Map<number, { start: number; down: number; up: number }>();
          const add = (rows: StatChange[] | undefined, k: 'down' | 'up', f: number) => {
            for (const r of rows ?? []) {
              const d = m.get(r.start) ?? { start: r.start, down: 0, up: 0 };
              d[k] += Math.max(0, r.change) * f;
              m.set(r.start, d);
            }
          };
          add(c[received], 'down', scale(received));
          add(c[sent], 'up', scale(sent));
          const days = [...m.values()].sort((a, b) => a.start - b.start).slice(-USAGE_DAYS);
          const midnight = new Date().setHours(0, 0, 0, 0);
          const last = days[days.length - 1];
          setUsage({ days, today: last && last.start === midnight ? { down: last.down, up: last.up } : undefined });
        })
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 30 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [hass, received, sent]);
  return usage;
}

function Speeds({ down, up }: { down?: number; up?: number }) {
  return (
    <div className="net-speeds">
      <div className="net-speed down">
        <Icon name="download" size={20} />
        <strong>{fmtRate(down)}</strong>
      </div>
      <div className="net-speed up">
        <Icon name="upload" size={20} />
        <strong>{fmtRate(up)}</strong>
      </div>
    </div>
  );
}

function Gauge({ label, value }: { label: string; value?: number }) {
  const v = value === undefined ? undefined : Math.round(value);
  return (
    <div className={`net-gauge ${v !== undefined && v >= 85 ? 'hot' : ''}`}>
      <div className="net-gauge-head">
        <span className="label">{label}</span>
        <strong>{v === undefined ? '–' : `${v}%`}</strong>
      </div>
      <span className="net-gauge-bar">
        <i style={{ width: `${v ?? 0}%` }} />
      </span>
    </div>
  );
}

// Guest and IoT networks toggle with two taps; the main bands are status only,
// since turning them off would cut off the screen showing this.
function WifiRow({ entity, label, main }: { entity: string; label: string; main: boolean }) {
  const hass = useHass();
  const e = useEntity(entity);
  const [armed, tap] = useConfirm();
  const on = isOn(e);
  return (
    <Row name={`Wi-Fi ${label}`} sub={isUnavailable(e) ? 'Unavailable' : main ? 'Status only' : armed ? `Tap again to turn ${on ? 'off' : 'on'}` : on ? 'On' : 'Off'}>
      {main ? (
        <span className={`chip ${on ? 'ok' : 'warn'}`}>{on ? 'On' : 'Off'}</span>
      ) : (
        <Toggle on={on} disabled={isUnavailable(e)} label={`Wi-Fi ${label}`} onChange={() => tap(() => hass.callService('switch', on ? 'turn_off' : 'turn_on', {}, { entity_id: entity }))} />
      )}
    </Row>
  );
}

const BAND_ORDER: Band[] = ['2.4 GHz', '5 GHz', '6 GHz', 'Wired', 'Other'];
const BAND_COLORS: Record<Band, string> = { '2.4 GHz': '#38bdf8', '5 GHz': '#a78bfa', '6 GHz': '#f472b6', Wired: '#34d399', Other: '#64748b' };

function RouterCard({ net }: { net: NetworkFound }) {
  const { router } = net;
  const cpu = num(useEntity(router.cpu_used));
  const mem = num(useEntity(router.memory_used));
  const total = num(useEntity(router.total_clients));
  const main = num(useEntity(router.total_main_wifi_clients));
  const guest = num(useEntity(router.total_guest_wifi_clients));
  const wired = num(useEntity(router.total_wired_clients));
  const dhcp = num(useEntity(router.dhcp_reservations));
  if (cpu === undefined && mem === undefined && total === undefined) return null;
  return (
    <section className="card">
      <header className="card-head">
        <Icon name="router" size={18} />
        <h2>{net.routerName ?? 'Router'}</h2>
      </header>
      {cpu !== undefined && <Gauge label="CPU" value={cpu} />}
      {mem !== undefined && <Gauge label="Memory" value={mem} />}
      <div className="stat-tiles three net-counts">
        <div className="stat-tile">
          <div className="label">Wi-Fi</div>
          <div className="stat-val">{main ?? '–'}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Guest</div>
          <div className="stat-val">{guest ?? '–'}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Wired</div>
          <div className="stat-val">{wired ?? '–'}</div>
        </div>
      </div>
      {dhcp !== undefined && <div className="muted small net-note">{dhcp} reserved addresses</div>}
    </section>
  );
}

function WifiCard({ router }: { router: RouterRoles }) {
  const wifi = useMemo(() => wifiSwitches(router), [router]);
  const vpns = useMemo(() => vpnSwitches(router), [router]);
  const vpnStates = useEntities(useMemo(() => vpns.map((v) => v.entity), [vpns]));
  if (!wifi.length) return null;
  return (
    <section className="card">
      <header className="card-head">
        <Icon name="wifi" size={18} />
        <h2>Wi-Fi</h2>
      </header>
      {wifi.map((w) => (
        <WifiRow key={w.entity} entity={w.entity} label={w.label} main={w.main} />
      ))}
      {vpns.length > 0 && (
        <div className="chips-row">
          {vpns.map((v, i) => {
            const s = vpnStates[i];
            return (
              <span key={v.entity} className={`chip ${isOn(s) ? 'ok' : ''}`}>
                VPN {v.label} · {isUnavailable(s) ? 'n/a' : isOn(s) ? 'on' : 'off'}
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}

// In the popup's header, left of the close button. Two taps: everything drops
// off the network for a few minutes, the screen showing this too.
function RestartRouter({ entity }: { entity: string }) {
  const hass = useHass();
  const e = useEntity(entity);
  return (
    <ConfirmButton
      label="Restart router"
      confirm="Tap again to restart"
      icon="restart"
      className="net-restart"
      disabled={e?.state === 'unavailable'}
      onConfirm={() => hass.callService('button', 'press', {}, { entity_id: entity })}
    />
  );
}

type Filter = Band | 'Guest' | 'All' | 'Offline';
type Sort = 'name' | 'ip' | 'recent';
const SORTS: [Sort, string][] = [
  ['name', 'Name'],
  ['ip', 'IP'],
  ['recent', 'Recent'],
];

const connectionOf = (c: Client) => (c.band === 'Wired' ? 'Wired' : `${c.guest ? 'Guest Wi-Fi' : 'Wi-Fi'}${c.band === 'Other' ? '' : ` ${c.band}`}`);

// One device: its name (the HA device's, matched by MAC, else the router's),
// IP and room; tap for MAC, connection, since when, and traffic where the
// router reports it. IP and MAC have copy buttons.
// How a client was matched to an HA device, after its name in the details.
const VIA: Record<KnownDevice['via'], string> = { mac: '', id: ' (by its ID)', likely: ' (likely)', manual: ' (named by you)' };

// `text` with each case-insensitive occurrence of `needle` wrapped in <mark>.
function Hl({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, at)) {
    if (i > at) parts.push(text.slice(at, i));
    parts.push(<mark key={i}>{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

export interface DeviceOption {
  id: string;
  name: string;
  area?: string; // room name
}

interface Naming {
  entry?: ClientName;
  options: DeviceOption[]; // HA devices it could be (not already another client's)
  save: (entry: ClientName | null) => Promise<void>;
}

const saveError = (e: unknown) => {
  const msg = String((e as { message?: unknown })?.message ?? e);
  return /unauthor|admin/i.test(msg) ? 'Only an admin login can save names.' : `Couldn’t save: ${msg}`;
};

// Naming a client: pick the HA device it is (its name and room follow the
// device), or give it a name and room of its own.
function NameEditor({ c, naming, onClose }: { c: Client; naming: Naming; onClose: () => void }) {
  const { entry, options, save } = naming;
  const [mode, setMode] = useState<'device' | 'own'>(entry?.name && !entry.device ? 'own' : 'device');
  const [device, setDevice] = useState(entry?.device ?? '');
  const [name, setName] = useState(entry?.name ?? '');
  const [area, setArea] = useState(entry?.area ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const groups = new Map<string, DeviceOption[]>();
  for (const o of options) groups.set(o.area ?? 'No room', [...(groups.get(o.area ?? 'No room') ?? []), o]);
  const ordered = [...groups].sort(([a], [b]) => (a === 'No room' ? 1 : b === 'No room' ? -1 : a.localeCompare(b)));
  const ready = mode === 'device' ? !!device : !!name.trim();
  const run = async (next: ClientName | null) => {
    setBusy(true);
    setError(undefined);
    try {
      await save(next);
      onClose();
    } catch (e) {
      setError(saveError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="net-name-editor">
      <div className="segmented small">
        <button className={mode === 'device' ? 'active' : ''} onClick={() => setMode('device')}>
          A Home Assistant device
        </button>
        <button className={mode === 'own' ? 'active' : ''} onClick={() => setMode('own')}>
          A name of my own
        </button>
      </div>
      {mode === 'device' ? (
        <label className="net-name-field">
          <span className="label">Which device is {c.name}?</span>
          <select value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="">Choose a device…</option>
            {ordered.map(([room, list]) => (
              <optgroup key={room} label={room}>
                {list.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : (
        <div className="net-name-own">
          <label className="net-name-field">
            <span className="label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${c.name}`} maxLength={60} />
          </label>
          <label className="net-name-field">
            <span className="label">Room</span>
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">No room</option>
              {ROOMS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {error && <p className="net-name-error">{error}</p>}
      <div className="net-name-actions">
        <button className="chip-btn active" disabled={!ready || busy} onClick={() => run(mode === 'device' ? { device } : { name: name.trim(), area: area || undefined })}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {entry && (
          <button className="chip-btn" disabled={busy} onClick={() => run(null)}>
            Remove my name
          </button>
        )}
        <button className="chip-btn" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="muted small">Saved in Home Assistant, so every screen shows it.</p>
    </div>
  );
}

function DeviceRow({
  c,
  known,
  open,
  onToggle,
  needle = '',
  naming,
}: {
  c: Client;
  known?: KnownDevice;
  open: boolean;
  onToggle: () => void;
  needle?: string;
  naming?: Naming;
}) {
  const [editing, setEditing] = useState(false);
  const room = areaName(known?.areaId ?? undefined);
  const sub = [c.ip, room].filter(Boolean).join(' · ');
  // [label, value, copyable]
  const rows: [string, string | undefined, boolean?][] = [
    ['IP address', c.ip, true],
    ['MAC address', c.mac, true],
    ['Connection', connectionOf(c)],
    [c.online ? 'Online since' : 'Last seen', c.since ? relTime(c.since) || undefined : undefined],
    ['Home Assistant', known ? [known.name, room].filter(Boolean).join(' · ') + VIA[known.via] : 'Not matched to a device'],
    ['Router calls it', known ? c.name : undefined],
    ['Signal', c.signal !== undefined ? `${c.signal} dBm` : undefined],
    ['Packets sent', c.packetsSent?.toLocaleString()],
    ['Packets received', c.packetsReceived?.toLocaleString()],
  ];
  return (
    <li className={`net-dev-row ${open ? 'open' : ''} ${c.online ? '' : 'offline'}`}>
      <button className="net-dev-btn" onClick={onToggle} aria-expanded={open}>
        <Icon name={c.band === 'Wired' ? 'lan' : c.online ? 'wifi' : 'wifiOff'} size={16} />
        <span className="net-flat-name">
          <span>
            <Hl text={known?.name ?? c.name} needle={needle} />
          </span>
          {sub && (
            <small className="muted">
              <Hl text={sub} needle={needle} />
            </small>
          )}
        </span>
        {c.guest && <span className="chip amber">Guest</span>}
        <span className="muted small">{c.online ? c.band : 'Offline'}</span>
        <Icon name={open ? 'down' : 'chevronRight'} size={16} />
      </button>
      {open && (
        <dl className="net-dev-info">
          {rows
            .filter(([, v]) => v)
            .map(([k, v, copy]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>
                  <Hl text={v!} needle={needle} />
                  {copy && v && <CopyButton text={v} label={k} />}
                </dd>
              </div>
            ))}
        </dl>
      )}
      {open && naming && c.mac && !editing && (
        <div className="net-name-open">
          <button className="chip-btn small" onClick={() => setEditing(true)}>
            <Icon name="pencil" size={14} />
            {naming.entry ? 'Change name' : known ? 'Name it differently' : 'Name it'}
          </button>
        </div>
      )}
      {open && naming && c.mac && editing && <NameEditor c={c} naming={naming} onClose={() => setEditing(false)} />}
    </li>
  );
}

// Mesh node trackers; re-read only when a device tracker changed.
function useMeshNodes(): MeshNode[] {
  const memo = useRef<{ refs: (HassEntity | undefined)[]; ids: string[]; count: number; key: string; list: MeshNode[] }>();
  return useSyncExternalStore(store.subscribe, () => {
    const all = store.getAll();
    const ids = Object.keys(all);
    const m = memo.current;
    if (m && m.count === ids.length && m.ids.every((id, i) => all[id] === m.refs[i])) return m.list;
    const trackers = ids.filter((id) => id.startsWith('device_tracker.'));
    const list = meshNodes(all);
    const key = JSON.stringify(list);
    memo.current = { refs: trackers.map((id) => all[id]), ids: trackers, count: ids.length, key, list: m && m.key === key ? m.list : list };
    return memo.current.list;
  });
}

const STEP = 150; // map spacing along the flow (internet → router → nodes)
const ACROSS = 92; // spacing between siblings (horizontal map)
const ACROSS_V = 128; // … and in the vertical (phone) map, where names sit beside nodes
const STEP_V = 104;
const R = 24; // node radius
const LEAF_W = 118;
const LEAF_H = 34;
const clip = (s: string, n = 15) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// "5" → "5 GHz", "wired" → "Wired".
const uplinkLabel = (u?: string) => (!u ? '' : /^\d+(\.\d+)?$/.test(u) ? `${u} GHz` : u.charAt(0).toUpperCase() + u.slice(1));

interface Placed {
  key: string;
  x: number;
  y: number;
}

// The card's width, so the map can turn vertical on narrow screens.
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// The network map at the top of the popup (the owner asked for one like the
// router maker's app): Internet → router → mesh nodes by uplink, with each
// node's client count, the uplink's type and signal bars. Clients don't report
// which node they're on, so without mesh node trackers (a single router, or an
// integration that doesn't report the mesh) the router branches into its
// bands instead; tap a band to filter the device list. Left to right on wide
// screens, top to bottom (names beside the nodes) under 520 px.
function NetworkMap({ net, onPick }: { net: NetworkFound; onPick: (f: Filter) => void }) {
  const { wan } = net;
  const link = useEntity(wan.wan_status ?? NETWORK.wan);
  const down = mbps(useEntity(wan.download_speed));
  const up = mbps(useEntity(wan.upload_speed));
  const clients = useClients();
  const tree = meshTree(useMeshNodes());
  const [ref, width] = useWidth<HTMLElement>();
  const vertical = width > 0 && width < 520;
  const linkDown = link !== undefined && !isUnavailable(link) && !isOn(link);

  // Columns along the flow: 0 internet, 1 router (the mesh root), 2… the levels below it.
  const mesh = tree.length > 0;
  const bands = BAND_ORDER.map((b) => [b, clients.filter((c) => c.band === b).length] as const).filter(([, n]) => n);
  const guests = clients.filter((c) => c.guest).length;
  const leaves: [Filter, number][] = [...bands.map(([b, n]): [Filter, number] => [b, n]), ...(guests ? ([['Guest', guests]] as [Filter, number][]) : [])];
  const levels = mesh ? Math.max(...tree.map((t) => t.level)) : leaves.length ? 1 : 0;
  const columns: string[][] = [['internet'], [mesh ? tree[0].node.entity : 'router']];
  for (let l = 1; l <= levels; l++) columns.push(mesh ? tree.filter((t) => t.level === l).map((t) => t.node.entity) : leaves.map(([f]) => `band:${f}`));
  const widest = Math.max(...columns.map((c) => c.length));
  const pos = new Map<string, Placed>();
  let W: number;
  let H: number;
  if (vertical && !mesh) {
    // Band pills two to a row under the router.
    W = 300;
    const rowsOfLeaves = Math.ceil(leaves.length / 2);
    H = 36 + 2 * STEP_V + Math.max(rowsOfLeaves - 1, 0) * 52 + 30;
    pos.set('internet', { key: 'internet', x: W / 2, y: 36 });
    pos.set('router', { key: 'router', x: W / 2, y: 36 + STEP_V });
    leaves.forEach(([f], k) => pos.set(`band:${f}`, { key: `band:${f}`, x: W / 2 + (k % 2 ? 1 : -1) * (LEAF_W / 2 + 8), y: 36 + 2 * STEP_V + Math.floor(k / 2) * 52 }));
  } else if (vertical) {
    W = Math.max(widest * ACROSS_V, 300);
    H = 40 + (columns.length - 1) * STEP_V + 40;
    columns.forEach((col, ci) => col.forEach((key, ri) => pos.set(key, { key, x: W / 2 - ((col.length - 1) * ACROSS_V) / 2 + ri * ACROSS_V - (col.length > 1 ? 0 : 50), y: 36 + ci * STEP_V })));
  } else {
    H = widest * ACROSS + 36;
    W = 70 + (columns.length - 1) * STEP + 90;
    columns.forEach((col, ci) => col.forEach((key, ri) => pos.set(key, { key, x: 50 + ci * STEP, y: H / 2 - ((col.length - 1) * ACROSS) / 2 + ri * ACROSS - 10 })));
  }
  const at = (k: string) => pos.get(k)!;
  const edge = (from: Placed, to: Placed, label: string, signal?: number, dim?: boolean, leaf = false) => {
    let d: string;
    let lx: number;
    let ly: number;
    if (vertical && leaf) {
      // A trunk straight down between the two pill columns, a short branch to each pill.
      d = `M ${from.x} ${from.y + R} V ${to.y} H ${to.x + (to.x < from.x ? 1 : -1) * (LEAF_W / 2)}`;
      lx = ly = 0;
    } else if (vertical) {
      const y1 = from.y + R;
      const y2 = to.y - (leaf ? LEAF_H / 2 : R);
      const my = (y1 + y2) / 2;
      d = `M ${from.x} ${y1} C ${from.x} ${my}, ${to.x} ${my}, ${to.x} ${y2}`;
      lx = (from.x + to.x) / 2 + 8;
      ly = my + 4;
    } else {
      const x1 = from.x + R;
      const x2 = to.x - (leaf ? 0 : R);
      const mx = (x1 + x2) / 2;
      d = `M ${x1} ${from.y} C ${mx} ${from.y}, ${mx} ${to.y}, ${x2} ${to.y}`;
      lx = mx;
      ly = (from.y + to.y) / 2 - 7;
    }
    return (
      <g key={`${from.key}>${to.key}`} className={`net-map-edge ${dim ? 'dim' : ''}`}>
        <path d={d} />
        {label && (
          <text x={lx} y={ly} textAnchor={vertical ? 'start' : 'middle'} className="net-map-edge-label">
            {label}
          </text>
        )}
        {signal !== undefined && (
          <g transform={vertical ? `translate(${lx + label.length * 6.5 + 6} ${ly - 9})` : `translate(${lx - 9} ${ly + 9})`} className="net-map-bars">
            {(signal > 3 ? [1, 2, 3, 4, 5] : [1, 2, 3]).map((b, _i, all) => (
              <rect key={b} x={(b - 1) * 6} y={10 - (b * 10) / all.length} width={4} height={(b * 10) / all.length} className={b <= signal ? 'on' : ''} rx={1} />
            ))}
          </g>
        )}
      </g>
    );
  };
  const nodeAt = (p: Placed, icon: IconName, name: string, sub: string | undefined, opts: { badge?: number; tone?: 'ok' | 'warn' | 'off' } = {}) => (
    <g key={p.key} className={`net-map-node ${opts.tone ?? ''}`}>
      <circle cx={p.x} cy={p.y} r={R} />
      <g transform={`translate(${p.x - 12} ${p.y - 12})`}>
        <Icon name={icon} size={24} />
      </g>
      {opts.badge !== undefined && (
        <g className="net-map-badge">
          <circle cx={p.x + R - 4} cy={p.y - R + 4} r={10} />
          <text x={p.x + R - 4} y={p.y - R + 8} textAnchor="middle">
            {opts.badge}
          </text>
        </g>
      )}
      <text x={vertical ? p.x + R + 10 : p.x} y={vertical ? p.y - 2 : p.y + R + 16} textAnchor={vertical ? 'start' : 'middle'} className="net-map-name">
        {clip(name)}
      </text>
      {sub && (
        <text x={vertical ? p.x + R + 10 : p.x} y={vertical ? p.y + 13 : p.y + R + 30} textAnchor={vertical ? 'start' : 'middle'} className="net-map-sub">
          {clip(sub, 20)}
        </text>
      )}
    </g>
  );

  return (
    <section className="card net-map-card" ref={ref}>
      <header className="card-head">
        <Icon name="accessPoint" size={18} />
        <h2>Network map</h2>
        <span className="muted small">{mesh ? `${tree.length} node${tree.length === 1 ? '' : 's'} · ${clients.length} devices` : `${clients.length} devices`}</span>
      </header>
      <svg className="net-map" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W }} role="img" aria-label="Network map">
        {edge(at('internet'), at(columns[1][0]), linkDown ? 'down' : '', undefined, linkDown)}
        {mesh
          ? tree.slice(1).map((t) => edge(at(t.parent!), at(t.node.entity), uplinkLabel(t.node.uplink), t.node.signal, !t.node.online))
          : leaves.map(([f]) => edge(at('router'), at(`band:${f}`), '', undefined, false, true))}
        {nodeAt(at('internet'), 'internet', 'Internet', linkDown ? 'Down' : down !== undefined ? `↓ ${fmtRate(down)} ↑ ${fmtRate(up)}` : undefined, {
          tone: linkDown ? 'warn' : 'ok',
        })}
        {mesh
          ? tree.map((t) =>
              nodeAt(at(t.node.entity), t.level === 0 ? 'router' : 'accessPoint', t.node.name, t.node.model, {
                badge: t.node.clients ?? (t.level === 0 && tree.length === 1 ? clients.length : undefined),
                tone: t.node.online ? 'ok' : 'off',
              }),
            )
          : nodeAt(at('router'), 'router', net.routerName ?? 'Router', undefined, { badge: clients.length, tone: 'ok' })}
        {!mesh &&
          leaves.map(([f, n]) => {
            const p = at(`band:${f}`);
            const x0 = vertical ? p.x - LEAF_W / 2 : p.x;
            return (
              <g key={p.key} className="net-map-leaf tap" onClick={() => onPick(f)} role="button" aria-label={`Show ${f} devices`}>
                <rect x={x0} y={p.y - LEAF_H / 2} width={LEAF_W} height={LEAF_H} rx={LEAF_H / 2} />
                <g transform={`translate(${x0 + 10} ${p.y - 9})`}>
                  <Icon name={f === 'Wired' ? 'lan' : 'wifi'} size={18} />
                </g>
                <text x={x0 + 34} y={p.y + 5} className="net-map-leaf-text">
                  {f} · {n}
                </text>
              </g>
            );
          })}
      </svg>
      {mesh && <p className="muted small net-map-note">The router doesn&apos;t say which node each device is on, so the devices are listed below rather than on the map.</p>}
    </section>
  );
}

// Every device the router knows: search (name, IP, MAC, room), filter by band,
// guest or offline, sort by name, IP or most recently connected.
function DeviceList({ filter, setFilter }: { filter: Filter; setFilter: (f: Filter) => void }) {
  const all = useClients(true);
  const registry = useRegistry();
  const { names, save } = useClientNames();
  const auto = useMemo(
    () => (registry ? matchClients(registry, all) : new Map<string, KnownDevice>()),
    // The tracker list rarely changes; recompute when the registry or it does.
    [registry, all.length],
  );
  // The owner's names win over the automatic matches.
  const known = useMemo(() => withNames(auto, all, names, registry), [auto, all, names, registry]);
  // HA devices a client could be named as: not disabled, not the router's own
  // per-client devices, and not already another client's.
  const deviceOptions = useMemo(() => {
    if (!registry) return [] as DeviceOption[];
    const trackers = new Set(registry.entities.filter((e) => all.some((c) => c.entity === e.entityId)).map((e) => e.deviceId));
    return registry.devices
      .filter((d) => !d.disabled && !trackers.has(d.id))
      .map((d) => ({ id: d.id, name: d.name, area: areaName(d.areaId ?? undefined) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [registry, all]);
  const namingOf = (c: Client): Naming | undefined => {
    if (!c.mac) return undefined;
    const mine = known.get(c.entity)?.deviceId;
    const taken = new Set([...known.entries()].filter(([entity]) => entity !== c.entity).map(([, k]) => k.deviceId));
    return {
      entry: names[c.mac],
      options: deviceOptions.filter((o) => o.id === mine || !taken.has(o.id)),
      save: (entry) => save(c.mac!, entry),
    };
  };
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [open, setOpen] = useState<string | null>(null);
  // While searching, every match is open; tapping one closes just that one.
  // A new search opens them all again.
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  useEffect(() => setClosed(new Set()), [q]);
  const online = all.filter((c) => c.online);
  const counts = BAND_ORDER.map((b) => [b, online.filter((c) => c.band === b).length] as const).filter(([, n]) => n);
  const guests = online.filter((c) => c.guest).length;
  const offline = all.length - online.length;
  const knownOf = (c: Client) => known.get(c.entity);
  const needle = q.trim().toLowerCase();
  const matches = (c: Client) => {
    if (!needle) return true;
    const k = knownOf(c);
    return [c.name, c.ip, c.mac, k?.name, areaName(k?.areaId ?? undefined)].some((s) => s?.toLowerCase().includes(needle));
  };
  const inFilter = (c: Client) =>
    filter === 'Offline' ? !c.online : c.online && (filter === 'All' || (filter === 'Guest' ? c.guest : c.band === filter));
  const nameOf = (c: Client) => knownOf(c)?.name ?? c.name;
  const shown = all
    .filter((c) => inFilter(c) && matches(c))
    .sort((a, b) =>
      sort === 'ip'
        ? compareIp(a.ip, b.ip)
        : sort === 'recent'
          ? (b.since ?? '').localeCompare(a.since ?? '')
          : nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }),
    );
  const filters: Filter[] = ['All', ...counts.map(([b]) => b), ...(guests ? (['Guest'] as const) : []), ...(offline ? (['Offline'] as const) : [])];
  const countOf = (f: Filter) => (f === 'All' ? online.length : f === 'Guest' ? guests : f === 'Offline' ? offline : counts.find(([x]) => x === f)?.[1] ?? 0);
  const traffic = all.some((c) => c.packetsSent !== undefined || c.packetsReceived !== undefined);
  const matched = online.filter((c) => knownOf(c)).length;

  return (
    <section className="card net-dev-main">
      <header className="card-head">
        <Icon name="devices" size={18} />
        <h2>Connected devices</h2>
        <span className="muted small">
          {shown.length} of {filter === 'Offline' ? offline : online.length}
        </span>
      </header>
      <input className="net-search" placeholder="Search by name, IP, MAC or room" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips-row net-filter">
        {filters.map((f) => (
          <button key={f} className={`chip-btn small ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f} {countOf(f)}
          </button>
        ))}
        <span className="net-sort">
          {SORTS.map(([id, label]) => (
            <button key={id} className={`chip-btn small ${sort === id ? 'active' : ''}`} onClick={() => setSort(id)}>
              {label}
            </button>
          ))}
        </span>
      </div>
      <ul className="net-flat">
        {shown.map((c) => (
          <DeviceRow
            key={c.entity}
            c={c}
            known={knownOf(c)}
            needle={needle}
            naming={namingOf(c)}
            open={needle ? !closed.has(c.entity) : open === c.entity}
            onToggle={() => {
              if (!needle) return setOpen(open === c.entity ? null : c.entity);
              const next = new Set(closed);
              if (next.has(c.entity)) next.delete(c.entity);
              else next.add(c.entity);
              setClosed(next);
            }}
          />
        ))}
        {!shown.length && <li className="muted">{all.length ? 'No devices match.' : 'The router reports no devices.'}</li>}
      </ul>
      <p className="muted small net-dev-note">
        {!registry
          ? registryError()
            ? `Couldn’t read Home Assistant’s device list (${registryError()}), so devices show the router’s names.`
            : 'Reading Home Assistant’s device list…'
          : !registry.devices.some((d) => d.macs?.length || d.identifiers?.length)
            ? `Home Assistant’s device list (${registry.devices.length} devices) came back without MAC addresses, so nothing can be matched.`
            : `${matched} of ${online.length} matched to Home Assistant devices (by MAC, ID or serial number).`}
        {traffic ? '' : ' This router reports no traffic per device, only the whole home’s speed.'}
      </p>
    </section>
  );
}

// The popup ("Devices first", the owner's pick on 2026-10-26 over one page in
// two columns and Internet/Devices/Router tabs): every connected device,
// searchable and filtered by band, with the internet, the router and Wi-Fi in a
// column beside it. Restart router sits in the header.
// Speed test (a Speedtest.net or Fast.com integration, found by itself;
// lib/network.ts findSpeedTest). Running one asks HA to update the download
// sensor: the integration measures download, upload and ping together and the
// service call returns when it's done (~30 s; given up after 2 min). Shared by
// the card and the popup, so both say "Testing…".
let testing = false;
const testListeners = new Set<() => void>();
const setTesting = (on: boolean) => {
  testing = on;
  testListeners.forEach((l) => l());
};
const subscribeTesting = (l: () => void) => {
  testListeners.add(l);
  return () => testListeners.delete(l);
};

function useSpeedTest(st?: SpeedTest) {
  const hass = useHass();
  const [dl, ul, ping] = useEntities(useMemo(() => [st?.download, st?.upload, st?.ping].filter((x): x is string => !!x), [st]));
  const running = useSyncExternalStore(subscribeTesting, () => testing);
  const byId = (id?: string) => [dl, ul, ping].find((e) => e && e.entity_id === id);
  const down = mbps(byId(st?.download));
  const up = mbps(byId(st?.upload));
  const latency = num(byId(st?.ping));
  const at = byId(st?.download)?.last_updated;
  const run = () => {
    if (!st?.download || testing) return;
    setTesting(true);
    const cap = window.setTimeout(() => setTesting(false), 120_000);
    hass
      .callService('homeassistant', 'update_entity', { entity_id: [st.download] })
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(cap);
        setTesting(false);
      });
  };
  return { down, up, latency, at, running, run, server: byId(st?.download)?.attributes.server_name as string | undefined };
}

function RunTest({ test, label = false }: { test: ReturnType<typeof useSpeedTest>; label?: boolean }) {
  return (
    <button className={`net-test-run ${label ? 'labelled' : ''}`} onClick={test.run} disabled={test.running} aria-label="Run a speed test" title="Run a speed test">
      <Icon name="refresh" size={label ? 18 : 16} className={test.running ? 'spin' : undefined} />
      {label && <span>{test.running ? 'Testing…' : 'Run speed test'}</span>}
    </button>
  );
}

// The card's line: the last result and when, with a button to run one.
function SpeedTestLine({ st }: { st: SpeedTest }) {
  const t = useSpeedTest(st);
  const has = t.down !== undefined;
  return (
    <div className="net-test">
      <div className="net-test-main">
        <span className="net-test-label">
          <Icon name="speed" size={15} />
          <span className="label">Speed test</span>
          {!t.running && has && <span className="muted small">· {relTime(t.at)}</span>}
        </span>
        {t.running ? (
          <span className="net-test-val muted">Testing… about 30 s</span>
        ) : has ? (
          <span className="net-test-val">
            <Icon name="download" size={14} />
            <b>{fmtRate(t.down).split(' ')[0]}</b>
            {t.up !== undefined && (
              <>
                <Icon name="upload" size={14} />
                <b>{fmtRate(t.up).split(' ')[0]}</b>
              </>
            )}
            <span className="muted">Mbps{t.latency !== undefined ? ` · ${Math.round(t.latency)} ms` : ''}</span>
          </span>
        ) : (
          <span className="net-test-val muted">No result yet</span>
        )}
      </div>
      <RunTest test={t} />
    </div>
  );
}

// The popup's card: the last result in full, the server, and Run.
function SpeedTestCard({ st }: { st: SpeedTest }) {
  const t = useSpeedTest(st);
  return (
    <section className="card">
      <header className="card-head">
        <Icon name="gauge" size={18} />
        <h2>Speed test</h2>
        {t.at && !t.running && <span className="muted small">{relTime(t.at)}</span>}
      </header>
      {t.running ? (
        <p className="muted net-test-busy">Testing… the connection is busy for about 30 seconds.</p>
      ) : t.down === undefined ? (
        <p className="muted">No result yet.</p>
      ) : (
        <div className="net-test-tiles">
          <span>
            <small className="label">Download</small>
            <b>{fmtRate(t.down)}</b>
          </span>
          {t.up !== undefined && (
            <span>
              <small className="label">Upload</small>
              <b>{fmtRate(t.up)}</b>
            </span>
          )}
          {t.latency !== undefined && (
            <span>
              <small className="label">Ping</small>
              <b>{Math.round(t.latency)} ms</b>
            </span>
          )}
        </div>
      )}
      {t.server && !t.running && <p className="muted small">Server: {t.server}</p>}
      <RunTest test={t} label />
    </section>
  );
}

function NetworkDetail({ net }: { net: NetworkFound }) {
  const { wan } = net;
  const down = mbps(useEntity(wan.download_speed));
  const up = mbps(useEntity(wan.upload_speed));
  const uptime = num(useEntity(wan.uptime));
  const hist = useSpeedHistory([wan.download_speed]);
  const usage = useUsage(wan.data_received, wan.data_sent);
  const monthStart = new Date(new Date().setHours(0, 0, 0, 0)).setDate(1);
  const month = usage?.days.filter((d) => d.start >= monthStart).reduce((s, d) => s + d.down + d.up, 0);
  const [filter, setFilter] = useState<Filter>('All');
  const pick = (f: Filter) => {
    setFilter(f);
    document.querySelector('.net-dev-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="net-detail net-cols wide-left">
      <NetworkMap net={net} onPick={pick} />
      <DeviceList filter={filter} setFilter={setFilter} />
      <div className="net-col">
        {(wan.download_speed || wan.upload_speed) && (
          <section className="card">
            <header className="card-head">
              <Icon name="speed" size={18} />
              <h2>Internet</h2>
              {uptime !== undefined && <span className="muted small">up {fmtUptime(uptime)}</span>}
            </header>
            <Speeds down={down} up={up} />
            {wan.download_speed && <Sparkline points={hist[wan.download_speed] ?? []} hours={HOURS} height={44} color="var(--accent-fan)" />}
            <div className="chips-row">
              {usage?.today && <span className="chip">Today {fmtBytes(usage.today.down + usage.today.up)}</span>}
              {month !== undefined && <span className="chip">This month {fmtBytes(month)}</span>}
            </div>
          </section>
        )}
        {net.speedTest && <SpeedTestCard st={net.speedTest} />}
        <RouterCard net={net} />
        <WifiCard router={net.router} />
      </div>
    </div>
  );
}

// The popup's device list as a card of its own (tablet and desktop Energy
// page, under the network card): search, filters, details and naming.
export function NetworkDevicesPanel() {
  const [filter, setFilter] = useState<Filter>('All');
  return (
    <section className="panel panel-wrap network-devices-panel">
      <DeviceList filter={filter} setFilter={setFilter} />
    </section>
  );
}

// A round number at or above v for a gauge's scale: 10, 20, 25, 50, 100, 200, ...
function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  return ([1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p) || 10;
}

// A half-ring speedometer scaled to the busiest stretch of the last 24 h.
function SpeedGauge({ label, value, peak, color }: { label: string; value?: number; peak?: number; color: string }) {
  const max = niceMax(Math.max(peak ?? 0, value ?? 0, 1));
  const f = value === undefined ? 0 : Math.min(1, value / max);
  const len = Math.PI * 52;
  const [num, unit] = fmtRate(value).split(' ');
  return (
    <div className="net-gauge-half">
      <svg viewBox="0 0 124 70" aria-hidden>
        <path d="M 10 64 A 52 52 0 0 1 114 64" className="net-gauge-track" />
        <path d="M 10 64 A 52 52 0 0 1 114 64" className="net-gauge-arc" style={{ stroke: color, strokeDasharray: `${len * f} ${len}` }} />
      </svg>
      <div className="net-gauge-val">
        <strong>{num}</strong>
        {unit && <small>{unit}</small>}
      </div>
      <div className="net-gauge-label">
        <span className="label">{label}</span>
        <span className="muted small">of {max} Mbps</span>
      </div>
    </div>
  );
}

// The card (the owner asked on 2026-10-26 for the "Gauges" and "Devices"
// designs combined): two speedometers, then who's connected by band and
// type, then today's data, uptime and router load in one line.
export function NetworkPanel() {
  const modal = useModal();
  const net = useNetwork();
  const { router, wan } = net;
  const link = useEntity(wan.wan_status ?? NETWORK.wan);
  const down = mbps(useEntity(wan.download_speed));
  const up = mbps(useEntity(wan.upload_speed));
  const uptime = num(useEntity(wan.uptime));
  const total = num(useEntity(router.total_clients));
  const cpu = num(useEntity(router.cpu_used));
  const clients = useClients();
  const hist = useSpeedHistory([wan.download_speed, wan.upload_speed]);
  const usage = useUsage(wan.data_received, wan.data_sent);
  // Only the unusual shows on the card: a main Wi-Fi band that is off.
  const mainWifi = useMemo(() => wifiSwitches(router).filter((w) => w.main), [router]);
  const wifiStates = useEntities(useMemo(() => mainWifi.map((w) => w.entity), [mainWifi]));
  const offline = link !== undefined && !isUnavailable(link) && !isOn(link);
  const nothing = !Object.keys(router).length && !Object.keys(wan).length;
  // The gauges' scale: the 24 h 95th percentile, so one burst doesn't flatten them.
  const p95 = (id?: string) => {
    const v = id ? (hist[id] ?? []).map((p) => p.v).sort((a, b) => a - b) : [];
    return v.length ? v[Math.floor((v.length - 1) * 0.95)] : undefined;
  };
  const bands = BAND_ORDER.map((b) => [b, clients.filter((c) => c.band === b).length] as const).filter(([, n]) => n);
  const guests = clients.filter((c) => c.guest).length;
  const families = clientGroups(clients).slice(0, 5);
  const devices = total ?? clients.length;

  return (
    <section className="panel network-panel">
      <PanelHead
        label="Network"
        summary={offline ? 'Internet down' : undefined}
        summaryClass={offline ? 'warn' : undefined}
        onMore={
          nothing
            ? undefined
            : () =>
                modal.open({
                  title: 'Network',
                  icon: 'router',
                  accent: 'var(--accent-fan)',
                  wide: true,
                  subtitle: offline ? 'Internet down' : 'Online',
                  aside: router.reboot ? <RestartRouter entity={router.reboot} /> : undefined,
                  body: <NetworkDetail net={net} />,
                })
        }
      />
      {nothing ? (
        <p className="muted">No router found. Add a router or UPnP/IGD integration in Home Assistant.</p>
      ) : (
        <>
          {(wan.download_speed || wan.upload_speed) && (
            <div className="net-gauges">
              <SpeedGauge label="Download" value={down} peak={p95(wan.download_speed)} color="var(--accent-fan)" />
              <SpeedGauge label="Upload" value={up} peak={p95(wan.upload_speed)} color="var(--accent-switch)" />
            </div>
          )}
          {net.speedTest && <SpeedTestLine st={net.speedTest} />}
          {devices > 0 && (
            <div className="net-dev">
              <div className="net-dev-head">
                <strong>{devices}</strong>
                <span className="muted">devices online{guests ? ` · ${guests} guest` : ''}</span>
              </div>
              {bands.length > 0 && (
                <>
                  <span className="net-band-bar" aria-hidden>
                    {bands.map(([b, n]) => (
                      <i key={b} style={{ flexGrow: n, background: BAND_COLORS[b] }} />
                    ))}
                  </span>
                  <div className="net-band-legend">
                    {bands.map(([b, n]) => (
                      <span key={b}>
                        <i style={{ background: BAND_COLORS[b] }} />
                        {b} {n}
                      </span>
                    ))}
                  </div>
                  <div className="chips-row">
                    {families.map((g) => (
                      <span key={g.family} className="chip">
                        {g.clients.length > 1 ? `${g.family} ×${g.clients.length}` : g.clients[0].name}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="net-dev-foot">
            {usage?.today && <span>Today {fmtBytes(usage.today.down + usage.today.up)}</span>}
            {uptime !== undefined && <span>Up {fmtUptime(uptime)}</span>}
            {cpu !== undefined && <span className={cpu >= 85 ? 'warn-text' : ''}>CPU {Math.round(cpu)}%</span>}
          </div>
          {mainWifi.some((_, i) => wifiStates[i] && !isUnavailable(wifiStates[i]) && !isOn(wifiStates[i])) && (
            <div className="chips-row">
              {mainWifi.map((w, i) =>
                wifiStates[i] && !isUnavailable(wifiStates[i]) && !isOn(wifiStates[i]) ? (
                  <span key={w.entity} className="chip warn">
                    <Icon name="wifiOff" size={14} />
                    Wi-Fi {w.label} off
                  </span>
                ) : null,
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Home page tile (GlancePanel): download now, filled against the last speed
// test (how busy the line is); red "Down" when the internet is down.
export function NetworkTile() {
  const net = useNetwork();
  const { router, wan } = net;
  const link = useEntity(wan.wan_status ?? NETWORK.wan);
  const down = mbps(useEntity(wan.download_speed));
  const total = num(useEntity(router.total_clients));
  const clients = useClients();
  const test = mbps(useEntity(net.speedTest?.download));
  if (!Object.keys(router).length && !Object.keys(wan).length) return null;
  const offline = link !== undefined && !isUnavailable(link) && !isOn(link);
  const devices = total ?? clients.length;
  return (
    <GlanceTile
      icon="internet"
      label="Internet"
      page="energy"
      color="var(--accent-fan)"
      tone={offline ? 'bad' : undefined}
      level={offline ? 100 : down !== undefined && test ? (down / test) * 100 : undefined}
      fill={offline ? 'var(--danger)' : 'var(--accent-fan)'}
      text={offline}
      value={offline ? 'Down' : fmtRate(down).split(' ')[0]}
      unit={offline ? undefined : 'Mbps'}
      sub={[devices ? `${devices} devices` : undefined, test !== undefined ? `of ${Math.round(test)}` : undefined].filter(Boolean).join(' · ')}
    />
  );
}
