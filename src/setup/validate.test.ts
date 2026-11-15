import { describe, expect, it } from 'vitest';
import example from '../../config/dashboard.config.example';
import { ICONS } from '../components/Icon';
import type { DashboardConfig } from '../config/types';
import { setAt } from './draft';
import { blank, SCHEMA, SECTION_KEYS, type Field } from './schema';
import { errorsOf, issuesUnder, validateConfig, type Issue } from './validate';

const clone = () => structuredClone(example) as unknown as Record<string, unknown>;
const messages = (issues: Issue[]) => issues.map((i) => `${i.path.join('.')}: ${i.message}`);

describe('the example config', () => {
  it('has nothing to report: the schema describes every setting the example uses', () => {
    expect(messages(validateConfig(example))).toEqual([]);
  });

  it('uses only icons the dashboard has', () => {
    expect(messages(validateConfig(example, { icons: new Set(Object.keys(ICONS)) }))).toEqual([]);
  });

  it('has an entry in the schema for every section', () => {
    expect(SECTION_KEYS.sort()).toEqual(Object.keys(example).sort().concat(SECTION_KEYS.filter((k) => !(k in example))).sort());
    for (const k of Object.keys(example)) expect(SCHEMA).toHaveProperty(k);
  });
});

describe('errors', () => {
  it('flags a missing required section and setting', () => {
    const c = clone();
    delete c.WEATHER;
    expect(messages(validateConfig(c))).toContain('WEATHER: Required');
    const d = setAt(clone(), ['CAR', 'lock'], undefined);
    expect(messages(validateConfig(d))).toContain('CAR.lock: Required');
  });

  it('flags the wrong kind of value', () => {
    const c = setAt(clone(), ['ROOMS', 0, 'presence'], 'binary_sensor.x');
    expect(messages(validateConfig(c))).toContain('ROOMS.0.presence: Should be a list, not a string');
    const n = setAt(clone(), ['COMMUTE', 'windowStartHour'], '9');
    expect(errorsOf(validateConfig(n)).map((i) => i.path.join('.'))).toContain('COMMUTE.windowStartHour');
  });

  it('flags an entity ID that isn’t one, a bad time, a bad colour, a bad pattern and a number out of range', () => {
    let c = setAt(clone(), ['WEATHER'], 'Weather Home');
    c = setAt(c, ['COMMUTE', 'arriveBy'], '25:00');
    c = setAt(c, ['CAR_DETAIL', 'model'], { url: 'x.glb', paint: 'green', paintMaterial: '(' });
    c = setAt(c, ['BATTERIES'], { low: 150 });
    const m = messages(validateConfig(c));
    expect(m).toContain('WEATHER: "Weather Home" isn’t an entity ID (like domain.entity_name)');
    expect(m).toContain('COMMUTE.arriveBy: "25:00" isn’t a time like 07:30');
    expect(m).toContain('CAR_DETAIL.model.paint: "green" isn’t a colour like #2c3527');
    expect(m).toContain('CAR_DETAIL.model.paintMaterial: Not a valid pattern');
    expect(m).toContain('BATTERIES.low: At most 99');
  });

  it('flags two rooms with the same ID', () => {
    const c = setAt(clone(), ['ROOMS', 1, 'id'], (clone().ROOMS as { id: string }[])[0].id);
    expect(messages(validateConfig(c)).some((s) => /already used by room 1/.test(s))).toBe(true);
  });

  it('knows nothing about an either-or setting being in the wrong shape until both fail', () => {
    expect(validateConfig(setAt(clone(), ['STORAGE'], { inbox: false }))).toEqual([]);
    expect(validateConfig(setAt(clone(), ['STORAGE'], { inbox: 'todo.dashboard_data' }))).toEqual([]);
    expect(errorsOf(validateConfig(setAt(clone(), ['STORAGE'], { inbox: 5 }))).length).toBeGreaterThan(0);
    expect(validateConfig(setAt(clone(), ['CAR_DETAIL', 'model'], { url: 'x.glb', rhd: true }))).toEqual([]);
  });
});

describe('warnings', () => {
  it('points at a setting that doesn’t exist, as a typo', () => {
    const c = setAt(clone(), ['CAR', 'fuell'], 'sensor.x');
    expect(messages(validateConfig(c))).toContain('CAR.fuell: Unknown setting "fuell" (a typo?)');
    expect(messages(validateConfig(setAt(clone(), ['NOT_A_SECTION'], 1)))).toContain('NOT_A_SECTION: Unknown section "NOT_A_SECTION"');
  });

  it('says when an entity is of an unexpected kind or not in Home Assistant', () => {
    const known = new Set(['weather.forecast_home']);
    const c = setAt(setAt(clone(), ['SUN'], 'light.sun'), ['WEATHER'], 'weather.forecast_home');
    const m = messages(validateConfig(c, { entities: known }));
    expect(m).toContain('SUN: Usually sun.*, not light.*');
    expect(m).toContain('SUN: light.sun isn’t in Home Assistant (yet?)');
    expect(m.some((s) => s.startsWith('WEATHER:'))).toBe(false);
    expect(errorsOf(validateConfig(c, { entities: known }))).toEqual([]);
  });

  it('checks the meal plan against the people and slots', () => {
    const c = setAt(clone(), ['MEALS', 'plan', '1', 'zed'], { breakfast: 'x' });
    const m = messages(validateConfig(c));
    expect(m).toContain('MEALS.plan.1.zed: "zed" isn’t one of the people above');
    expect(m).toContain('MEALS.plan.1.zed.lunch: No meal set');
    expect(messages(validateConfig(setAt(clone(), ['MEALS', 'plan', '9'], {})))).toContain('MEALS.plan.9: Day 9 isn’t 0 (Sunday) to 6 (Saturday)');
  });

  it('flags a commute window that ends before it starts, and a wall-screen room that doesn’t exist', () => {
    const c = setAt(setAt(clone(), ['COMMUTE', 'windowEndHour'], 8), ['SCREEN_POWER', 'rooms'], ['nowhere']);
    const m = messages(validateConfig(c));
    expect(m).toContain('COMMUTE.windowEndHour: The window ends before it starts');
    expect(m).toContain('SCREEN_POWER.rooms.0: No room with the ID "nowhere"');
  });
});

describe('helpers', () => {
  it('finds the issues under a path', () => {
    const issues = validateConfig(setAt(clone(), ['CAR', 'fuell'], 'x'));
    expect(issuesUnder(issues, ['CAR'])).toHaveLength(1);
    expect(issuesUnder(issues, ['ROOMS'])).toHaveLength(0);
  });

  it('a blank room is what "Add room" starts from: only the required settings, and it needs filling in', () => {
    const room = blank((SCHEMA.ROOMS.field as unknown as { of: Field }).of) as Record<string, unknown>;
    expect(Object.keys(room).sort()).toEqual(['controls', 'doors', 'icon', 'id', 'name', 'presence']);
    const c = setAt(clone() as unknown as DashboardConfig, ['ROOMS', 99], room);
    expect(errorsOf(validateConfig(c)).length).toBeGreaterThan(0);
  });

  it('a config that isn’t an object is one error', () => {
    expect(validateConfig(null)).toHaveLength(1);
    expect(validateConfig([])).toHaveLength(1);
  });
});
