// Medicines: the list (kept in a hidden HA dashboard and edited on the
// dashboard), the daily schedule, and how much stock is left and for how long.
// Pure (no React, no config import). Unit-tested.
//
// Stock: each medicine stores the count someone last entered (`count`) and
// when (`countedAt`). What's left now is that count minus every dose scheduled
// since, so no screen or automation has to "take" doses off and nothing is
// counted twice. Every change (refill, correction, schedule edit, pause,
// resume) stores what's left at that moment as the new count.
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
  paused?: boolean; // no doses (and none counted) while paused
  count?: number | null; // stock when last counted; null/missing = not counted
  countedAt?: string; // ISO time of that count
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
// A dose stays "up next" this long after its time before it counts as taken.
export const GRACE_MIN = 30;

export const timesOf = (times: MedicinesConfig['times']): Record<MedSlot, string> => ({ ...DEFAULT_TIMES, ...times });
export const unitOf = (m: MedicineDef) => m.unit || 'tablet';

// How many come off the stock at a dose time (everyone on the medicine takes theirs).
export const doseAt = (m: MedicineDef, slot: MedSlot) => (m.doses[slot] ?? 0) * m.who.length;
export const smallestDose = (m: MedicineDef) => Math.min(...MED_SLOTS.map((s) => doseAt(m, s)).filter((n) => n > 0), Infinity);

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

// Units scheduled after `from` up to and including `to`.
export function dosesBetween(m: MedicineDef, from: Date, to: Date, times: Record<MedSlot, string>): number {
  if (m.paused || to <= from) return 0;
  let total = 0;
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  for (let day = new Date(from.getFullYear(), from.getMonth(), from.getDate()); day <= end; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    if (!takesOn(m, day)) continue;
    for (const slot of MED_SLOTS) {
      const need = doseAt(m, slot);
      const t = need && atTime(day, times[slot]);
      if (t && t > from && t <= to) total += need;
    }
  }
  return total;
}

// What's left now: the last count minus the doses since (never below 0).
export function remaining(m: MedicineDef, now: Date, times: Record<MedSlot, string>): number | null {
  if (m.count === null || m.count === undefined || !Number.isFinite(m.count)) return null;
  const at = m.countedAt ? new Date(m.countedAt) : now;
  return Math.max(0, m.count - dosesBetween(m, Number.isNaN(at.getTime()) ? now : at, now, times));
}

// Stores `n` as what's left right now.
export const withCount = (m: MedicineDef, n: number | null, now: Date): MedicineDef => ({
  ...m,
  count: n === null ? null : Math.max(0, Math.round(n * 2) / 2),
  countedAt: now.toISOString(),
});

// Pausing or resuming first stores what's left, so the pause doesn't count doses.
export const withPaused = (m: MedicineDef, paused: boolean, now: Date, times: Record<MedSlot, string>): MedicineDef => ({
  ...withCount(m, remaining(m, now, times), now),
  paused: paused || undefined,
});

// When the stock runs out: the time of the first dose there aren't enough left
// for, looking `horizon` days ahead. null when the course ends first, nothing
// is scheduled, it's paused, or it lasts beyond the horizon.
export function runOut(m: MedicineDef, stock: number, now: Date, times: Record<MedSlot, string>, horizon = 400): Date | null {
  if (m.paused) return null;
  let left = stock;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let d = 0; d <= horizon; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
    if (m.until && ymd(day) > m.until) return null;
    if (!takesOn(m, day)) continue;
    for (const slot of MED_SLOTS) {
      const need = doseAt(m, slot);
      if (!need) continue;
      const t = atTime(day, times[slot]);
      if (t <= now) continue; // already counted
      if (left + 1e-9 < need) return t;
      left -= need;
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
  const left = remaining(m, now, times);
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
// what they take then. Paused medicines are left out.
export interface SlotDoses {
  slot: MedSlot;
  time: string;
  at: Date;
  byPerson: Record<string, { med: MedicineDef; dose: number }[]>;
}
export function daySchedule(list: MedicineDef[], day: Date, times: Record<MedSlot, string>): SlotDoses[] {
  const out: SlotDoses[] = [];
  for (const slot of MED_SLOTS) {
    const byPerson: SlotDoses['byPerson'] = {};
    for (const m of list) {
      const dose = m.doses[slot];
      if (!dose || m.paused || !takesOn(m, day)) continue;
      for (const p of m.who) (byPerson[p] ??= []).push({ med: m, dose });
    }
    if (Object.keys(byPerson).length) out.push({ slot, time: times[slot], at: atTime(day, times[slot]), byPerson });
  }
  return out;
}

// The day the panel shows: today until its last dose is past its grace, then tomorrow.
export function shownDay(list: MedicineDef[], now: Date, times: Record<MedSlot, string>): { offset: 0 | 1; slots: SlotDoses[] } {
  const today = daySchedule(list, now, times);
  const pending = today.some((s) => now.getTime() < s.at.getTime() + GRACE_MIN * 60_000);
  if (pending) return { offset: 0, slots: today };
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { offset: 1, slots: daySchedule(list, tomorrow, times) };
}

export type DoseState = 'done' | 'next' | 'later';
export function doseStates(slots: SlotDoses[], now: Date): DoseState[] {
  let seen = false;
  return slots.map((s) => {
    if (now.getTime() >= s.at.getTime() + GRACE_MIN * 60_000) return 'done';
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
