import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

// States for the fictional home in config/dashboard.config.example.ts, tuned so
// every card has something to show (car online, dishwasher mid-cycle).
const now = new Date().toISOString();

function e(entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id,
    state,
    attributes,
    last_changed: now,
    last_updated: now,
    context: { id: 'mock', parent_id: null, user_id: null },
  };
}

// Smart plug power sensor, with the attributes plug discovery looks for.
const plug = (entity_id: string, state: string, name: string) =>
  e(entity_id, state, { device_class: 'power', state_class: 'measurement', unit_of_measurement: 'W', friendly_name: name });

// Lights like the real ones: white-only (warmth) for the two 't_light' bulbs, colour for the rest.
const white = { supported_color_modes: ['color_temp'], min_color_temp_kelvin: 2700, max_color_temp_kelvin: 6500 };
const rgbw = { supported_color_modes: ['color_temp', 'hs', 'xy'], min_color_temp_kelvin: 2202, max_color_temp_kelvin: 6535 };
const fan = { percentage_step: 16.666666666666668 };

const list: HassEntity[] = [
  e('sun.sun', 'below_horizon', {
    next_rising: new Date(Date.now() + 9 * 3600_000).toISOString(),
    next_setting: new Date(Date.now() + 21 * 3600_000).toISOString(),
    elevation: -38.4,
    azimuth: 282,
    rising: false,
  }),
  e('weather.forecast_home', 'partlycloudy', {
    temperature: 27.9,
    apparent_temperature: 30.4,
    dew_point: 26.4,
    humidity: 92,
    cloud_coverage: 48,
    uv_index: 0,
    pressure: 1009.6,
    pressure_unit: 'hPa',
    wind_bearing: 240,
    wind_speed: 8.6,
    wind_gust_speed: 19,
    wind_speed_unit: 'km/h',
    visibility: 14,
    visibility_unit: 'km',
    attribution: 'Mock weather',
  }),
  // Readings a weather integration adds as sensors on its device (found via the registry).
  e('sensor.forecast_home_weather_condition', 'Partly cloudy'),
  e('sensor.forecast_home_precipitation_probability', '20', { unit_of_measurement: '%' }),
  e('sensor.forecast_home_precipitation_intensity', '0.0', { unit_of_measurement: 'mm/h', device_class: 'precipitation_intensity' }),
  e('sensor.forecast_home_thunderstorm_probability', '10', { unit_of_measurement: '%' }),
  e('sensor.forecast_home_heat_index', '30.4', { unit_of_measurement: '°C', device_class: 'temperature' }),
  e('sensor.forecast_home_wind_chill', '27.9', { unit_of_measurement: '°C', device_class: 'temperature' }),
  e('sensor.outdoor_temperature', '27.9'),
  e('person.alex', 'home', { friendly_name: 'Alex' }),
  // Placeholder coordinates only; never real locations in fixtures.
  e('zone.home', '1', { latitude: 10.0, longitude: 10.0 }),
  e('binary_sensor.router_wan_status', 'on'),
  e('input_text.dashboard_build', 'dev'),

  // Living room
  e('sensor.living_room_hub_living_room_temperature', '29.3'),
  e('sensor.living_room_hub_living_room_humidity', '64'),
  e('sensor.living_room_light_level', '142', { device_class: 'illuminance', unit_of_measurement: 'lx' }),
  e('binary_sensor.living_room_presence_zone_1', 'on'),
  e('binary_sensor.living_room_presence_zone_2', 'on'),
  e('binary_sensor.living_room_presence_zone_4', 'off'),
  e('binary_sensor.living_room_presence_zone_6', 'off'),
  e('binary_sensor.living_room_main_door', 'off'),
  e('light.living_room_living_room_t_light', 'on', { ...white, brightness: 204, color_mode: 'color_temp', color_temp_kelvin: 2700 }),
  e('fan.sofa_fan', 'on', { ...fan, percentage: 83 }),
  e('fan.tv_fan', 'off', fan),
  e('switch.tv_unit_plug', 'on'),

  // Kitchen
  e('binary_sensor.living_room_presence_zone_3', 'off'),
  e('binary_sensor.living_room_presence_zone_5', 'off'),
  e('binary_sensor.kitchen_fridge_door_sensor_door', 'off'),
  e('binary_sensor.kitchen_oven_door', 'off'),
  e('light.kitchen_kitchen_t_light', 'unavailable', white),
  e('fan.kitchen_fan', 'off', fan),
  e('switch.kitchen_kitchen_small_appliances', 'off'),
  e('switch.kitchen_oven', 'off'),
  e('switch.kitchen_fridge', 'on'),

  // Bedroom
  // Too cool for the fan and too bright for the lights, so both readings show red.
  e('sensor.bedroom_bedroom_hub_temperature', '26.4'),
  e('sensor.bedroom_bedroom_hub_humidity', '72'),
  e('sensor.bedroom_light_level', '12'),
  e('input_boolean.bedroom_fan_temp_override', 'off'),
  e('binary_sensor.bedroom_bedroom_presence_sensor_occupancy', 'off'),
  e('light.bedroom_bedroom_light', 'off', rgbw),
  e('light.bedroom_bedroom_light_2', 'off', rgbw),
  e('fan.bedroom_fan', 'off', fan),

  // Workroom
  e('sensor.workroom_workroom_hub_temperature', '29.0'),
  e('sensor.workroom_workroom_hub_humidity', '64'),
  e('sensor.workroom_light_level', '35'),
  e('binary_sensor.workroom_workroom_presence_sensor_occupancy', 'on'),
  e('light.workroom_workroom_light', 'on', { ...rgbw, brightness: 255, color_mode: 'color_temp', color_temp_kelvin: 4000 }),
  e('fan.work_room_fan', 'off', fan),
  e('switch.workroom_pc', 'on'),

  // Bathrooms
  e('binary_sensor.common_bathroom_common_bathroom_presence_sensor_occupancy', 'off'),
  e('binary_sensor.common_bathroom_common_bathroom_door_sensor_door', 'unavailable'),
  e('light.common_bathroom_common_bathroom_light', 'off', rgbw),
  e('switch.common_bathroom_common_bathroom_geyser', 'off'),
  e('binary_sensor.master_bathroom_master_bathroom_presence_sensor_occupancy', 'off'),
  e('binary_sensor.master_bathroom_master_bathroom_door_sensor_door', 'on'),
  e('light.master_bathroom_master_bathroom_light', 'off', rgbw),
  e('switch.master_bathroom_master_bathroom_geyser', 'off'),

  // Utility
  e('binary_sensor.utility_utility_door_sensor_door', 'off'),
  e('binary_sensor.utility_washing_machine_door_sensor_door', 'off'),
  e('light.utility_utility_light', 'off', rgbw),
  e('light.utility_utility_light_2', 'off', rgbw),
  e('switch.utility_washing_machine', 'on'),
  e('input_boolean.washing_machine_running', 'on'),
  // Automations whose thresholds the room cards show (configs in AUTOMATIONS below)
  e('automation.living_room_occupied', 'on'),
  e('automation.sofa_fan_on_when_hot', 'on'),
  e('automation.bedroom_occupied', 'on'),
  e('automation.workroom_occupied', 'on'),
  // Fan manual-off flags (bedroom is held, like in the real house)
  e('input_boolean.sofa_fan_manual_off', 'off'),
  e('input_boolean.tv_fan_manual_off', 'off'),
  e('input_boolean.bedroom_fan_manual_off', 'on'),
  e('input_boolean.workroom_fan_manual_off', 'off'),
  plug('sensor.utility_washing_machine_power', '312', 'Washing Machine Power'),
  e('sensor.utility_dishwasher_operation_state', 'run'),
  e('sensor.dishwasher_program_progress', '42'),
  e('sensor.dishwasher_program_finish_time', new Date(Date.now() + 65 * 60_000).toISOString()),
  e('binary_sensor.dishwasher_connectivity', 'on'),
  // Water purifier (Kitchen). __mockPatch('binary_sensor.water_purifier_no_water', { state: 'on' }) shows a fault.
  e('sensor.water_purifier_tank_tds', '85.42', { unit_of_measurement: 'ppm', state_class: 'measurement' }),
  e('sensor.water_purifier_input_tds', '247.19', { unit_of_measurement: 'ppm', state_class: 'measurement' }),
  e('binary_sensor.water_purifier_tank_full', 'on'),
  e('select.water_purifier_purification_mode', 'TasteTune 50-100 ppm', {
    options: ['RO only', 'Adaptive', 'TasteTune 50-100 ppm', 'TasteTune 75-125 ppm', 'TasteTune 100-150 ppm', 'Vacation'],
  }),
  e('select.water_purifier_fallback_mode', 'TasteTune 50-100 ppm', {
    options: ['RO only', 'TasteTune 50-100 ppm', 'TasteTune 75-125 ppm', 'TasteTune 100-150 ppm'],
  }),
  e('button.water_purifier_refresh', 'unknown'),
  e('sensor.water_purifier_last_reported', new Date(Date.now() - 95 * 60_000).toISOString(), { device_class: 'timestamp' }),
  e('binary_sensor.water_purifier_no_water', 'off', { device_class: 'problem' }),
  e('binary_sensor.water_purifier_filter_choked', 'off', { device_class: 'problem' }),
  e('binary_sensor.water_purifier_valve_fault', 'off', { device_class: 'problem' }),
  e('binary_sensor.water_purifier_system_fault', 'off', { device_class: 'problem' }),

  // Climate
  e('climate.ac', 'cool', {
    hvac_modes: ['off', 'dry', 'fan_only', 'auto', 'cool'],
    fan_modes: ['auto', 'low', 'medium', 'high'],
    fan_mode: 'auto',
    current_temperature: 28,
    temperature: 24,
    min_temp: 7,
    max_temp: 35,
  }),
  e('sensor.ac_energy_today', '1.84', { unit_of_measurement: 'kWh' }),
  e('sensor.ac_pm2_5', '18'),
  e('sensor.ac_energy_this_month', '1805', { unit_of_measurement: 'kWh' }),

  // Energy
  e('sensor.home_power', '1649.13', { device_class: 'power', state_class: 'measurement', unit_of_measurement: 'W' }),
  plug('sensor.kitchen_fridge_power', '716.7', 'Fridge Power'),
  plug('sensor.workroom_pc_power', '468.3', 'PC Power'),
  plug('sensor.tv_unit_plug_power', '462.9', 'TV Unit Power'),
  plug('sensor.common_bathroom_common_bathroom_geyser_power', '0', 'Common Bathroom Geyser Power'),
  plug('sensor.master_bathroom_master_bathroom_geyser_power', '0', 'Master Bathroom Geyser Power'),
  plug('sensor.kitchen_kitchen_small_appliances_power', '0', 'Kitchen Small Appliances Power'),
  plug('sensor.kitchen_oven_power', '0', 'Oven Power'),
  plug('sensor.utility_dishwasher_power', '1.19', 'Dishwasher Power'),
  // Not in ENERGY.plugs: shows that a new plug is picked up on its own.
  // `__mockPatch('sensor.bedroom_heater_power', { state: '900' })` puts it on the panel.
  plug('sensor.bedroom_heater_power', '0', 'Bedroom Heater Power'),
  e('switch.bedroom_heater', 'off'),
  // A bulb's power sensor: its device has no switch, so it must stay off the panel.
  plug('sensor.living_room_living_room_t_light_power', '9', 'Living room Light Power'),

  // Media
  e('media_player.tv_2', 'playing', { media_title: 'Formula 1: Singapore GP', app_name: 'Netflix' }),
  e('media_player.living_room_apple_tv', 'off'),
  e('media_player.living_room_dot', 'playing', { media_title: 'Clair de Lune', media_artist: 'Claude Debussy', supported_features: 5644 | 48 }),
  e('media_player.bedroom_dot', 'idle', { supported_features: 5644 }),
  e('media_player.work_room_dot', 'unavailable'),
  e('button.work_room_dot_restart', 'unknown'),
  e('media_player.desktop_pc', 'unavailable'),

  // Car
  e('lock.car_door_lock', 'locked'),
  e('sensor.car_fuel_level', '38'),
  e('sensor.car_fuel_driving_range', '312'),
  e('sensor.car_odometer', '18452'),
  e('binary_sensor.car_front_left_door', 'off'),
  e('binary_sensor.car_front_right_door', 'off'),
  e('binary_sensor.car_back_left_door', 'off'),
  e('binary_sensor.car_back_right_door', 'off'),
  e('binary_sensor.car_hood', 'off'),
  e('binary_sensor.car_trunk', 'off'),
  e('binary_sensor.car_tire_pressure_all', 'off'),
  e('binary_sensor.car_brake_fluid_warning', 'off'),
  e('binary_sensor.car_washer_fluid_warning', 'on'),
  e('binary_sensor.car_smart_key_battery_warning', 'off'),
  e('binary_sensor.car_fuel_low_level', 'off'),
  e('binary_sensor.car_tire_pressure_front_left', 'off'),
  e('binary_sensor.car_tire_pressure_front_right', 'off'),
  e('binary_sensor.car_tire_pressure_rear_left', 'off'),
  e('binary_sensor.car_tire_pressure_rear_right', 'off'),
  e('binary_sensor.car_engine', 'off'),
  e('device_tracker.car_location', 'home', { latitude: 10.0, longitude: 10.0 }),
  e('sensor.car_car_battery_level', '82', { unit_of_measurement: '%' }),
  e('switch.car_climate', 'off'),
  // Extra car status for the 3D model (CAR_DETAIL.status).
  e('binary_sensor.car_headlamp_status', 'off'),
  e('binary_sensor.car_turn_signal_left_front', 'off'),
  e('binary_sensor.car_turn_signal_right_front', 'off'),
  e('binary_sensor.car_turn_signal_left_rear', 'off'),
  e('binary_sensor.car_turn_signal_right_rear', 'off'),
  e('binary_sensor.car_front_left_lamp_fault', 'off'),
  e('binary_sensor.car_front_right_lamp_fault', 'off'),
  e('binary_sensor.car_headlamp_left_high_fault', 'off'),
  e('binary_sensor.car_headlamp_right_high_fault', 'off'),
  e('binary_sensor.car_headlamp_left_bifunctional_fault', 'off'),
  e('binary_sensor.car_headlamp_right_bifunctional_fault', 'off'),
  e('binary_sensor.car_rear_left_lamp_fault', 'off'),
  e('binary_sensor.car_rear_right_lamp_fault', 'off'),
  e('binary_sensor.car_air_conditioner', 'off'),
  e('binary_sensor.car_defrost', 'off'),
  e('binary_sensor.car_back_window_heater', 'off'),
  e('binary_sensor.car_steering_wheel_heater', 'off'),
  e('sensor.car_front_left_seat', 'Off'),
  e('sensor.car_front_right_seat', 'Off'),
  e('sensor.car_rear_left_seat', 'Off'),
  e('sensor.car_rear_right_seat', 'Off'),
  e('button.car_force_refresh', 'unknown'),
  e('button.car_start_hazard_lights', 'unknown'),
  e('button.car_start_hazard_lights_and_horn', 'unknown'),
  e('climate.car_climate_control', 'off', { hvac_modes: ['off', 'auto'], min_temp: 14, max_temp: 30, target_temp_step: 0.5, temperature: 22, unit_of_measurement: '°C' }),
  e('sensor.car_location_last_updated', new Date(Date.now() - 3 * 3600_000).toISOString()),
  e('sensor.car_last_updated_at', new Date(Date.now() - 40 * 60_000).toISOString()),

];

