// Which HA entities the dashboard shows. The values come from the per-home
// config (config/dashboard.config.ts), which main.tsx sets from the embedded
// copy or the device cache before rendering.
import type { DashboardConfig } from './types';

export type { ControlDef, RoomDef } from './types';

// The bundle is one file, so this module runs at page load even on a device's
// first visit, while main.tsx is still fetching the config from HA. It must
// not crash then; main.tsx caches the fetched config and reloads, and the app
// is never rendered with this empty one.
const EMPTY: DashboardConfig = {
  ROOMS: [],
  FAN_MANUAL_OFF: {},
  WEATHER: '',
  OUTDOOR_TEMP: '',
  SUN: '',
  HOME_ZONE: '',
  CLIMATE: { entity: '', power: '', energyToday: '', pm25: '' },
  ENERGY: { total: '', legacyTotal: '', plugs: {} },
  APPLIANCES: {
    dishwasher: { state: '', progress: '', finish: '', connectivity: '' },
    washer: { running: '', power: '', door: '' },
  },
  MEDIA: [],
  MUSIC_PLAYERS: [],
  CAR: { name: '', lock: '', fuel: '', range: '', odometer: '', doors: [], warnings: [] },
  CAR_DETAIL: {
    image: '',
    location: '',
    battery12v: '',
    climate: '',
    lastUpdated: '',
    tyres: { frontLeft: '', frontRight: '', rearLeft: '', rearRight: '' },
    openings: [],
    engine: '',
  },
  NETWORK: { wan: '' },
  FRIDGE: { power: '', door: '' },
  COMMUTE: { dashboard: '', cardType: '', windowDays: [], windowStartHour: 0, windowEndHour: 0 },
  MEALS: { people: [], slots: [], plan: {}, notes: [] },
};

const cfg: DashboardConfig = window.__DASHBOARD_CONFIG__ ?? EMPTY;

// Hash of the loaded config; part of the self-update version check.
export const CONFIG_HASH = window.__DASHBOARD_CONFIG_HASH__ ?? 'none';

export const {
  ROOMS,
  FAN_MANUAL_OFF,
  WEATHER,
  OUTDOOR_TEMP,
  SUN,
  HOME_ZONE,
  CLIMATE,
  ENERGY,
  APPLIANCES,
  MEDIA,
  MUSIC_PLAYERS,
  CAR,
  CAR_DETAIL,
  NETWORK,
  FRIDGE,
  COMMUTE,
  MEALS,
} = cfg;

// Optional settings, with defaults for configs stored before they existed.
export const ALERTS = { chime: true, doorOpenMinutes: 3, notify: ['notify', 'mobile_app_*'], seconds: 30, alarms: [] as string[], ...cfg.ALERTS };
export const DOORBELL = { seconds: 60, ...cfg.DOORBELL };
export const VACATION_MODE = cfg.VACATION_MODE ?? '';
export const VACUUM: NonNullable<DashboardConfig['VACUUM']> = { ...cfg.VACUUM };
export const DESK: NonNullable<DashboardConfig['DESK']> = { ...cfg.DESK };
export const HEALTH = { people: [] as NonNullable<NonNullable<DashboardConfig['HEALTH']>['people']>, ...cfg.HEALTH };
export const BATTERIES = { low: 20, hide: [] as string[], ...cfg.BATTERIES };
export const FINANCE = {
  prefix: 'fold',
  hide: ['tablet'] as string[],
  cardColors: {} as Record<string, [string, string]>,
  store: 'dashboard-money',
  skipCategories: ['Credit Bill'],
  hideAccounts: [] as string[],
  snapshotStore: 'dashboard-fold-data',
  activityStore: 'dashboard-fold-activity',
  editsStore: 'dashboard-money-edits',
  ...cfg.FINANCE,
};
export const MEDICINES = {
  people: MEALS.people,
  times: {} as NonNullable<NonNullable<DashboardConfig['MEDICINES']>['times']>,
  lowDays: 5,
  store: 'dashboard-medicines',
  haSensor: undefined as string | undefined,
  ...cfg.MEDICINES,
};
export const PLANNER = {
  todos: 'todo.todos',
  reminders: 'todo.reminders',
  shopping: 'todo.shopping_list',
  appointments: 'calendar.appointments',
  people: MEALS.people,
  store: 'dashboard-habits',
  calendars: undefined as string[] | undefined,
  ...cfg.PLANNER,
};
export const NIGHT_MODE = { enabled: true, idleMinutes: 5, nightOnly: true, layouts: ['tablet'] as string[], ...cfg.NIGHT_MODE };
export const HOME_IDLE = { minutes: 2, layouts: ['tablet'] as string[], ...cfg.HOME_IDLE };
export const SCREEN_POWER = {
  enabled: true,
  quiet: ['23:00', '06:00'] as [string, string],
  vacation: true,
  rooms: undefined as string[] | undefined,
  holdMinutes: 5,
  entity: '',
  battery: '',
  ...cfg.SCREEN_POWER,
};

// Deploys write "<app version>/<config hash>" here; open pages reload when it
// stops matching what they run (see update/useSelfUpdate.ts).
export const BUILD_HELPER = 'input_text.dashboard_build';

// Offline-device recovery in the status dialog. Not per-home: these describe
// how integrations behave.
export const RECOVERY = {
  // Matter devices can't be restarted one by one; restarting the Matter
  // Server app re-establishes every Matter subscription.
  matterServerApp: 'core_matter_server',
  // Friendly names for integration platforms.
  integrations: {
    alexa_devices: 'Alexa',
    hass_agent: 'HASS.Agent',
    homekit_controller: 'HomeKit',
    home_connect: 'Home Connect',
    kia_uvo: 'Kia Connect',
    matter: 'Matter',
    mobile_app: 'Companion app',
    webostv: 'LG webOS TV',
    wiz: 'WiZ',
  } as Record<string, string>,
  // Integrations whose devices are usually just switched off when
  // unavailable; reloading rarely helps.
  usuallyPoweredOff: ['webostv', 'hass_agent', 'mobile_app'],
  // Integrations where one reload affects every device on the account.
  accountWide: ['alexa_devices', 'kia_uvo', 'home_connect'],
};
