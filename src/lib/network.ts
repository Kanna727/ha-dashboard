import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import type { RegistrySnapshot } from '../ha/api';
import { deviceRoles, idsByDevice } from './deviceRoles';

// Keys a router integration gives its device (client counts, load, Wi-Fi and
// VPN switches, reboot) and the ones a UPnP/IGD gateway gives (WAN link, live
// speeds, byte counters). Both are found by these keys; nothing to configure.
export const ROUTER_KEYS = [
  'total_clients',
  'total_main_wifi_clients',
  'total_guest_wifi_clients',
  'total_iot_wifi_clients',
  'total_wired_clients',
  'cpu_used',
  'memory_used',
  'dhcp_reservations',
  'total_openvpn_clients',
  'total_pptp_clients',
  'wan_ipv4_address',
  'lan_ipv4_address',
  'reboot',
  'router_data_fetching',
  'wifi_2_4g',
  'wifi_5g',
  'wifi_6g',
  'guest_wifi_2_4g',
  'guest_wifi_5g',
  'guest_wifi_6g',
  'iot_wifi_2_4g',
  'iot_wifi_5g',
  'iot_wifi_6g',
  'vpn_server_openvpn',
  'vpn_server_pptp',
  'vpn_server_ipsec',
] as const;

export const WAN_KEYS = [
  'wan_status',
  'download_speed',
  'upload_speed',
  'data_received',
  'data_sent',
  'packet_download_speed',
  'packet_upload_speed',
  'packets_received',
  'packets_sent',
  'uptime',
  'external_ip',
] as const;

export type RouterRoles = Partial<Record<(typeof ROUTER_KEYS)[number], string>>;
export type WanRoles = Partial<Record<(typeof WAN_KEYS)[number], string>>;

export interface NetworkFound {
  router: RouterRoles;
  routerName?: string;
  wan: WanRoles;
  speedTest?: SpeedTest;
}

// A speed test integration's sensors: Speedtest.net (`speedtestdotnet`:
// download, upload, ping) or Fast.com (`fastdotcom`: download, and in newer
// versions upload and ping).
export interface SpeedTest {
  download?: string;
  upload?: string;
  ping?: string;
}
const SPEED_TEST_PLATFORMS = ['speedtestdotnet', 'fastdotcom'];

export function findSpeedTest(r: RegistrySnapshot): SpeedTest | undefined {
  const ids = r.entities.filter((e) => SPEED_TEST_PLATFORMS.includes(e.platform) && e.entityId.startsWith('sensor.')).map((e) => e.entityId);
  const role = (re: RegExp) => ids.find((id) => re.test(id));
  const found: SpeedTest = { download: role(/download$/), upload: role(/upload$/), ping: role(/(ping|latency)$/) };
  return found.download ? found : undefined;
}

// The router: the device of `routerEntity` if given, else the device with a
// "total clients" sensor. The gateway: the device of `wanEntity` (the WAN
// status in the config), else one with download speed and byte counters.
export function findNetwork(r: RegistrySnapshot, wanEntity?: string, routerEntity?: string): NetworkFound {
  const byDevice = idsByDevice(r.entities);
  const deviceOf = (id?: string) => (id ? r.entities.find((e) => e.entityId === id)?.deviceId : undefined);
  const has = (ids: string[], key: string) => ids.some((id) => id.endsWith(`_${key}`));

  const routerId =
    deviceOf(routerEntity) ?? [...byDevice].find(([, ids]) => ids.some((id) => id.startsWith('sensor.') && id.endsWith('_total_clients')))?.[0];
  const wanId = deviceOf(wanEntity) ?? [...byDevice].find(([, ids]) => has(ids, 'download_speed') && has(ids, 'data_received'))?.[0];

  return {
    router: routerId ? deviceRoles(byDevice.get(routerId) ?? [], ROUTER_KEYS) : {},
    routerName: r.devices.find((d) => d.id === routerId)?.name,
    wan: wanId ? deviceRoles(byDevice.get(wanId) ?? [], WAN_KEYS) : {},
    speedTest: findSpeedTest(r),
  };
}

