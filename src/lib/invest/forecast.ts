// A cash-flow forecast from what is known to be coming: recurring payments (each
// repeated by its frequency), card bills (the one due and the cycle still
// running), the monthly fund purchases found in the order history (SIPs) and any
// income the owner listed. It starts from today's money in the bank and counts
// down; it does NOT guess everyday spending, so it shows planned payments, not a
// prediction of the balance. Dates are local calendar days (YYYY-MM-DD).
import type { Order } from './orders';

export type Kind = 'recurring' | 'card' | 'sip' | 'income' | 'one-off';

export interface Planned {
  date: string;
  name: string;
  // Money out is negative.
  amount: number;
  kind: Kind;
}

export interface Day {
  date: string;
  balance: number;
}

export interface Forecast {
  days: Day[];
  events: Planned[];
  lowest: Day;
  out: number;
  in: number;
  end: number;
  // What the figures rest on, in words.
  assumptions: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
export const ymdLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Month arithmetic that keeps the day of the month where it can (31 Jan + 1 month = 28/29 Feb).
function addMonths(d: Date, n: number, day = d.getDate()): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(day, last));
}

// The money app's frequency names ("FREQUENCY_EVERY_MONTH", "monthly", ...) as a step.
export function stepOf(frequency: string | undefined): { months?: number; days?: number } | undefined {
  const f = (frequency ?? 'monthly').toLowerCase().replace(/^frequency_/, '').replace(/[_ ]+/g, ' ').trim();
  if (/daily|every day/.test(f)) return { days: 1 };
  if (/fortnight|every 2 weeks|biweekly|bi-weekly/.test(f)) return { days: 14 };
  if (/week/.test(f)) return { days: 7 };
  if (/quarter|every 3 months/.test(f)) return { months: 3 };
  if (/half|every 6 months|semi/.test(f)) return { months: 6 };
  if (/year|annual/.test(f)) return { months: 12 };
  if (/month/.test(f)) return { months: 1 };
  return undefined;
}

// Every date of a recurring payment from its next due date up to `to`.
export function occurrences(nextDue: string, frequency: string | undefined, from: Date, to: Date): string[] {
  const step = stepOf(frequency);
  const first = parse(nextDue);
  const out: string[] = [];
  if (Number.isNaN(first.getTime())) return out;
  if (!step) return first >= from && first <= to ? [nextDue] : [];
  for (let i = 0; i < 400; i++) {
    const d = step.days ? addDays(first, step.days * i) : addMonths(first, (step.months ?? 1) * i, first.getDate());
    if (d > to) break;
    if (d >= from) out.push(ymdLocal(d));
  }
  return out;
}

export interface SipFound {
  scheme: string;
  amount: number;
  // Day of the month it usually goes.
  day: number;
  last: string;
  next: string;
}

