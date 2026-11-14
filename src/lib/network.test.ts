import { describe, expect, it } from 'vitest';
import type { RegistryDevice } from '../ha/api';
import type { Client } from './network';
import type { HassEntity } from 'home-assistant-js-websocket';
import { deviceRoles } from './deviceRoles';
import { clientFamily, clientGroups, compareIp, findNetwork, findSpeedTest, fmtBytes, fmtRate, fmtUptime, formatMac, hexRuns, matchClients, meshNodes, parseClientNames, withNames, meshTree, routerClients, toMbps, wifiSwitches } from './network';

const ent = (entityId: string, deviceId: string) => ({ entityId, deviceId, platform: 'x' });

describe('deviceRoles', () => {
  it('votes on the prefix so short keys never claim longer unknown ones', () => {
    const ids = ['sensor.ride_sam_level', 'sensor.ride_sam_run_level', 'sensor.ride_sam_ftp', 'sensor.ride_sam_weight'];
    expect(deviceRoles(ids, ['level', 'ftp', 'weight'])).toEqual({
      level: 'sensor.ride_sam_level',
      ftp: 'sensor.ride_sam_ftp',
      weight: 'sensor.ride_sam_weight',
    });
  });
  it('prefers sensors when two domains share a key', () => {
    expect(deviceRoles(['binary_sensor.gw_wan_status', 'sensor.gw_wan_status', 'sensor.gw_uptime'], ['wan_status', 'uptime']).wan_status).toBe('sensor.gw_wan_status');
  });
});

describe('findNetwork', () => {
  const registry = {
    devices: [
      { id: 'r', name: 'Router', areaId: null, disabled: false },
      { id: 'g', name: 'Gateway', areaId: null, disabled: false },
    ],
    entities: [
      ent('sensor.router_total_clients', 'r'),
      ent('sensor.router_total_wired_clients', 'r'),
      ent('sensor.router_cpu_used', 'r'),
      ent('switch.router_wifi_2_4g', 'r'),
      ent('switch.router_wifi_5g', 'r'),
      ent('switch.router_guest_wifi_5g', 'r'),
      ent('switch.router_router_data_fetching', 'r'),
      ent('button.router_reboot', 'r'),
      ent('binary_sensor.gw_wan_status', 'g'),
      ent('sensor.gw_download_speed', 'g'),
      ent('sensor.gw_upload_speed', 'g'),
      ent('sensor.gw_data_received', 'g'),
    ],
  };

  it('finds the router by its client count and the gateway by its counters', () => {
    const n = findNetwork(registry);
    expect(n.routerName).toBe('Router');
    expect(n.router).toMatchObject({ total_clients: 'sensor.router_total_clients', reboot: 'button.router_reboot', wifi_5g: 'switch.router_wifi_5g' });
    expect(n.wan).toMatchObject({ wan_status: 'binary_sensor.gw_wan_status', download_speed: 'sensor.gw_download_speed' });
  });

  it('lists Wi-Fi switches main bands first', () => {
    expect(wifiSwitches(findNetwork(registry).router).map((w) => [w.label, w.main])).toEqual([
      ['2.4 GHz', true],
      ['5 GHz', true],
      ['Guest 5 GHz', false],
    ]);
  });

  it('gives nothing when there is no router', () => {
    expect(findNetwork({ devices: [], entities: [] })).toEqual({ router: {}, routerName: undefined, wan: {} });
  });
});

describe('units and formatting', () => {
  it('converts rates', () => {
    expect(toMbps(1000, 'KiB/s')).toBeCloseTo(8.192);
    expect(toMbps(50, 'Mbit/s')).toBe(50);
    expect(toMbps(1, 'furlongs')).toBeUndefined();
  });
  it('formats', () => {
    expect(fmtRate(0.25)).toBe('250 kbps');
    expect(fmtRate(12.44)).toBe('12.4 Mbps');
    expect(fmtRate(312.4)).toBe('312 Mbps');
    expect(fmtBytes(4.24e9)).toBe('4.2 GB');
    expect(fmtBytes(640e6)).toBe('640 MB');
    expect(fmtBytes(1.31e12)).toBe('1.31 TB');
    expect(fmtUptime(19_200)).toBe('5 h 20 m');
    expect(fmtUptime(17_323_759)).toBe('200 days');
  });
});

