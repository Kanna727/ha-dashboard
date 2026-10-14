// Which HA entities the dashboard shows. The values come from the per-home
// config (config/dashboard.config.ts), which main.tsx loads from HA (or the
// device cache) before it imports the app, so `!` is safe here.
import type { DashboardConfig } from './types';

export type { ControlDef, RoomDef } from './types';

const cfg: DashboardConfig = window.__DASHBOARD_CONFIG__!;

// Hash of the loaded config; part of the self-update version check.
export const CONFIG_HASH = window.__DASHBOARD_CONFIG_HASH__ ?? 'none';

export const {
  ROOMS,
  FAN_MANUAL_OFF,
  WEATHER,
  OUTDOOR_TEMP,
  SUN,
  PEOPLE,
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
