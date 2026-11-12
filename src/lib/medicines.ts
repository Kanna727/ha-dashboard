// Medicines: the list (kept in a hidden HA dashboard and edited on the
// dashboard), the daily schedule, and how much stock is left and for how long.
// Pure (no React, no config import). Unit-tested.
//
// Stock: each medicine stores how many are left (`count`). Ticking a dose as
// taken takes it off the count and remembers how much came off under the
// dose's key (`taken`), so unticking puts exactly that back and a second tick
// from another screen changes nothing. Untaken doses don't touch the stock.
import type { MedSlot, MedicinesConfig } from '../config/types';

export interface MedicineDef {
  id: string;
  name: string;
  // Who takes it (people ids). Two people on one medicine share one stock.
  who: string[];
  // How many each person takes at each time, e.g. { after_breakfast: 1, after_dinner: 0.5 }.
  doses: Partial<Record<MedSlot, number>>;
  days?: number[]; // 0 = Sunday (JS getDay()); missing = every day
  until?: string; // 'YYYY-MM-DD', the course's last day
  unit?: string; // what is counted, default 'tablet'
  pack?: number; // how many come in a strip or bottle: the refill button adds this many
  note?: string; // e.g. 'Empty stomach'
  paused?: boolean; // no doses shown or expected while paused
  count?: number | null; // how many are left; null/missing = not counted
  countedAt?: string; // ISO time someone last set the count by hand
  // Doses ticked as taken: doseKey → how many came off the count (kept a week).
  taken?: Record<string, number>;
}

export const MED_SLOTS: MedSlot[] = ['before_breakfast', 'after_breakfast', 'before_lunch', 'after_lunch', 'before_dinner', 'after_dinner'];

export const SLOT_LABEL: Record<MedSlot, string> = {
  before_breakfast: 'Before breakfast',
  after_breakfast: 'After breakfast',
  before_lunch: 'Before lunch',
  after_lunch: 'After lunch',
  before_dinner: 'Before dinner',
  after_dinner: 'After dinner',
};

export const DEFAULT_TIMES: Record<MedSlot, string> = {
  before_breakfast: '07:30',
  after_breakfast: '08:30',
  before_lunch: '12:30',
  after_lunch: '13:30',
  before_dinner: '19:30',
  after_dinner: '20:30',
};

const DAY = 86_400_000;
// A dose stays "up next" this long after its time; unticked after that, it shows as missed.
export const GRACE_MIN = 30;

export const timesOf = (times: MedicinesConfig['times']): Record<MedSlot, string> => ({ ...DEFAULT_TIMES, ...times });
export const unitOf = (m: MedicineDef) => m.unit || 'tablet';

// How many come off the stock at a dose time (everyone on the medicine takes theirs).
export const doseAt = (m: MedicineDef, slot: MedSlot) => (m.doses[slot] ?? 0) * m.who.length;
// The smallest single dose one person takes (what one tick takes off).
export const smallestDose = (m: MedicineDef) => Math.min(...MED_SLOTS.map((s) => m.doses[s] ?? 0).filter((n) => n > 0), Infinity);

// 'YYYY-MM-DD' in local time.
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function atTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m || 0);
}

export const takesOn = (m: MedicineDef, day: Date) => (!m.days || m.days.includes(day.getDay())) && (!m.until || ymd(day) <= m.until);

// Units used per day on average (weekly medicines count a seventh per day).
export function perDay(m: MedicineDef): number {
  const daily = MED_SLOTS.reduce((s, slot) => s + doseAt(m, slot), 0);
  return (daily * (m.days ? new Set(m.days).size : 7)) / 7;
}

// One person's dose at one time on one day: 'YYYY-MM-DD|after_dinner|a'.
export const doseKey = (day: Date, slot: MedSlot, person: string) => `${ymd(day)}|${slot}|${person}`;
export const isTaken = (m: MedicineDef, key: string) => !!m.taken && key in m.taken;

// How many are left (never below 0); null when never counted.
export function remaining(m: MedicineDef): number | null {
  return m.count === null || m.count === undefined || !Number.isFinite(m.count) ? null : Math.max(0, m.count);
}

// Sets how many are left, counted by hand now.
export const withCount = (m: MedicineDef, n: number | null, now: Date): MedicineDef => ({
  ...m,
  count: n === null ? null : Math.max(0, Math.round(n * 2) / 2),
  countedAt: now.toISOString(),
});

