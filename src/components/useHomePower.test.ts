import { describe, expect, it } from 'vitest';
import type { HassEntity } from 'home-assistant-js-websocket';
import { isPlugPower, plugCandidates, plugLook } from './useHomePower';

const sensor = (attributes: Record<string, unknown>) => ({ entity_id: 'sensor.x', state: '10', attributes }) as unknown as HassEntity;

describe('smart plug discovery', () => {
  it('accepts power measurements in W or kW only', () => {
    expect(isPlugPower(sensor({ device_class: 'power', state_class: 'measurement', unit_of_measurement: 'W' }))).toBe(true);
    expect(isPlugPower(sensor({ device_class: 'power', state_class: 'measurement', unit_of_measurement: 'kW' }))).toBe(true);
    expect(isPlugPower(sensor({ device_class: 'power', unit_of_measurement: 'W' }))).toBe(false); // no state_class (Zwift)
    expect(isPlugPower(sensor({ device_class: 'energy', state_class: 'measurement', unit_of_measurement: 'W' }))).toBe(false);
    expect(isPlugPower(undefined)).toBe(false);
  });

  it('only keeps sensors on devices that also have a switch', () => {
    const registry = {
      devices: [],
      entities: [
        { entityId: 'switch.plug_a', deviceId: 'a', platform: 'wiz' },
        { entityId: 'sensor.plug_a_power', deviceId: 'a', platform: 'wiz' },
        { entityId: 'sensor.bulb_power', deviceId: 'b', platform: 'wiz' }, // bulb: no switch
        { entityId: 'light.bulb', deviceId: 'b', platform: 'wiz' },
        { entityId: 'sensor.plug_a_rssi', deviceId: 'a', platform: 'wiz', category: 'diagnostic' },
      ],
    };
    expect(plugCandidates(registry)).toEqual(['sensor.plug_a_power']);
  });

  it('names and styles unknown plugs from their friendly name', () => {
    const look = (name: string) => plugLook('sensor.new_plug_power', sensor({ friendly_name: name }));
    expect(look('Bedroom Heater Power')).toMatchObject({ name: 'Bedroom Heater', icon: 'geyser' });
    // "dish" must win over "wash" in the guess order.
    expect(look('Dishwasher Power').icon).toBe('dishwasher');
    expect(look('Washing Machine Power').icon).toBe('washer');
    // A TV unit (router, streamer, soundbar...) must not look like the TV itself.
    expect(look('TV Unit Power').icon).toBe('avUnit');
    expect(look('TV Power').icon).toBe('tv');
    expect(look('TV Unit Power').color).not.toBe(look('TV Power').color);
    expect(look('Woofer & Dashboard Power')).toMatchObject({ name: 'Woofer & Dashboard', icon: 'speaker' });
    // A speaker's plug that also charges something is still the speakers.
    expect(look('Rear speakers & charger Power').icon).toBe('speaker');
    expect(look('Phone charger Power').icon).toBe('charging');
    // TP-Link plugs call the power sensor "Current consumption".
    expect(look('Vacuum Cleaner Plug Current consumption')).toMatchObject({ name: 'Vacuum Cleaner Plug', icon: 'vacuum' });
    expect(look('Mystery Gadget Power').icon).toBe('flash');
  });
});
