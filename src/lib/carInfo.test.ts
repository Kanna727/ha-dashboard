import { describe, expect, it } from 'vitest';
import { carExtras, classifyCarBinaries, fmtMinutes, heading8, pm25Band, serviceText, shortName, shortPlace, tripEvents } from './carInfo';

describe('carExtras', () => {
  const ents = [
    { entityId: 'lock.car_door_lock', deviceId: 'car' },
    { entityId: 'sensor.car_fuel_level', deviceId: 'car' },
    { entityId: 'sensor.garage_car_last_trip_top_speed', deviceId: 'car' },
    { entityId: 'sensor.garage_car_top_speed_this_month', deviceId: 'car' },
    { entityId: 'sensor.garage_car_distance_today', deviceId: 'car' },
    { entityId: 'sensor.garage_car_last_trip_distance', deviceId: 'car' },
    { entityId: 'button.car_start_valet_mode', deviceId: 'car' },
    { entityId: 'binary_sensor.garage_car_engine_oil', deviceId: 'car' },
    { entityId: 'binary_sensor.car_hood', deviceId: 'car' },
    { entityId: 'binary_sensor.car_tire_pressure_all', deviceId: 'car' },
    { entityId: 'sensor.other_distance_today', deviceId: 'other' },
  ];

  it('finds sensors on the car device by suffix, longest first', () => {
    const x = carExtras('lock.car_door_lock', ents, ['lock.car_door_lock', 'binary_sensor.car_hood', 'binary_sensor.car_tire_pressure_all']);
    expect(x.sensors).toEqual({
      last_trip_top_speed: 'sensor.garage_car_last_trip_top_speed',
      top_speed_this_month: 'sensor.garage_car_top_speed_this_month',
      distance_today: 'sensor.garage_car_distance_today',
      last_trip_distance: 'sensor.garage_car_last_trip_distance',
      start_valet_mode: 'button.car_start_valet_mode',
    });
    // Configured binaries are skipped; the rest are left for classification.
    expect(x.binaries).toEqual(['binary_sensor.garage_car_engine_oil']);
  });

  it('is empty without the anchor', () => {
    expect(carExtras('lock.missing', ents, [])).toEqual({ sensors: {}, binaries: [] });
  });
});

describe('classifyCarBinaries', () => {
  it('splits service items from extra problems and sorts by urgency', () => {
    const { service, problems } = classifyCarBinaries(
      [
        { entity: 'binary_sensor.a', state: 'off', attributes: { friendly_name: 'CAR Cabin Air Filter', interval_km: 20000, interval_months: 24, remaining_km: 8808, remaining_months: 11 } },
        { entity: 'binary_sensor.b', state: 'on', attributes: { friendly_name: 'CAR Engine Oil', interval_km: 10000, interval_months: 12, remaining_km: -1192, remaining_months: -1 } },
        { entity: 'binary_sensor.c', state: 'off', attributes: { friendly_name: 'CAR Engine Coolant', interval_km: 210000, interval_months: null, remaining_km: 198808 } },
        { entity: 'binary_sensor.d', state: 'off', attributes: { friendly_name: 'CAR Oil Level Warning', device_class: 'problem' } },
        { entity: 'binary_sensor.e', state: 'off', attributes: { friendly_name: 'CAR Sleep Mode Check' } },
      ],
      'Car',
    );
    expect(service.map((s) => s.name)).toEqual(['Engine oil', 'Cabin air filter', 'Engine coolant']);
    expect(service[0]).toMatchObject({ due: true, used: 1 });
    expect(service[1].used).toBeCloseTo(0.5596, 3); // the further along of km (11,192 of 20,000) and months (13 of 24)
    expect(service[2].intervalMonths).toBeUndefined();
    expect(problems).toEqual([{ entity: 'binary_sensor.d', name: 'Oil level' }]);
  });
});

describe('serviceText', () => {
  const base = { entity: 'x', name: 'x', used: 0 };
  it('words due and upcoming items', () => {
    expect(serviceText({ ...base, due: true, remainingKm: -1192, remainingMonths: -1 })).toBe('Overdue by 1,192 km · 1 month');
    expect(serviceText({ ...base, due: true, remainingKm: 300, remainingMonths: 0 })).toBe('Due now');
    expect(serviceText({ ...base, due: false, remainingKm: 8808, remainingMonths: 11 })).toBe('In 8,808 km or 11 months');
    expect(serviceText({ ...base, due: false, remainingKm: 198808 })).toBe('In 198,808 km');
  });
});

describe('formatting', () => {
  it('shortName strips the device name and "warning"', () => {
    expect(shortName('MY CAR Spark Plug', 'My car', 'binary_sensor.x')).toBe('Spark plug');
    expect(shortName(undefined, undefined, 'binary_sensor.wheel_alignment')).toBe('Wheel alignment');
  });
  it('fmtMinutes', () => {
    expect(fmtMinutes(5)).toBe('5 min');
    expect(fmtMinutes(95)).toBe('1 h 35 min');
    expect(fmtMinutes(120)).toBe('2 h');
    expect(fmtMinutes(undefined)).toBe('–');
  });
  it('shortPlace prefers the named place parts', () => {
    expect(shortPlace('x', { residential: 'Maple Court', suburb: 'Oakridge', city: 'Springfield' })).toBe('Maple Court, Oakridge');
    expect(shortPlace('12 Elm Street, Oakridge, Springfield', null)).toBe('12 Elm Street, Oakridge');
    expect(shortPlace('unavailable', undefined)).toBeUndefined();
  });
  it('pm25Band and heading8', () => {
    expect(pm25Band(9).label).toBe('Good');
    expect(pm25Band(24).tone).toBe('fair');
    expect(pm25Band(80).tone).toBe('danger');
    expect(heading8(277)).toBe('W');
    expect(heading8(-10)).toBe('N');
  });
  it('tripEvents', () => {
    expect(tripEvents(0, 2, 1).map((e) => e.label)).toEqual(['No hard braking', '2 rapid starts', 'Speeding once']);
    expect(tripEvents()).toEqual([]);
  });
});
