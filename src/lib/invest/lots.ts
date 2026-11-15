// Lots, gains and how long they were held. Computed figures to look at, not tax
// advice: the rules below are the Indian ones as of late 2026, simplified, and a
// fund's class can be wrong (FINANCE.fundClasses overrides it).
import type { Order } from './orders';

export type FundClass = 'equity' | 'debt' | 'other';
export type Term = 'short' | 'long';

const DAY = 86_400_000;
// Debt funds bought from 1 April 2023 are taxed at the slab rate whatever the holding period.
const SPECIFIED_FROM = Date.UTC(2023, 3, 1);
// Budget 2024: for sales from 23 July 2024 the long-term limit for other funds is 24 months, before it 36.
const BUDGET_2024 = Date.UTC(2024, 6, 23);

// A fund's class from its asset category and name: equity-oriented funds
// (equity, index, ELSS, arbitrage and the hybrids that hold mostly equity), debt
// (liquid, bond, gilt, ...), and everything else (gold, international, other
// hybrids). `guessed` when neither said anything and equity was assumed.
export function classify(scheme: string, category?: string, overrides?: Record<string, FundClass>): { cls: FundClass; guessed: boolean } {
  const name = scheme.toLowerCase();
  for (const [k, v] of Object.entries(overrides ?? {})) if (k.trim() && name.includes(k.trim().toLowerCase())) return { cls: v, guessed: false };
  const text = `${category ?? ''} ${scheme}`.toLowerCase();
  if (/arbitrage|equity savings|balanced advantage|dynamic asset|aggressive hybrid|elss|tax saver/.test(text)) return { cls: 'equity', guessed: false };
  if (/gold|silver|commodit|international|global|\bus\b|nasdaq|fund of funds|\bfof\b|multi.?asset|hybrid/.test(text)) return { cls: 'other', guessed: false };
  if (/debt|liquid|overnight|money market|gilt|\bbond|credit risk|banking (&|and) psu|\bpsu\b|floater|duration|corporate|target maturity|\bfmp\b|income fund/.test(text)) return { cls: 'debt', guessed: false };
  if (/equity|index|etf|large|mid ?cap|small ?cap|flexi|multi.?cap|focused|value|contra|sectoral|thematic|nifty|sensex|growth opportunities|blue ?chip|bluechip/.test(text)) return { cls: 'equity', guessed: false };
  return { cls: 'equity', guessed: true };
}

// Held for more than `months` calendar months: sold after the same day that many months on.
function heldMoreThan(buyT: number, sellT: number, months: number): boolean {
  const d = new Date(buyT);
  const limit = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate());
  return sellT > limit;
}

// Short or long term for a lot bought at `buyT` and sold (or valued) at `sellT`.
// `slab`: taxed at the person's slab rate whatever the holding period.
export function termOf(cls: FundClass, buyT: number, sellT: number): { term: Term; slab?: true } {
  if (cls === 'equity') return { term: heldMoreThan(buyT, sellT, 12) ? 'long' : 'short' };
  if (cls === 'debt' && buyT >= SPECIFIED_FROM) return { term: 'short', slab: true };
  return { term: heldMoreThan(buyT, sellT, sellT >= BUDGET_2024 ? 24 : 36) ? 'long' : 'short' };
}

// "2025-26" for a date in April 2025 to March 2026.
export function fyOf(t: number): string {
  const d = new Date(t);
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export interface Lot {
  t: number;
  date: string;
  units: number;
  cost: number;
}

export interface Sale {
  sellDate: string;
  sellT: number;
  buyDate: string;
  buyT: number;
  units: number;
  proceeds: number;
  cost: number;
  gain: number;
}

export interface Fifo {
  // What is left, oldest first.
  lots: Lot[];
  sales: Sale[];
  // Units sold that no earlier purchase accounts for (orders from before the history starts).
  unmatchedUnits: number;
  bought: number;
  sold: number;
}

const EPS = 1e-6;

// One fund's orders (oldest first, buys before sells on a day) matched first in,
// first out, which is how mutual fund sales are taken for tax.
export function fifo(orders: Order[]): Fifo {
  const lots: Lot[] = [];
  const sales: Sale[] = [];
  let unmatched = 0;
  let bought = 0;
  let sold = 0;
  for (const o of orders) {
    if (o.type === 'BUY') {
      lots.push({ t: o.t, date: o.date, units: o.units, cost: o.amount });
      bought += o.amount;
      continue;
    }
    sold += o.amount;
    let left = o.units;
    while (left > EPS && lots.length) {
      const lot = lots[0];
      const take = Math.min(left, lot.units);
      const cost = lot.cost * (take / lot.units);
      sales.push({ sellDate: o.date, sellT: o.t, buyDate: lot.date, buyT: lot.t, units: take, proceeds: o.amount * (take / o.units), cost, gain: o.amount * (take / o.units) - cost });
      lot.units -= take;
      lot.cost -= cost;
      left -= take;
      if (lot.units <= EPS) lots.shift();
    }
    if (left > EPS) unmatched += left;
  }
  return { lots, sales, unmatchedUnits: unmatched, bought, sold };
}

export const daysBetween = (a: number, b: number) => Math.round((b - a) / DAY);
