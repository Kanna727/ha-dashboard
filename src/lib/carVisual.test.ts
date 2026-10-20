import { describe, expect, it } from 'vitest';
import { carVisual, focusAnchors, openingPart, type CarVisualInput } from './carVisual';

const base: CarVisualInput = { offline: false, openings: [], tyres: {} };

describe('openingPart', () => {
  it('reads the part from Kia-style entity IDs', () => {
    expect(openingPart('binary_sensor.car_front_left_door')).toBe('FL');
    expect(openingPart('binary_sensor.car_front_right_door')).toBe('FR');
    expect(openingPart('binary_sensor.car_back_left_door')).toBe('RL');
    expect(openingPart('binary_sensor.car_rear_right_door')).toBe('RR');
    expect(openingPart('binary_sensor.car_hood')).toBe('hood');
    expect(openingPart('binary_sensor.car_trunk')).toBe('trunk');
    expect(openingPart('binary_sensor.car_engine')).toBeUndefined();
  });
});

describe('carVisual', () => {
  it('opens doors and pins callouts to them', () => {
    const v = carVisual({
      ...base,
      openings: [
        { entity: 'binary_sensor.car_front_left_door', state: 'on' },
        { entity: 'binary_sensor.car_back_right_door', state: 'off' },
        { entity: 'binary_sensor.car_trunk', state: 'on' },
      ],
    });
    expect(v.doors).toEqual({ FL: true, FR: false, RL: false, RR: false });
    expect(v.callouts.map((c) => c.anchor)).toEqual(['door:FL', 'trunk']);
  });

  it('flags low tyres per corner and skips the redundant all-tyres warning', () => {
    const v = carVisual({
      ...base,
      tyres: { FL: 'on', FR: 'off' },
      warnings: [{ entity: 'binary_sensor.car_tire_pressure_all', name: 'Tyre pressure', state: 'on' }],
    });
    expect(v.callouts.map((c) => c.id)).toEqual(['tyre:FL']);
  });

  it('places warnings where they belong on the car', () => {
    const v = carVisual({
      ...base,
      driverSide: 'right',
      locked: false,
      warnings: [
        { entity: 'binary_sensor.car_washer_fluid_warning', name: 'Washer fluid', state: 'on' },
        { entity: 'binary_sensor.car_fuel_low_level', name: 'Low fuel', state: 'on' },
        { entity: 'binary_sensor.car_smart_key_battery_warning', name: 'Key battery', state: 'on' },
        { entity: 'binary_sensor.car_brake_fluid_warning', name: 'Brake fluid', state: 'off' },
      ],
      lampFaults: [{ entity: 'binary_sensor.car_rear_left_lamp_fault', name: 'Rear left lamp', state: 'on' }],
    });
    const at = Object.fromEntries(v.callouts.map((c) => [c.id, c.anchor]));
    expect(at).toEqual({
      lock: 'door:FR', // right-hand drive: the driver's door
      'binary_sensor.car_washer_fluid_warning': 'hood',
      'binary_sensor.car_fuel_low_level': 'fuel',
      'binary_sensor.car_smart_key_battery_warning': 'door:FR',
      'lamp:binary_sensor.car_rear_left_lamp_fault': 'lampRear',
    });
  });

  it('says nothing about doors, lock or lamps while offline, but keeps last-known tyres', () => {
    const v = carVisual({
      ...base,
      offline: true,
      locked: false,
      headlamps: 'on',
      openings: [{ entity: 'binary_sensor.car_hood', state: 'on' }],
      tyres: { RR: 'on' },
      seats: { FL: 'High' },
    });
    expect(v.callouts.map((c) => [c.id, c.label])).toEqual([['tyre:RR', 'Low pressure (last known)']]);
    expect(v.headlamps).toBe(false);
    expect(v.seatHeat).toEqual({});
  });

  it('reads comfort states', () => {
    const v = carVisual({ ...base, ac: 'on', setTemp: 22, seats: { FL: 'High', FR: 'Off', RL: 'unavailable' }, steeringHeat: 'on', signals: ['off', 'on'] });
    expect(v.ac && v.steeringHeat && v.signals).toBe(true);
    expect(v.seatHeat).toEqual({ FL: 'High' });
    expect(v.callouts.find((c) => c.id === 'ac')?.label).toBe('Climate 22°');
  });

  it('blinks the signals for the hazards', () => {
    expect(carVisual({ ...base, hazards: 'on' }).signals).toBe(true);
    expect(carVisual({ ...base, hazards: 'on', offline: true }).signals).toBe(false);
  });

  it('pins one quiet service callout and engine warnings to the bonnet', () => {
    const one = carVisual({ ...base, serviceDue: ['Engine oil'], warnings: [{ entity: 'binary_sensor.car_oil_level_warning', name: 'Oil level', state: 'on' }] });
    expect(one.callouts.map((c) => [c.id, c.anchor, c.label, c.focus])).toEqual([
      ['binary_sensor.car_oil_level_warning', 'hood', 'Oil level', true],
      ['service', 'hood', 'Engine oil due', false],
    ]);
    expect(carVisual({ ...base, serviceDue: ['Engine oil', 'Oil filter'] }).callouts[0].label).toBe('Service due · 2 items');
  });
});

describe('carVisual: everything on the model', () => {
  it('shows driving, accessory, 12V and cabin air (no all-clear labels)', () => {
    const v = carVisual({ ...base, locked: true, engine: 'on', motion: '23 km/h W', hazards: 'on', battery12v: 31, cabinAir: { value: 18, label: 'Fair', poor: false } });
    const by = Object.fromEntries(v.callouts.map((c) => [c.id, `${c.anchor}|${c.label}|${c.tone}`]));
    expect(by).toEqual({
      engine: 'hood|Driving · 23 km/h W|info',
      '12v': 'hood|12V battery 31%|warn',
      cabinAir: 'cabin|Cabin air 18 µg/m³ · Fair|info',
    });
    // Accessory only matters with the engine off.
    expect(carVisual({ ...base, accessory: 'on' }).callouts.map((c) => c.id)).toEqual(['acc']);
    expect(carVisual({ ...base, accessory: 'on', engine: 'on' }).callouts.map((c) => c.id)).toEqual(['engine']);
  });
});

describe('focusAnchors', () => {
  it('visits each warning anchor once, in order, skipping info', () => {
    const v = carVisual({ ...base, engine: 'on', tyres: { FL: 'on' }, openings: [{ entity: 'binary_sensor.car_hood', state: 'on' }] });
    expect(focusAnchors(v.callouts)).toEqual(['hood', 'tyre:FL']);
  });
});
