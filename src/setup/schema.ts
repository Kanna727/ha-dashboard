// What the config looks like at runtime. types.ts describes DashboardConfig for
// TypeScript, which is gone by the time the dashboard runs, so the editor
// (forms, entity pickers, validation) works from this description instead. The
// `satisfies` at the bottom makes the build fail if a top-level key of
// DashboardConfig has no entry here; setup.test.ts checks the example config
// against the rest. Keep it in step with types.ts: a new setting is added to
// both (and, if optional, given a default in entities.ts).
import type { DashboardConfig } from '../config/types';

interface Base {
  label?: string;
  help?: string;
  // Must be present (everything else is optional).
  req?: boolean;
}

export type Field =
  // A Home Assistant entity ID; `domains` are the usual ones for this setting.
  | (Base & { t: 'entity'; domains?: readonly string[] })
  | (Base & { t: 'string'; kind?: 'text' | 'time' | 'color' | 'icon' | 'regex' | 'slug' | 'path'; placeholder?: string })
  | (Base & { t: 'number'; min?: number; max?: number; step?: number; unit?: string })
  | (Base & { t: 'bool' })
  | (Base & { t: 'enum'; options: readonly string[]; labels?: Record<string, string> })
  | (Base & { t: 'multi'; options: readonly string[]; labels?: Record<string, string>; numeric?: boolean })
  // `title`: the item's key shown as its heading.
  | (Base & { t: 'list'; of: Field; item?: string; title?: string })
  | (Base & { t: 'object'; fields: Record<string, Field> })
  // A record: free keys of one kind, or `keyOptions` (shown as rows to fill in).
  | (Base & { t: 'map'; of: Field; keyKind: 'entity' | 'text'; keyDomains?: readonly string[]; keyOptions?: readonly string[]; keyLabels?: Record<string, string>; keyHelp?: string })
  | (Base & { t: 'tuple'; of: Field[]; labels?: string[] })
  // Either of two kinds of value (a setting that can also be switched off with `false`).
  | (Base & { t: 'either'; a: Field; b: Field });

export type FieldKind = Field['t'];

const entity = (domains?: readonly string[], o: Base = {}): Field => ({ t: 'entity', domains, ...o });
const text = (o: Base & { kind?: 'text' | 'time' | 'color' | 'icon' | 'regex' | 'slug' | 'path'; placeholder?: string } = {}): Field => ({ t: 'string', ...o });
const num = (o: Base & { min?: number; max?: number; step?: number; unit?: string } = {}): Field => ({ t: 'number', ...o });
const bool = (o: Base = {}): Field => ({ t: 'bool', ...o });
const oneOf = (options: readonly string[], o: Base & { labels?: Record<string, string> } = {}): Field => ({ t: 'enum', options, ...o });
const many = (options: readonly string[], o: Base & { labels?: Record<string, string>; numeric?: boolean } = {}): Field => ({ t: 'multi', options, ...o });
const list = (of: Field, o: Base & { item?: string; title?: string } = {}): Field => ({ t: 'list', of, ...o });
const obj = (fields: Record<string, Field>, o: Base = {}): Field => ({ t: 'object', fields, ...o });
const map = (of: Field, o: Base & { keyKind?: 'entity' | 'text'; keyDomains?: readonly string[]; keyOptions?: readonly string[]; keyLabels?: Record<string, string>; keyHelp?: string } = {}): Field => ({
  t: 'map',
  of,
  keyKind: 'text',
  ...o,
});
const tuple = (of: Field[], o: Base & { labels?: string[] } = {}): Field => ({ t: 'tuple', of, ...o });
const either = (a: Field, b: Field, o: Base = {}): Field => ({ t: 'either', a, b, ...o });

const LAYOUTS = ['tablet', 'phone', 'desktop'] as const;
const person = (extra: Record<string, Field> = {}) => obj({ id: text({ req: true, kind: 'slug', label: 'ID', help: 'A short word, e.g. "a"; used in saved data, so don’t change it later.' }), name: text({ req: true }), ...extra });
const named = (domains?: readonly string[]) => obj({ entity: entity(domains, { req: true }), name: text({ req: true }) });
const ID_PAIR = 'HA area id; its lights show up in the room by themselves.';

