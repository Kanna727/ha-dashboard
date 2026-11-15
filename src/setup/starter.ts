// A first config built from what Home Assistant has: one room per area (its
// lights, fans and switches as controls, its presence, door, temperature and
// humidity sensors), the weather, the sun, the home zone, the climate device,
// the media players, the people. Anything it can't find stays empty for the
// owner to pick (entities.ts and the panels treat an empty entity as
// unavailable). Pure, so it is unit-tested (setup.test.ts).
import type { HassEntities } from 'home-assistant-js-websocket';
import type { DashboardConfig, RoomDef } from '../config/types';
import type { RegistrySnapshot } from '../ha/api';
import { blank, SCHEMA, SECTION_KEYS } from './schema';
import { REQUIRED_SECTIONS } from './validate';

const humanize = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const domainOf = (id: string) => id.split('.')[0];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// A room icon from its name (names of the dashboard's icons, components/Icon.tsx).
export function roomIcon(name: string): string {
  const n = name.toLowerCase();
  if (/bed|sleep|nursery/.test(n)) return 'bed';
  if (/living|lounge|hall|sofa|family/.test(n)) return 'sofa';
  if (/kitchen|pantry|dining/.test(n)) return 'stove';
  if (/bath|toilet|wash ?room|shower|wc/.test(n)) return 'bathtub';
  if (/work|office|study|desk/.test(n)) return 'desk';
  if (/utility|laundry/.test(n)) return 'washer';
  if (/garage|parking|car/.test(n)) return 'car';
  if (/balcony|terrace|garden|patio|yard/.test(n)) return 'sun';
  return 'home';
}

interface Info {
  id: string;
  name: string;
  domain: string;
  cls?: string;
  area?: string;
}

function infos(states: HassEntities, registry?: RegistrySnapshot): Info[] {
  const deviceArea = new Map((registry?.devices ?? []).map((d) => [d.id, d.areaId ?? undefined]));
  const entityArea = new Map((registry?.entities ?? []).map((e) => [e.entityId, e.areaId ?? deviceArea.get(e.deviceId)]));
  return Object.values(states)
    .map((e) => ({
      id: e.entity_id,
      name: (e.attributes.friendly_name as string | undefined) ?? humanize(e.entity_id.split('.')[1]),
      domain: domainOf(e.entity_id),
      cls: e.attributes.device_class as string | undefined,
      area: entityArea.get(e.entity_id),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function starterConfig(states: HassEntities, registry?: RegistrySnapshot): DashboardConfig {
  const all = infos(states, registry);
  const first = (pred: (i: Info) => boolean) => all.find(pred)?.id ?? '';
  const config: Record<string, unknown> = {};
  // Every section the dashboard needs, empty to begin with.
  for (const k of SECTION_KEYS) if ((REQUIRED_SECTIONS as readonly string[]).includes(k)) config[k] = blank(SCHEMA[k].field);

  // Rooms: one per area that has something to show.
  const byArea = new Map<string, Info[]>();
  for (const i of all) if (i.area) byArea.set(i.area, [...(byArea.get(i.area) ?? []), i]);
  const rooms: RoomDef[] = [];
  for (const [area, list] of byArea) {
    const name = humanize(area);
    const prefix = new RegExp(`^${name}\\s+`, 'i');
    const controls = list
      .filter((i) => ['light', 'fan'].includes(i.domain) || (i.domain === 'switch' && i.cls !== 'outlet'))
      .slice(0, 8)
      .map((i) => ({ entity: i.id, name: i.name.replace(prefix, '') || i.name }));
    const presence = list.filter((i) => i.domain === 'binary_sensor' && ['occupancy', 'presence', 'motion'].includes(i.cls ?? '')).map((i) => i.id);
    const doors = list.filter((i) => i.domain === 'binary_sensor' && ['door', 'window', 'opening', 'garage_door'].includes(i.cls ?? '')).map((i) => i.id);
    const temperature = list.find((i) => i.domain === 'sensor' && i.cls === 'temperature')?.id;
    const humidity = list.find((i) => i.domain === 'sensor' && i.cls === 'humidity')?.id;
    if (!controls.length && !presence.length && !doors.length && !temperature) continue;
    rooms.push({ id: slug(area), name, icon: roomIcon(name), presence, doors, controls, ...(temperature ? { temperature } : {}), ...(humidity ? { humidity } : {}) });
  }
  config.ROOMS = rooms;

  config.WEATHER = first((i) => i.domain === 'weather');
  config.SUN = first((i) => i.id === 'sun.sun') || first((i) => i.domain === 'sun');
  config.HOME_ZONE = first((i) => i.id === 'zone.home') || first((i) => i.domain === 'zone');
  config.OUTDOOR_TEMP = first((i) => i.domain === 'sensor' && /outdoor|outside|garden|balcony/i.test(`${i.id} ${i.name}`) && (i.cls === 'temperature' || /temp/i.test(i.id)));

  const ac = first((i) => i.domain === 'climate');
  (config.CLIMATE as Record<string, string>).entity = ac;
  config.MEDIA = [];
  config.MUSIC_PLAYERS = all.filter((i) => i.domain === 'media_player').slice(0, 8).map((i) => ({ entity: i.id, name: i.name }));
  (config.NETWORK as Record<string, string>).wan = first((i) => i.domain === 'binary_sensor' && i.cls === 'connectivity' && /wan|internet|router/i.test(`${i.id} ${i.name}`));
  (config.ENERGY as Record<string, string>).total = first((i) => i.domain === 'sensor' && i.cls === 'power' && /home|house|total|mains/i.test(`${i.id} ${i.name}`));

  // The commute card reads its settings from a Lovelace card; these are the usual names.
  Object.assign(config.COMMUTE as object, { dashboard: 'lovelace', cardType: 'custom:commute-traffic-map', windowDays: [1, 2, 3, 4, 5], windowStartHour: 8, windowEndHour: 10 });
  (config.CAR as Record<string, unknown>).name = 'Car';

  // People from the person entities (their meals, medicines and habits).
  const people = all.filter((i) => i.domain === 'person').slice(0, 4);
  Object.assign(config.MEALS as object, {
    people: people.map((p) => ({ id: slug(p.id.split('.')[1]).slice(0, 12) || 'p', name: p.name })),
    slots: [
      { id: 'breakfast', label: 'Breakfast', time: 'Before 9:30 AM', end: '09:30', delivery: '' },
      { id: 'lunch', label: 'Lunch', time: '9:30 AM – 2 PM', end: '14:00', delivery: '' },
      { id: 'dinner', label: 'Dinner', time: '6 – 8 PM', end: '20:00', delivery: '' },
    ],
  });

  return config as unknown as DashboardConfig;
}