export const FIXTURES: HassEntities = Object.fromEntries(list.map((x) => [x.entity_id, x]));

// Smart plugs: a switch plus a power sensor on one device (what plug discovery keys on).
const PLUGS: [string, string, string][] = [
  ['dev_plug_fridge', 'switch.kitchen_fridge', 'sensor.kitchen_fridge_power'],
  ['dev_plug_pc', 'switch.workroom_pc', 'sensor.workroom_pc_power'],
  ['dev_plug_tv', 'switch.tv_unit_plug', 'sensor.tv_unit_plug_power'],
  ['dev_plug_cb_geyser', 'switch.common_bathroom_common_bathroom_geyser', 'sensor.common_bathroom_common_bathroom_geyser_power'],
  ['dev_plug_mb_geyser', 'switch.master_bathroom_master_bathroom_geyser', 'sensor.master_bathroom_master_bathroom_geyser_power'],
  ['dev_plug_appliances', 'switch.kitchen_kitchen_small_appliances', 'sensor.kitchen_kitchen_small_appliances_power'],
  ['dev_plug_oven', 'switch.kitchen_oven', 'sensor.kitchen_oven_power'],
  ['dev_plug_dishwasher', 'switch.utility_dishwasher', 'sensor.utility_dishwasher_power'],
  ['dev_plug_washer', 'switch.utility_washing_machine', 'sensor.utility_washing_machine_power'],
  ['dev_plug_heater', 'switch.bedroom_heater', 'sensor.bedroom_heater_power'],
];