// Funds bought about once a month for about the same amount, lately: a SIP.
export function detectSips(orders: Order[], now: Date): SipFound[] {
  const by = new Map<string, Order[]>();
  for (const o of orders) if (o.type === 'BUY') by.set(o.key, [...(by.get(o.key) ?? []), o]);
  const out: SipFound[] = [];
  for (const list of by.values()) {
    const recent = list.slice(-6);
    if (recent.length < 3) continue;
    const gaps = recent.slice(1).map((o, i) => (o.t - recent[i].t) / 86_400_000);
    const monthly = gaps.filter((g) => g >= 26 && g <= 36).length;
    const amounts = recent.map((o) => o.amount);
    const med = [...amounts].sort((a, b) => a - b)[amounts.length >> 1];
    const steady = amounts.filter((a) => Math.abs(a - med) <= 0.03 * med).length;
    const last = recent[recent.length - 1];
    const sinceLast = (now.getTime() - last.t) / 86_400_000;
    if (monthly < Math.max(2, gaps.length - 1) || steady < recent.length - 1 || sinceLast > 45) continue;
    const days = recent.map((o) => Number(o.date.slice(8, 10))).sort((a, b) => a - b);
    const day = days[days.length >> 1];
    let next = addMonths(parse(last.date), 1, day);
    while (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next = addMonths(next, 1, day);
    out.push({ scheme: last.scheme, amount: Math.round(med), day, last: last.date, next: ymdLocal(next) });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export interface CardIn {
  name: string;
  outstanding?: number;
  cycleSpent?: number;
  statementDate?: string;
  lastBill?: { total: number; due?: string; statementDate?: string; paid: boolean; remaining?: number };
}

// The bill that is due and the one the running cycle will become.
export function cardBills(cards: CardIn[], now: Date): Planned[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: Planned[] = [];
  for (const c of cards) {
    const b = c.lastBill;
    if (b && !b.paid && b.due) {
      const amount = b.remaining ?? b.total;
      if (amount > 0) out.push({ date: b.due, name: `${c.name} bill`, amount: -amount, kind: 'card' });
    }
    if (c.cycleSpent && c.cycleSpent > 0 && c.statementDate) {
      // Due a similar number of days after the statement as the last bill was.
      const gap = b?.due && b.statementDate ? Math.round((parse(b.due).getTime() - parse(b.statementDate).getTime()) / 86_400_000) : 18;
      const due = addDays(parse(c.statementDate), gap > 0 && gap < 40 ? gap : 18);
      if (due >= today) out.push({ date: ymdLocal(due), name: `${c.name} bill (this cycle so far)`, amount: -c.cycleSpent, kind: 'card' });
    }
  }
  return out;
}

export interface RecurringIn {
  name: string;
  amount: number;
  frequency?: string;
  nextDue?: string;
}
export interface UpcomingIn {
  date: string;
  name: string;
  amount: number;
}
export interface IncomeIn {
  name: string;
  amount: number;
  // Day of the month it arrives.
  day: number;
}

export interface Input {
  now: Date;
  days: number;
  // Money in the bank now (what can pay these).
  balance: number;
  recurring: RecurringIn[];
  upcoming: UpcomingIn[];
  cards: CardIn[];
  orders: Order[];
  income?: IncomeIn[];
}

const SIPISH = /\b(sip|mutual fund|mf)\b/i;

export function buildForecast(i: Input): Forecast {
  const from = new Date(i.now.getFullYear(), i.now.getMonth(), i.now.getDate());
  const to = addDays(from, i.days);
  const events: Planned[] = [];
  const assumptions: string[] = [];

  const sips = detectSips(i.orders, i.now);
  const skipNames = (n: string) => sips.length > 0 && SIPISH.test(n);

  const names = new Set<string>();
  for (const r of i.recurring) {
    if (!r.nextDue || skipNames(r.name)) continue;
    names.add(r.name.toLowerCase());
    for (const d of occurrences(r.nextDue, r.frequency, from, to)) events.push({ date: d, name: r.name, amount: -Math.abs(r.amount), kind: 'recurring' });
  }
  for (const u of i.upcoming) {
    if (names.has(u.name.toLowerCase()) || skipNames(u.name)) continue;
    const d = parse(u.date);
    if (d >= from && d <= to) events.push({ date: u.date, name: u.name, amount: -Math.abs(u.amount), kind: 'one-off' });
  }
  for (const b of cardBills(i.cards, i.now)) if (parse(b.date) >= from && parse(b.date) <= to) events.push(b);
  for (const s of sips) {
    for (const d of occurrences(s.next, 'monthly', from, to)) events.push({ date: d, name: `SIP: ${s.scheme}`, amount: -s.amount, kind: 'sip' });
  }
  for (const inc of i.income ?? []) {
    for (let m = 0; m <= Math.ceil(i.days / 28) + 1; m++) {
      const d = addMonths(from, m, inc.day);
      if (d >= from && d <= to) events.push({ date: ymdLocal(d), name: inc.name, amount: Math.abs(inc.amount), kind: 'income' });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);

  const days: Day[] = [];
  let bal = i.balance;
  let at = 0;
  for (let n = 0; n <= i.days; n++) {
    const date = ymdLocal(addDays(from, n));
    while (at < events.length && events[at].date <= date) bal += events[at++].amount;
    days.push({ date, balance: Math.round(bal) });
  }
  const lowest = days.reduce((m, d) => (d.balance < m.balance ? d : m), days[0]);
  const out = events.filter((e) => e.amount < 0).reduce((s, e) => s + -e.amount, 0);
  const inn = events.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);

  assumptions.push('Starts from the money in your bank accounts today.');
  assumptions.push('Counts recurring payments, card bills (the one due and the cycle still running), SIPs found in your fund orders' + (i.income?.length ? ' and the income you listed.' : '. No income is listed, so nothing comes in.'));
  assumptions.push('Everyday spending that is not a card spend or a recurring payment is not included.');
  return { days, events, lowest, out, in: inn, end: days[days.length - 1].balance, assumptions };
}