export const withPaused = (m: MedicineDef, paused: boolean): MedicineDef => ({ ...m, paused: paused || undefined });

// How long ticks are kept: the board only shows today and tomorrow, and an
// untick can only reach back that far.
export const KEEP_TAKEN_DAYS = 7;

// Ticks (`want`) or unticks one dose. A tick takes `dose` off the count (no
// more than is left) and remembers how much; an untick puts that back. Asking
// for the state it's already in changes nothing, so two screens can't take a
// dose off twice. Ticks older than a week are dropped.
export function withTaken(m: MedicineDef, key: string, dose: number, want: boolean, now: Date): MedicineDef {
  const taken = { ...m.taken };
  let count = remaining(m);
  if (want && !(key in taken)) {
    const off = count === null ? 0 : Math.min(count, dose);
    taken[key] = off;
    if (count !== null) count -= off;
  } else if (!want && key in taken) {
    if (count !== null) count += taken[key];
    delete taken[key];
  }
  const oldest = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - KEEP_TAKEN_DAYS));
  for (const k of Object.keys(taken)) if (k.slice(0, 10) < oldest) delete taken[k];
  return { ...m, count, taken: Object.keys(taken).length ? taken : undefined };
}

// When the stock runs out: the time of the first dose there aren't enough left
// for, looking `horizon` days ahead. Today's doses not ticked yet are still
// expected (even ones whose time has passed: they may be taken late), then
// every dose after today. null when the course ends first, nothing is
// scheduled, it's paused, or it lasts beyond the horizon.
export function runOut(m: MedicineDef, stock: number, now: Date, times: Record<MedSlot, string>, horizon = 400): Date | null {
  if (m.paused) return null;
  let left = stock;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let d = 0; d <= horizon; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
    if (m.until && ymd(day) > m.until) return null;
    if (!takesOn(m, day)) continue;
    for (const slot of MED_SLOTS) {
      const need = m.doses[slot] ?? 0;
      if (!need) continue;
      for (const p of m.who) {
        if (d === 0 && isTaken(m, doseKey(day, slot, p))) continue;
        if (left + 1e-9 < need) return atTime(day, times[slot]);
        left -= need;
      }
    }
  }
  return null;
}

// Whole calendar days from `now` to `t` (0 = today).
export const daysAway = (t: Date, now: Date) =>
  Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY);

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (t: Date) => `${t.getDate()} ${MONTH[t.getMonth()]}`;

// "today", "tomorrow", "Friday" (within a week), else "18 Nov".
export function dayText(t: Date, now: Date): string {
  const d = daysAway(t, now);
  if (d <= 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 7) return WEEKDAY[t.getDay()];
  return shortDate(t);
}

export interface StockStatus {
  med: MedicineDef;
  left: number | null; // null: never counted
  out: Date | null; // the first dose there won't be enough for
  low: boolean; // runs out within lowDays (or already has); never while paused
}

export function stockStatus(m: MedicineDef, now: Date, times: Record<MedSlot, string>, lowDays: number): StockStatus {
  const left = remaining(m);
  if (left === null) return { med: m, left, out: null, low: false };
  const out = runOut(m, left, now, times);
  return { med: m, left, out, low: !!out && out.getTime() - now.getTime() < lowDays * DAY };
}

// The "Needs attention" text: "Omega-3 has run out", "Omega-3 runs out Friday".
// `who` is added when the name alone is ambiguous (two people, separate stocks).
export function lowText(s: StockStatus, now: Date, who?: string): string {
  const name = who ? `${who}'s ${s.med.name}` : s.med.name;
  if (!s.out) return name;
  if (s.left !== null && s.left + 1e-9 < smallestDose(s.med)) return `${name} has run out`;
  return `${name} runs out ${dayText(s.out, now)}`;
}

// One day's doses by time: each slot with something to take, and per person
// what they take then and whether it's ticked. Paused medicines are left out.
export interface PersonDose {
  med: MedicineDef;
  dose: number;
  key: string;
  taken: boolean;
}
export interface SlotDoses {
  slot: MedSlot;
  time: string;
  at: Date;
  byPerson: Record<string, PersonDose[]>;
}
export function daySchedule(list: MedicineDef[], day: Date, times: Record<MedSlot, string>): SlotDoses[] {
  const out: SlotDoses[] = [];
  for (const slot of MED_SLOTS) {
    const byPerson: SlotDoses['byPerson'] = {};
    for (const m of list) {
      const dose = m.doses[slot];
      if (!dose || m.paused || !takesOn(m, day)) continue;
      for (const p of m.who) {
        const key = doseKey(day, slot, p);
        (byPerson[p] ??= []).push({ med: m, dose, key, taken: isTaken(m, key) });
      }
    }
    if (Object.keys(byPerson).length) out.push({ slot, time: times[slot], at: atTime(day, times[slot]), byPerson });
  }
  return out;
}

