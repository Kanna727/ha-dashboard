// What the mutual fund orders add up to, per fund and overall: the yearly return
// (XIRR), gains made and still unrealised, split into short and long term. All
// computed from the orders and the current values; none of it is investment or
// tax advice. A fund whose orders don't add up to the units now held (orders from
// before the history starts, bonus units, a merger) is marked `incomplete` and
// left out of the splits and the overall return, so the numbers that are shown
// can be trusted.
import { classify, fifo, fyOf, termOf, type FundClass, type Sale, type Term } from './lots';
import type { Order } from './orders';
import { xirr, type Flow } from './xirr';

const YEAR_MS = 365 * 86_400_000;

// The current holding of a fund (money/Snapshot funds).
export interface HoldingIn {
  scheme: string;
  value: number;
  units?: number;
  category?: string;
  invested?: number;
  gain?: number;
  // Whose it is (FINANCE.people id); only their orders can belong to it.
  owner?: string;
}

export interface Bucket {
  cost: number;
  value: number;
  gain: number;
}
const empty = (): Bucket => ({ cost: 0, value: 0, gain: 0 });

export interface SaleRow extends Sale {
  term: Term;
  slab?: true;
  fy: string;
}

export interface FundReport {
  key: string;
  owner?: string;
  scheme: string;
  cls: FundClass;
  classGuessed: boolean;
  // Units are still held.
  held: boolean;
  invested: number;
  withdrawn: number;
  units: number;
  value?: number;
  // value + withdrawn − invested.
  gain?: number;
  xirr?: number;
  years: number;
  first?: string;
  last?: string;
  // Why the returns and the split can't be trusted for this fund.
  incomplete?: string;
  // The money app's own gain figure, shown for funds that can't be split.
  holdingGain?: number;
  unrealised: { short: Bucket; long: Bucket; slab: Bucket };
  sales: SaleRow[];
}

export interface FyGains {
  fy: string;
  short: number;
  long: number;
  slab: number;
  total: number;
  sales: number;
}

export interface Report {
  asOf: number;
  funds: FundReport[];
  overall: { xirr?: number; years: number; invested: number; withdrawn: number; value: number; gain: number; counted: number; leftOut: number };
  realised: FyGains[];
  unrealised: { short: Bucket; long: Bucket; slab: Bucket; unsplitGain: number; unsplitFunds: number };
}

// ---- matching a holding to its orders' fund by name ----

const STOP = new Set(['fund', 'plan', 'option', 'scheme', 'mutual', 'the', 'of', 'and', 'growth', 'idcw']);
const tokens = (s: string) => new Set(s.toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)));

export function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

const MATCH_AT = 0.75;

interface Group {
  key: string;
  owner?: string;
  scheme: string;
  orders: Order[];
}

function groupOrders(orders: Order[]): Group[] {
  const by = new Map<string, Group>();
  for (const o of orders) {
    const g = by.get(o.key) ?? { key: o.key, owner: o.owner, scheme: o.scheme, orders: [] };
    g.orders.push(o);
    g.scheme = o.scheme; // the newest spelling
    by.set(o.key, g);
  }
  return [...by.values()];
}

function assign(groups: Group[], holdings: HoldingIn[]): Map<string, HoldingIn> {
  const pairs: { g: Group; h: HoldingIn; s: number }[] = [];
  for (const g of groups) for (const h of holdings) if ((g.owner ?? '') === (h.owner ?? '')) pairs.push({ g, h, s: similarity(g.scheme, h.scheme) });
  pairs.sort((a, b) => b.s - a.s);
  const out = new Map<string, HoldingIn>();
  const used = new Set<HoldingIn>();
  for (const p of pairs) {
    if (p.s < MATCH_AT) break;
    if (out.has(p.g.key) || used.has(p.h)) continue;
    out.set(p.g.key, p.h);
    used.add(p.h);
  }
  return out;
}

// ---- the analysis ----

export interface Options {
  // A fund's class by a piece of its name (FINANCE.fundClasses).
  classes?: Record<string, FundClass>;
}

const sumInto = (b: Bucket, cost: number, value: number) => {
  b.cost += cost;
  b.value += value;
  b.gain += value - cost;
};

