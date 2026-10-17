// Numeric thresholds that gate the home's own automations ("fan on above 27°",
// "lights on below 60 lx"), read from the automation configs so a room card can
// show when a reading is what's stopping a fan or a light from switching on.
// Nothing is configured: the gates come from whatever the automations say.

export interface Gate {
  automation: string; // automation.* entity; its gates count only while it's on
  sensor: string;
  // A number, or the entity whose state is the limit (e.g. an input_number).
  above?: number | string;
  below?: number | string;
  // What the automation turns on behind this gate (fan.*, light.*, ...).
  targets: string[];
  // State conditions OR-ed with the gate (e.g. a "temperature override"
  // boolean): while one holds, the gate doesn't block.
  bypass: { entity: string; states: string[] }[];
}

export type Read = (entityId: string) => string | undefined;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const strs = (v: unknown) => list(v).filter((x): x is string => typeof x === 'string');
const enabled = (v: unknown): v is Obj => isObj(v) && v.enabled !== false;
const kindOf = (o: Obj) => o.condition ?? o.trigger ?? o.platform;

function limit(v: unknown): number | string | undefined {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : v.includes('.') ? v : undefined;
}

type Found = Pick<Gate, 'sensor' | 'above' | 'below' | 'bypass'>;

// State conditions an OR group offers besides the gate itself.
function stateBypass(o: Obj): Gate['bypass'] {
  if (kindOf(o) !== 'state') return [];
  const states = strs(o.state);
  return states.length ? strs(o.entity_id).map((entity) => ({ entity, states })) : [];
}

function gatesIn(conds: unknown[], bypass: Gate['bypass'], out: Found[]) {
  for (const c of conds.filter(enabled)) {
    const kind = kindOf(c) ?? (Array.isArray(c.and) ? 'and' : Array.isArray(c.or) ? 'or' : undefined);
    const kids = list(c.conditions ?? c.and ?? c.or).filter(enabled);
    if (kind === 'numeric_state') {
      if (c.attribute || c.value_template) continue;
      const above = limit(c.above);
      const below = limit(c.below);
      if (above === undefined && below === undefined) continue;
      for (const sensor of strs(c.entity_id)) out.push({ sensor, above, below, bypass });
    } else if (kind === 'and') {
      gatesIn(kids, bypass, out);
    } else if (kind === 'or') {
      for (const k of kids) gatesIn([k], [...bypass, ...kids.filter((o) => o !== k).flatMap(stateBypass)], out);
    }
    // `not` and the rest: no telling which way they gate, so skip them.
  }
}

// Entities the actions switch on (any *.turn_on), however deeply nested.
function turnedOn(v: unknown, out: Set<string>) {
  if (Array.isArray(v)) return v.forEach((x) => turnedOn(x, out));
  if (!isObj(v) || v.enabled === false) return;
  const service = v.action ?? v.service;
  if (typeof service === 'string' && service.endsWith('.turn_on')) {
    const target = isObj(v.target) ? v.target : {};
    const data = isObj(v.data) ? v.data : {};
    [target.entity_id, v.entity_id, data.entity_id].flatMap(strs).forEach((id) => out.add(id));
  }
  Object.values(v).forEach((x) => turnedOn(x, out));
}

// One block of actions and the conditions in front of it. Nested if/choose
// branches gate only their own actions, so each is its own scope.
function scope(automation: string, conds: unknown[], actions: unknown[], out: Gate[]) {
  const found: Found[] = [];
  gatesIn(conds, [], found);
  // A condition step in the sequence gates the steps of the block too.
  gatesIn(actions.filter((s) => enabled(s) && 'condition' in s), [], found);
  const on = new Set<string>();
  turnedOn(actions, on);
  if (on.size) found.forEach((g) => out.push({ automation, ...g, targets: [...on] }));

  for (const step of actions.filter(enabled)) {
    if (step.if) {
      scope(automation, list(step.if), list(step.then), out);
      scope(automation, [], list(step.else), out);
    }
    if (Array.isArray(step.choose)) {
      for (const opt of step.choose.filter(enabled)) scope(automation, list(opt.conditions), list(opt.sequence), out);
      scope(automation, [], list(step.default), out);
    }
    for (const key of ['parallel', 'sequence'] as const) {
      if (step[key]) scope(automation, [], list(step[key]).flat(), out);
    }
    if (isObj(step.repeat)) scope(automation, [], list(step.repeat.sequence), out);
  }
}

export function automationGates(automation: string, config: unknown): Gate[] {
  if (!isObj(config)) return [];
  const out: Gate[] = [];
  // Triggers are OR-ed, so a numeric_state trigger only gates the automation
  // when it is the only trigger.
  const triggers = list(config.triggers ?? config.trigger).filter(enabled);
  const conds = [...(triggers.length === 1 && kindOf(triggers[0]) === 'numeric_state' ? triggers : []), ...list(config.conditions ?? config.condition)];
  scope(automation, conds, list(config.actions ?? config.action), out);
  return out;
}

const toNum = (s: string | undefined) => {
  const n = s === undefined || s === '' ? NaN : Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export const limitValue = (l: number | string | undefined, read: Read) => (typeof l === 'string' ? toNum(read(l)) : l);

// Does the reading let the automation through? Undefined when it can't tell
// (sensor or limit unavailable).
export function gatePasses(g: Gate, read: Read): boolean | undefined {
  const v = toNum(read(g.sensor));
  const above = limitValue(g.above, read);
  const below = limitValue(g.below, read);
  if (v === undefined || (g.above !== undefined && above === undefined) || (g.below !== undefined && below === undefined)) return undefined;
  return (above === undefined || v > above) && (below === undefined || v < below);
}

const bypassed = (g: Gate, read: Read) => g.bypass.some((b) => b.states.includes(read(b.entity) ?? ''));

// The gates on `sensor` of active automations that would turn on some of
// `devices`. With `offOnly`, only those whose devices are all off right now
// (one light on already lights the room, and lifts its light level).
export function gatesFor(gates: Gate[], sensor: string | undefined, devices: string[], read: Read, offOnly = true): Gate[] {
  if (!sensor) return [];
  return gates.filter((g) => {
    const mine = g.targets.filter((t) => devices.includes(t));
    if (g.sensor !== sensor || read(g.automation) !== 'on' || !mine.length) return false;
    return !offOnly || (mine.some((t) => read(t) === 'off') && !mine.some((t) => read(t) === 'on'));
  });
}

// True when the reading is what's keeping those devices off: every gate is
// shut by it and none is bypassed.
export function heldBack(gates: Gate[], read: Read): boolean {
  return gates.length > 0 && gates.every((g) => gatePasses(g, read) === false && !bypassed(g, read));
}

// "above 27" / "below 60" / "between 20 and 30", with entity limits resolved.
export function describeGate(g: Gate, read: Read, digits = 1): string {
  const fmt = (l: number | string | undefined) => {
    const v = limitValue(l, read);
    return v === undefined ? '?' : String(Number(v.toFixed(digits)));
  };
  if (g.above !== undefined && g.below !== undefined) return `between ${fmt(g.above)} and ${fmt(g.below)}`;
  return g.above !== undefined ? `above ${fmt(g.above)}` : `below ${fmt(g.below)}`;
}

// The room's light-level sensor, as its lighting automations use it: the
// sensor most often gating a "lights on when it's dark" (below) on its lights.
export function ambienceSensor(gates: Gate[], lights: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const g of gates) {
    if (g.below === undefined || g.above !== undefined || !g.targets.some((t) => lights.includes(t))) continue;
    counts.set(g.sensor, (counts.get(g.sensor) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}