const allTaken = (s: SlotDoses) => Object.values(s.byPerson).every((ds) => ds.every((d) => d.taken));

// Untaken doses stay on the board this long after the day's last dose time.
export const LATE_HOURS = 2;

// The day the panel shows: today, until its last dose time has passed with
// everything ticked, or LATE_HOURS after it; then tomorrow.
export function shownDay(list: MedicineDef[], now: Date, times: Record<MedSlot, string>): { offset: 0 | 1; slots: SlotDoses[] } {
  const today = daySchedule(list, now, times);
  const last = today.at(-1)?.at.getTime();
  const t = now.getTime();
  const over = last === undefined || t >= last + LATE_HOURS * 3_600_000 || (t >= last && today.every(allTaken));
  if (!over) return { offset: 0, slots: today };
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { offset: 1, slots: daySchedule(list, tomorrow, times) };
}

// Each slot's look: every dose ticked (done), past its time by GRACE_MIN with
// something unticked (missed), the first other one (next), or later.
export type DoseState = 'done' | 'missed' | 'next' | 'later';
export function doseStates(slots: SlotDoses[], now: Date): DoseState[] {
  let seen = false;
  return slots.map((s) => {
    if (allTaken(s)) return 'done';
    if (now.getTime() >= s.at.getTime() + GRACE_MIN * 60_000) return 'missed';
    if (seen) return 'later';
    seen = true;
    return 'next';
  });
}

// "1 after breakfast · ½ after dinner", with "Sundays" or "Mon, Thu" for days.
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const amount = (n: number) => (n === 0.5 ? '½' : n === 0.25 ? '¼' : Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
export function scheduleText(m: MedicineDef): string {
  const parts = MED_SLOTS.filter((s) => m.doses[s]).map((s) => `${amount(m.doses[s]!)} ${SLOT_LABEL[s].toLowerCase()}`);
  const days = m.days ? [...new Set(m.days)].sort() : null;
  const when =
    !days || days.length === 7
      ? ''
      : days.length === 1
        ? ` · ${WEEKDAY[days[0]]}s`
        : ` · ${[1, 2, 3, 4, 5, 6, 0]
            .filter((d) => days.includes(d))
            .map((d) => DAY_SHORT[d])
            .join(', ')}`;
  return (parts.join(' · ') || 'Not scheduled') + when;
}

// ---- the stored document ----

export const MEDICINES_VERSION = 1;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

function takenOf(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = Object.fromEntries(Object.entries(v).filter(([k, n]) => /^\d{4}-\d{2}-\d{2}\|/.test(k) && num(n) !== undefined && (n as number) >= 0));
  return Object.keys(out).length ? out : undefined;
}

// The medicines in a stored document; anything malformed is dropped, so an
// odd entry can't break the panel.
export function parseMedicines(doc: unknown): MedicineDef[] {
  const list = (doc as { medicines?: unknown } | null)?.medicines;
  if (!Array.isArray(list)) return [];
  const out: MedicineDef[] = [];
  for (const raw of list) {
    const r = raw as Record<string, unknown>;
    const id = str(r?.id);
    const name = str(r?.name);
    if (!id || !name) continue;
    const doses: MedicineDef['doses'] = {};
    for (const s of MED_SLOTS) {
      const n = num((r.doses as Record<string, unknown> | undefined)?.[s]);
      if (n && n > 0) doses[s] = n;
    }
    const days = Array.isArray(r.days) ? r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6) : undefined;
    out.push({
      id,
      name,
      who: Array.isArray(r.who) ? r.who.filter((w): w is string => typeof w === 'string') : [],
      doses,
      days: days && days.length ? days : undefined,
      until: str(r.until),
      unit: str(r.unit),
      pack: num(r.pack),
      note: str(r.note),
      paused: r.paused === true || undefined,
      count: num(r.count) ?? null,
      countedAt: str(r.countedAt),
      taken: takenOf(r.taken),
    });
  }
  return out;
}

