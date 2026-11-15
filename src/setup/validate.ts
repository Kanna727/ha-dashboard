// Checks a config draft against the schema (schema.ts) and against itself, and
// against what Home Assistant has. Pure, so it is unit-tested (setup.test.ts).
// Errors mean the dashboard would misbehave or crash on it, warnings mean it
// probably isn't what was meant (a typo, an entity HA doesn't know).
import { isPlainObject } from '../storage/envelope';
import type { Path } from './draft';
import { DAY_NAMES, MEAL_SLOTS, MED_SLOTS, SCHEMA, SECTION_KEYS, type Field, type SectionKey } from './schema';

export interface Issue {
  path: Path;
  level: 'error' | 'warn';
  message: string;
}

export interface Known {
  // Entity IDs Home Assistant has (states and registry); without it existence isn't checked.
  entities?: ReadonlySet<string>;
  // Icon names the dashboard has; without it they aren't checked.
  icons?: ReadonlySet<string>;
}

// Sections the dashboard can't start without (the others are optional).
export const REQUIRED_SECTIONS = [
  'ROOMS',
  'FAN_MANUAL_OFF',
  'WEATHER',
  'OUTDOOR_TEMP',
  'SUN',
  'HOME_ZONE',
  'CLIMATE',
  'ENERGY',
  'APPLIANCES',
  'MEDIA',
  'MUSIC_PLAYERS',
  'CAR',
  'CAR_DETAIL',
  'NETWORK',
  'FRIDGE',
  'COMMUTE',
  'MEALS',
] as const satisfies readonly SectionKey[];

const ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9][a-z0-9_]*$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

const typeName = (v: unknown) => (v === null ? 'nothing' : Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'an object' : `a ${typeof v}`);

function checkEntity(id: string, domains: readonly string[] | undefined, path: Path, out: Issue[], known?: Known) {
  if (!ENTITY_ID.test(id)) {
    // An empty entity is allowed (the card shows as unavailable); a malformed one isn't.
    out.push(id ? { path, level: 'error', message: `"${id}" isn’t an entity ID (like light.kitchen)` } : { path, level: 'warn', message: 'Not chosen yet; this shows as unavailable' });
    return;
  }
  if (domains?.length && !domains.includes(id.split('.')[0])) out.push({ path, level: 'warn', message: `Usually ${domains.map((d) => `${d}.*`).join(' or ')}, not ${id.split('.')[0]}.*` });
  if (known?.entities && !known.entities.has(id)) out.push({ path, level: 'warn', message: `${id} isn’t in Home Assistant (yet?)` });
}

function check(f: Field, v: unknown, path: Path, out: Issue[], known?: Known): void {
  const bad = (what: string): void => {
    out.push({ path, level: 'error', message: `Should be ${what}, not ${typeName(v)}` });
  };
  switch (f.t) {
    case 'entity':
      if (typeof v !== 'string') return bad('an entity ID');
      return checkEntity(v, f.domains, path, out, known);
    case 'string': {
      if (typeof v !== 'string') return bad('text');
      if (!v) {
        if (f.req) out.push(f.kind === 'path' ? { path, level: 'warn', message: 'Not set; the picture is left out' } : { path, level: 'error', message: 'Required' });
        return;
      }
      if (f.kind === 'time' && !TIME.test(v)) out.push({ path, level: 'error', message: `"${v}" isn’t a time like 07:30` });
      else if (f.kind === 'color' && !COLOR.test(v)) out.push({ path, level: 'error', message: `"${v}" isn’t a colour like #2c3527` });
      else if (f.kind === 'slug' && !SLUG.test(v)) out.push({ path, level: 'warn', message: 'Use lowercase letters, digits, - and _' });
      else if (f.kind === 'regex') {
        try {
          new RegExp(v);
        } catch {
          out.push({ path, level: 'error', message: 'Not a valid pattern' });
        }
      } else if (f.kind === 'icon' && known?.icons && !known.icons.has(v)) out.push({ path, level: 'warn', message: `No icon called "${v}"` });
      return;
    }
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return bad('a number');
      if (f.min !== undefined && v < f.min) out.push({ path, level: 'error', message: `At least ${f.min}` });
      if (f.max !== undefined && v > f.max) out.push({ path, level: 'error', message: `At most ${f.max}` });
      return;
    case 'bool':
      if (typeof v !== 'boolean') bad('on or off');
      return;
    case 'enum':
      if (typeof v !== 'string' || !f.options.includes(v)) out.push({ path, level: 'error', message: `One of ${f.options.join(', ')}` });
      return;
    case 'multi':
      if (!Array.isArray(v)) return bad('a list');
      v.forEach((x, i) => {
        if (f.numeric ? typeof x !== 'number' || !f.options.includes(String(x)) : typeof x !== 'string' || !f.options.includes(x)) out.push({ path: [...path, i], level: 'error', message: `One of ${f.options.join(', ')}` });
      });
      return;
    case 'list':
      if (!Array.isArray(v)) return bad('a list');
      v.forEach((x, i) => check(f.of, x, [...path, i], out, known));
      return;
    case 'tuple':
      if (!Array.isArray(v) || v.length !== f.of.length) return bad(`a pair of ${f.of.length} values`);
      f.of.forEach((sub, i) => check(sub, v[i], [...path, i], out, known));
      return;
    case 'object':
      if (!isPlainObject(v)) return bad('a group of settings');
      for (const [k, sub] of Object.entries(f.fields)) {
        if (v[k] === undefined) {
          if (sub.req) out.push({ path: [...path, k], level: 'error', message: 'Required' });
        } else check(sub, v[k], [...path, k], out, known);
      }
      for (const k of Object.keys(v)) if (!(k in f.fields)) out.push({ path: [...path, k], level: 'warn', message: `Unknown setting "${k}" (a typo?)` });
      return;
    case 'map':
      if (!isPlainObject(v)) return bad('a list of entries');
      for (const [k, val] of Object.entries(v)) {
        if (f.keyKind === 'entity') checkEntity(k, f.keyDomains, [...path, k], out, known);
        else if (f.keyOptions && !f.keyOptions.includes(k)) out.push({ path: [...path, k], level: 'warn', message: `Unexpected key "${k}"; expected ${f.keyOptions.join(', ')}` });
        check(f.of, val, [...path, k], out, known);
      }
      return;
    case 'either': {
      const a: Issue[] = [];
      const b: Issue[] = [];
      check(f.a, v, path, a, known);
      check(f.b, v, path, b, known);
      const pick = !a.some((i) => i.level === 'error') ? a : !b.some((i) => i.level === 'error') ? b : a;
      out.push(...pick);
    }
  }
}

