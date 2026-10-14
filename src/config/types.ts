// Shape of the per-home config (config/dashboard.config.ts). It is stored in
// Home Assistant (see config/load.ts), so the release bundle carries no entity
// IDs or names. Keep it plain data: it travels as JSON.

export interface ControlDef {
  entity: string;
  name: string;
  icon?: string; // key into icons map in components/Icon.tsx
  // Shown but not toggleable from the dashboard (e.g. fridge, PC).
  readOnly?: boolean;
}

export interface RoomDef {
  id: string;
  name: string;
  icon: string;
  temperature?: string;
  humidity?: string;
  presence: string[];
  doors: string[];
  controls: ControlDef[];
  power?: string[];
  // Second one-tap button on the room row, next to the lights button.
  quick?: { entity: string; kind: 'fan' | 'geyser' };
  // Status buttons on the room card; tap opens the appliance details (never toggles power).
  appliances?: ('washer' | 'dishwasher')[];
  // Extra cards shown in the room's detail modal.
  detailCards?: ('climate' | 'media')[];
}

export interface NamedEntity {
  entity: string;
  name: string;
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

export interface MealsConfig {
  people: { id: string; name: string }[];
  // `time` is the eating window shown in the panel; `end` (HH:MM, 24 h) is when
  // the slot stops being "next up". `delivery` is informational.
  slots: { id: MealSlot; label: string; time: string; end: string; delivery: string }[];
  // Index 0 = Sunday (JS getDay()). A missing day means no delivery.
  plan: Record<number, Record<string, Record<MealSlot, string>> | undefined>;
  notes: string[];
}

export interface DashboardConfig {
  ROOMS: RoomDef[];
  // Per-fan "manual off" flag. While it is on, the fan's automations won't turn the fan on.
  FAN_MANUAL_OFF: Record<string, string>;
  WEATHER: string;
  OUTDOOR_TEMP: string;
  SUN: string;
  PEOPLE: string[];
  HOME_ZONE: string;
  CLIMATE: { entity: string; power: string; energyToday: string; pm25: string };
  ENERGY: {
    total: string;
    legacyTotal: string;
    plugs: Record<string, { name?: string; icon?: string; color?: string }>;
  };
  APPLIANCES: {
    dishwasher: { state: string; progress: string; finish: string; connectivity: string };
    washer: { running: string; power: string; door: string };
  };
  MEDIA: NamedEntity[];
  MUSIC_PLAYERS: NamedEntity[];
  CAR: {
    name: string;
    lock: string;
    fuel: string;
    range: string;
    odometer: string;
    doors: string[];
    warnings: NamedEntity[];
  };
  CAR_DETAIL: {
    image: string; // relative to /local/dashboard/
    location: string;
    battery12v: string;
    climate: string;
    lastUpdated: string;
    tyres: { frontLeft: string; frontRight: string; rearLeft: string; rearRight: string };
    openings: { entities: string[]; name: string }[];
    engine: string;
  };
  NETWORK: { wan: string };
  FRIDGE: { power: string; door: string };
  // Commute map settings (API key, origin/destination) are read at runtime from
  // this Lovelace card, so the key never lands in the public /local/ files.
  COMMUTE: {
    dashboard: string;
    cardType: string;
    windowDays: number[]; // 0 = Sunday
    windowStartHour: number;
    windowEndHour: number;
  };
  MEALS: MealsConfig;
}

declare global {
  interface Window {
    __DASHBOARD_CONFIG__?: DashboardConfig;
    __DASHBOARD_CONFIG_HASH__?: string;
  }
}