export const medicinesDoc = (list: MedicineDef[]) => ({ version: MEDICINES_VERSION, medicines: list });

// A new id from the name: "vitamin_d3", "vitamin_d3_2", ...
export function newMedicineId(name: string, list: MedicineDef[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'medicine';
  let id = base;
  for (let i = 2; list.some((m) => m.id === id); i++) id = `${base}_${i}`;
  return id;
}

// Adds or replaces one medicine (by id), keeping the others as stored.
export const upsertMedicine = (list: MedicineDef[], m: MedicineDef) =>
  list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m];
export const removeMedicine = (list: MedicineDef[], id: string) => list.filter((x) => x.id !== id);

// ---- what Home Assistant gets (for its reminder and stock automations) ----

// HA automations can't read the stored document, so the dashboard sends this
// summary as a `dashboard_medicines` event whenever it changes; a trigger-based
// template sensor named "Dashboard medicines" keeps it, its state the `hash`.
// See AGENTS.md "Medicines panel" for the HA side.
export const HA_EVENT = 'dashboard_medicines';

// That sensor, found by itself (no entity ID in the bundle): the one the config
// names, else a sensor called "Dashboard medicines", else one already holding a
// summary. undefined when HA has none, and then nothing is sent.
export function findHaSensor(states: Record<string, { attributes: Record<string, unknown> } | undefined>, configured?: string): string | undefined {
  if (configured) return states[configured] ? configured : undefined;
  const sensors = Object.keys(states).filter((id) => id.startsWith('sensor.'));
  return (
    sensors.find((id) => String(states[id]?.attributes.friendly_name ?? '').trim().toLowerCase() === 'dashboard medicines') ??
    sensors.find((id) => {
      const a = states[id]?.attributes;
      return !!a && Array.isArray(a.doses) && Array.isArray(a.taken) && 'low_days' in a;
    })
  );
}

export interface HaMedicines {
  hash: string;
  times: Record<MedSlot, string>;
  labels: Record<MedSlot, string>;
  people: Record<string, string>; // id → name
  low_days: number; // MEDICINES.lowDays
  // Every medicine: what's left, when it runs out ('YYYY-MM-DD', null = not
  // within ~a year or the course ends first), whether it's low or has run out.
  medicines: { id: string; name: string; who: string[]; unit: string; left: number | null; runs_out: string | null; low: boolean; empty: boolean; paused: boolean }[];
  // One entry per person per dose time of every medicine that isn't paused.
  doses: { id: string; name: string; person: string; slot: MedSlot; dose: number; days: number[]; until: string | null }[];
  taken: string[]; // doseKeys ticked today or yesterday
}

// A short, stable hash of a string (djb2), for telling whether HA has the latest summary.
export function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function haSummary(list: MedicineDef[], now: Date, times: Record<MedSlot, string>, people: { id: string; name: string }[], lowDays: number): HaMedicines {
  const yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const body: Omit<HaMedicines, 'hash'> = {
    times,
    labels: SLOT_LABEL,
    people: Object.fromEntries(people.map((p) => [p.id, p.name])),
    low_days: lowDays,
    medicines: list.map((m) => {
      const s = stockStatus(m, now, times, lowDays);
      return {
        id: m.id,
        name: m.name,
        who: m.who,
        unit: unitOf(m),
        left: s.left,
        runs_out: s.out ? ymd(s.out) : null,
        low: s.low,
        empty: s.left !== null && s.left + 1e-9 < smallestDose(m),
        paused: !!m.paused,
      };
    }),
    doses: list
      .filter((m) => !m.paused)
      .flatMap((m) =>
        MED_SLOTS.filter((slot) => (m.doses[slot] ?? 0) > 0).flatMap((slot) =>
          m.who.map((person) => ({
            id: m.id,
            name: m.name,
            person,
            slot,
            dose: m.doses[slot]!,
            days: m.days ? [...new Set(m.days)].sort() : [0, 1, 2, 3, 4, 5, 6],
            until: m.until ?? null,
          })),
        ),
      ),
    taken: list.flatMap((m) => Object.keys(m.taken ?? {}).filter((k) => k.slice(0, 10) >= yesterday)).sort(),
  };
  return { hash: shortHash(JSON.stringify(body)), ...body };
}