// Device registry for the status dialog: four offline devices (one per
// recovery path) plus a healthy one that must not be listed. Also the plugs.
export const REGISTRY = {
  devices: [
    ...PLUGS.map(([id, sw]) => ({ id, name: `WiZ Socket ${sw.slice(7)}`, areaId: null, model: 'ESP25_SOCKET_01', disabled: false })),
    { id: 'dev_lr_light', name: 'Living Room Light', areaId: 'living_room', model: 'SHTW', disabled: false },
    { id: 'dev_dot_work', name: 'Work Room Dot', areaId: 'workroom', model: 'Echo Dot', disabled: false },
    { id: 'dev_kitchen_light', name: 'Kitchen Light', areaId: 'kitchen', model: 'SHTW', disabled: false },
    { id: 'dev_pc', name: 'DESKTOP-PC', areaId: 'workroom', model: 'Windows', disabled: false },
    { id: 'dev_cb_door', name: 'Common Bath Door Sensor', areaId: 'common_bathroom', model: 'Door sensor', disabled: false },
    { id: 'dev_dot_bed', name: 'Bedroom Dot', areaId: 'bedroom', model: 'Echo Dot', disabled: false },
    { id: 'dev_weather', name: 'Forecast Home', areaId: null, model: null, disabled: false },
  ],
  entities: [
    ...PLUGS.flatMap(([deviceId, sw, power]) => [
      { entityId: sw, deviceId, platform: 'wiz' },
      { entityId: power, deviceId, platform: 'wiz' },
    ]),
    { entityId: 'light.living_room_living_room_t_light', deviceId: 'dev_lr_light', platform: 'wiz' },
    { entityId: 'sensor.living_room_living_room_t_light_power', deviceId: 'dev_lr_light', platform: 'wiz' },
    { entityId: 'media_player.work_room_dot', deviceId: 'dev_dot_work', platform: 'alexa_devices' },
    { entityId: 'button.work_room_dot_restart', deviceId: 'dev_dot_work', platform: 'alexa_devices', category: 'config' },
    { entityId: 'light.kitchen_kitchen_t_light', deviceId: 'dev_kitchen_light', platform: 'wiz' },
    { entityId: 'media_player.desktop_pc', deviceId: 'dev_pc', platform: 'hass_agent' },
    { entityId: 'binary_sensor.common_bathroom_common_bathroom_door_sensor_door', deviceId: 'dev_cb_door', platform: 'matter' },
    { entityId: 'media_player.bedroom_dot', deviceId: 'dev_dot_bed', platform: 'alexa_devices' },
    { entityId: 'weather.forecast_home', deviceId: 'dev_weather', platform: 'weather_mock' },
    { entityId: 'sensor.forecast_home_weather_condition', deviceId: 'dev_weather', platform: 'weather_mock', translationKey: 'weather_condition' },
    { entityId: 'sensor.forecast_home_precipitation_probability', deviceId: 'dev_weather', platform: 'weather_mock', translationKey: 'precipitation_probability' },
    { entityId: 'sensor.forecast_home_precipitation_intensity', deviceId: 'dev_weather', platform: 'weather_mock' },
    { entityId: 'sensor.forecast_home_thunderstorm_probability', deviceId: 'dev_weather', platform: 'weather_mock', translationKey: 'thunderstorm_probability' },
    { entityId: 'sensor.forecast_home_heat_index', deviceId: 'dev_weather', platform: 'weather_mock', translationKey: 'heat_index' },
    { entityId: 'sensor.forecast_home_wind_chill', deviceId: 'dev_weather', platform: 'weather_mock', translationKey: 'wind_chill' },
  ],
};