export const MED_SLOTS = ['before_breakfast', 'after_breakfast', 'before_lunch', 'after_lunch', 'before_dinner', 'after_dinner'] as const;
export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'] as const;
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const ROOM = obj({
  id: text({ req: true, kind: 'slug', label: 'ID', help: ID_PAIR }),
  name: text({ req: true }),
  icon: text({ req: true, kind: 'icon' }),
  area: text({ help: 'Only if the HA area’s id differs from the room’s ID.' }),
  temperature: entity(['sensor']),
  humidity: entity(['sensor']),
  presence: list(entity(['binary_sensor']), { req: true, item: 'presence sensor', help: 'Occupancy or presence sensors; the room shows as occupied when one is on.' }),
  doors: list(entity(['binary_sensor']), { req: true, item: 'door sensor' }),
  controls: list(
    obj({
      entity: entity(['light', 'fan', 'switch', 'input_boolean', 'cover', 'lock', 'climate'], { req: true }),
      name: text({ req: true }),
      icon: text({ kind: 'icon' }),
      readOnly: bool({ label: 'Read only', help: 'Shown, but can’t be toggled from the dashboard (a fridge, say).' }),
      confirmOff: bool({ label: 'Confirm off', help: 'Turning it off takes a second tap (a PC on a smart plug).' }),
    }),
    { req: true, item: 'control', title: 'name' },
  ),
  power: list(entity(['sensor']), { item: 'power sensor' }),
  quick: obj({ entity: entity(['fan', 'switch', 'light'], { req: true }), kind: oneOf(['fan', 'geyser'], { req: true }) }, { label: 'Quick button', help: 'A second one-tap button on the room row, next to the lights button.' }),
  appliances: many(['washer', 'dishwasher', 'purifier', 'vacuum', 'desk'], { help: 'Appliances shown in the room’s popup.' }),
  detailCards: many(['climate', 'media'], { label: 'Extra cards', help: 'Cards shown in the room’s popup.' }),
});

export interface Section {
  group: string;
  title: string;
  help?: string;
  field: Field;
}

export const GROUPS = ['Home', 'Weather and climate', 'Energy', 'Appliances', 'Media', 'Car and commute', 'Network', 'People', 'Screens and alerts', 'Other'] as const;