export function analyseFunds(orders: Order[], holdings: HoldingIn[], now: number, opts: Options = {}): Report {
  const groups = groupOrders(orders);
  const matched = assign(groups, holdings);
  const heldByHolding = new Set(matched.values());
  const funds: FundReport[] = [];

  for (const g of groups) {
    const h = matched.get(g.key);
    const f = fifo(g.orders);
    const { cls, guessed } = classify(h?.scheme ?? g.scheme, h?.category, opts.classes);
    const units = f.lots.reduce((s, l) => s + l.units, 0);
    const value = h?.value;
    const flows: Flow[] = g.orders.map((o) => ({ t: o.t, amount: o.type === 'BUY' ? -o.amount : o.amount }));
    if (value !== undefined && value > 0) flows.push({ t: now, amount: value });

    let incomplete: string | undefined;
    if (f.unmatchedUnits > 1e-3) incomplete = 'Sold more than the orders show buying (some orders are from before the history starts).';
    else if (h?.units !== undefined && Math.abs(units - h.units) > Math.max(0.01, 0.002 * h.units)) incomplete = 'The orders add up to a different number of units than are held.';
    else if (!h && units > 0.01) incomplete = 'No current value found for the units still held.';

    const first = g.orders[0];
    const last = g.orders[g.orders.length - 1];
    const years = (now - first.t) / YEAR_MS;
    const withdrawn = f.sold;
    const gain = value !== undefined ? value + withdrawn - f.bought : units < 0.01 ? withdrawn - f.bought : undefined;

    const unrealised = { short: empty(), long: empty(), slab: empty() };
    const sales: SaleRow[] = [];
    if (!incomplete) {
      for (const s of f.sales) {
        const t = termOf(cls, s.buyT, s.sellT);
        sales.push({ ...s, term: t.term, slab: t.slab, fy: fyOf(s.sellT) });
      }
      if (h && h.units && h.units > 0) {
        const nav = h.value / h.units;
        for (const lot of f.lots) {
          const t = termOf(cls, lot.t, now);
          sumInto(t.slab ? unrealised.slab : t.term === 'long' ? unrealised.long : unrealised.short, lot.cost, lot.units * nav);
        }
      }
    }

    funds.push({
      key: g.key,
      owner: g.owner,
      scheme: h?.scheme ?? g.scheme,
      cls,
      classGuessed: guessed,
      held: units > 0.01,
      invested: f.bought,
      withdrawn,
      units,
      value,
      gain,
      xirr: incomplete ? undefined : xirr(flows),
      years,
      first: first.date,
      last: last.date,
      incomplete,
      holdingGain: h ? (h.gain ?? (h.invested !== undefined ? h.value - h.invested : undefined)) : undefined,
      unrealised,
      sales,
    });
  }

  // Holdings with no orders at all.
  for (const h of holdings) {
    if (heldByHolding.has(h)) continue;
    const { cls, guessed } = classify(h.scheme, h.category, opts.classes);
    funds.push({
      key: `holding:${h.owner ?? ''}:${h.scheme}`,
      owner: h.owner,
      scheme: h.scheme,
      cls,
      classGuessed: guessed,
      held: true,
      invested: h.invested ?? 0,
      withdrawn: 0,
      units: h.units ?? 0,
      value: h.value,
      gain: h.gain,
      years: 0,
      incomplete: 'No orders found for this fund.',
      holdingGain: h.gain ?? (h.invested !== undefined ? h.value - h.invested : undefined),
      unrealised: { short: empty(), long: empty(), slab: empty() },
      sales: [],
    });
  }

  const good = funds.filter((f) => !f.incomplete);
  const allFlows: Flow[] = [];
  const goodGroups = new Set(good.map((f) => f.key));
  for (const g of groups) {
    if (!goodGroups.has(g.key)) continue;
    for (const o of g.orders) allFlows.push({ t: o.t, amount: o.type === 'BUY' ? -o.amount : o.amount });
  }
  for (const f of good) if (f.value && f.value > 0) allFlows.push({ t: now, amount: f.value });
  const firstT = allFlows.length ? Math.min(...allFlows.map((f) => f.t)) : now;
  const overall = {
    xirr: xirr(allFlows),
    years: (now - firstT) / YEAR_MS,
    invested: good.reduce((s, f) => s + f.invested, 0),
    withdrawn: good.reduce((s, f) => s + f.withdrawn, 0),
    value: good.reduce((s, f) => s + (f.value ?? 0), 0),
    gain: good.reduce((s, f) => s + (f.gain ?? 0), 0),
    counted: good.length,
    leftOut: funds.length - good.length,
  };

  const byFy = new Map<string, FyGains>();
  const unrealised = { short: empty(), long: empty(), slab: empty(), unsplitGain: 0, unsplitFunds: 0 };
  for (const f of funds) {
    if (f.incomplete) {
      if (f.holdingGain !== undefined) {
        unrealised.unsplitGain += f.holdingGain;
        unrealised.unsplitFunds++;
      }
      continue;
    }
    for (const s of f.sales) {
      const r = byFy.get(s.fy) ?? { fy: s.fy, short: 0, long: 0, slab: 0, total: 0, sales: 0 };
      r[s.slab ? 'slab' : s.term] += s.gain;
      r.total += s.gain;
      r.sales++;
      byFy.set(s.fy, r);
    }
    for (const k of ['short', 'long', 'slab'] as const) {
      unrealised[k].cost += f.unrealised[k].cost;
      unrealised[k].value += f.unrealised[k].value;
      unrealised[k].gain += f.unrealised[k].gain;
    }
  }

  return {
    asOf: now,
    funds: funds.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.scheme.localeCompare(b.scheme)),
    overall,
    realised: [...byFy.values()].sort((a, b) => b.fy.localeCompare(a.fy)),
    unrealised,
  };
}