export const TODO_ITEMS = [
  { uid: '1', summary: 'Milk', status: 'needs_action' as const },
  { uid: '2', summary: 'Eggs', status: 'needs_action' as const },
  { uid: '3', summary: 'Coffee beans', status: 'needs_action' as const },
  { uid: '4', summary: 'Dishwasher salt', status: 'needs_action' as const },
];

export const TODO_ITEMS_2 = [
  { uid: 't1', summary: 'Renew car insurance', status: 'needs_action' as const },
  { uid: 't2', summary: 'Book AC service', status: 'needs_action' as const },
];

// Hourly from the start of the current hour, ~30 h, with an afternoon shower.
export const FORECAST_HOURLY = Array.from({ length: 30 }, (_, i) => {
  const t = new Date();
  t.setMinutes(0, 0, 0);
  t.setHours(t.getHours() + i);
  const h = t.getHours();
  const rainy = h >= 15 && h <= 17;
  const temperature = 22 + 8 * Math.sin(((h - 8) / 24) * 2 * Math.PI);
  return {
    datetime: t.toISOString(),
    condition: rainy ? 'rainy' : h >= 19 || h < 6 ? 'clear-night' : h < 10 ? 'sunny' : 'partlycloudy',
    temperature,
    apparent_temperature: temperature + 1.5,
    precipitation: rainy ? 1.2 : 0,
    precipitation_probability: rainy ? 70 : h === 14 || h === 18 ? 30 : 5,
    wind_speed: 8 + (h % 5),
    is_daytime: h >= 6 && h < 18,
  };
});

