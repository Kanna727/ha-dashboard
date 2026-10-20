// What the 3D car should show, from the car's entity states: open doors,
// lamps, heaters, and callouts pinned to parts of the model. Pure, so it can be
// tested without three.js; car3d/ applies it.
import type { IconName } from '../components/Icon';

export type Corner = 'FL' | 'FR' | 'RL' | 'RR';
export type Anchor = `tyre:${Corner}` | `door:${Corner}` | 'hood' | 'trunk' | 'lampFront' | 'lampRear' | 'fuel' | 'cabin';

export interface Callout {
  id: string;
  anchor: Anchor;
  label: string;
  icon: IconName;
  tone: 'warn' | 'info';
  focus: boolean; // the turntable swings round to show it
}

export interface CarVisual {
  doors: Record<Corner, boolean>;
  headlamps: boolean;
  signals: boolean; // any turn signal or the hazards
  defrostFront: boolean;
  defrostRear: boolean;
  steeringHeat: boolean;
  ac: boolean;
  seatHeat: Partial<Record<Corner, string>>; // level, e.g. "High"
  callouts: Callout[];
}

export interface CarVisualInput {
  offline: boolean;
  driverSide?: 'left' | 'right';
  openings: { entity: string; state?: string }[];
  tyres: Partial<Record<Corner, string>>; // 'on' = low pressure (last known while offline)
  locked?: boolean;
  engine?: string;
  headlamps?: string;
  signals?: (string | undefined)[];
  hazards?: string; // hazard lights sensor: blinks every signal
  lampFaults?: { name: string; entity: string; state?: string }[];
  ac?: string;
  setTemp?: number;
  defrostFront?: string;
  defrostRear?: string;
  steeringHeat?: string;
  seats?: Partial<Record<Corner, string>>;
  warnings?: { entity: string; name: string; state?: string }[];
  serviceDue?: string[]; // names of service items that are due, most urgent first
  motion?: string; // "23 km/h W" while driving
  battery12v?: number; // %
  cabinAir?: { value: number; label: string; poor: boolean }; // PM2.5 µg/m³
  accessory?: string; // ACC power sensor
}

// Below this the 12V battery label turns orange.
export const LOW_12V = 40;

const CORNERS: Corner[] = ['FL', 'FR', 'RL', 'RR'];
const CORNER_NAME: Record<Corner, string> = { FL: 'Front left', FR: 'Front right', RL: 'Rear left', RR: 'Rear right' };

// Which part an opening sensor belongs to, from its entity ID (Kia Connect
// names them …_front_left_door, …_back_right_door, …_hood, …_trunk).
export function openingPart(entity: string): Corner | 'hood' | 'trunk' | undefined {
  const id = entity.toLowerCase();
  if (/hood|bonnet/.test(id)) return 'hood';
  if (/trunk|tailgate|boot/.test(id)) return 'trunk';
  const front = /front/.test(id);
  const rear = /back|rear/.test(id);
  const left = /left/.test(id);
  const right = /right/.test(id);
  if ((front || rear) && (left || right)) return `${front ? 'F' : 'R'}${left ? 'L' : 'R'}` as Corner;
  return undefined;
}

const on = (s?: string) => s === 'on';
// Seat sensors report "Off" or a level; anything else that isn't missing is on.
const seatLevel = (s?: string) => (!s || /^(off|unknown|unavailable)$/i.test(s) ? undefined : s);

