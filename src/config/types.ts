// Shape of the per-home config (config/dashboard.config.ts). It is stored in
// Home Assistant (see config/load.ts), so the release bundle carries no entity
// IDs or names. Keep it plain data: it travels as JSON.

export interface ControlDef {
  entity: string;
  name: string;
  icon?: string; // key into icons map in components/Icon.tsx
  // Shown but not toggleable from the dashboard (e.g. fridge).
  readOnly?: boolean;
  // Turning off takes a second tap within 4 s (e.g. a PC on a smart plug,
  // where a stray tap would cut its power). Turning on is still one tap.
  confirmOff?: boolean;
}

export interface RoomDef {
  // Also the HA area whose bulbs show up here by themselves, unless `area` names another.
  id: string;
  area?: string;
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
  // Appliances shown in the room's detail modal. Washer and dishwasher also get
  // status buttons on the room card (tap opens the details, never toggles power);
  // the purifier has no button, only a fault note in the card's subtitle. The
  // vacuum gets a chip with its live status that opens the vacuum page; the
  // desk a chip with its height that opens the desk's popup.
  appliances?: ('washer' | 'dishwasher' | 'purifier' | 'vacuum' | 'desk')[];
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

// When a medicine is taken, around the meals.
export type MedSlot = 'before_breakfast' | 'after_breakfast' | 'before_lunch' | 'after_lunch' | 'before_dinner' | 'after_dinner';

export interface MedicinesConfig {
  people?: { id: string; name: string }[]; // default MEALS.people
  times?: Partial<Record<MedSlot, string>>; // 'HH:MM' each dose is taken (and comes off the stock)
  lowDays?: number; // "Needs attention" when a medicine runs out within this many days (default 5)
  // The hidden dashboard holding the medicines, edited on the dashboard itself
  // (default 'dashboard-medicines'; created on the first save).
  store?: string;
  // HA's template sensor that keeps the medicines summary for its reminder
  // automations (default: found by itself, see lib/medicines.ts findHaSensor).
  haSensor?: string;
}

export interface DashboardConfig {
  ROOMS: RoomDef[];
  // Per-fan "manual off" flag. While it is on, the fan's automations won't turn the fan on.
  FAN_MANUAL_OFF: Record<string, string>;
  WEATHER: string;
  OUTDOOR_TEMP: string;
  // Optional: an input_boolean toggled from the status bar, beside the leaving-home button.
  VACATION_MODE?: string;
  SUN: string;
  HOME_ZONE: string;
  CLIMATE: { entity: string; power: string; energyToday: string; pm25: string };
  ENERGY: {
    total: string;
    legacyTotal: string;
    plugs: Record<string, { name?: string; icon?: string; color?: string }>;
  };
  APPLIANCES: {
    dishwasher: {
      state: string;
      progress: string;
      finish: string;
      connectivity: string;
      // Optional (Home Connect): pick a program and start or stop it. Starting
      // needs the device id, which is found from the `program` entity's device.
      control?: {
        program: string; // select.* selected program
        stop: string; // button.* stop program
        power?: string; // switch.* Home Connect power (on / standby)
        plug?: string; // switch.* smart plug on the mains; when off the dishwasher can't be reached
        watts?: string; // sensor.* power draw, for the modal's chart
        remoteStart?: string; // binary_sensor.*, on = the door-side "remote start" is allowed
      };
    };
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
  // `wan`: the internet link's connectivity sensor (its device's speeds and byte
  // counters feed the Network panel). `router`: any entity of the router, if
  // the one with a "total clients" sensor isn't it.
  NETWORK: { wan: string; router?: string };
  FRIDGE: { power: string; door: string };
  // Commute map settings (API key, origin/destination) are read at runtime from
  // this Lovelace card, so the key never lands in the public /local/ files.
  COMMUTE: {
    dashboard: string;
    cardType: string;
    windowDays: number[]; // 0 = Sunday
    windowStartHour: number;
    windowEndHour: number;
    // Optional "HH:MM": when you want to arrive. In the commute window the Home
    // page's commute tile then counts down to when to leave.
    arriveBy?: string;
  };
  MEALS: MealsConfig;
  // Medicines panel settings. The medicines themselves are added and edited on
  // the dashboard and kept in HA (MEDICINES.store; see lib/medicines.ts).
  MEDICINES?: MedicinesConfig;
  // Optional: settings added after the config moved into HA must be optional
  // with defaults in entities.ts, because the stored config can be older than
  // the app.
  // "Done" and "door left open" banners.
  // `notify`: the HA notify services whose messages also show here (a trailing
  // * matches a prefix; [] turns mirroring off). `seconds`: how long an alert stays up.
  // `alarms`: words that make a mirrored notification an alarm (red, a siren, up
  // until tapped) when its title or message contains one, e.g. ['shoe rack'].
  ALERTS?: { chime?: boolean; doorOpenMinutes?: number; notify?: string[]; seconds?: number; alarms?: string[] };
  // Doorbell: a press shows the camera's live view full screen for `seconds`
  // (default 60). Optional: without it the first camera with "doorbell" in its ID or
  // name is used, and the first binary sensor named as a doorbell press.
  DOORBELL?: { camera?: string; press?: string; seconds?: number };
  // Robot vacuum page. Optional: without it the first vacuum.* entity is used,
  // and its map camera and settings are found from the vacuum's entity names.
  // `look` colours the 3D robot on the page: shell, laser band, and whether to draw its dock.
  // `autoOpen` (default true): the page opens by itself while the robot runs.
  VACUUM?: { entity?: string; map?: string; autoOpen?: boolean; look?: { body?: string; laser?: string; dock?: boolean } };
  // Standing desk (a height-adjustable desk controller with a cover, a height
  // number and preset buttons). Optional: without it the first number.*_desk_height
  // is used, and the desk's other entities are found from its name prefix and device.
  // `standAbove`: the height (cm) from which it counts as standing (default: halfway
  // between the learned Sit and Stand heights, else 90). `look` sizes and colours the
  // 3D desk: the top's width × depth in cm, the top's and the frame's colours.
  DESK?: { entity?: string; standAbove?: number; look?: { top?: [number, number]; board?: string; frame?: string } };
  // Health panel: who owns which scale, recovery wearable and indoor-cycling
  // account. Each is any one entity of that device; its other readings are found
  // from the device. Health devices no one is given still show, under the device's name.
  HEALTH?: { people?: { name: string; color?: string; scale?: string; wearable?: string; cycling?: string }[] };
  // Batteries panel: every battery is found by itself. `low`: the % at or below
  // which one counts as low (default 20). `hide`: entity IDs to leave out.
  BATTERIES?: { low?: number; hide?: string[] };
  // Money page: personal finance from helpers a money-app sync keeps up to date,
  // named `<prefix>_<role>` (default 'fold'; see lib/finance.ts). Accounts, cards
  // and scores are found by name. `hide`: layouts where amounts start blurred
  // (default ['tablet'], the wall screens; tap to show them for 5 min).
  // `cardColors`: a card's colours by its name ("Kotak League"), [from, to].
  // `store`: the hidden dashboard the sync writes chart data into (default
  // 'dashboard-money'). `skipCategories`: spending categories the charts leave
  // out (default ['Credit Bill']: card bill payments, already counted as card spends).
  // `hideAccounts`: bank account or card entity IDs to leave off the page.
  // `snapshotStore` / `activityStore`: the hidden dashboards the sync writes the
  // details into (defaults 'dashboard-fold-data', 'dashboard-fold-activity').
  // `editsStore`: where the dashboard keeps the owner's own changes to the
  // transactions (default 'dashboard-money-edits'; created on the first save).
  // `people`: more than one person's money (each their own money-app sync):
  // `id` (a short slug), `name`, the helpers' `prefix`, and their own `store`,
  // `snapshotStore`, `activityStore` (defaults: the first person uses the keys
  // above, the others `<default>-<id>`). The page then adds them up, with a
  // Both / one person switch, and tags each account, card and transaction.
  FINANCE?: {
    prefix?: string;
    people?: { id: string; name: string; prefix?: string; store?: string; snapshotStore?: string; activityStore?: string }[];
    hide?: ('tablet' | 'phone' | 'desktop')[];
    cardColors?: Record<string, [string, string]>;
    store?: string;
    skipCategories?: string[];
    hideAccounts?: string[];
    snapshotStore?: string;
    activityStore?: string;
    editsStore?: string;
  };
  // Planner page (planner/): habits, to-do lists and the master calendar.
  // `todos`, `reminders`, `shopping`: HA todo lists (defaults 'todo.todos',
  // 'todo.reminders' from the Local To-do integration, 'todo.shopping_list'
  // from Shopping List); a list that doesn't exist is left out. `people`: who
  // the habits are for (default MEALS.people). `store`: the hidden dashboard the
  // habits are kept in (default 'dashboard-habits'; created on the first save).
  // `calendars`: calendar.* entities shown on the calendar (default: every one).
  // `appointments`: the calendar the Appointments card and the calendar's "+"
  // add to (default 'calendar.appointments', a Local Calendar); always shown.
  PLANNER?: { todos?: string; reminders?: string; shopping?: string; appointments?: string; people?: { id: string; name: string }[]; store?: string; calendars?: string[] };
  // Dim night screen after inactivity (kiosk burn-in and glare).
  NIGHT_MODE?: { enabled?: boolean; idleMinutes?: number; nightOnly?: boolean; layouts?: ('tablet' | 'phone' | 'desktop')[] };
  // Back to the Home page (the glance page) after this many minutes without a
  // touch, closing a popup left open. 0 turns it off. Default 2, tablet only.
  HOME_IDLE?: { minutes?: number; layouts?: ('tablet' | 'phone' | 'desktop')[] };
  // Wall-screen power, for a ChromeOS tablet with the extension in
  // kiosk-extension/ (anywhere else it does nothing). The screen is kept on,
  // except in the `quiet` hours ['HH:MM', 'HH:MM'] (default 23:00–06:00) and,
  // with `vacation` (default true), while VACATION_MODE is on: then ChromeOS may
  // turn it off once the presence sensors of `rooms` (room ids; default every
  // room) have seen nobody for `holdMinutes` (default 5), and someone being seen
  // wakes it. `enabled: false` keeps the screen on always.
  // `entity`: an input_boolean the wall screen keeps in step with its display
  // (its history shows when it was on or off); toggling it in HA turns the
  // display on or off until the automatic decision next changes. `battery`: an
  // input_number (0–100) the wall screen writes its battery level into, so an
  // automation can charge it only when needed.
  SCREEN_POWER?: { enabled?: boolean; quiet?: [string, string]; vacation?: boolean; rooms?: string[]; holdMinutes?: number; entity?: string; battery?: string };
}

declare global {
  interface Window {
    __DASHBOARD_CONFIG__?: DashboardConfig;
    __DASHBOARD_CONFIG_HASH__?: string;
  }
}