describe('clients', () => {
  const t = (id: string, attrs: Record<string, unknown>, state = 'home') =>
    ({ entity_id: id, state, attributes: { source_type: 'router', ...attrs } }) as unknown as HassEntity;

  it('families drop serial tails', () => {
    expect(clientFamily('wiz_3d7904')).toBe('Wiz');
    expect(clientFamily('SwitchBot-Hub-2-302DAC')).toBe('SwitchBot Hub 2');
    expect(clientFamily('Living-Room')).toBe('Living Room');
    expect(clientFamily('office')).toBe('Office');
    expect(clientFamily('fan_cafe')).toBe('Fan cafe');
  });

  it('lists connected clients with their band', () => {
    const clients = routerClients({
      a: t('device_tracker.wiz_aa11', { band: '2G', connection: 'host', host_name: 'wiz_aa11' }),
      b: t('device_tracker.wiz_bb22', { band: '2G', connection: 'host', host_name: 'wiz_bb22' }),
      c: t('device_tracker.nas', { band: null, connection: 'wired', host_name: 'nas' }),
      d: t('device_tracker.guest', { band: '5G', connection: 'guest', host_name: 'Unknown', friendly_name: 'Visitor' }),
      e: t('device_tracker.gone', { band: '5G', connection: 'host', host_name: 'gone' }, 'not_home'),
      f: { entity_id: 'device_tracker.phone', state: 'home', attributes: { source_type: 'gps' } } as unknown as HassEntity,
    });
    expect(clients.map((c) => [c.name, c.band, c.guest])).toEqual([
      ['nas', 'Wired', false],
      ['Visitor', '5 GHz', true],
      ['wiz_aa11', '2.4 GHz', false],
      ['wiz_bb22', '2.4 GHz', false],
    ]);
    expect(clientGroups(clients).map((g) => [g.family, g.clients.length])).toEqual([
      ['Wiz', 2],
      ['Nas', 1],
      ['Visitor', 1],
    ]);
  });
});

describe('device details', () => {
  const t = (id: string, attrs: Record<string, unknown>, state = 'home') =>
    ({ entity_id: id, state, last_changed: '2026-10-26T08:00:00Z', attributes: { source_type: 'router', ...attrs } }) as unknown as HassEntity;

  it('formats MACs and sorts IPs numerically', () => {
    expect(formatMac('02-00-5E-00-00-0B')).toBe('02:00:5e:00:00:0b');
    expect(formatMac('02005e00000b')).toBe('02:00:5e:00:00:0b');
    expect(['192.0.2.10', '192.0.2.9', undefined, '192.0.2.1'].sort(compareIp)).toEqual(['192.0.2.1', '192.0.2.9', '192.0.2.10', undefined]);
  });

  it('reads IP, MAC, traffic when reported, and offline devices on request', () => {
    const states = {
      a: t('device_tracker.lamp', { host_name: 'lamp', band: '2G', connection: 'host', ip: '192.0.2.5', mac: '02-00-5E-00-00-01', packets_sent: null, packets_received: '42' }),
      b: t('device_tracker.old', { host_name: 'old', band: '5G', connection: 'host' }, 'not_home'),
    };
    expect(routerClients(states)).toHaveLength(1);
    const [lamp, old] = routerClients(states, true);
    expect(lamp).toMatchObject({ ip: '192.0.2.5', mac: '02:00:5e:00:00:01', online: true, packetsSent: undefined, packetsReceived: 42, since: '2026-10-26T08:00:00Z' });
    expect(old).toMatchObject({ name: 'old', online: false });
  });

  it('finds hex runs with or without separators', () => {
    expect(hexRuns('BOSCH-SMV6ZCX49E-68A40E5A1D2B')).toEqual(['68a40e5a1d2b']);
    expect(hexRuns('AA:BB:CC:DD:EE:FF')).toEqual(['aabbccddeeff']);
    expect(hexRuns('deviceid_1-2-MatterNodeDevice')).toEqual([]);
  });

  it("matches clients to HA devices, most certain first, skipping the trackers' own devices", () => {
    const client = (entity: string, mac: string) => ({ entity, mac, name: entity, band: '2.4 GHz', guest: false, family: entity, online: true }) as Client;
    const clients = [
      client('device_tracker.lamp', '02:00:5e:00:00:01'), // MAC connection
      client('device_tracker.washer', '02:00:5e:00:00:02'), // inside an appliance ID
      client('device_tracker.bulb', '02:00:5e:00:00:03'), // serial number
      client('device_tracker.plug', '02:00:5e:00:00:12'), // a neighbour's MAC two steps off: no match
      client('device_tracker.sensor', '02:00:5e:12:84:99'), // same last 3 bytes
      client('device_tracker.nas', '02:00:5e:00:00:99'), // nothing
      { ...client('device_tracker.oven', '02:00:5e:00:00:20'), name: 'bosch-oven-100000000000000001' }, // ID in the host name
    ];
    const dev = (id: string, name: string, extra: Partial<RegistryDevice>): RegistryDevice => ({ id, name, areaId: 'hall', disabled: false, ...extra });
    const registry = {
      devices: [
        dev('trk', 'lamp', { macs: ['02:00:5e:00:00:01'] }), // the router's own client device
        dev('light', 'Hall Light', { macs: ['02:00:5e:00:00:01'] }),
        dev('wash', 'Dishwasher', { identifiers: ['BOSCH-SMV6-02005E000002'] }),
        dev('bulb', 'Desk Lamp', { identifiers: ['deviceid_1-2'], serial: '02005E000003' }),
        dev('wiz', 'WiZ Plug', { macs: ['02:00:5e:00:00:10'] }),
        dev('fp2', 'Presence', { identifiers: ['AA:BB:CC:12:84:99'] }),
        dev('off', 'Old', { macs: ['02:00:5e:00:00:99'], disabled: true }),
        dev('oven', 'Oven', { identifiers: ['100000000000000001'] }),
      ],
      entities: [{ entityId: 'device_tracker.lamp', deviceId: 'trk', platform: 'router' }],
    };
    const m = matchClients(registry, clients);
    expect(Object.fromEntries([...m].map(([k, v]) => [k.replace('device_tracker.', ''), `${v.name}/${v.via}`]))).toEqual({
      lamp: 'Hall Light/mac',
      washer: 'Dishwasher/id',
      bulb: 'Desk Lamp/id',
      sensor: 'Presence/likely',
      oven: 'Oven/id',
    });
  });

  it('leaves a likely match out when two devices fit', () => {
    const c = [{ entity: 'device_tracker.x', mac: '02:00:5e:12:84:99', name: 'x', band: 'Other', guest: false, family: 'x', online: true } as Client];
    const registry = {
      devices: [
        { id: 'a', name: 'A', areaId: null, disabled: false, identifiers: ['A2:22:33:12:84:99'] },
        { id: 'b', name: 'B', areaId: null, disabled: false, identifiers: ['A6:55:66:12:84:99'] },
      ],
      entities: [],
    };
    expect(matchClients(registry, c).size).toBe(0);
  });
});