export function carVisual(i: CarVisualInput): CarVisual {
  const doors: Record<Corner, boolean> = { FL: false, FR: false, RL: false, RR: false };
  const callouts: Callout[] = [];
  const driverDoor: Corner = i.driverSide === 'right' ? 'FR' : 'FL';

  // Doors and lock are unknown while the car is offline: show them closed and say nothing.
  if (!i.offline) {
    for (const o of i.openings) {
      if (!on(o.state)) continue;
      const part = openingPart(o.entity);
      if (!part) continue;
      if (part === 'hood') callouts.push({ id: 'hood', anchor: 'hood', label: 'Bonnet open', icon: 'carDoor', tone: 'warn', focus: true });
      else if (part === 'trunk') callouts.push({ id: 'trunk', anchor: 'trunk', label: 'Tailgate open', icon: 'carDoor', tone: 'warn', focus: true });
      else {
        doors[part] = true;
        callouts.push({ id: `door:${part}`, anchor: `door:${part}`, label: `${CORNER_NAME[part]} door open`, icon: 'carDoor', tone: 'warn', focus: true });
      }
    }
    if (i.locked === false) callouts.push({ id: 'lock', anchor: `door:${driverDoor}`, label: 'Unlocked', icon: 'unlock', tone: 'warn', focus: true });
    if (on(i.engine)) callouts.push({ id: 'engine', anchor: 'hood', label: i.motion ? `Driving · ${i.motion}` : 'Engine running', icon: 'engine', tone: 'info', focus: false });
    if (on(i.accessory) && !on(i.engine)) callouts.push({ id: 'acc', anchor: 'cabin', label: 'Accessory on', icon: 'power', tone: 'info', focus: false });
    if (on(i.ac)) callouts.push({ id: 'ac', anchor: 'cabin', label: i.setTemp !== undefined ? `Climate ${i.setTemp}°` : 'Climate on', icon: 'ac', tone: 'info', focus: false });
  }

  const lowTyres = CORNERS.filter((c) => on(i.tyres[c]));
  // While offline the tyre states are the last known ones; say so.
  const lastKnown = i.offline ? ' (last known)' : '';
  for (const c of lowTyres) callouts.push({ id: `tyre:${c}`, anchor: `tyre:${c}`, label: `Low pressure${lastKnown}`, icon: 'tyre', tone: 'warn', focus: true });
  if (i.battery12v !== undefined) {
    const low = i.battery12v < LOW_12V;
    callouts.push({ id: '12v', anchor: 'hood', label: `12V battery ${Math.round(i.battery12v)}%${lastKnown}`, icon: 'carBattery', tone: low ? 'warn' : 'info', focus: low });
  }
  if (i.cabinAir) {
    const a = i.cabinAir;
    callouts.push({ id: 'cabinAir', anchor: 'cabin', label: `Cabin air ${Math.round(a.value)} µg/m³ · ${a.label}`, icon: 'airFilter', tone: a.poor ? 'warn' : 'info', focus: a.poor });
  }

  for (const f of i.lampFaults ?? []) {
    if (!on(f.state)) continue;
    const anchor: Anchor = /rear|tail|back/i.test(f.entity + f.name) ? 'lampRear' : 'lampFront';
    callouts.push({ id: `lamp:${f.entity}`, anchor, label: `${f.name} fault`, icon: 'lampFault', tone: 'warn', focus: true });
  }

  for (const w of i.warnings ?? []) {
    if (!on(w.state)) continue;
    const id = w.entity.toLowerCase();
    if (/tire|tyre/.test(id)) {
      // The all-tyres flag adds nothing when a corner already shows it.
      if (!lowTyres.length) callouts.push({ id: w.entity, anchor: 'tyre:FL', label: w.name, icon: 'tyre', tone: 'warn', focus: true });
    } else if (/fuel/.test(id)) callouts.push({ id: w.entity, anchor: 'fuel', label: w.name, icon: 'fuel', tone: 'warn', focus: true });
    else if (/washer/.test(id)) callouts.push({ id: w.entity, anchor: 'hood', label: w.name, icon: 'washerFluid', tone: 'warn', focus: true });
    else if (/brake/.test(id)) callouts.push({ id: w.entity, anchor: 'hood', label: w.name, icon: 'brakeFluid', tone: 'warn', focus: true });
    else if (/oil|coolant/.test(id)) callouts.push({ id: w.entity, anchor: 'hood', label: w.name, icon: 'engine', tone: 'warn', focus: true });
    else if (/key/.test(id)) callouts.push({ id: w.entity, anchor: `door:${driverDoor}`, label: w.name, icon: 'keyAlert', tone: 'warn', focus: true });
    else callouts.push({ id: w.entity, anchor: 'cabin', label: w.name, icon: 'alert', tone: 'warn', focus: false });
  }

  // Service reminders last for weeks, so one quiet callout rather than a tour stop.
  const due = i.serviceDue ?? [];
  if (due.length) {
    const label = due.length === 1 ? `${due[0]} due` : `Service due · ${due.length} items`;
    callouts.push({ id: 'service', anchor: 'hood', label, icon: 'service', tone: 'warn', focus: false });
  }

  const seatHeat: Partial<Record<Corner, string>> = {};
  if (!i.offline) for (const c of CORNERS) {
    const level = seatLevel(i.seats?.[c]);
    if (level) seatHeat[c] = level;
  }

  return {
    doors,
    headlamps: !i.offline && on(i.headlamps),
    signals: !i.offline && ((i.signals ?? []).some(on) || on(i.hazards)),
    defrostFront: !i.offline && on(i.defrostFront),
    defrostRear: !i.offline && on(i.defrostRear),
    steeringHeat: !i.offline && on(i.steeringHeat),
    ac: !i.offline && on(i.ac),
    seatHeat,
    callouts,
  };
}

// Anchors the turntable should visit, most important first, one per anchor.
export function focusAnchors(callouts: Callout[]): Anchor[] {
  const seen = new Set<Anchor>();
  for (const c of callouts) if (c.focus) seen.add(c.anchor);
  return [...seen];
}
