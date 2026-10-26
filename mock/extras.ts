import type { HassEntity } from 'home-assistant-js-websocket';
import type { HistoryPoint, RegistryDevice, RegistryEntity, StatChange, StatPoint } from '../src/ha/api';

// The fictional home's health devices, router, internet gateway and battery
// devices, for the Health, Network and Batteries panels (all discovered from
// the registry), plus their statistics and history for the charts.
const now = new Date().toISOString();
const DAY = 86_400_000;

function e(entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  return { entity_id, state, attributes, last_changed: now, last_updated: now, context: { id: 'mock', parent_id: null, user_id: null } };
}

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

type Reading = [key: string, state: string, attrs?: Record<string, unknown>];
const kg = { unit_of_measurement: 'kg', device_class: 'weight', state_class: 'measurement' };
const pct = { unit_of_measurement: '%', state_class: 'measurement' };
const hours = { unit_of_measurement: 'h', device_class: 'duration', state_class: 'measurement' };
const bpm = { unit_of_measurement: 'bpm', state_class: 'measurement' };

const scale = (who: string, w: string, fat: string, muscle: string, bmi: string): Reading[] => [
  ['weight', w, kg],
  ['target_weight', who === 'alex' ? '78.0' : 'unknown', kg],
  ['body_fat', fat, pct],
  ['muscle_mass', muscle, kg],
  ['bmi', bmi, { unit_of_measurement: 'kg/m²', state_class: 'measurement' }],
  ['water_percentage', who === 'alex' ? '54.2' : '50.8', pct],
  ['bone_mass', who === 'alex' ? '3.2' : '2.4', kg],
  ['bmr', who === 'alex' ? '1780' : '1340', { unit_of_measurement: 'kcal/day', state_class: 'measurement' }],
  ['visceral_fat', who === 'alex' ? '9' : '5', { unit_of_measurement: 'level', state_class: 'measurement' }],
];

const BAND: Reading[] = [
  ['weight', '82.6', kg],
  ['recovery_score', '72', pct],
  ['hrv', '61.3', { unit_of_measurement: 'ms', state_class: 'measurement' }],
  ['resting_heart_rate', '58', bpm],
  ['spo2', '96.8', pct],
  ['skin_temperature', '33.9', { unit_of_measurement: '°C', device_class: 'temperature', state_class: 'measurement' }],
  ['day_strain', '9.4', { state_class: 'measurement' }],
  ['day_calories', '2140', { unit_of_measurement: 'kcal', state_class: 'total_increasing' }],
  ['day_average_heart_rate', '74', bpm],
  ['day_max_heart_rate', '151', bpm],
  ['sleep_performance', '84', pct],
  ['sleep_efficiency', '91.2', pct],
  ['sleep_consistency', '72', pct],
  ['sleep_respiratory_rate', '15.4', { unit_of_measurement: 'rpm', state_class: 'measurement' }],
  ['sleep_time_awake', '0.6', hours],
  ['sleep_light_sleep_time', '3.4', hours],
  ['sleep_sws_time', '1.6', hours],
  ['sleep_rem_sleep_time', '1.9', hours],
  ['sleep_baseline_need', '7.8', hours],
  ['sleep_debt_need', '0.4', hours],
  ['sleep_strain_need', '0.3', hours],
  ['sleep_nap_credit', '0', hours],
  ['last_workout_strain', '11.2', { state_class: 'measurement' }],
  ['last_workout_average_hr', '138', bpm],
  ['last_workout_max_hr', '171', bpm],
  ['last_workout_calories', '520', { unit_of_measurement: 'kcal' }],
  ...[0.05, 0.15, 0.25, 0.2, 0.1, 0.02].map((h, z): Reading => [`last_workout_zone_${z}_time`, String(h), hours]),
];