export const SCHEMA = {
  ROOMS: { group: 'Home', title: 'Rooms', help: 'The room cards on the Home page, with their sensors and controls.', field: list(ROOM, { item: 'room', title: 'name' }) },
  FAN_MANUAL_OFF: {
    group: 'Home',
    title: 'Fan manual-off flags',
    help: 'For each fan, the input_boolean that is on while it was switched off by hand, so the fan’s automations leave it alone.',
    field: map(entity(['input_boolean'], { req: true }), { keyKind: 'entity', keyDomains: ['fan'] }),
  },
  VACATION_MODE: { group: 'Home', title: 'Vacation mode', help: 'An input_boolean toggled from the top bar, beside the leaving-home button.', field: entity(['input_boolean']) },
  HOME_ZONE: { group: 'Home', title: 'Home zone', field: entity(['zone'], { req: true }) },
  SUN: { group: 'Home', title: 'Sun', field: entity(['sun'], { req: true }) },
  WEATHER: { group: 'Weather and climate', title: 'Weather', help: 'The weather entity the Weather card and the sky use.', field: entity(['weather'], { req: true }) },
  OUTDOOR_TEMP: { group: 'Weather and climate', title: 'Outdoor temperature', field: entity(['sensor'], { req: true }) },
  CLIMATE: {
    group: 'Weather and climate',
    title: 'Air conditioner',
    field: obj({
      entity: entity(['climate'], { req: true }),
      power: entity(['switch', 'sensor'], { req: true }),
      energyToday: entity(['sensor'], { req: true, label: 'Energy today' }),
      pm25: entity(['sensor'], { req: true, label: 'PM2.5' }),
    }),
  },
  ENERGY: {
    group: 'Energy',
    title: 'Home energy',
    help: 'Smart plugs are found by themselves; the list only gives known plugs a shorter name, an icon and a colour.',
    field: obj({
      total: entity(['sensor'], { req: true, label: 'Home power', help: 'A sensor summing the plugs that report.' }),
      legacyTotal: entity(['sensor'], { req: true, label: 'Older total', help: 'Only used to fill the 24 h chart before the sensor above has a day of history.' }),
      plugs: map(obj({ name: text(), icon: text({ kind: 'icon' }), color: text({ kind: 'color' }) }), { keyKind: 'entity', keyDomains: ['sensor'], req: true }),
    }),
  },
  FRIDGE: { group: 'Energy', title: 'Fridge', field: obj({ power: entity(['sensor'], { req: true }), door: entity(['binary_sensor'], { req: true }) }) },
  APPLIANCES: {
    group: 'Appliances',
    title: 'Dishwasher, washer, purifier',
    field: obj({
      dishwasher: obj(
        {
          state: entity(['sensor'], { req: true }),
          progress: entity(['sensor'], { req: true }),
          finish: entity(['sensor'], { req: true }),
          connectivity: entity(['binary_sensor'], { req: true }),
          control: obj(
            {
              program: entity(['select'], { req: true, help: 'The selected program.' }),
              stop: entity(['button'], { req: true }),
              power: entity(['switch']),
              plug: entity(['switch'], { help: 'A smart plug on the mains; when it is off the dishwasher can’t be reached.' }),
              watts: entity(['sensor'], { help: 'Power draw, for the popup’s chart.' }),
              remoteStart: entity(['binary_sensor'], { help: 'On when remote start is allowed.' }),
            },
            { help: 'Optional (Home Connect): pick a program and start or stop it.' },
          ),
        },
        { req: true },
      ),
      washer: obj({ running: entity(['binary_sensor', 'sensor', 'switch', 'input_boolean'], { req: true }), power: entity(['sensor'], { req: true }), door: entity(['binary_sensor'], { req: true }) }, { req: true }),
      purifier: obj(
        {
          name: text({ placeholder: 'Water purifier' }),
          tankTds: entity(['sensor'], { req: true, label: 'Purified water TDS' }),
          inputTds: entity(['sensor'], { label: 'Incoming water TDS' }),
          tankFull: entity(['binary_sensor']),
          mode: entity(['select'], { help: 'The purification mode.' }),
          fallbackMode: entity(['select'], { help: 'Shown while the mode is Adaptive.' }),
          refresh: entity(['button']),
          lastReported: entity(['sensor'], { help: 'A timestamp sensor.' }),
          faults: list(named(['binary_sensor']), { item: 'fault sensor', title: 'name' }),
        },
        { help: 'Optional: a water purifier with TDS readings.' },
      ),
    }),
  },
  VACUUM: {
    group: 'Appliances',
    title: 'Robot vacuum',
    help: 'Optional: without it the first vacuum entity is used and its map and settings are found by name.',
    field: obj({
      entity: entity(['vacuum']),
      map: entity(['camera']),
      autoOpen: bool({ label: 'Open by itself', help: 'The vacuum page opens while the robot runs (default on).' }),
      look: obj({ body: text({ kind: 'color' }), laser: text({ kind: 'color' }), dock: bool({ label: 'Draw the dock' }) }, { help: 'Colours of the 3D robot.' }),
    }),
  },
  DESK: {
    group: 'Appliances',
    title: 'Standing desk',
    help: 'Optional: without it the first number.*_desk_height is used.',
    field: obj({
      entity: entity(['number']),
      standAbove: num({ min: 0, max: 200, unit: 'cm', label: 'Counts as standing above', help: 'Default: halfway between the learned Sit and Stand heights, else 90.' }),
      look: obj({ top: tuple([num({ min: 20, max: 400, unit: 'cm' }), num({ min: 20, max: 400, unit: 'cm' })], { labels: ['Width', 'Depth'], label: 'Top size' }), board: text({ kind: 'color', label: 'Top colour' }), frame: text({ kind: 'color', label: 'Frame colour' }) }, { help: 'Sizes and colours the 3D desk.' }),
    }),
  },
  MEDIA: { group: 'Media', title: 'Media players', field: list(named(['media_player']), { item: 'player', title: 'name' }) },
  MUSIC_PLAYERS: { group: 'Media', title: 'Music players', field: list(named(['media_player']), { item: 'player', title: 'name' }) },
  CAR: {
    group: 'Car and commute',
    title: 'Car',
    field: obj({
      name: text({ req: true }),
      lock: entity(['lock'], { req: true }),
      fuel: entity(['sensor'], { req: true }),
      range: entity(['sensor'], { req: true }),
      odometer: entity(['sensor'], { req: true }),
      doors: list(entity(['binary_sensor']), { req: true, item: 'door sensor' }),
      warnings: list(named(['binary_sensor']), { req: true, item: 'warning', title: 'name' }),
    }),
  },
  CAR_DETAIL: {
    group: 'Car and commute',
    title: 'Car popup',
    field: obj({
      image: text({ req: true, kind: 'path', label: 'Photo', help: 'Relative to /local/dashboard/.' }),
      location: entity(['device_tracker', 'sensor'], { req: true }),
      battery12v: entity(['sensor'], { req: true, label: '12 V battery' }),
      climate: entity(['climate', 'sensor', 'binary_sensor', 'switch'], { req: true }),
      lastUpdated: entity(['sensor'], { req: true }),
      tyres: obj({ frontLeft: entity(['binary_sensor', 'sensor'], { req: true }), frontRight: entity(['binary_sensor', 'sensor'], { req: true }), rearLeft: entity(['binary_sensor', 'sensor'], { req: true }), rearRight: entity(['binary_sensor', 'sensor'], { req: true }) }, { req: true }),
      openings: list(obj({ name: text({ req: true }), entities: list(entity(['binary_sensor']), { req: true, item: 'sensor' }) }), { req: true, item: 'opening', title: 'name' }),
      engine: entity(['binary_sensor', 'sensor'], { req: true }),
      model: obj(
        {
          url: text({ req: true, kind: 'path', label: '3D model', help: 'A .glb relative to /local/dashboard/. Never commit it.' }),
          paint: text({ kind: 'color', label: 'Body colour' }),
          paintMaterial: text({ kind: 'regex', label: 'Paint material pattern', placeholder: 'carpaint' }),
          driverSide: oneOf(['left', 'right'], { label: 'Driver side' }),
          gloss: num({ min: 0, max: 1, step: 0.05, help: '0 satin … 1 wet look; default 0.4.' }),
          rhd: either(bool(), obj({ include: text({ kind: 'regex' }), exclude: text({ kind: 'regex' }), flip: text({ kind: 'regex' }), split: text({ kind: 'regex' }), keep: text({ kind: 'regex' }) }), { label: 'Right-hand drive', help: 'Convert a left-hand-drive model: on, or the regex knobs.' }),
          plate: text({ help: 'Shown on the number plates.' }),
        },
        { label: '3D model', help: 'Optional; without it the photo shows.' },
      ),
      status: obj(
        {
          headlamps: entity(['binary_sensor', 'sensor']),
          turnSignals: list(entity(['binary_sensor', 'sensor']), { item: 'signal' }),
          lampFaults: list(named(['binary_sensor']), { item: 'lamp fault', title: 'name' }),
          airConditioner: entity(['binary_sensor', 'sensor']),
          defrost: entity(['binary_sensor', 'sensor']),
          rearWindowHeater: entity(['binary_sensor', 'sensor']),
          steeringHeater: entity(['binary_sensor', 'sensor']),
          seats: obj({ frontLeft: entity(['sensor']), frontRight: entity(['sensor']), rearLeft: entity(['sensor']), rearRight: entity(['sensor']) }),
          locationUpdated: entity(['sensor']),
        },
        { help: 'Optional: lamps, heaters and seats drawn on the 3D model.' },
      ),
      actions: obj(
        {
          refresh: entity(['button'], { help: 'Asks the car for fresh data.' }),
          hazards: entity(['button']),
          hornHazards: entity(['button'], { label: 'Horn and hazards' }),
          climate: entity(['climate'], { help: 'Remote climate with a target temperature.' }),
        },
        { help: 'Optional remote actions in the car popup.' },
      ),
    }),
  },
  COMMUTE: {
    group: 'Car and commute',
    title: 'Commute',
    help: 'The map’s API key and route are read at runtime from a Lovelace card, so the key never sits in this config.',
    field: obj({
      dashboard: text({ req: true, kind: 'slug', help: 'The Lovelace dashboard (url path) holding the card.' }),
      cardType: text({ req: true, placeholder: 'custom:commute-traffic-map' }),
      windowDays: many(['0', '1', '2', '3', '4', '5', '6'], { req: true, numeric: true, labels: { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' }, help: 'Days the route auto-refreshes and alerts.' }),
      windowStartHour: num({ req: true, min: 0, max: 23 }),
      windowEndHour: num({ req: true, min: 0, max: 24 }),
      arriveBy: text({ kind: 'time', help: 'When you want to arrive; the Home page counts down to leaving.' }),
    }),
  },
  NETWORK: {
    group: 'Network',
    title: 'Network',
    field: obj({ wan: entity(['binary_sensor'], { req: true, label: 'Internet link', help: 'The connectivity sensor of the internet link; its device’s speeds feed the Network panel.' }), router: entity(undefined, { help: 'Any entity of the router, if the one with a "total clients" sensor isn’t it.' }) }),
  },
  MEALS: {
    group: 'People',
    title: 'Meals',
    field: obj({
      people: list(person(), { req: true, item: 'person', title: 'name' }),
      slots: list(obj({ id: oneOf(MEAL_SLOTS, { req: true }), label: text({ req: true }), time: text({ req: true, help: 'The eating window as shown, e.g. "Before 9:30 AM".' }), end: text({ req: true, kind: 'time', help: 'When the slot stops being next up.' }), delivery: text({ help: 'Informational; not shown.' }) }), { req: true, item: 'meal', title: 'label' }),
      plan: map(map(map(text(), { keyOptions: MEAL_SLOTS }), { keyHelp: 'person ID' }), { keyOptions: ['0', '1', '2', '3', '4', '5', '6'], keyLabels: { '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday' }, req: true, help: 'Each delivery day: person → meal. A missing day shows "No delivery planned".' }),
      notes: list(text(), { req: true, item: 'note' }),
    }),
  },
  MEDICINES: {
    group: 'People',
    title: 'Medicines',
    help: 'Dose times and when a medicine starts showing in "Needs attention". The medicines themselves are edited on the Health page.',
    field: obj({
      people: list(person(), { item: 'person', title: 'name', help: 'Default: the people under Meals.' }),
      times: map(text({ kind: 'time' }), { keyOptions: MED_SLOTS, keyLabels: Object.fromEntries(MED_SLOTS.map((s) => [s, s.replace('_', ' ')])) }),
      lowDays: num({ min: 0, max: 60, label: 'Low-stock days', help: 'Needs attention when one runs out within this many days (default 5).' }),
      store: text({ kind: 'slug', help: 'The hidden dashboard holding the medicines (default dashboard-medicines).' }),
      haSensor: entity(['sensor'], { help: 'The template sensor HA’s reminders read (default: found by itself).' }),
    }),
  },
  HEALTH: {
    group: 'People',
    title: 'Health',
    help: 'Whose scale, recovery wearable and indoor-cycling account is whose. Any one entity of each device is enough.',
    field: obj({ people: list(obj({ name: text({ req: true }), color: text({ kind: 'color' }), scale: entity(['sensor']), wearable: entity(['sensor']), cycling: entity(['sensor']) }), { item: 'person', title: 'name' }) }),
  },
  PLANNER: {
    group: 'People',
    title: 'Planner',
    field: obj({
      todos: entity(['todo']),
      reminders: entity(['todo']),
      shopping: entity(['todo']),
      appointments: entity(['calendar'], { help: 'The calendar the Appointments card adds to (a Local Calendar).' }),
      people: list(person(), { item: 'person', title: 'name', help: 'Who the habits are for (default: the people under Meals).' }),
      store: text({ kind: 'slug', help: 'The hidden dashboard the habits are kept in (default dashboard-habits).' }),
      calendars: list(entity(['calendar']), { item: 'calendar', help: 'Calendars shown on the master calendar (default: every one).' }),
    }),
  },
  FINANCE: {
    group: 'People',
    title: 'Money',
    help: 'Personal finance from helpers a money-app sync keeps up to date, named <prefix>_<role>.',
    field: obj({
      prefix: text({ kind: 'slug', placeholder: 'fold' }),
      people: list(obj({ id: text({ req: true, kind: 'slug', label: 'ID' }), name: text({ req: true }), prefix: text({ kind: 'slug' }), store: text({ kind: 'slug' }), snapshotStore: text({ kind: 'slug' }), activityStore: text({ kind: 'slug' }), ordersStore: text({ kind: 'slug' }) }), { item: 'person', title: 'name', help: 'More than one person’s money, each with their own sync.' }),
      hide: many(LAYOUTS, { label: 'Blur amounts on', help: 'Layouts where amounts start blurred (default: tablet).' }),
      cardColors: map(tuple([text({ kind: 'color' }), text({ kind: 'color' })], { labels: ['From', 'To'] }), { keyHelp: 'The card’s name' }),
      store: text({ kind: 'slug', help: 'Chart data the sync writes (default dashboard-money).' }),
      skipCategories: list(text(), { item: 'category', help: 'Spending categories the charts leave out (default: Credit Bill).' }),
      hideAccounts: list(entity(['input_number']), { item: 'account', help: 'Bank account or card helpers to leave off the page.' }),
      snapshotStore: text({ kind: 'slug' }),
      activityStore: text({ kind: 'slug' }),
      editsStore: text({ kind: 'slug' }),
      ordersStore: text({ kind: 'slug', help: 'Every mutual fund order the sync writes (default dashboard-fold-orders); the returns, gains and SIP forecast come from it.' }),
      fundClasses: map(oneOf(['equity', 'debt', 'other']), { keyHelp: 'a piece of the fund’s name', help: 'A fund’s tax class by a piece of its name, when the guess from its category is wrong.' }),
      expectedIncome: list(obj({ name: text({ req: true }), amount: num({ req: true, min: 0 }), day: num({ req: true, min: 1, max: 31, help: 'Day of the month it arrives.' }) }), { item: 'income', title: 'name', help: 'Money that arrives each month, counted in the cash-flow forecast.' }),
    }),
  },
  ALERTS: {
    group: 'Screens and alerts',
    title: 'Alerts',
    help: '"Done" and "door left open" banners, and which HA notifications are mirrored on the screen.',
    field: obj({
      chime: bool(),
      doorOpenMinutes: num({ min: 0, max: 120, unit: 'min' }),
      notify: list(text(), { item: 'service', help: 'notify services whose messages also show here; a trailing * matches a prefix; none turns mirroring off.' }),
      seconds: num({ min: 1, max: 600, unit: 's', help: 'How long an alert stays up.' }),
      alarms: list(text(), { item: 'word', help: 'Words that make a mirrored notification an alarm.' }),
    }),
  },
  DOORBELL: { group: 'Screens and alerts', title: 'Doorbell', help: 'Optional: without it the camera and the press sensor are found by name.', field: obj({ camera: entity(['camera']), press: entity(['binary_sensor']), seconds: num({ min: 5, max: 600, unit: 's' }) }) },
  NIGHT_MODE: { group: 'Screens and alerts', title: 'Night mode', field: obj({ enabled: bool(), idleMinutes: num({ min: 1, max: 600, unit: 'min' }), nightOnly: bool(), layouts: many(LAYOUTS) }) },
  HOME_IDLE: { group: 'Screens and alerts', title: 'Back to Home when idle', field: obj({ minutes: num({ min: 0, max: 600, unit: 'min', help: '0 turns it off (default 2).' }), layouts: many(LAYOUTS) }) },
  SCREEN_POWER: {
    group: 'Screens and alerts',
    title: 'Wall-screen power',
    help: 'For a ChromeOS tablet running the extension in kiosk-extension/.',
    field: obj({
      enabled: bool({ help: 'Off keeps the screen on always.' }),
      quiet: tuple([text({ kind: 'time' }), text({ kind: 'time' })], { labels: ['From', 'To'], label: 'Quiet hours' }),
      vacation: bool({ help: 'While vacation mode is on the screen may turn off once nobody is seen.' }),
      rooms: list(text({ kind: 'slug' }), { item: 'room', help: 'Room IDs whose presence sensors count (default: every room).' }),
      holdMinutes: num({ min: 0, max: 120, unit: 'min' }),
      entity: entity(['input_boolean'], { help: 'Kept in step with the display; toggling it turns the display on or off.' }),
      battery: entity(['input_number'], { help: 'The wall screen writes its battery level (0–100) here.' }),
    }),
  },
  BATTERIES: { group: 'Other', title: 'Batteries', help: 'Every battery is found by itself.', field: obj({ low: num({ min: 1, max: 99, unit: '%', help: 'At or below this a battery counts as low (default 20).' }), hide: list(entity(['sensor']), { item: 'battery' }) }) },
  STORAGE: { group: 'Other', title: 'Shared storage', help: 'Where a login that can’t save to Home Assistant’s dashboards saves instead.', field: obj({ inbox: either(entity(['todo']), bool(), { help: 'A Local To-do list (default todo.dashboard_data, used when it exists), or off.' }) }) },
} satisfies Record<keyof DashboardConfig, Section>;

export type SectionKey = keyof typeof SCHEMA;
export const SECTION_KEYS = Object.keys(SCHEMA) as SectionKey[];

// "windowStartHour" → "Window start hour".
export function labelOf(key: string, f?: Field): string {
  if (f?.label) return f.label;
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// A new value for a field (what "+ Add" or switching a setting on starts from).
export function blank(f: Field): unknown {
  switch (f.t) {
    case 'entity':
    case 'string':
      return '';
    case 'number':
      return f.min ?? 0;
    case 'bool':
      return false;
    case 'enum':
      return f.options[0];
    case 'multi':
    case 'list':
      return [];
    case 'tuple':
      return f.of.map(blank);
    case 'map':
      return {};
    case 'either':
      return blank(f.a);
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, sub] of Object.entries(f.fields)) if (sub.req) out[k] = blank(sub);
      return out;
    }
  }
}
