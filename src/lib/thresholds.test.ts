import { describe, expect, it } from 'vitest';
import { ambienceSensor, automationGates, describeGate, gatePasses, gatesFor, heldBack, type Read } from './thresholds';

// An occupancy automation: lights when it's dark, fan when it's hot (or the override is on).
const occupied = {
  triggers: [{ trigger: 'state', entity_id: 'binary_sensor.bedroom_occupancy', to: 'on' }],
  actions: [
    {
      parallel: [
        {
          if: [{ condition: 'numeric_state', entity_id: 'sensor.bedroom_light_level', below: 6 }],
          then: [{ action: 'light.turn_on', target: { entity_id: ['light.bedroom'] } }],
        },
        {
          if: [
            {
              condition: 'or',
              conditions: [
                { condition: 'numeric_state', entity_id: 'sensor.bedroom_temperature', above: 27 },
                { condition: 'state', entity_id: 'input_boolean.bedroom_temp_override', state: 'on' },
              ],
            },
          ],
          then: [{ action: 'fan.turn_on', target: { entity_id: 'fan.bedroom' } }],
        },
      ],
    },
  ],
};
const hot = {
  triggers: [{ trigger: 'numeric_state', entity_id: 'sensor.bedroom_temperature', above: 'input_number.fan_on_at', for: { minutes: 1 } }],
  conditions: [{ condition: 'state', entity_id: 'fan.bedroom', state: 'off' }],
  actions: [{ action: 'fan.turn_on', target: { entity_id: 'fan.bedroom' } }],
};
const cool = {
  triggers: [{ trigger: 'numeric_state', entity_id: 'sensor.bedroom_temperature', below: 24 }],
  actions: [{ action: 'fan.turn_off', target: { entity_id: 'fan.bedroom' } }],
};

describe('automationGates', () => {
  it('scopes nested if conditions to their own branch', () => {
    const gates = automationGates('automation.occupied', occupied);
    expect(gates).toHaveLength(2);
    expect(gates[0]).toMatchObject({ sensor: 'sensor.bedroom_light_level', below: 6, targets: ['light.bedroom'], bypass: [] });
    expect(gates[1]).toMatchObject({
      sensor: 'sensor.bedroom_temperature',
      above: 27,
      targets: ['fan.bedroom'],
      bypass: [{ entity: 'input_boolean.bedroom_temp_override', states: ['on'] }],
    });
  });

  it('takes a lone numeric_state trigger, with an entity as the limit', () => {
    expect(automationGates('automation.hot', hot)).toEqual([
      { automation: 'automation.hot', sensor: 'sensor.bedroom_temperature', above: 'input_number.fan_on_at', below: undefined, targets: ['fan.bedroom'], bypass: [] },
    ]);
  });

  it('ignores automations that only turn things off', () => {
    expect(automationGates('automation.cool', cool)).toEqual([]);
  });

  it('ignores numeric triggers OR-ed with other triggers, and disabled conditions', () => {
    const cfg = {
      triggers: [hot.triggers[0], { trigger: 'state', entity_id: 'binary_sensor.x', to: 'on' }],
      conditions: [{ condition: 'numeric_state', entity_id: 'sensor.kitchen_light_level', below: 60, enabled: false }],
      actions: hot.actions,
    };
    expect(automationGates('automation.x', cfg)).toEqual([]);
  });

  it('reads legacy keys and choose blocks', () => {
    const cfg = {
      trigger: [{ platform: 'state', entity_id: 'binary_sensor.x' }],
      action: [
        {
          choose: [
            {
              conditions: [{ condition: 'and', conditions: [{ condition: 'numeric_state', entity_id: 'sensor.lux', below: '40' }] }],
              sequence: [{ service: 'light.turn_on', entity_id: 'light.hall' }],
            },
          ],
        },
      ],
    };
    expect(automationGates('automation.x', cfg)).toMatchObject([{ sensor: 'sensor.lux', below: 40, targets: ['light.hall'] }]);
  });
});

describe('evaluating gates', () => {
  const gates = [...automationGates('automation.occupied', occupied), ...automationGates('automation.hot', hot)];
  const reader =
    (s: Record<string, string>): Read =>
    (id) =>
      ({ 'automation.occupied': 'on', 'automation.hot': 'on', 'input_number.fan_on_at': '27.0', 'fan.bedroom': 'off', 'light.bedroom': 'off', ...s })[id];

  it('holds the fan back while it is too cool', () => {
    const read = reader({ 'sensor.bedroom_temperature': '26.4' });
    const temp = gatesFor(gates, 'sensor.bedroom_temperature', ['fan.bedroom'], read);
    expect(temp).toHaveLength(2);
    expect(heldBack(temp, read)).toBe(true);
    expect(describeGate(temp[1], read)).toBe('above 27');
  });

  it('lets it through when hot, or when the override is on', () => {
    const hotRead = reader({ 'sensor.bedroom_temperature': '27.2' });
    expect(heldBack(gatesFor(gates, 'sensor.bedroom_temperature', ['fan.bedroom'], hotRead), hotRead)).toBe(false);
    // The override bypasses the occupancy gate; one open path is enough.
    const override = reader({ 'sensor.bedroom_temperature': '25', 'input_boolean.bedroom_temp_override': 'on' });
    expect(heldBack(gatesFor(gates, 'sensor.bedroom_temperature', ['fan.bedroom'], override), override)).toBe(false);
  });

  it('only counts devices that are off and automations that are on', () => {
    const oneLight = reader({ 'sensor.bedroom_light_level': '40', 'light.bedroom': 'on' });
    const twoLights = gates.map((g) => (g.targets.includes('light.bedroom') ? { ...g, targets: ['light.bedroom', 'light.bedroom_2'] } : g));
    expect(gatesFor(twoLights, 'sensor.bedroom_light_level', ['light.bedroom', 'light.bedroom_2'], (id) => (id === 'light.bedroom_2' ? 'off' : oneLight(id)))).toEqual([]);
    const fanOn = reader({ 'sensor.bedroom_temperature': '25', 'fan.bedroom': 'on' });
    expect(gatesFor(gates, 'sensor.bedroom_temperature', ['fan.bedroom'], fanOn)).toEqual([]);
    const disabled = reader({ 'sensor.bedroom_temperature': '25', 'automation.occupied': 'off', 'automation.hot': 'off' });
    expect(gatesFor(gates, 'sensor.bedroom_temperature', ['fan.bedroom'], disabled)).toEqual([]);
  });

  it('flags a bright room for the lights, and never an unavailable sensor', () => {
    const bright = reader({ 'sensor.bedroom_light_level': '40' });
    expect(heldBack(gatesFor(gates, 'sensor.bedroom_light_level', ['light.bedroom'], bright), bright)).toBe(true);
    const dark = reader({ 'sensor.bedroom_light_level': '3' });
    expect(heldBack(gatesFor(gates, 'sensor.bedroom_light_level', ['light.bedroom'], dark), dark)).toBe(false);
    const gone = reader({ 'sensor.bedroom_light_level': 'unavailable' });
    expect(gatePasses(gates[0], gone)).toBeUndefined();
    expect(heldBack(gatesFor(gates, 'sensor.bedroom_light_level', ['light.bedroom'], gone), gone)).toBe(false);
  });
});

describe('ambienceSensor', () => {
  it('finds the sensor gating the room lights on darkness', () => {
    const gates = automationGates('automation.occupied', occupied);
    expect(ambienceSensor(gates, ['light.bedroom'])).toBe('sensor.bedroom_light_level');
    expect(ambienceSensor(gates, ['light.kitchen'])).toBeUndefined();
  });
});