// `live`: in a ride right now.
const ride = (live: boolean, level: string, progress: string, ftp: string, weight: string, score: string, cat: string, streak: string, best: string, km: string, days: string): Reading[] => [
  ['online', live ? 'True' : 'False', { device_class: 'connectivity' }],
  ['power', live ? '145' : '0', { unit_of_measurement: 'W', device_class: 'power' }],
  ['heart_rate', live ? '138' : '0', { unit_of_measurement: 'bpm' }],
  ['cadence', live ? '84' : '0', { unit_of_measurement: 'rpm' }],
  ['speed', live ? '29.4' : '0', { unit_of_measurement: 'km/h', device_class: 'speed' }],
  ['distance', live ? '12.3' : '0', { unit_of_measurement: 'km', device_class: 'distance' }],
  ['level', level],
  ['run_level', '1'],
  ['cycle_progress', progress, { unit_of_measurement: '%' }],
  ['ftp', ftp, { unit_of_measurement: 'W', device_class: 'power' }],
  ['weight', weight, { unit_of_measurement: 'kg', device_class: 'weight' }],
  ['racing_score', score],
  ['racing_category', cat],
  ['current_streak', streak, { unit_of_measurement: 'w' }],
  ['max_streak', best, { unit_of_measurement: 'w' }],
  ['total_distance', km, { unit_of_measurement: 'km', device_class: 'distance' }],
  ['total_time', days, { unit_of_measurement: 'd', device_class: 'duration' }],
];

// [device id, device name, entity prefix, readings]
const HEALTH: [string, string, string, Reading[]][] = [
  ['dev_scale_alex', 'Bathroom Scale Alex', 'bathroom_scale_alex', scale('alex', '82.4', '22.1', '60.2', '25.1')],
  ['dev_scale_sam', 'Bathroom Scale Sam', 'bathroom_scale_sam', scale('sam', '63.0', '27.4', '43.6', '22.6')],
  ['dev_band_alex', 'Band (Alex)', 'band_alex', BAND],
  ['dev_ride_alex', 'Rides Alex', 'ride_alex', ride(false, '18', '64', '212', '82', '310', 'C', '3', '9', '1840.5', '3.1')],
  ['dev_ride_sam', 'Rides Sam', 'ride_sam', ride(true, '12', '30', '150', '63', '180', 'D', '5', '5', '620.2', '1.2')],
];

// The router (client counts, load, Wi-Fi) and the internet gateway (UPnP/IGD).
const ROUTER: Reading[] = [
  ['total_clients', '15', { state_class: 'total' }],
  ['total_main_wifi_clients', '12', { state_class: 'total' }],
  ['total_guest_wifi_clients', '1', { state_class: 'total' }],
  ['total_wired_clients', '2', { state_class: 'total' }],
  ['cpu_used', '23', pct],
  ['memory_used', '41.5', pct],
  ['dhcp_reservations', '4'],
];
const ROUTER_SWITCHES: [string, string][] = [
  ['wifi_2_4g', 'on'],
  ['wifi_5g', 'on'],
  ['guest_wifi_2_4g', 'off'],
  ['guest_wifi_5g', 'on'],
  ['vpn_server_openvpn', 'off'],
];
const GATEWAY: Reading[] = [
  ['download_speed', '2400', { unit_of_measurement: 'KiB/s', device_class: 'data_rate', state_class: 'measurement' }],
  ['upload_speed', '420', { unit_of_measurement: 'KiB/s', device_class: 'data_rate', state_class: 'measurement' }],
  ['data_received', '183742960112', { unit_of_measurement: 'B', device_class: 'data_size', state_class: 'total_increasing' }],
  ['data_sent', '22372233441', { unit_of_measurement: 'B', device_class: 'data_size', state_class: 'total_increasing' }],
  ['uptime', '1234567', { unit_of_measurement: 's', device_class: 'duration' }],
];
// Speedtest.net (`speedtestdotnet`): the last result, from about 2 h ago.
const SPEEDTEST: Reading[] = [
  ['download', '94.62', { unit_of_measurement: 'Mbit/s', device_class: 'data_rate', state_class: 'measurement', server_name: 'Example City', server_country: 'Example', server_id: '1234' }],
  ['upload', '9.81', { unit_of_measurement: 'Mbit/s', device_class: 'data_rate', state_class: 'measurement', server_name: 'Example City', server_country: 'Example', server_id: '1234' }],
  ['ping', '12', { unit_of_measurement: 'ms', state_class: 'measurement', server_name: 'Example City', server_country: 'Example', server_id: '1234' }],
];
// A mock speed test: 6 s, then new results (homeassistant.update_entity on a speed test sensor).
export const SPEEDTEST_IDS = SPEEDTEST.map(([k]) => `sensor.speedtest_${k}`);
export function speedTestResult(): Record<string, string> {
  return { 'sensor.speedtest_download': (88 + Math.random() * 10).toFixed(2), 'sensor.speedtest_upload': (9 + Math.random()).toFixed(2), 'sensor.speedtest_ping': String(10 + Math.round(Math.random() * 6)) };
}
// Connected clients: [host name, band, connection]
const CLIENTS: [string, string | null, string][] = [
  ...['a1b2c3', 'a1b2d4', 'a1b2e5', 'a1b2f6', 'a1b307', 'a1b318'].map((s): [string, string, string] => [`bulb_${s}`, '2G', 'host']),
  ...['9f01aa', '9f01bb', '9f01cc'].map((s): [string, string, string] => [`plug-${s}`, '2G', 'host']),
  ['Alex-Phone', '5G', 'host'],
  ['Sam-Laptop', '5G', 'host'],
  ['Cleaner-Bot', '2G', 'host'],
  ['Guest-Tablet', '5G', 'guest'],
  ['nas', null, 'wired'],
  ['tv-box', null, 'wired'],
];
// Seen before, not connected now: [host name, band, hours since last seen]
const GONE: [string, string, number][] = [
  ['Old-Phone', '5G', 30],
  ['bulb_a1b329', '2G', 3],
];
// Fake, locally administered MACs (02:…), never real ones.
const macOf = (i: number) => `02-00-5E-00-00-${i.toString(16).padStart(2, '0').toUpperCase()}`;
// Mock HA devices that share a client's MAC, so the device list shows their
// names and rooms (lib/network.ts knownByMac).
export const MOCK_MACS: Record<string, string> = {
  dev_lr_light: '02:00:5e:00:00:00', // bulb_a1b2c3
  dev_kitchen_light: '02:00:5e:00:00:01', // bulb_a1b2d4
  dev_plug_fridge: '02:00:5e:00:00:06', // plug-9f01aa
  dev_plug_pc: '02:00:5e:00:00:07', // plug-9f01bb
  dev_robot: '02:00:5e:00:00:0b', // Cleaner-Bot
};

