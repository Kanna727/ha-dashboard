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
  appliances?: ('washer' | 'dishwasher' | 'purifier')[];
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
    // Optional (added after the config moved into HA): a water purifier with
    // TDS readings. The dashboard may change its mode (two taps) and refresh it.
    purifier?: {
      name?: string; // default 'Water purifier'
      tankTds: string; // ppm of the purified water
      inputTds?: string; // ppm of the incoming water
      tankFull?: string; // binary_sensor, on = full
      mode?: string; // select.* purification mode
      fallbackMode?: string; // select.*, shown while the mode is Adaptive
      refresh?: string; // button.* asking the cloud for new readings
      lastReported?: string; // timestamp sensor
      faults?: NamedEntity[]; // problem binary_sensors, on = fault
    };
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
    // Optional 3D model for the car modal (a .glb relative to /local/dashboard/,
    // never committed: see AGENTS.md "3D car model"). Without it the photo shows.
    model?: {
      url: string;
      paint?: string; // body colour, e.g. '#2c3527'
      paintMaterial?: string; // regex for the paint material names (default 'carpaint')
      driverSide?: 'left' | 'right'; // where "Unlocked" is pinned (default 'left')
      gloss?: number; // paint finish, 0 (satin) to 1 (wet look); default 0.4
      // Convert a left-hand-drive model to right-hand drive (true, or regex
      // knobs: include / exclude / flip / split / keep; see car3d/viewer.ts).
      rhd?: boolean | { include?: string; exclude?: string; flip?: string; split?: string; keep?: string };
      plate?: string; // registration shown on the number plates
    };
    // Optional extra car entities drawn on the 3D model (lamps, heaters, seats).
    status?: {
      headlamps?: string;
      turnSignals?: string[];
      lampFaults?: NamedEntity[];
      airConditioner?: string;
      defrost?: string;
      rearWindowHeater?: string;
      steeringHeater?: string;
      seats?: { frontLeft?: string; frontRight?: string; rearLeft?: string; rearRight?: string };
      locationUpdated?: string;
    };
    // Optional remote actions in the car modal (Kia Connect buttons and climate).
    actions?: {
      refresh?: string; // button.* that asks the car for fresh data
      hazards?: string; // button.* flashing the hazards
      hornHazards?: string; // button.* sounding the horn with the hazards
      climate?: string; // climate.* for remote climate with a target temperature
    };
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
  // Optional: settings added after the config moved into HA must be optional
  // with defaults in entities.ts, because the stored config can be older than
  // the app.
  // "Done" and "door left open" banners.
  ALERTS?: { chime?: boolean; doorOpenMinutes?: number };
  // Dim night screen after inactivity (kiosk burn-in and glare).
  NIGHT_MODE?: { enabled?: boolean; idleMinutes?: number; nightOnly?: boolean; layouts?: ('tablet' | 'phone' | 'desktop')[] };
}

declare global {
  interface Window {
    __DASHBOARD_CONFIG__?: DashboardConfig;
    __DASHBOARD_CONFIG_HASH__?: string;
  }
}