export const FORECAST = ['partlycloudy', 'rainy', 'lightning-rainy', 'cloudy', 'sunny', 'partlycloudy', 'rainy'].map((condition, i) => ({
  datetime: new Date(Date.now() + i * 86400_000).toISOString(),
  condition,
  temperature: 30 - (i % 3),
  templow: 21 + (i % 2),
  precipitation: condition.includes('rain') ? 2.4 + i : 0,
  precipitation_probability: condition.includes('rain') ? 60 + i * 2 : 10,
  wind_speed: 10 + i,
  uv_index: 6 + (i % 3),
}));

// Automation configs (automation/config) behind the threshold colouring on the
// room cards: lights on below a light level, fans on above a temperature.
const lightsWhenDark = (sensor: string, below: number, light: string | string[]) => ({
  if: [{ condition: 'numeric_state', entity_id: sensor, below }],
  then: [{ action: 'light.turn_on', target: { entity_id: light } }],
});
const fanWhenHot = (sensor: string, fan: string, override?: string) => ({
  if: [
    override
      ? {
          condition: 'or',
          conditions: [
            { condition: 'numeric_state', entity_id: sensor, above: 27 },
            { condition: 'state', entity_id: override, state: 'on' },
          ],
        }
      : { condition: 'numeric_state', entity_id: sensor, above: 27 },
  ],
  then: [{ action: 'fan.turn_on', target: { entity_id: fan } }],
});
const occupied = (presence: string, ...branches: object[]) => ({
  triggers: [{ trigger: 'state', entity_id: presence, to: 'on' }],
  actions: [{ parallel: branches }],
  mode: 'single',
});

