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

const dimmable = { supported_color_modes: ['brightness'] };
const fan = { percentage_step: 16.666666666666668 };

const list: HassEntity[] = [
  e('sun.sun', 'below_horizon', {
    next_rising: new Date(Date.now() + 9 * 3600_000).toISOString(),
    next_setting: new Date(Date.now() + 21 * 3600_000).toISOString(),
  }),
  e('weather.forecast_home', 'partlycloudy', { temperature: 27.9, humidity: 92, wind_speed: 8.6, wind_speed_unit: 'km/h' }),
  e('sensor.outdoor_temperature', '27.9'),
  e('person.alex', 'home', { friendly_name: 'Alex' }),
  // Placeholder coordinates only; never real locations in fixtures.
  e('zone.home', '1', { latitude: 10.0, longitude: 10.0 }),
  e('binary_sensor.router_wan_status', 'on'),
  e('input_text.dashboard_build', 'dev'),

  // Living room
  e('sensor.living_room_hub_living_room_temperature', '29.3'),
  e('sensor.living_room_hub_living_room_humidity', '64'),
  e('binary_sensor.living_room_presence_zone_1', 'on'),
  e('binary_sensor.living_room_presence_zone_2', 'on'),
  e('binary_sensor.living_room_presence_zone_4', 'off'),
  e('binary_sensor.living_room_presence_zone_6', 'off'),
  e('binary_sensor.living_room_main_door', 'off'),
  e('light.living_room_living_room_t_light', 'on', { ...dimmable, brightness: 204 }),
  e('fan.sofa_fan', 'on', { ...fan, percentage: 83 }),
  e('fan.tv_fan', 'off', fan),
  e('switch.tv_unit_plug', 'on'),

  // Kitchen
  e('binary_sensor.living_room_presence_zone_3', 'off'),
  e('binary_sensor.living_room_presence_zone_5', 'off'),
  e('binary_sensor.kitchen_fridge_door_sensor_door', 'off'),
  e('binary_sensor.kitchen_oven_door', 'off'),
  e('light.kitchen_kitchen_t_light', 'unavailable', dimmable),
  e('fan.kitchen_fan', 'off', fan),
  e('switch.kitchen_kitchen_small_appliances', 'off'),
  e('switch.kitchen_oven', 'off'),
  e('switch.kitchen_fridge', 'on'),

  // Bedroom
  e('sensor.bedroom_bedroom_hub_temperature', '27.1'),
  e('sensor.bedroom_bedroom_hub_humidity', '72'),
  e('binary_sensor.bedroom_bedroom_presence_sensor_occupancy', 'off'),
  e('light.bedroom_bedroom_light', 'off', dimmable),
  e('light.bedroom_bedroom_light_2', 'off', dimmable),
  e('fan.bedroom_fan', 'off', fan),

  // Workroom
  e('sensor.workroom_workroom_hub_temperature', '29.0'),
  e('sensor.workroom_workroom_hub_humidity', '64'),
  e('binary_sensor.workroom_workroom_presence_sensor_occupancy', 'on'),
  e('light.workroom_workroom_light', 'on', { ...dimmable, brightness: 255 }),
  e('fan.work_room_fan', 'off', fan),
  e('switch.workroom_pc', 'on'),

  // Bathrooms
  e('binary_sensor.common_bathroom_common_bathroom_presence_sensor_occupancy', 'off'),
  e('binary_sensor.common_bathroom_common_bathroom_door_sensor_door', 'unavailable'),
  e('light.common_bathroom_common_bathroom_light', 'off', dimmable),
  e('switch.common_bathroom_common_bathroom_geyser', 'off'),
  e('binary_sensor.master_bathroom_master_bathroom_presence_sensor_occupancy', 'off'),
  e('binary_sensor.master_bathroom_master_bathroom_door_sensor_door', 'on'),
  e('light.master_bathroom_master_bathroom_light', 'off', dimmable),
  e('switch.master_bathroom_master_bathroom_geyser', 'off'),

  // Utility
  e('binary_sensor.utility_utility_door_sensor_door', 'off'),
  e('binary_sensor.utility_washing_machine_door_sensor_door', 'off'),
  e('light.utility_utility_light', 'off', dimmable),
  e('light.utility_utility_light_2', 'off', dimmable),
  e('switch.utility_washing_machine', 'on'),
  e('input_boolean.washing_machine_running', 'on'),
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
  return {
    datetime: t.toISOString(),
    condition: rainy ? 'rainy' : h >= 19 || h < 6 ? 'clear-night' : h < 10 ? 'sunny' : 'partlycloudy',
    temperature: 22 + 8 * Math.sin(((h - 8) / 24) * 2 * Math.PI),
    precipitation: rainy ? 1.2 : 0,
  };
});

export const FORECAST = ['partlycloudy', 'rainy', 'lightning-rainy', 'cloudy', 'sunny', 'partlycloudy', 'rainy'].map((condition, i) => ({
  datetime: new Date(Date.now() + i * 86400_000).toISOString(),
  condition,
  temperature: 30 - (i % 3),
  templow: 21 + (i % 2),
  precipitation: condition.includes('rain') ? 2.4 + i : 0,
}));
