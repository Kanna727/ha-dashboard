// Example dashboard config for a fictional home. Copy it to
// config/dashboard.config.ts (gitignored) and replace the entity IDs with yours.
// It is compiled to config.js, which is deployed next to index.html.
import type { DashboardConfig } from '../src/config/types';

const config: DashboardConfig = {
  ROOMS: [
    {
      id: 'living_room',
      detailCards: ['media'],
      quick: { entity: 'fan.sofa_fan', kind: 'fan' },
      name: 'Living Room',
      icon: 'sofa',
      temperature: 'sensor.living_room_hub_living_room_temperature',
      humidity: 'sensor.living_room_hub_living_room_humidity',
      presence: [
        'binary_sensor.living_room_presence_zone_1',
        'binary_sensor.living_room_presence_zone_2',
        'binary_sensor.living_room_presence_zone_4',
        'binary_sensor.living_room_presence_zone_6',
      ],
      doors: ['binary_sensor.living_room_main_door'],
      controls: [
        { entity: 'light.living_room_living_room_t_light', name: 'Light' },
        { entity: 'fan.sofa_fan', name: 'Sofa Fan' },
        { entity: 'fan.tv_fan', name: 'TV Fan' },
        { entity: 'switch.tv_unit_plug', name: 'TV Unit', icon: 'avUnit' },
      ],
    },
    {
      id: 'kitchen',
      quick: { entity: 'fan.kitchen_fan', kind: 'fan' },
      appliances: ['purifier'],
      name: 'Kitchen',
      icon: 'utensils',
      presence: [
        'binary_sensor.living_room_presence_zone_3',
        'binary_sensor.living_room_presence_zone_5',
      ],
      doors: ['binary_sensor.kitchen_fridge_door_sensor_door', 'binary_sensor.kitchen_oven_door'],
      controls: [
        { entity: 'light.kitchen_kitchen_t_light', name: 'Light' },
        { entity: 'fan.kitchen_fan', name: 'Fan' },
        { entity: 'switch.kitchen_kitchen_small_appliances', name: 'Appliances', icon: 'blender' },
        { entity: 'switch.kitchen_oven', name: 'Oven', icon: 'oven' },
        { entity: 'switch.kitchen_fridge', name: 'Fridge', icon: 'fridge', readOnly: true },
      ],
    },
    {
      id: 'bedroom',
      detailCards: ['climate'],
      quick: { entity: 'fan.bedroom_fan', kind: 'fan' },
      name: 'Bedroom',
      icon: 'bed',
      temperature: 'sensor.bedroom_bedroom_hub_temperature',
      humidity: 'sensor.bedroom_bedroom_hub_humidity',
      presence: ['binary_sensor.bedroom_bedroom_presence_sensor_occupancy'],
      doors: [],
      controls: [
        { entity: 'light.bedroom_bedroom_light', name: 'Light 1' },
        { entity: 'light.bedroom_bedroom_light_2', name: 'Light 2' },
        { entity: 'fan.bedroom_fan', name: 'Fan' },
      ],
    },
    {
      id: 'workroom',
      appliances: ['desk'],
      quick: { entity: 'fan.work_room_fan', kind: 'fan' },
      name: 'Workroom',
      icon: 'desk',
      temperature: 'sensor.workroom_workroom_hub_temperature',
      humidity: 'sensor.workroom_workroom_hub_humidity',
      presence: ['binary_sensor.workroom_workroom_presence_sensor_occupancy'],
      doors: [],
      controls: [
        { entity: 'light.workroom_workroom_light', name: 'Light' },
        { entity: 'fan.work_room_fan', name: 'Fan' },
        { entity: 'switch.workroom_pc', name: 'PC', icon: 'pc', confirmOff: true },
      ],
    },
    {
      id: 'common_bathroom',
      quick: { entity: 'switch.common_bathroom_common_bathroom_geyser', kind: 'geyser' },
      name: 'Common Bath',
      icon: 'shower',
      presence: ['binary_sensor.common_bathroom_common_bathroom_presence_sensor_occupancy'],
      doors: ['binary_sensor.common_bathroom_common_bathroom_door_sensor_door'],
      controls: [
        { entity: 'light.common_bathroom_common_bathroom_light', name: 'Light' },
        { entity: 'switch.common_bathroom_common_bathroom_geyser', name: 'Geyser', icon: 'geyser' },
      ],
    },
    {
      id: 'master_bathroom',
      quick: { entity: 'switch.master_bathroom_master_bathroom_geyser', kind: 'geyser' },
      name: 'Master Bath',
      icon: 'bathtub',
      presence: ['binary_sensor.master_bathroom_master_bathroom_presence_sensor_occupancy'],
      doors: ['binary_sensor.master_bathroom_master_bathroom_door_sensor_door'],
      controls: [
        { entity: 'light.master_bathroom_master_bathroom_light', name: 'Light' },
        { entity: 'switch.master_bathroom_master_bathroom_geyser', name: 'Geyser', icon: 'geyser' },
      ],
    },
    {
      id: 'utility',
      appliances: ['washer', 'dishwasher', 'vacuum'],
      name: 'Utility',
      icon: 'washer',
      presence: [],
      doors: ['binary_sensor.utility_utility_door_sensor_door', 'binary_sensor.utility_washing_machine_door_sensor_door'],
      controls: [
        { entity: 'light.utility_utility_light', name: 'Light 1' },
        { entity: 'light.utility_utility_light_2', name: 'Light 2' },
        { entity: 'switch.utility_washing_machine', name: 'Washer', icon: 'washer' },
      ],
    },
  ],
  // Per-fan "manual off" flag. While it is on, the fan's automations won't turn the fan on.
  // (The *_temp_override booleans are a different flag: they bypass the temperature condition.)
  FAN_MANUAL_OFF: {
    'fan.sofa_fan': 'input_boolean.sofa_fan_manual_off',
    'fan.tv_fan': 'input_boolean.tv_fan_manual_off',
    'fan.bedroom_fan': 'input_boolean.bedroom_fan_manual_off',
    'fan.work_room_fan': 'input_boolean.workroom_fan_manual_off',
  },
  VACATION_MODE: 'input_boolean.vacation_mode',
  WEATHER: 'weather.forecast_home',
  OUTDOOR_TEMP: 'sensor.outdoor_temperature',
  SUN: 'sun.sun',
  CLIMATE: {
    entity: 'climate.ac',
    power: 'switch.ac_power',
    energyToday: 'sensor.ac_energy_today',
    pm25: 'sensor.ac_pm2_5',
  },
  ENERGY: {
    // Template helper: sum of the consumer plugs that are reporting (created 2026-10-14).
    total: 'sensor.home_power',
    // The older min_max sum. It goes `unknown` when any plug is offline; only used to
    // fill the 24h chart before sensor.home_power has a day of history.
    legacyTotal: 'sensor.total_power_consumption',
    // Smart plugs are discovered, not listed: any power sensor (W/kW, state_class
    // measurement) on a device that also has a switch.* entity. sensor.home_power
    // in HA uses the same rule, so a new plug shows up in both on its own.
    // New plugs take their name from HA (minus " Power") and an icon/colour
    // guessed from it (PLUG_GUESSES in components/useHomePower.ts). This map only
    // gives known plugs shorter names and fixed colours.
    plugs: {
      'sensor.kitchen_fridge_power': { name: 'Fridge', icon: 'fridge', color: '#38bdf8' },
      'sensor.workroom_pc_power': { name: 'PC', icon: 'pc', color: '#f472b6' }, // pink: purple was too dim on dark panels
      'sensor.tv_unit_plug_power': { name: 'TV Unit', icon: 'avUnit', color: '#c084fc' },
      'sensor.common_bathroom_common_bathroom_geyser_power': { name: 'Common Geyser', icon: 'geyser', color: '#fb923c' },
      'sensor.master_bathroom_master_bathroom_geyser_power': { name: 'Master Geyser', icon: 'geyser', color: '#fb923c' },
      'sensor.kitchen_kitchen_small_appliances_power': { name: 'Appliances', icon: 'blender', color: '#fbbf24' },
      'sensor.kitchen_oven_power': { name: 'Oven', icon: 'oven', color: '#f87171' },
      'sensor.utility_dishwasher_power': { name: 'Dishwasher', icon: 'dishwasher', color: '#2dd4bf' },
      'sensor.utility_washing_machine_power': { name: 'Washer', icon: 'washer', color: '#34d399' },
    },
  },
  APPLIANCES: {
    dishwasher: {
      state: 'sensor.utility_dishwasher_operation_state',
      progress: 'sensor.dishwasher_program_progress',
      finish: 'sensor.dishwasher_program_finish_time',
      connectivity: 'binary_sensor.dishwasher_connectivity',
      control: {
        program: 'select.utility_dishwasher_selected_program',
        stop: 'button.dishwasher_stop_program',
        power: 'switch.utility_dishwasher_power',
        plug: 'switch.utility_dishwasher',
        watts: 'sensor.utility_dishwasher_power',
        remoteStart: 'binary_sensor.utility_dishwasher_remote_start',
      },
    },
    washer: {
      running: 'input_boolean.washing_machine_running',
      power: 'sensor.utility_washing_machine_power',
      door: 'binary_sensor.utility_washing_machine_door_sensor_door',
    },
    // Optional. Mode changes need two taps; faults also show as top-bar issues.
    purifier: {
      tankTds: 'sensor.water_purifier_tank_tds',
      inputTds: 'sensor.water_purifier_input_tds',
      tankFull: 'binary_sensor.water_purifier_tank_full',
      mode: 'select.water_purifier_purification_mode',
      fallbackMode: 'select.water_purifier_fallback_mode',
      refresh: 'button.water_purifier_refresh',
      lastReported: 'sensor.water_purifier_last_reported',
      faults: [
        { entity: 'binary_sensor.water_purifier_no_water', name: 'No water' },
        { entity: 'binary_sensor.water_purifier_filter_choked', name: 'Filter choked' },
        { entity: 'binary_sensor.water_purifier_valve_fault', name: 'Valve fault' },
        { entity: 'binary_sensor.water_purifier_system_fault', name: 'System fault' },
      ],
    },
  },
  MEDIA: [
    { entity: 'media_player.tv_2', name: 'TV' },
    { entity: 'media_player.living_room_apple_tv', name: 'Apple TV' },
    { entity: 'media_player.laptop', name: 'Laptop' },
    { entity: 'media_player.desktop_pc', name: 'PC' },
  ],
  CAR: {
    name: 'My Car',
    lock: 'lock.car_door_lock',
    fuel: 'sensor.car_fuel_level',
    range: 'sensor.car_fuel_driving_range',
    odometer: 'sensor.car_odometer',
    doors: [
      'binary_sensor.car_front_left_door',
      'binary_sensor.car_front_right_door',
      'binary_sensor.car_back_left_door',
      'binary_sensor.car_back_right_door',
      'binary_sensor.car_hood',
      'binary_sensor.car_trunk',
    ],
    warnings: [
      { entity: 'binary_sensor.car_tire_pressure_all', name: 'Tyre pressure' },
      { entity: 'binary_sensor.car_brake_fluid_warning', name: 'Brake fluid' },
      { entity: 'binary_sensor.car_washer_fluid_warning', name: 'Washer fluid' },
      { entity: 'binary_sensor.car_smart_key_battery_warning', name: 'Key battery' },
      { entity: 'binary_sensor.car_fuel_low_level', name: 'Low fuel' },
    ],
  },
  NETWORK: { wan: 'binary_sensor.router_wan_status' },
  // Commute map settings (API key, origin/destination, vehicle) are read at
  // runtime from this Lovelace card, so the key never lands in the public
  // /local/ bundle and the Lovelace card stays the single source of truth.
  COMMUTE: {
    dashboard: 'lovelace',
    cardType: 'custom:commute-traffic-map',
    // Days (0 = Sunday) and hours when the route auto-refreshes and alerts.
    windowDays: [2, 4, 5],
    windowStartHour: 9,
    windowEndHour: 11,
    // When you want to arrive: the Home page's commute tile counts down to leaving.
    arriveBy: '10:30',
  },
  FRIDGE: { power: 'sensor.kitchen_fridge_power', door: 'binary_sensor.kitchen_fridge_door_sensor_door' },
  MUSIC_PLAYERS: [
    { entity: 'media_player.living_room_dot', name: 'Living Room' },
    { entity: 'media_player.bedroom_dot', name: 'Bedroom' },
    { entity: 'media_player.work_room_dot', name: 'Workroom' },
    { entity: 'media_player.living_room_apple_tv', name: 'Apple TV' },
    { entity: 'media_player.laptop', name: 'Laptop' },
    { entity: 'media_player.desktop_pc', name: 'PC' },
  ],
  HOME_ZONE: 'zone.home',
  // Extra car entities used by the car detail modal.
  CAR_DETAIL: {
    image: '../car.png', // /config/www/car.png, relative to /local/dashboard/
    location: 'device_tracker.car_location',
    battery12v: 'sensor.car_car_battery_level',
    climate: 'switch.car_climate',
    lastUpdated: 'sensor.car_last_updated_at',
    tyres: {
      frontLeft: 'binary_sensor.car_tire_pressure_front_left',
      frontRight: 'binary_sensor.car_tire_pressure_front_right',
      rearLeft: 'binary_sensor.car_tire_pressure_rear_left',
      rearRight: 'binary_sensor.car_tire_pressure_rear_right',
    },
    openings: [
      { entities: ['binary_sensor.car_front_left_door', 'binary_sensor.car_front_right_door', 'binary_sensor.car_back_left_door', 'binary_sensor.car_back_right_door'], name: 'Doors' },
      { entities: ['binary_sensor.car_trunk'], name: 'Tailgate' },
      { entities: ['binary_sensor.car_hood'], name: 'Bonnet' },
    ],
    engine: 'binary_sensor.car_engine',
    // Optional 3D model in the car modal: an optimised .glb in /config/www/
    // (scripts/car-model). Falls back to `image` when missing.
    // rhd: true converts a left-hand-drive model to right-hand drive; plate is
    // shown on the number plates (made up here).
    model: { url: '../car.glb', paint: '#2c3527', gloss: 0.4, plate: 'AB12 CD 3456' },
    // Extra entities shown on the 3D car: lamps, heaters, seats.
    status: {
      headlamps: 'binary_sensor.car_headlamp_status',
      turnSignals: [
        'binary_sensor.car_turn_signal_left_front',
        'binary_sensor.car_turn_signal_right_front',
        'binary_sensor.car_turn_signal_left_rear',
        'binary_sensor.car_turn_signal_right_rear',
      ],
      lampFaults: [
        { entity: 'binary_sensor.car_front_left_lamp_fault', name: 'Front left lamp' },
        { entity: 'binary_sensor.car_front_right_lamp_fault', name: 'Front right lamp' },
        { entity: 'binary_sensor.car_headlamp_left_high_fault', name: 'Left high beam' },
        { entity: 'binary_sensor.car_headlamp_right_high_fault', name: 'Right high beam' },
        { entity: 'binary_sensor.car_headlamp_left_bifunctional_fault', name: 'Left headlamp' },
        { entity: 'binary_sensor.car_headlamp_right_bifunctional_fault', name: 'Right headlamp' },
        { entity: 'binary_sensor.car_rear_left_lamp_fault', name: 'Rear left lamp' },
        { entity: 'binary_sensor.car_rear_right_lamp_fault', name: 'Rear right lamp' },
      ],
      airConditioner: 'binary_sensor.car_air_conditioner',
      defrost: 'binary_sensor.car_defrost',
      rearWindowHeater: 'binary_sensor.car_back_window_heater',
      steeringHeater: 'binary_sensor.car_steering_wheel_heater',
      seats: {
        frontLeft: 'sensor.car_front_left_seat',
        frontRight: 'sensor.car_front_right_seat',
        rearLeft: 'sensor.car_rear_left_seat',
        rearRight: 'sensor.car_rear_right_seat',
      },
      locationUpdated: 'sensor.car_location_last_updated',
    },
    // Remote actions in the car modal. Hazards and horn need a second tap.
    actions: {
      refresh: 'button.car_force_refresh',
      hazards: 'button.car_start_hazard_lights',
      hornHazards: 'button.car_start_hazard_lights_and_horn',
      climate: 'climate.car_climate_control',
    },
  },
  // Full-screen alerts when the washer or dishwasher finishes, a door stays open,
  // or a Home Assistant automation notifies the phones (notify.notify, notify.mobile_app_*).
  // A notification whose title or message contains one of `alarms` is an alarm: red, a siren, up until tapped.
  ALERTS: { chime: true, doorOpenMinutes: 3, notify: ['notify', 'mobile_app_*'], seconds: 30, alarms: ['shoe rack'] },
  // Night screen on the iPad: after 5 idle minutes, only while the sun is down.
  NIGHT_MODE: { enabled: true, idleMinutes: 5, nightOnly: true, layouts: ['tablet'] },
  // Back to the Home page after 2 minutes left alone (tablet only); 0 = off.
  HOME_IDLE: { minutes: 2, layouts: ['tablet'] },
  // Robot vacuum page (optional: without it the first vacuum.* entity is used).
  // It opens by itself while the robot runs; `autoOpen: false` turns that off.
  VACUUM: { entity: 'vacuum.robot', map: 'camera.robot_map' },
  // Standing desk (optional: without it the first number.*_desk_height is used;
  // the rest of its entities are found from its name and device). `look` sizes the
  // 3D desk's top in cm and colours the top and frame.
  DESK: { entity: 'number.standing_desk_desk_height', look: { top: [140, 70], board: '#cf9452', frame: '#17181b' } },
  // Health panel: whose scale, recovery wearable and indoor-cycling account is
  // whose (any one entity of each device; the rest is found from the device).
  HEALTH: {
    people: [
      { name: 'Alex', color: '#60a5fa', scale: 'sensor.bathroom_scale_alex_weight', wearable: 'sensor.band_alex_recovery_score', cycling: 'sensor.ride_alex_ftp' },
      { name: 'Sam', color: '#f472b6', scale: 'sensor.bathroom_scale_sam_weight', cycling: 'sensor.ride_sam_ftp' },
    ],
  },
  // Batteries panel (every battery is found by itself): low below 20 %, and
  // anything to leave out.
  BATTERIES: { low: 20, hide: [] },
  // Weekly meal plan shown in the Meals panel. Days without a plan show
  // "No delivery planned".
  MEALS: {
    people: [
      { id: 'a', name: 'Alex' },
      { id: 's', name: 'Sam' },
    ],
    slots: [
      { id: 'breakfast', label: 'Breakfast', time: 'Before 9:30 AM', end: '09:30', delivery: '7:30–8:00 AM' },
      { id: 'lunch', label: 'Lunch', time: '9:30 AM – 2 PM', end: '14:00', delivery: '7:30–8:00 AM' },
      { id: 'dinner', label: 'Dinner', time: '6 – 8 PM', end: '20:00', delivery: '6:00–6:30 PM' },
    ],
    plan: {
      1: {
        a: { breakfast: 'Masala Omelette + Toast', lunch: 'Chicken Rice Bowl', dinner: 'Grilled Fish + Greens' },
        s: { breakfast: 'Berry Oatmeal Bowl', lunch: 'Paneer Quinoa Bowl', dinner: 'Lentil Soup + Salad' },
      },
      2: {
        a: { breakfast: 'Breakfast Burrito', lunch: 'Burrito Rice Bowl', dinner: 'Chicken Salad + Roti' },
        s: { breakfast: 'Roasted Sweet Potato', lunch: 'Tofu Bowl + Brown Rice', dinner: 'Chicken Salad' },
      },
      3: {
        a: { breakfast: 'Idli + Sambar', lunch: 'Garlic Prawns + Brown Rice', dinner: 'Fish Plate' },
        s: { breakfast: 'Fruit Oatmeal Bowl', lunch: 'Dal Rice Bowl', dinner: 'Fish Plate (extra veg)' },
      },
      4: {
        a: { breakfast: 'Protein Roti + Juice', lunch: 'Dal Rice Bowl', dinner: 'Chicken Bowl + Sweet Potato' },
        s: { breakfast: 'Protein Roti', lunch: 'Fish + Quinoa + Salad', dinner: 'Chicken Bowl + Mushroom Salad' },
      },
      5: {
        a: { breakfast: 'Breakfast Burrito', lunch: 'Prawns + Brown Rice', dinner: 'Fish Plate' },
        s: { breakfast: 'Berry Oatmeal Bowl', lunch: 'Chicken + Dal Rice + Salad', dinner: 'Fish Plate (extra veg)' },
      },
      6: {
        a: { breakfast: 'Oatmeal + Banana Shake', lunch: 'Burrito Rice Bowl', dinner: 'Chicken + Quinoa + Veg' },
        s: { breakfast: 'Roasted Sweet Potato', lunch: 'Tofu Bowl + Quinoa', dinner: 'Prawns + Chicken Salad' },
      },
    },
    notes: [
      'Grilled and pan-tossed items: olive oil, no butter or cream bases.',
      'Dressings on the side.',
    ],
  },
};

export default config;