// Wi-Fi switches on the router, main bands first: { key, entity, label, guest }.
export function wifiSwitches(router: RouterRoles) {
  return Object.entries(router)
    .filter(([k, id]) => id?.startsWith('switch.') && /(^|_)wifi_/.test(k))
    .map(([k, id]) => {
      const band = k.replace(/^.*wifi_/, '').replace('_', '.').replace(/g$/, ' GHz');
      const kind = k.startsWith('guest_') ? 'Guest' : k.startsWith('iot_') ? 'IoT' : '';
      return { key: k, entity: id!, label: kind ? `${kind} ${band}` : band, main: !kind };
    })
    .sort((a, b) => Number(b.main) - Number(a.main) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

// VPN servers on the router: { entity, label } (status only).
export function vpnSwitches(router: RouterRoles) {
  return Object.entries(router)
    .filter(([k, id]) => id?.startsWith('switch.') && k.startsWith('vpn_server_'))
    .map(([k, id]) => ({ entity: id!, label: k.replace('vpn_server_', '').replace('openvpn', 'OpenVPN').replace(/^(pptp|ipsec)$/, (s) => (s === 'ipsec' ? 'IPsec' : 'PPTP')) }));
}

const RATE_MBPS: Record<string, number> = {
  'bit/s': 1e-6,
  'kbit/s': 1e-3,
  'Mbit/s': 1,
  'Gbit/s': 1e3,
  'B/s': 8e-6,
  'kB/s': 8e-3,
  'KiB/s': (8 * 1024) / 1e6,
  'MB/s': 8,
  'MiB/s': (8 * 1024 * 1024) / 1e6,
};
const SIZE_BYTES: Record<string, number> = {
  B: 1,
  kB: 1e3,
  KB: 1e3,
  KiB: 1024,
  MB: 1e6,
  MiB: 1024 ** 2,
  GB: 1e9,
  GiB: 1024 ** 3,
  TB: 1e12,
  TiB: 1024 ** 4,
};

// A data-rate reading in Mbit/s (undefined for an unknown unit).
export const toMbps = (v: number, unit: unknown) => (typeof unit === 'string' && unit in RATE_MBPS ? v * RATE_MBPS[unit] : undefined);
export const bytesPer = (unit: unknown) => (typeof unit === 'string' && unit in SIZE_BYTES ? SIZE_BYTES[unit] : undefined);

// "820 kbps", "12.4 Mbps", "312 Mbps".
export function fmtRate(mbps: number | undefined): string {
  if (mbps === undefined || !Number.isFinite(mbps)) return '–';
  if (mbps < 1) return `${Math.round(mbps * 1000)} kbps`;
  return `${mbps < 100 ? mbps.toFixed(1) : Math.round(mbps)} Mbps`;
}

// "640 MB", "4.2 GB", "1.31 TB" (decimal units, as ISPs count).
export function fmtBytes(b: number | undefined): string {
  if (b === undefined || !Number.isFinite(b)) return '–';
  if (b < 1e6) return `${Math.round(b / 1e3)} kB`;
  if (b < 1e9) return `${Math.round(b / 1e6)} MB`;
  if (b < 1e12) return `${(b / 1e9).toFixed(b < 1e10 ? 1 : 0)} GB`;
  return `${(b / 1e12).toFixed(2)} TB`;
}

// "5 h 20 m", "3 days", "200 days".
export function fmtUptime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '–';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} m`;
  const d = Math.floor(seconds / 86400);
  return `${d} day${d === 1 ? '' : 's'}`;
}

export type Band = '2.4 GHz' | '5 GHz' | '6 GHz' | 'Wired' | 'Other';

export interface Client {
  entity: string;
  name: string;
  band: Band;
  guest: boolean;
  family: string;
  online: boolean; // the tracker is home (connected now)
  since?: string; // when it connected (or was last seen, when offline): the tracker's last_changed
  ip?: string;
  mac?: string; // lower case, colon-separated
  // Only some routers report these per device; undefined when they don't.
  packetsSent?: number;
  packetsReceived?: number;
  signal?: number; // dBm
}

const BANDS: Record<string, Band> = { '2G': '2.4 GHz', '2.4G': '2.4 GHz', '5G': '5 GHz', '6G': '6 GHz' };

// "wiz_3d7904" → "Wiz", "SwitchBot-Hub-2-302DAC" → "SwitchBot Hub 2": the
// name without a trailing serial (a hex or numeric tail containing a digit).
export function clientFamily(name: string): string {
  const serial = name.replace(/[-_ ](?=[0-9a-f]*\d)[0-9a-f]{4,}$/i, '');
  const base = (serial !== name ? serial : name.replace(/[-_ ]\d+$/, '')).replace(/[-_]+/g, ' ').trim() || name;
  return base === base.toLowerCase() ? base.charAt(0).toUpperCase() + base.slice(1) : base;
}

// Devices connected to the router right now: router-sourced device trackers
// that are home, with their band from the integration's attributes.
const numOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(+v) ? +v : undefined);
const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

// Mesh node trackers (EasyMesh/Deco: the router integration gives each node,
// the main router included, a tracker with `device_type`/`device_model`/
// `connection_type`, a 1–3 bar `signal_level` for its uplink, its client count
// and the MAC it uplinks through). Not clients.
const isNode = (s: HassEntity) => s.attributes.device_model !== undefined || s.attributes.device_type !== undefined;

// With `offline`, also the ones the router has seen before that aren't connected now.
export function routerClients(states: HassEntities, offline = false): Client[] {
  return Object.values(states)
    .filter((s: HassEntity) => s.entity_id.startsWith('device_tracker.') && s.attributes.source_type === 'router' && !isNode(s) && (s.state === 'home' || offline))
    .map((s) => {
      const a = s.attributes;
      const conn = String(a.connection ?? '').toLowerCase();
      const band: Band = conn === 'wired' ? 'Wired' : BANDS[String(a.band ?? '').toUpperCase()] ?? 'Other';
      const name = String(a.host_name && a.host_name !== 'Unknown' ? a.host_name : a.friendly_name ?? s.entity_id);
      const mac = typeof a.mac === 'string' && a.mac ? formatMac(a.mac) : undefined;
      return {
        entity: s.entity_id,
        name,
        band,
        guest: conn.includes('guest'),
        family: clientFamily(name),
        online: s.state === 'home',
        since: s.last_changed || undefined,
        ip: typeof a.ip === 'string' && a.ip ? a.ip : undefined,
        mac,
        packetsSent: numOf(a.packets_sent),
        packetsReceived: numOf(a.packets_received),
        signal: numOf(a.signal ?? a.signal_strength ?? a.rssi),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export interface MeshNode {
  entity: string;
  name: string;
  model?: string;
  main: boolean; // the main router (controller), the root of the map
  mac?: string;
  uplinkMac?: string; // the node it connects through
  uplink?: string; // how: "Wired", "5G", ...
  signal?: number; // uplink bars: 1–3 on newer firmware, up to 5 on some
  clients?: number;
  online: boolean;
}

// Mesh nodes from their trackers (the TP-Link router integration names them
// `role`, `is_main_router`, `parent_mac`, `client_num`, `signal_level`; other
// integrations differ, so the uplink MAC is any MAC-valued attribute whose key
// mentions uplink/parent/backhaul and the client count any numeric one whose
// key mentions client).
export function meshNodes(states: HassEntities): MeshNode[] {
  return Object.values(states)
    .filter((s) => s.entity_id.startsWith('device_tracker.') && isNode(s))
    .map((s) => {
      const a = s.attributes;
      const entries = Object.entries(a);
      const uplinkMac = entries.find(([k, v]) => /uplink|parent|backhaul/i.test(k) && typeof v === 'string' && MAC_RE.test(v))?.[1] as string | undefined;
      const clients = entries.map(([k, v]) => (/client/i.test(k) ? numOf(v) : undefined)).find((v) => v !== undefined);
      const role = `${a.device_type ?? ''} ${a.role ?? ''}`.toLowerCase(); // EasyMesh: main_router / satellite_router; Deco: master / slave
      const conn = String(a.connection_type ?? a.uplink_type ?? '');
      return {
        entity: s.entity_id,
        name: String(a.host_name || a.friendly_name || s.entity_id),
        model: a.device_model ? String(a.device_model) : undefined,
        main: a.is_main_router === true || /main|master|root|controller|gateway/.test(role) || (!uplinkMac && /wan|internet/i.test(conn)),
        mac: typeof a.mac === 'string' && a.mac ? formatMac(a.mac) : undefined,
        uplinkMac: uplinkMac ? formatMac(uplinkMac) : undefined,
        uplink: conn ? conn.replace(/^band/i, '').replace(/_/g, ' ').trim() || undefined : undefined,
        signal: numOf(a.signal_level),
        clients,
        online: s.state === 'home',
      };
    })
    .sort((a, b) => Number(b.main) - Number(a.main) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export interface MapNode {
  node: MeshNode;
  parent?: string; // entity of the node it hangs from
  level: number; // 0 = the main router
}

// Mesh nodes as a tree for the map: the main router (or a node with no known
// uplink) at level 0, every other node below the node whose MAC it uplinks
// through. A node whose uplink isn't among the nodes hangs from the root.
export function meshTree(nodes: MeshNode[]): MapNode[] {
  if (!nodes.length) return [];
  const root = nodes.find((n) => n.main) ?? nodes.find((n) => !n.uplinkMac) ?? nodes[0];
  const byMac = new Map(nodes.filter((n) => n.mac).map((n) => [n.mac!, n]));
  const out: MapNode[] = [{ node: root, level: 0 }];
  const placed = new Set([root.entity]);
  let frontier = [root];
  for (let level = 1; frontier.length && level < 8; level++) {
    const next: MeshNode[] = [];
    for (const n of nodes) {
      if (placed.has(n.entity)) continue;
      const parent = n.uplinkMac ? byMac.get(n.uplinkMac) : undefined;
      const under = frontier.find((f) => f === parent) ?? (level === 1 && (!parent || parent === n) ? root : undefined);
      if (!under) continue;
      out.push({ node: n, parent: under.entity, level });
      placed.add(n.entity);
      next.push(n);
    }
    frontier = next;
  }
  // Anything left (a loop, an uplink we can't place) hangs from the root.
  for (const n of nodes) if (!placed.has(n.entity)) out.push({ node: n, parent: root.entity, level: 1 });
  return out;
}

export interface KnownDevice {
  name: string;
  areaId: string | null;
  deviceId?: string; // the HA device, when it is one (not for an own name)
  // How it was matched: the MAC as a device connection; the MAC inside an
  // identifier or serial number, or the device's ID in the router's host name;
  // or a likely match (the same last 3 bytes of the MAC), unique among devices.
  // No "MAC a few steps off" rule: devices from one batch (WiZ) have near MACs.
  via: 'mac' | 'id' | 'likely' | 'manual';
}

// Names the owner gave clients in the network popup, by MAC: either an HA
// device to treat it as, or a name (and room) of its own.
export interface ClientName {
  device?: string; // HA device id
  name?: string;
  area?: string; // area id
}
export type ClientNames = Record<string, ClientName>;

// The stored document ({ clients: { mac: … } }), keeping only well-formed entries.
export function parseClientNames(doc: unknown): ClientNames {
  const raw = (doc as { clients?: unknown } | null)?.clients;
  if (!raw || typeof raw !== 'object') return {};
  const out: ClientNames = {};
  for (const [mac, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const { device, name, area } = v as Record<string, unknown>;
    const entry: ClientName = {};
    if (typeof device === 'string' && device) entry.device = device;
    if (typeof name === 'string' && name.trim()) entry.name = name.trim();
    if (typeof area === 'string' && area) entry.area = area;
    if (entry.device || entry.name) out[formatMac(mac)] = entry;
  }
  return out;
}

// The owner's names over the automatic matches: a named client always shows
// its name (an HA device that no longer exists falls back to the automatic match).
export function withNames(auto: Map<string, KnownDevice>, clients: Client[], names: ClientNames, r: RegistrySnapshot | undefined): Map<string, KnownDevice> {
  const out = new Map(auto);
  for (const c of clients) {
    const n = c.mac ? names[c.mac] : undefined;
    if (!n) continue;
    const d = n.device ? r?.devices.find((x) => x.id === n.device) : undefined;
    if (d) out.set(c.entity, { name: d.name, areaId: d.areaId, deviceId: d.id, via: 'manual' });
    else if (n.name) out.set(c.entity, { name: n.name, areaId: n.area ?? null, via: 'manual' });
  }
  return out;
}

// MAC-like runs in a string, lower case without separators: a MAC written with
// : or - between all six pairs, or an unbroken run of 8+ hex digits
// ("BOSCH-SMV6ZCX49E-68A40E5A1D2B" → ["68a40e5a1d2b"]).
export function hexRuns(s: string): string[] {
  return (s.match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{8,}/gi) ?? []).map((m) => m.replace(/[:-]/g, '').toLowerCase());
}

// HA devices for the router's clients, so a client the router calls
// "wiz_3d7904" shows as the device it is ("PC", Workroom). Integrations record
// the MAC differently: as a connection (WiZ, ESPHome, Dreame), inside an
// identifier (Home Connect's appliance ID ends with it, SwitchBot's device ID
// is a MAC) or as the serial number (many Matter devices). The router
// integration's own per-client devices carry the same MAC, so the trackers'
// devices are skipped. Most certain first; a likely match must be unique.
export function matchClients(r: RegistrySnapshot, clients: Client[]): Map<string, KnownDevice> {
  const skip = new Set(r.entities.filter((e) => clients.some((c) => c.entity === e.entityId)).map((e) => e.deviceId));
  const devices = r.devices
    .filter((d) => !skip.has(d.id) && !d.disabled)
    .map((d) => ({
      d,
      conns: (d.macs ?? []).map((m) => m.replace(/[:-]/g, '').toLowerCase()),
      runs: [...(d.identifiers ?? []), d.serial ?? ''].flatMap(hexRuns),
    }));
  const out = new Map<string, KnownDevice>();
  for (const c of clients) {
    const mac = c.mac?.replace(/:/g, '');
    if (!mac || mac.length !== 12) continue;
    const put = (x: (typeof devices)[number], via: KnownDevice['via']) => out.set(c.entity, { name: x.d.name, areaId: x.d.areaId, deviceId: x.d.id, via });
    const exact = devices.find((x) => x.conns.includes(mac));
    if (exact) {
      put(exact, 'mac');
      continue;
    }
    const inId = devices.find((x) => x.runs.some((h) => h.includes(mac)));
    if (inId) {
      put(inId, 'id');
      continue;
    }
    // The router's host name carries the device's ID (Home Connect appliances
    // call themselves "<brand>-<type>-<appliance id>").
    const host = c.name.toLowerCase();
    const named = devices.find((x) => (x.d.identifiers ?? []).some((id) => id.length >= 8 && /\d/.test(id) && host.includes(id.toLowerCase())));
    if (named) {
      put(named, 'id');
      continue;
    }
    const tail = mac.slice(6);
    const likely = devices.filter((x) => [...x.conns, ...x.runs].some((h) => h.length >= 8 && h !== mac && h.endsWith(tail)));
    if (likely.length === 1) put(likely[0], 'likely');
  }
  return out;
}

// "02-00-5E-00-00-10" / "02005e000010" → "02:00:5e:00:00:10"; anything else unchanged (lower case).
export function formatMac(mac: string): string {
  const hex = mac.toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.length === 12 ? hex.match(/../g)!.join(':') : mac.toLowerCase();
}

// "192.168.1.9" before "192.168.1.10"; missing last.
export function compareIp(a?: string, b?: string): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// Clients grouped by family, biggest group first.
export function clientGroups(clients: Client[]): { family: string; clients: Client[] }[] {
  const m = new Map<string, Client[]>();
  for (const c of clients) m.set(c.family, [...(m.get(c.family) ?? []), c]);
  return [...m]
    .map(([family, list]) => ({ family, clients: list }))
    .sort((a, b) => b.clients.length - a.clients.length || a.family.localeCompare(b.family));
}
