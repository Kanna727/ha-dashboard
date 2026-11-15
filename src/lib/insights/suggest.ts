// Automations the insights suggest, as the config Home Assistant's automation
// editor saves (the 2024.10+ syntax: `triggers`, `conditions`, `actions`, with
// `trigger:` and `action:` keys), a plain-words description of one, and a check
// whether an existing automation already does the same thing. The check reads
// the automation configs as text and is a heuristic: it says "seems to", never
// blocks, and only ever hides the Add button.
import { clock, clockGap } from './stats';
import type { Automation, AutomationDraft, Suggestion } from './types';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKEND = ['sat', 'sun'];
const PREFIX = 'Insight · ';

const domainOf = (entity: string) => entity.split('.')[0];
const seconds = (min: number) => `${clock(min)}:00`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function turnOffAfter(entity: string, name: string, minutes: number): Suggestion {
  return {
    id: `off-after:${entity}:${minutes}`,
    title: `Turn ${name} off after ${minutes} min`,
    why: `So ${name} can't stay on much longer than it normally does.`,
    draft: {
      alias: `${PREFIX}${name} off after ${minutes} min`,
      description: `Suggested by the dashboard: ${name} has been seen running far longer than usual.`,
      mode: 'single',
      triggers: [{ trigger: 'state', entity_id: entity, to: 'on', for: { hours: Math.floor(minutes / 60), minutes: minutes % 60, seconds: 0 } }],
      conditions: [],
      actions: [{ action: `${domainOf(entity)}.turn_off`, target: { entity_id: entity } }],
    },
  };
}

export function atTime(entity: string, name: string, dir: 'on' | 'off', minute: number, type: 'weekday' | 'weekend'): Suggestion {
  const days = type === 'weekday' ? 'weekdays' : 'weekends';
  return {
    id: `at:${entity}:${dir}:${type}:${clock(minute)}`,
    title: `Turn ${name} ${dir} at ${clock(minute)} on ${days}`,
    why: dir === 'on' ? `${name} usually comes on around then on ${days}.` : `${name} is usually off by then on ${days}.`,
    draft: {
      alias: `${PREFIX}${name} ${dir} at ${clock(minute)} on ${days}`,
      description: `Suggested by the dashboard: it is usually switched ${dir} around ${clock(minute)} on ${days}.`,
      mode: 'single',
      triggers: [{ trigger: 'time', at: seconds(minute) }],
      conditions: [{ condition: 'time', weekday: type === 'weekday' ? WEEKDAYS : WEEKEND }],
      actions: [{ action: `${domainOf(entity)}.turn_${dir}`, target: { entity_id: entity } }],
    },
  };
}

export function doorAtNight(entity: string, name: string, fromMin: number, toMin: number): Suggestion {
  return {
    id: `door-night:${entity}:${clock(fromMin)}-${clock(toMin)}`,
    title: `Tell me if ${name} opens between ${clock(fromMin)} and ${clock(toMin)}`,
    why: `It has not been opened then lately, so any opening is worth knowing about.`,
    draft: {
      alias: `${PREFIX}${name} opened at night`,
      description: `Suggested by the dashboard: ${name} is not normally opened between ${clock(fromMin)} and ${clock(toMin)}.`,
      mode: 'single',
      triggers: [{ trigger: 'state', entity_id: entity, to: 'on' }],
      conditions: [{ condition: 'time', after: seconds(fromMin), before: seconds(toMin) }],
      actions: [{ action: 'notify.notify', data: { title: `${name} opened`, message: `${name} was opened at {{ now().strftime('%H:%M') }}.`, data: { dashboard: 'warn' } } }],
    },
  };
}

// An id Home Assistant accepts for a new automation (`/api/config/automation/config/<id>`).
export const automationId = (s: Suggestion, at: number) => `dashboard_insight_${slug(s.draft.alias.replace(PREFIX, '')).slice(0, 40)}_${at.toString(36)}`;

