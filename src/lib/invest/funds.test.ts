import { describe, expect, it } from 'vitest';
import { analyseFunds, similarity, type HoldingIn } from './funds';
import { classify, fifo, fyOf, termOf } from './lots';
import { parseOrders, schemeKey, type Order } from './orders';

const T = (s: string) => Date.parse(`${s}T00:00:00Z`);
let n = 0;
const order = (date: string, type: 'BUY' | 'SELL', scheme: string, units: number, amount: number, isin?: string): Order => ({ date, t: T(date), type, scheme, key: schemeKey(scheme, isin ?? `ISIN${scheme.length}${scheme.charCodeAt(0)}`), units, amount, isin, note: `o${n++}` });
const sorted = (os: Order[]) => [...os].sort((a, b) => a.t - b.t || (a.type === b.type ? 0 : a.type === 'BUY' ? -1 : 1));

describe('first in, first out', () => {
  it('takes a sale from the oldest lots and keeps the rest', () => {
    const f = fifo([order('2024-01-01', 'BUY', 'A', 10, 1000), order('2024-02-01', 'BUY', 'A', 10, 1200), order('2024-06-01', 'SELL', 'A', 15, 2100)]);
    expect(f.sales).toHaveLength(2);
    expect(f.sales[0]).toMatchObject({ units: 10, proceeds: 1400, cost: 1000, gain: 400, buyDate: '2024-01-01' });
    expect(f.sales[1]).toMatchObject({ units: 5, proceeds: 700, cost: 600, gain: 100, buyDate: '2024-02-01' });
    expect(f.lots).toEqual([{ t: T('2024-02-01'), date: '2024-02-01', units: 5, cost: 600 }]);
    expect(f.unmatchedUnits).toBe(0);
    expect(f.bought).toBe(2200);
    expect(f.sold).toBe(2100);
  });

  it('reports units sold that no purchase accounts for', () => {
    const f = fifo([order('2024-01-01', 'BUY', 'A', 5, 500), order('2024-02-01', 'SELL', 'A', 8, 900)]);
    expect(f.unmatchedUnits).toBeCloseTo(3, 9);
    expect(f.lots).toEqual([]);
  });

  it('puts buys before sells on the same day', () => {
    const f = fifo(sorted([order('2024-03-01', 'SELL', 'A', 5, 600), order('2024-03-01', 'BUY', 'A', 5, 500)]));
    expect(f.unmatchedUnits).toBe(0);
    expect(f.sales[0].gain).toBe(100);
  });
});

describe('short and long term', () => {
  it('equity is long after more than 12 months', () => {
    expect(termOf('equity', T('2024-01-15'), T('2025-01-15'))).toEqual({ term: 'short' });
    expect(termOf('equity', T('2024-01-15'), T('2025-01-16'))).toEqual({ term: 'long' });
    expect(termOf('equity', T('2023-01-01'), T('2023-06-01')).term).toBe('short');
  });

  it('debt bought from April 2023 is always taxed at the slab rate', () => {
    expect(termOf('debt', T('2023-04-01'), T('2027-01-01'))).toEqual({ term: 'short', slab: true });
    expect(termOf('debt', T('2023-03-31'), T('2025-06-01'))).toEqual({ term: 'long' });
  });

  it('other funds are long after 24 months for sales after July 2024, 36 before', () => {
    expect(termOf('other', T('2022-08-01'), T('2024-09-01')).term).toBe('long');
    expect(termOf('other', T('2022-08-01'), T('2024-07-01')).term).toBe('short');
    expect(termOf('other', T('2021-01-01'), T('2023-06-01')).term).toBe('short');
    expect(termOf('other', T('2020-01-01'), T('2023-01-02')).term).toBe('long');
  });

  it('numbers the Indian financial year', () => {
    expect(fyOf(T('2025-03-31'))).toBe('2024-25');
    expect(fyOf(T('2025-04-01'))).toBe('2025-26');
    expect(fyOf(T('2099-12-31'))).toBe('2099-00');
  });
});