// Things that only make sense across sections.
function cross(c: Record<string, unknown>, out: Issue[]) {
  const rooms = Array.isArray(c.ROOMS) ? c.ROOMS : [];
  const ids = new Map<string, number>();
  rooms.forEach((r, i) => {
    const id = isPlainObject(r) && typeof r.id === 'string' ? r.id : '';
    if (!id) return;
    if (ids.has(id)) out.push({ path: ['ROOMS', i, 'id'], level: 'error', message: `Room ID "${id}" is already used by room ${ids.get(id)! + 1}` });
    else ids.set(id, i);
  });

  const meals = c.MEALS;
  if (isPlainObject(meals) && isPlainObject(meals.plan)) {
    const people = new Set((Array.isArray(meals.people) ? meals.people : []).map((p) => (isPlainObject(p) ? p.id : undefined)));
    for (const [day, perPerson] of Object.entries(meals.plan)) {
      if (!(Number(day) >= 0 && Number(day) <= 6)) out.push({ path: ['MEALS', 'plan', day], level: 'warn', message: `Day ${day} isn’t 0 (${DAY_NAMES[0]}) to 6 (${DAY_NAMES[6]})` });
      if (!isPlainObject(perPerson)) continue;
      for (const [who, slots] of Object.entries(perPerson)) {
        if (!people.has(who)) out.push({ path: ['MEALS', 'plan', day, who], level: 'warn', message: `"${who}" isn’t one of the people above` });
        if (isPlainObject(slots)) for (const s of MEAL_SLOTS) if (typeof slots[s] !== 'string') out.push({ path: ['MEALS', 'plan', day, who, s], level: 'warn', message: 'No meal set' });
      }
    }
  }

  const med = c.MEDICINES;
  if (isPlainObject(med) && isPlainObject(med.times)) for (const k of Object.keys(med.times)) if (!(MED_SLOTS as readonly string[]).includes(k)) out.push({ path: ['MEDICINES', 'times', k], level: 'warn', message: `Not a dose time (${MED_SLOTS.join(', ')})` });

  const commute = c.COMMUTE;
  if (isPlainObject(commute) && typeof commute.windowStartHour === 'number' && typeof commute.windowEndHour === 'number' && commute.windowEndHour <= commute.windowStartHour) out.push({ path: ['COMMUTE', 'windowEndHour'], level: 'warn', message: 'The window ends before it starts' });

  const sp = c.SCREEN_POWER;
  if (isPlainObject(sp) && Array.isArray(sp.rooms)) sp.rooms.forEach((r, i) => typeof r === 'string' && !ids.has(r) && out.push({ path: ['SCREEN_POWER', 'rooms', i], level: 'warn', message: `No room with the ID "${r}"` }));
}

export function validateConfig(config: unknown, known?: Known): Issue[] {
  const out: Issue[] = [];
  if (!isPlainObject(config)) return [{ path: [], level: 'error', message: 'The config must be an object' }];
  for (const key of SECTION_KEYS) {
    const v = config[key];
    if (v === undefined) {
      if ((REQUIRED_SECTIONS as readonly string[]).includes(key)) out.push({ path: [key], level: 'error', message: 'Required' });
      continue;
    }
    check(SCHEMA[key].field, v, [key], out, known);
  }
  for (const k of Object.keys(config)) if (!(k in SCHEMA)) out.push({ path: [k], level: 'warn', message: `Unknown section "${k}"` });
  cross(config, out);
  return out;
}

export const errorsOf = (issues: Issue[]) => issues.filter((i) => i.level === 'error');

// Issues at or under `path` (a section's badge, a field's message).
export const issuesUnder = (issues: Issue[], path: Path): Issue[] => issues.filter((i) => path.every((k, n) => i.path[n] === k));