// Batteries around the house: [device id, name, area, entity, level]
const BATTERIES: [string, string, string | null, string, string][] = [
  ['dev_bat_front_door', 'Front Door Sensor', 'living_room', 'sensor.front_door_sensor_battery', '64'],
  ['dev_bat_bath_door', 'Bathroom Door Sensor', 'common_bathroom', 'sensor.bathroom_door_sensor_battery', '81'],
  ['dev_bat_bed_button', 'Bedroom Bedroom Button', 'bedroom', 'sensor.bedroom_bedroom_button_battery', '8'],
  ['dev_bat_motion', 'Hall Motion Sensor', 'living_room', 'sensor.hall_motion_sensor_battery', '17'],
  ['dev_bat_wheel', 'Living Room Scroll Wheel', 'living_room', 'sensor.living_room_scroll_wheel_battery', 'unavailable'],
  ['dev_bat_toothbrush', 'Toothbrush', 'master_bathroom', 'sensor.toothbrush_battery', '46'],
  ['dev_bat_phone', 'Alex Phone', null, 'sensor.alex_phone_battery_level', '54'],
];

export function extraEntities(): HassEntity[] {
  const out: HassEntity[] = [];
  for (const [, name, prefix, readings] of HEALTH) {
    for (const [k, state, attrs] of readings) out.push(e(`sensor.${prefix}_${k}`, state, { friendly_name: `${name} ${k.replace(/_/g, ' ')}`, ...attrs }));
  }
  for (const [k, state, attrs] of ROUTER) out.push(e(`sensor.home_router_${k}`, state, attrs));
  for (const [k, state] of ROUTER_SWITCHES) out.push(e(`switch.home_router_${k}`, state, { friendly_name: `Home Router ${k.replace(/_/g, ' ')}` }));
  out.push(e('button.home_router_reboot', 'unknown', { device_class: 'restart' }));
  for (const [k, state, attrs] of GATEWAY) out.push(e(`sensor.router_${k}`, state, attrs));
  const tested = new Date(Date.now() - 2 * 3_600_000).toISOString();
  for (const [k, state, attrs] of SPEEDTEST) out.push({ ...e(`sensor.speedtest_${k}`, state, attrs), last_updated: tested, last_changed: tested });
  CLIENTS.forEach(([host, band, connection], i) =>
    out.push(
      e(`device_tracker.${host.toLowerCase().replace(/-/g, '_')}`, 'home', {
        source_type: 'router',
        host_name: host,
        friendly_name: host,
        band,
        connection,
        ip: `192.0.2.${10 + i}`, // documentation range
        mac: macOf(i),
        packets_sent: null,
        packets_received: null,
      }),
    ),
  );
  // Mesh node trackers, only with ?mesh (the default mock is a single router,
  // which draws the map's band view): the main router and two satellites, one
  // on 5 GHz backhaul, one wired behind it.
  if (new URLSearchParams(globalThis.location?.search ?? '').has('mesh')) {
    const nodeMac = (n: number) => `02-00-5E-00-01-0${n}`;
    // Attribute names as the TP-Link router integration's EasyMesh trackers use them.
    const nodes: [string, string, Record<string, unknown>][] = [
      ['Home Router', 'main_router', { device_model: 'Router', connection_type: 'wan', is_main_router: true, client_num: 9 }],
      ['Hall', 'satellite_router', { device_model: 'Mesh Node', parent_mac: nodeMac(0), connection_type: 'band5', signal_level: 3, client_num: 4 }],
      ['Study', 'satellite_router', { device_model: 'Mesh Node', parent_mac: nodeMac(1), connection_type: 'wired', client_num: 2 }],
    ];
    nodes.forEach(([name, role, attrs], i) =>
      out.push(
        e(`device_tracker.mesh_${name.toLowerCase().replace(/ /g, '_')}`, 'home', { source_type: 'router', host_name: name, device_type: 'easymesh', role, mac: nodeMac(i), ...attrs }),
      ),
    );
  }
  GONE.forEach(([host, band, hours], i) => {
    const seen = new Date(Date.now() - hours * 3_600_000).toISOString();
    out.push({
      ...e(`device_tracker.${host.toLowerCase().replace(/-/g, '_')}`, 'not_home', {
        source_type: 'router',
        host_name: host,
        friendly_name: host,
        band,
        connection: 'host',
        ip: `192.0.2.${60 + i}`,
        mac: macOf(0x40 + i),
      }),
      last_changed: seen,
    });
  });
  for (const [, name, , id, level] of BATTERIES) {
    out.push(e(id, level, { device_class: 'battery', unit_of_measurement: '%', state_class: 'measurement', friendly_name: `${name} Battery` }));
  }
  out.push(e('sensor.alex_phone_battery_state', 'Charging', { friendly_name: 'Alex Phone Battery state' }));
  out.push(e('binary_sensor.front_lock_battery', 'off', { device_class: 'battery', friendly_name: 'Front Lock Battery' }));
  return out;
}