// The draft in words, for the preview before it is added: "When … Then …".
export function describe(d: AutomationDraft, name: (entity: string) => string = (e) => e): string[] {
  const lines: string[] = [];
  for (const t of d.triggers) {
    const kind = String(t.trigger ?? t.platform);
    if (kind === 'time') lines.push(`At ${String(t.at).slice(0, 5)}`);
    else if (kind === 'state') {
      const f = t.for as { hours?: number; minutes?: number } | undefined;
      const span = f ? ` for ${(f.hours ?? 0) * 60 + (f.minutes ?? 0)} min` : '';
      lines.push(`When ${name(String(t.entity_id))} ${span ? `has been ${t.to ?? 'on'}${span}` : `turns ${t.to ?? 'on'}`}`);
    } else lines.push(`When ${kind}`);
  }
  for (const c of d.conditions) {
    if (c.condition === 'time') {
      if (Array.isArray(c.weekday)) lines.push(`Only on ${c.weekday.join(', ')}`);
      if (c.after && c.before) lines.push(`Only between ${String(c.after).slice(0, 5)} and ${String(c.before).slice(0, 5)}`);
    }
  }
  for (const a of d.actions) {
    const target = (a.target as { entity_id?: string } | undefined)?.entity_id;
    const act = String(a.action);
    const verb = act.endsWith('turn_on') ? 'Turn on' : act.endsWith('turn_off') ? 'Turn off' : act.startsWith('notify.') ? 'Send a notification' : act;
    lines.push(`Then ${verb}${target ? ` ${name(target)}` : ''}`);
  }
  return lines;
}

// ---- is it already automated? ----

const asList = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v as Record<string, unknown>] : []);
const text = (v: unknown) => JSON.stringify(v ?? null);
const triggersOf = (c: Record<string, unknown>) => asList(c.triggers ?? c.trigger);
const actionsText = (c: Record<string, unknown>) => text(c.actions ?? c.action);
const nameOf = (a: Automation) => String((a.config as { alias?: unknown })?.alias ?? a.entityId);
const mentions = (a: Automation, entity: string) => text(a.config).includes(`"${entity}"`);

// A time trigger within `slack` minutes of `minute` that switches the entity `dir`.
export function coversTime(autos: Automation[], entity: string, dir: 'on' | 'off', minute: number, slack = 30): string | undefined {
  for (const a of autos) {
    const c = a.config as Record<string, unknown> | null;
    if (!c || !mentions(a, entity) || !actionsText(c).includes(`turn_${dir}`)) continue;
    for (const t of triggersOf(c)) {
      if (String(t.trigger ?? t.platform) !== 'time' || typeof t.at !== 'string') continue;
      const m = /^(\d{1,2}):(\d{2})/.exec(t.at);
      if (m && clockGap(Number(m[1]) * 60 + Number(m[2]), minute) <= slack) return nameOf(a);
    }
  }
  return undefined;
}

// A state trigger on the entity being on for a while that switches it off.
export function coversOffTimer(autos: Automation[], entity: string): string | undefined {
  for (const a of autos) {
    const c = a.config as Record<string, unknown> | null;
    if (!c || !mentions(a, entity) || !actionsText(c).includes('turn_off')) continue;
    if (triggersOf(c).some((t) => String(t.trigger ?? t.platform) === 'state' && t.for !== undefined && String(t.to) === 'on' && text(t.entity_id).includes(entity))) return nameOf(a);
  }
  return undefined;
}

// A state trigger on the door opening that sends a notification.
export function coversDoorAlert(autos: Automation[], entity: string): string | undefined {
  for (const a of autos) {
    const c = a.config as Record<string, unknown> | null;
    if (!c || !mentions(a, entity) || !/notify/.test(actionsText(c))) continue;
    if (triggersOf(c).some((t) => String(t.trigger ?? t.platform) === 'state' && String(t.to) === 'on' && text(t.entity_id).includes(entity))) return nameOf(a);
  }
  return undefined;
}