export const AUTOMATIONS = [
  {
    entityId: 'automation.living_room_occupied',
    config: occupied('binary_sensor.living_room_presence_zone_1', lightsWhenDark('sensor.living_room_light_level', 60, 'light.living_room_living_room_t_light')),
  },
  {
    entityId: 'automation.sofa_fan_on_when_hot',
    config: {
      triggers: [{ trigger: 'numeric_state', entity_id: 'sensor.living_room_hub_living_room_temperature', above: 27, for: { minutes: 1 } }],
      actions: [{ action: 'fan.turn_on', target: { entity_id: 'fan.sofa_fan' } }],
    },
  },
  {
    entityId: 'automation.bedroom_occupied',
    config: occupied(
      'binary_sensor.bedroom_bedroom_presence_sensor_occupancy',
      lightsWhenDark('sensor.bedroom_light_level', 6, ['light.bedroom_bedroom_light', 'light.bedroom_bedroom_light_2']),
      fanWhenHot('sensor.bedroom_bedroom_hub_temperature', 'fan.bedroom_fan', 'input_boolean.bedroom_fan_temp_override'),
    ),
  },
  {
    entityId: 'automation.workroom_occupied',
    config: occupied(
      'binary_sensor.workroom_workroom_presence_sensor_occupancy',
      lightsWhenDark('sensor.workroom_light_level', 6, 'light.workroom_workroom_light'),
      fanWhenHot('sensor.workroom_workroom_hub_temperature', 'fan.work_room_fan'),
    ),
  },
];