export const EXTRA_DEVICES: RegistryDevice[] = [
  ...HEALTH.map(([id, name]) => ({ id, name, areaId: null, model: null, disabled: false })),
  { id: 'dev_router', name: 'Home Router', areaId: 'living_room', model: 'Router', disabled: false },
  { id: 'dev_gateway', name: 'Gateway', areaId: 'living_room', model: 'IGD', disabled: false },
  { id: 'dev_speedtest', name: 'SpeedTest', areaId: null, model: null, disabled: false },
  ...BATTERIES.map(([id, name, area]) => ({ id, name, areaId: area, model: null, disabled: false })),
];

export const EXTRA_REGISTRY: RegistryEntity[] = [
  ...HEALTH.flatMap(([id, , prefix, readings]) => readings.map(([k]) => ({ entityId: `sensor.${prefix}_${k}`, deviceId: id, platform: 'mock_health' }))),
  ...ROUTER.map(([k]) => ({ entityId: `sensor.home_router_${k}`, deviceId: 'dev_router', platform: 'mock_router' })),
  ...ROUTER_SWITCHES.map(([k]) => ({ entityId: `switch.home_router_${k}`, deviceId: 'dev_router', platform: 'mock_router' })),
  { entityId: 'button.home_router_reboot', deviceId: 'dev_router', platform: 'mock_router', category: 'config' },
  { entityId: 'binary_sensor.router_wan_status', deviceId: 'dev_gateway', platform: 'upnp' },
  ...GATEWAY.map(([k]) => ({ entityId: `sensor.router_${k}`, deviceId: 'dev_gateway', platform: 'upnp' })),
  ...SPEEDTEST.map(([k]) => ({ entityId: `sensor.speedtest_${k}`, deviceId: 'dev_speedtest', platform: 'speedtestdotnet' })),
  ...BATTERIES.map(([dev, , , id]) => ({ entityId: id, deviceId: dev, platform: 'mock', category: 'diagnostic' })),
  { entityId: 'sensor.alex_phone_battery_state', deviceId: 'dev_bat_phone', platform: 'mobile_app' },
];

