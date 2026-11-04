import { describe, expect, it } from 'vitest';
import { findDoorbell, isPress } from './doorbell';

const on = (friendly_name?: string) => ({ state: 'off', attributes: { friendly_name } });

describe('findDoorbell', () => {
  const states = {
    'binary_sensor.doorbell_battery_low': on('Doorbell battery low'),
    'binary_sensor.doorbell_motion': on('Doorbell motion'),
    'binary_sensor.when_the_bell_is_used': on('Doorbell press Occupancy'),
    'binary_sensor.front_door': on('Front door'),
    'camera.robot_map': on('Robot map'),
    'camera.entrance': on('Doorbell'),
  };

  it('finds the camera and the press sensor by id or name', () => {
    expect(findDoorbell(states, {})).toEqual({ camera: 'camera.entrance', press: 'binary_sensor.when_the_bell_is_used' });
  });

  it('takes a sensor called just "doorbell", but not its other sensors', () => {
    const plain = { 'binary_sensor.doorbell_motion': on(), 'binary_sensor.front_doorbell': on() };
    expect(findDoorbell(plain, {}).press).toBe('binary_sensor.front_doorbell');
    expect(findDoorbell({ 'binary_sensor.doorbell_motion': on(), 'binary_sensor.doorbell_tampering': on() }, {}).press).toBeUndefined();
  });

  it('prefers the config, unless its entity is gone', () => {
    expect(findDoorbell(states, { camera: 'camera.robot_map', press: 'binary_sensor.front_door' })).toEqual({
      camera: 'camera.robot_map',
      press: 'binary_sensor.front_door',
    });
    expect(findDoorbell(states, { camera: 'camera.gone' }).camera).toBe('camera.entrance');
  });

  it('finds nothing in a home without a doorbell', () => {
    expect(findDoorbell({ 'binary_sensor.front_door': on(), 'camera.robot_map': on() }, {})).toEqual({ camera: undefined, press: undefined });
  });
});

describe('isPress', () => {
  it('counts only a seen off -> on', () => {
    expect(isPress('off', 'on')).toBe(true);
    expect(isPress('on', 'off')).toBe(false);
    expect(isPress('on', 'on')).toBe(false);
    expect(isPress(undefined, 'on')).toBe(false); // first reading after load
    expect(isPress('unavailable', 'on')).toBe(false);
  });
});