describe('mesh map', () => {
  const node = (id: string, attrs: Record<string, unknown>, state = 'home') =>
    ({ entity_id: `device_tracker.${id}`, state, attributes: { source_type: 'router', host_name: id, ...attrs } }) as unknown as HassEntity;
  const states = {
    main: node('main', { device_type: 'main', device_model: 'Router X', mac: 'AA-00-00-00-00-01', connection_type: 'wan', client_count: 9 }),
    hall: node('hall', { device_type: 'satellite', device_model: 'Node Y', mac: 'AA-00-00-00-00-02', uplink_mac: 'aa:00:00:00:00:01', connection_type: 'band5', signal_level: 3, client_count: '4' }),
    loft: node('loft', { device_type: 'satellite', mac: 'AA-00-00-00-00-03', uplink_mac: 'AA-00-00-00-00-02', connection_type: 'wired' }),
    lost: node('lost', { device_type: 'satellite', mac: 'AA-00-00-00-00-04', uplink_mac: 'AA-00-00-00-00-99' }, 'not_home'),
    phone: node('phone', { band: '5G', connection: 'host', mac: 'A6-00-00-00-00-01' }),
  };

  it('reads node trackers and keeps them out of the clients', () => {
    const nodes = meshNodes(states);
    expect(nodes.map((n) => [n.name, n.main, n.uplinkMac, n.uplink, n.signal, n.clients, n.online])).toEqual([
      ['main', true, undefined, 'wan', undefined, 9, true],
      ['hall', false, 'aa:00:00:00:00:01', '5', 3, 4, true],
      ['loft', false, 'aa:00:00:00:00:02', 'wired', undefined, undefined, true],
      ['lost', false, 'aa:00:00:00:00:99', undefined, undefined, undefined, false],
    ]);
    expect(routerClients(states).map((c) => c.name)).toEqual(['phone']);
  });

  it("reads the TP-Link integration's own attribute names", () => {
    const n = meshNodes({
      m: node('m', { device_type: 'easymesh', role: 'main_router', is_main_router: true, mac: 'AA-00-00-00-00-01', client_num: 7 }),
      s: node('s', { device_type: 'easymesh', role: 'satellite_router', mac: 'AA-00-00-00-00-02', parent_mac: 'AA-00-00-00-00-01', signal_level: 5 }),
    });
    expect(n.map((x) => [x.name, x.main, x.uplinkMac, x.clients, x.signal])).toEqual([
      ['m', true, undefined, 7, undefined],
      ['s', false, 'aa:00:00:00:00:01', undefined, 5],
    ]);
  });

  it('builds the tree from uplinks; unknown uplinks hang from the root', () => {
    const tree = meshTree(meshNodes(states));
    expect(tree.map((t) => [t.node.name, t.parent?.replace('device_tracker.', ''), t.level])).toEqual([
      ['main', undefined, 0],
      ['hall', 'main', 1],
      ['lost', 'main', 1],
      ['loft', 'hall', 2],
    ]);
    expect(meshTree([])).toEqual([]);
  });
});