// Average plug draw (W) by name, for the energy history's per-plug kWh.
const PLUG_MEANS: [RegExp, number][] = [
  [/fridge/, 95],
  [/pc/, 140],
  [/tv/, 70],
  [/geyser/, 110],
  [/appliances/, 45],
  [/oven/, 35],
  [/dishwasher/, 55],
  [/washing/, 40],
];

const daily = (days: number, f: (i: number, rand: () => number) => number | undefined, seed: number): StatPoint[] => {
  const rand = seeded(seed);
  const today = new Date().setHours(0, 0, 0, 0);
  const out: StatPoint[] = [];
  for (let i = 0; i <= days; i++) {
    const mean = f(i, rand);
    if (mean !== undefined) out.push({ start: today - (days - i) * DAY, mean });
  }
  return out;
};

// Daily means for the panels' charts; undefined for entities this file doesn't know.
export function extraStatistics(id: string, days: number): StatPoint[] | undefined {
  const seed = hash(id);
  if (id.endsWith('_weight') && id.startsWith('sensor.bathroom_scale_')) {
    const end = id.includes('alex') ? 82.4 : 63;
    // Drifting down ~2 kg over 90 days with day-to-day noise.
    return daily(days, (i, r) => end + ((days - i) / 90) * (id.includes('alex') ? 2.1 : 0.6) + (r() - 0.5) * 0.6, seed);
  }
  if (id.endsWith('_recovery_score')) return daily(days, (_i, r) => 25 + r() * 70, seed);
  if (id.startsWith('sensor.bathroom_scale_') && id.endsWith('_body_fat')) {
    const end = id.includes('alex') ? 22.1 : 27.4;
    return daily(days, (i, r) => end + ((days - i) / 90) * 0.9 + (r() - 0.5) * 0.5, seed);
  }
  if (id.endsWith('_hrv')) return daily(days, (_i, r) => 50 + r() * 20, seed);
  if (id.endsWith('_resting_heart_rate')) return daily(days, (_i, r) => 55 + r() * 7, seed);
  const stage = { sleep_light_sleep_time: [2.8, 1], sleep_sws_time: [1.2, 0.7], sleep_rem_sleep_time: [1.4, 0.8] }[id.replace(/^sensor\.band_alex_/, '')];
  if (stage) return daily(days, (_i, r) => stage[0] + r() * stage[1], seed);
  if (id.endsWith('_battery') || id.endsWith('_battery_level')) {
    if (id.includes('phone')) return daily(days, (_i, r) => 20 + r() * 70, seed);
    const level = { front_door: 64, bathroom_door: 81, bedroom_bedroom_button: 8, hall_motion: 17, toothbrush: 46 }[id.replace(/^sensor\.|_sensor_battery$|_battery$/g, '')];
    if (level === undefined) return [];
    const perDay = id.includes('toothbrush') ? 1.8 : id.includes('button') ? 0.5 : 0.25;
    return daily(days, (i) => Math.min(100, level + (days - i) * perDay), seed);
  }
  const plug = PLUG_MEANS.find(([re]) => re.test(id) && id.endsWith('_power'));
  if (plug) return daily(days, (_i, r) => plug[1] * (0.6 + r() * 0.8), seed);
  return undefined;
}

// Bytes per day through the gateway (~4–9 GB down, ~0.4–1.2 GB up).
export function extraStatChanges(id: string, days: number): StatChange[] | undefined {
  if (!/^sensor\.router_data_(received|sent)$/.test(id)) return undefined;
  const down = id.endsWith('received');
  return daily(Math.min(days, 45), (_i, r) => (down ? 4e9 + r() * 5e9 : 4e8 + r() * 8e8), hash(id)).map((p) => ({ start: p.start, change: p.mean! }));
}

// Speeds every 5 minutes: busy evenings, quiet nights (KiB/s).
export function extraHistory(id: string, hours: number): HistoryPoint[] | undefined {
  if (!/^sensor\.router_(download|upload)_speed$/.test(id)) return undefined;
  const rand = seeded(hash(id) + hours);
  const base = id.includes('download') ? 2400 : 420;
  const end = Math.floor(Date.now() / 300_000) * 300_000;
  const pts: HistoryPoint[] = [];
  for (let t = end - hours * 3600_000; t <= end; t += 300_000) {
    const h = new Date(t).getHours();
    const load = h >= 19 && h <= 23 ? 2.2 : h >= 1 && h <= 6 ? 0.15 : 1;
    pts.push({ t, v: Math.max(5, base * load * (0.3 + rand() * 1.1) + (rand() > 0.97 ? base * 6 : 0)) });
  }
  return pts;
}
