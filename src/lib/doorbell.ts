// The doorbell's two entities: the camera it shows and the sensor that says it
// was pressed. Pure, unit-tested; components/Doorbell.tsx uses them.

export interface DoorbellState {
  state: string;
  attributes?: { friendly_name?: string };
}

export interface DoorbellEntities {
  camera?: string;
  press?: string;
}

const named = (id: string, s: DoorbellState) => `${id} ${s.attributes?.friendly_name ?? ''}`.toLowerCase();
const DOORBELL = /door[ _]?bell/;
// Doorbells have other sensors too (motion, battery, a person seen).
const PRESS = /press|button|(^|[\s._])ring/;

// The config's entities when they exist, else the first camera named doorbell
// and the first binary sensor named as a doorbell press (or just "...doorbell").
export function findDoorbell(states: Record<string, DoorbellState>, config: DoorbellEntities): DoorbellEntities {
  const ids = Object.keys(states).sort();
  const belled = (domain: string) => ids.filter((id) => id.startsWith(`${domain}.`) && DOORBELL.test(named(id, states[id])));
  const sensors = belled('binary_sensor');
  return {
    camera: config.camera && states[config.camera] ? config.camera : belled('camera')[0],
    press:
      config.press && states[config.press]
        ? config.press
        : sensors.find((id) => PRESS.test(named(id, states[id]))) ?? sensors.find((id) => /door_?bell$/.test(id)),
  };
}

// A press is a seen off -> on: the first reading after a load, or a sensor
// coming back from unavailable, never counts.
export const isPress = (before: string | undefined, now: string | undefined) => before === 'off' && now === 'on';