describe('client names', () => {
  it('keeps only well-formed entries, by formatted MAC', () => {
    expect(
      parseClientNames({
        clients: {
          '0E-4E-A0-30-2D-AC': { device: 'hub1' },
          '0e:4e:a0:30:e6:90': { name: '  Bedroom hub ', area: 'bedroom' },
          bad: 'x',
          empty: { name: '   ' },
        },
      }),
    ).toEqual({ '0e:4e:a0:30:2d:ac': { device: 'hub1' }, '0e:4e:a0:30:e6:90': { name: 'Bedroom hub', area: 'bedroom' } });
    expect(parseClientNames(null)).toEqual({});
  });

  it('puts the owner’s names over the automatic matches', () => {
    const c = (entity: string, mac: string) => ({ entity, mac, name: entity, band: '2.4 GHz', guest: false, family: entity, online: true }) as Client;
    const clients = [c('a', '02:00:5e:00:00:01'), c('b', '02:00:5e:00:00:02'), c('c', '02:00:5e:00:00:03'), c('d', '02:00:5e:00:00:04')];
    const registry = { devices: [{ id: 'hub', name: 'Hub Living Room', areaId: 'living_room', disabled: false }], entities: [] };
    const auto = new Map([['a', { name: 'Guess', areaId: null, via: 'likely' as const }]]);
    const names = {
      '02:00:5e:00:00:01': { device: 'hub' },
      '02:00:5e:00:00:02': { name: 'Old laptop', area: 'workroom' },
      '02:00:5e:00:00:03': { device: 'gone', name: 'Fallback' },
    };
    const m = withNames(auto, clients, names, registry);
    expect(m.get('a')).toEqual({ name: 'Hub Living Room', areaId: 'living_room', deviceId: 'hub', via: 'manual' });
    expect(m.get('b')).toEqual({ name: 'Old laptop', areaId: 'workroom', via: 'manual' });
    expect(m.get('c')?.name).toBe('Fallback');
    expect(m.has('d')).toBe(false);
  });
});

describe('findSpeedTest', () => {
  const reg = (entities: { entityId: string; deviceId: string; platform: string }[]) => ({ devices: [], entities });
  it('finds Speedtest.net sensors by role', () => {
    const r = reg([
      { entityId: 'sensor.speedtest_ping', deviceId: 's', platform: 'speedtestdotnet' },
      { entityId: 'sensor.speedtest_download', deviceId: 's', platform: 'speedtestdotnet' },
      { entityId: 'sensor.speedtest_upload', deviceId: 's', platform: 'speedtestdotnet' },
      { entityId: 'sensor.gw_download_speed', deviceId: 'g', platform: 'upnp' },
    ]);
    expect(findSpeedTest(r)).toEqual({ download: 'sensor.speedtest_download', upload: 'sensor.speedtest_upload', ping: 'sensor.speedtest_ping' });
    expect(findNetwork(r).speedTest?.download).toBe('sensor.speedtest_download');
  });
  it('takes Fast.com, and nothing without a download sensor', () => {
    expect(findSpeedTest(reg([{ entityId: 'sensor.fast_com_download', deviceId: 'f', platform: 'fastdotcom' }]))).toEqual({ download: 'sensor.fast_com_download' });
    expect(findSpeedTest(reg([{ entityId: 'sensor.gw_download_speed', deviceId: 'g', platform: 'upnp' }]))).toBeUndefined();
  });
});