describe('fund class', () => {
  it('reads it from the category and the name', () => {
    expect(classify('Axis Bluechip Fund Direct Growth', 'Equity').cls).toBe('equity');
    expect(classify('ITI Banking & PSU Debt Fund Direct Growth', 'Debt').cls).toBe('debt');
    expect(classify('Nippon India Gold Savings Fund', 'Others').cls).toBe('other');
    expect(classify('HDFC Arbitrage Fund', 'Hybrid').cls).toBe('equity');
    expect(classify('Parag Parikh Flexi Cap Fund').cls).toBe('equity');
    expect(classify('Mystery Scheme', undefined)).toEqual({ cls: 'equity', guessed: true });
  });

  it('lets the owner override it by a piece of the name', () => {
    expect(classify('Nippon India Gold Savings Fund', 'Others', { 'gold savings': 'equity' }).cls).toBe('equity');
  });
});

describe('matching names', () => {
  it('matches the same fund spelt two ways and tells direct from regular', () => {
    expect(similarity('ICICI Prudential Flexicap Fund Growth', 'ICICI Prudential Flexicap Fund - Direct Plan Growth')).toBeGreaterThanOrEqual(0.75);
    expect(similarity('Axis Bluechip Fund Direct Growth', 'Axis Bluechip Fund Regular Growth')).toBeLessThan(0.75);
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('two people holding the same fund', () => {
  it('are two funds: orders and holdings only meet within one person', () => {
    const doc = (rows: unknown[][]) => ({ orders: { columns: ['date', 'type', 'scheme', 'isin', 'units', 'amount'], rows } });
    const a = parseOrders(doc([['2025-01-01', 'BUY', 'Alpha Fund', 'INFA', 10, 1000]]), 'me');
    const b = parseOrders(doc([['2025-01-01', 'BUY', 'Alpha Fund', 'INFA', 30, 3000]]), 'her');
    expect(a[0].key).not.toBe(b[0].key);
    const r = analyseFunds([...a, ...b], [{ scheme: 'Alpha Fund', value: 1200, units: 10, owner: 'me' }, { scheme: 'Alpha Fund', value: 4000, units: 30, owner: 'her' }], Date.parse('2025-07-01T00:00:00Z'));
    expect(r.funds.map((f) => [f.owner, f.units, f.incomplete])).toEqual([['her', 30, undefined], ['me', 10, undefined]]);
  });
});

describe('parsing orders', () => {
  it('reads the document, in date order, ignoring bad rows', () => {
    const doc = {
      version: 1,
      orders: {
        columns: ['date', 'type', 'scheme', 'isin', 'units', 'amount', 'note'],
        rows: [
          ['2024-05-01', 'sell', 'Fund A', 'INF1', 5, 600, 'Redemption'],
          ['2024-01-01', 'BUY', 'Fund A', 'INF1', 10, 1000, null],
          ['2024-02-01', 'DIVIDEND', 'Fund A', 'INF1', 1, 10, null],
          ['bad', 'BUY', 'Fund A', 'INF1', 1, 10, null],
          ['2024-03-01', 'BUY', 'Fund B', null, 0, 10, null],
        ],
      },
    };
    const os = parseOrders(doc);
    expect(os.map((o) => `${o.date} ${o.type} ${o.units}`)).toEqual(['2024-01-01 BUY 10', '2024-05-01 SELL 5']);
    expect(os[0].key).toBe('INF1');
    expect(parseOrders(null)).toEqual([]);
  });
});

describe('the fund report', () => {
  const now = T('2025-10-01');
  const A = 'Alpha Equity Fund Direct Growth';
  const B = 'Beta Banking Debt Fund Direct Growth';
  const C = 'Gamma Midcap Fund Direct Growth';
  const D = 'Delta Index Fund Direct Growth';
  const orders = sorted([
    // A: a SIP through 2024 (equity), still held. 12 buys of 1000 → 100 units each 12 months ago.
    ...Array.from({ length: 12 }, (_, i) => order(`2024-${String(i + 1).padStart(2, '0')}-05`, 'BUY', A, 10, 1000, 'INFA')),
    // B: bought and fully sold (debt, before April 2023 → long term at 24 months).
    order('2022-01-10', 'BUY', B, 100, 10000, 'INFB'),
    order('2025-03-10', 'SELL', B, 100, 13000, 'INFB'),
    // C: sells with no buys (orders start late).
    order('2025-05-01', 'SELL', C, 50, 7000, 'INFC'),
  ]);
  const holdings: HoldingIn[] = [
    { scheme: 'Alpha Equity Fund - Direct Plan Growth', value: 15000, units: 120, category: 'Equity' },
    { scheme: C, value: 4000, units: 30, category: 'Equity', invested: 3000, gain: 1000 },
    { scheme: D, value: 9000, units: 90, category: 'Equity', invested: 8000 },
  ];
  const r = analyseFunds(orders, holdings, now);
  const fund = (name: string) => r.funds.find((f) => f.scheme.startsWith(name))!;

  it('gives a fund its invested, value, gain and yearly return', () => {
    const a = fund('Alpha');
    expect(a).toMatchObject({ invested: 12000, withdrawn: 0, value: 15000, gain: 3000, held: true });
    expect(a.incomplete).toBeUndefined();
    expect(a.xirr!).toBeGreaterThan(0.1);
    expect(a.xirr!).toBeLessThan(0.3);
  });

  it('splits what is still held into long and short term by each lot’s age', () => {
    const a = fund('Alpha');
    // On 1 Oct 2025 the lots bought from January to September 2024 are over 12 months old.
    expect(a.unrealised.long.cost + a.unrealised.short.cost).toBeCloseTo(12000, 6);
    expect(a.unrealised.long.cost).toBe(9000); // Jan–Sep 2024
    expect(a.unrealised.short.cost).toBe(3000); // October to December 2024
    expect(a.unrealised.long.value + a.unrealised.short.value).toBeCloseTo(15000, 6);
  });

  it('counts a fund sold in full as a realised gain in its financial year, as long term when held that long', () => {
    const b = fund('Beta');
    expect(b).toMatchObject({ held: false, gain: 3000, invested: 10000, withdrawn: 13000 });
    expect(r.realised).toEqual([{ fy: '2024-25', short: 0, long: 3000, slab: 0, total: 3000, sales: 1 }]);
    expect(b.xirr!).toBeGreaterThan(0.07);
  });

  it('leaves a fund whose orders do not add up out of the splits and the overall return', () => {
    const c = fund('Gamma');
    expect(c.incomplete).toMatch(/before the history starts/);
    expect(c.xirr).toBeUndefined();
    expect(r.unrealised.unsplitGain).toBe(1000 + 1000); // Gamma's own gain and Delta's value − invested
    expect(r.unrealised.unsplitFunds).toBe(2);
    expect(r.overall.counted).toBe(2); // Alpha and Beta
    expect(r.overall.leftOut).toBe(2); // Gamma and Delta
    expect(r.overall.invested).toBe(22000);
  });

  it('lists a holding with no orders, and says why', () => {
    expect(fund('Delta')).toMatchObject({ incomplete: 'No orders found for this fund.', value: 9000 });
  });

  it('gives an overall return from the funds that can be trusted', () => {
    expect(r.overall.xirr!).toBeGreaterThan(0.1);
    expect(r.overall.gain).toBe(6000);
    expect(r.overall.value).toBe(15000);
  });

  it('copes with nothing at all', () => {
    const e = analyseFunds([], [], now);
    expect(e.funds).toEqual([]);
    expect(e.overall.xirr).toBeUndefined();
    expect(e.realised).toEqual([]);
  });

  it('marks the units not adding up as incomplete', () => {
    const o = sorted([order('2024-01-01', 'BUY', A, 10, 1000, 'INFA')]);
    const x = analyseFunds(o, [{ scheme: A, value: 1500, units: 14 }], now);
    expect(x.funds[0].incomplete).toMatch(/different number of units/);
  });
});
