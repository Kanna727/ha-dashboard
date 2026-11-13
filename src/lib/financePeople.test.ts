import { describe, expect, it } from 'vitest';
import type { Finance, MoneyHistory } from './finance';
import { parseActivity, parseSnapshot } from './financeDetail';
import { mergeActivity, mergeFinance, mergeHistory, mergeSnapshot } from './financePeople';

const acct = (id: string, name: string, last4: string, balance: number) => ({ id, bank: name.split(' ')[0], product: '', name, last4, balance });

const a: Finance = {
  netWorth: 500000,
  bankTotal: 120000,
  cardsOutstanding: 20000,
  cardsLimit: 200000,
  fundsGain: 10000,
  fundsInvested: 100000,
  healthCover: 1500000,
  premiumDue: '2027-03-14',
  asOf: 1000,
  changedAt: 5000,
  banks: [acct('b1', 'Kotak', '4821', 120000)],
  cards: [acct('c1', 'Kotak League', '4410', 20000)],
  scores: [{ id: 's1', bureau: 'CIBIL', score: 780 }],
  bill: { card: 'Kotak League', last4: '4410', amount: 18000, due: '2026-11-20' },
  lastTransaction: { merchant: 'Corner Cafe', amount: -340 },
};
const b: Finance = {
  netWorth: 200000,
  bankTotal: 80000,
  cardsOutstanding: 5000,
  cardsLimit: 50000,
  fundsGain: 0,
  fundsInvested: 50000,
  healthCover: 1500000,
  asOf: 800,
  changedAt: 9000,
  banks: [acct('b2', 'Canara', '3381', 80000), acct('b3', 'IDFC', '7720', -100)],
  cards: [acct('c2', 'AU Zenith', '5152', 5000)],
  scores: [{ id: 's2', bureau: 'CIBIL', score: 768 }],
  bill: { card: 'AU Zenith', last4: '5152', amount: 3000, due: '2026-11-16' },
  lastTransaction: { merchant: 'Green Basket', amount: -420 },
};

describe('mergeFinance', () => {
  it('returns one person tagged, and undefined for nobody', () => {
    expect(mergeFinance([{ owner: 'me', data: undefined }])).toBeUndefined();
    const one = mergeFinance([{ owner: 'me', data: a }, { owner: 'partner', data: undefined }])!;
    expect(one.netWorth).toBe(500000);
    expect(one.banks[0].owner).toBe('me');
    expect(one.bill?.owner).toBe('me');
  });

  it('adds up totals and recomputes the ratios', () => {
    const m = mergeFinance([{ owner: 'me', data: a }, { owner: 'partner', data: b }])!;
    expect(m.netWorth).toBe(700000);
    expect(m.bankTotal).toBe(200000);
    expect(m.cardsUtilization).toBe(10);
    expect(m.fundsGainPct).toBeCloseTo(6.67, 2);
    // Only the first has a premium date; a total nobody has stays undefined.
    expect(m.premiumDue).toBe('2027-03-14');
    expect(m.loans).toBeUndefined();
  });

  it('counts the same family cover once', () => {
    expect(mergeFinance([{ owner: 'me', data: a }, { owner: 'partner', data: b }])!.healthCover).toBe(1500000);
    expect(mergeFinance([{ owner: 'me', data: a }, { owner: 'partner', data: { ...b, healthCover: 500000 } }])!.healthCover).toBe(2000000);
  });

  it('lists everyone’s rows, tagged and sorted', () => {
    const m = mergeFinance([{ owner: 'me', data: a }, { owner: 'partner', data: b }])!;
    expect(m.banks.map((x) => [x.last4, x.owner])).toEqual([
      ['4821', 'me'],
      ['3381', 'partner'],
      ['7720', 'partner'],
    ]);
    expect(m.scores.map((s) => s.owner)).toEqual(['me', 'partner']);
    // The bill due soonest, the newest transaction, the oldest bank fetch.
    expect(m.bill?.card).toBe('AU Zenith');
    expect(m.bill?.owner).toBe('partner');
    expect(m.lastTransaction?.merchant).toBe('Green Basket');
    expect(m.asOf).toBe(800);
    expect(m.changedAt).toBe(9000);
  });
});

describe('mergeHistory', () => {
  const day = (d: number) => new Date(2026, 9, d).getTime();
  const h1: MoneyHistory = {
    updated: 10,
    netWorth: [
      { t: day(1), v: 100 },
      { t: day(2), v: 110 },
      { t: day(4), v: 130 },
    ],
    months: [{ month: '2026-10', total: 50, categories: [['Food', 30], ['Rent', 20]] }],
    upcoming: [{ date: '2026-11-20', name: 'Rent', amount: 40000 }],
  };
  const h2: MoneyHistory = {
    updated: 5,
    netWorth: [
      { t: day(2), v: 10 },
      { t: day(3), v: 20 },
    ],
    months: [
      { month: '2026-09', total: 5, categories: [['Food', 5]] },
      { month: '2026-10', total: 15, categories: [['Food', 15]] },
    ],
    upcoming: [{ date: '2026-11-18', name: 'Yoga', amount: 2500 }],
  };

  it('adds net worth from the day both have it, carrying the last value forward', () => {
    const m = mergeHistory([{ owner: 'me', data: h1 }, { owner: 'partner', data: h2 }]);
    expect(m.netWorth.map((p) => p.v)).toEqual([120, 130, 150]);
    expect(m.updated).toBe(5);
  });

  it('adds months by category and lists everyone’s upcoming payments', () => {
    const m = mergeHistory([{ owner: 'me', data: h1 }, { owner: 'partner', data: h2 }]);
    expect(m.months).toEqual([
      { month: '2026-09', total: 5, categories: [['Food', 5]] },
      { month: '2026-10', total: 65, categories: [['Food', 45], ['Rent', 20]] },
    ]);
    expect(m.upcoming.map((u) => [u.name, u.owner])).toEqual([
      ['Yoga', 'partner'],
      ['Rent', 'me'],
    ]);
  });
});

describe('mergeSnapshot', () => {
  const policy = { name: 'Family Floater', insurer: 'Acme Health', type: 'health', sum_assured: 1500000, start: '2026-03-14' };
  const s1 = parseSnapshot({
    version: 1,
    cards: { open: [{ name: 'Kotak League ••4410', limit: 300000, outstanding: 20000 }] },
    credit_score: { bureaus: [{ bureau: 'CIBIL', score: 780, factors: [] }] },
    mutual_funds: { invested: 100, value: 120, gain: 20, count: 1, allocation: { equity: 100 }, holdings: [{ scheme: 'Alpha Fund', invested: 100, value: 120, gain: 20 }] },
    insurance: [policy],
  });
  const s2 = parseSnapshot({
    version: 1,
    cards: { open: [{ name: 'AU Zenith ••5152', limit: 180000, outstanding: 6000 }] },
    credit_score: { bureaus: [{ bureau: 'CIBIL', score: 768, factors: [] }] },
    mutual_funds: { invested: 100, value: 80, gain: -20, count: 1, allocation: { equity: 50, debt: 50 }, holdings: [{ scheme: 'Beta Fund', invested: 100, value: 80, gain: -20 }] },
    insurance: [policy],
  });

  it('lists both people’s cards and scores, tagged', () => {
    const m = mergeSnapshot([{ owner: 'me', data: s1 }, { owner: 'partner', data: s2 }]);
    expect(m.cards.map((c) => [c.name, c.owner])).toEqual([
      ['Kotak League', 'me'],
      ['AU Zenith', 'partner'],
    ]);
    expect(m.bureaus.map((x) => x.owner)).toEqual(['me', 'partner']);
  });

  it('adds up the funds, weighting the allocation by value', () => {
    const f = mergeSnapshot([{ owner: 'me', data: s1 }, { owner: 'partner', data: s2 }]).funds!;
    expect(f.value).toBe(200);
    expect(f.gain).toBe(0);
    expect(f.gainPct).toBe(0);
    expect(f.count).toBe(2);
    expect(f.allocation).toEqual([
      ['equity', 80],
      ['debt', 20],
    ]);
    expect(f.holdings.map((h) => h.owner)).toEqual(['me', 'partner']);
  });

  it('keeps a family floater once, with no single owner', () => {
    const m = mergeSnapshot([{ owner: 'me', data: s1 }, { owner: 'partner', data: s2 }]);
    expect(m.policies).toHaveLength(1);
    expect(m.policies[0].owner).toBeUndefined();
  });
});

describe('mergeActivity', () => {
  const cols = ['date', 'amount', 'type', 'merchant', 'category', 'subcategory', 'account', 'notes'];
  const x = parseActivity({ transactions: { columns: cols, from: '2026-10-30', rows: [['2026-11-10 09:00', 100, 'DEBIT', 'Cafe', 'Food', null, 'Kotak ••4821', null]] } });
  const y = parseActivity({ transactions: { columns: cols, from: '2026-10-31', rows: [['2026-11-11 09:00', 50, 'DEBIT', 'Books', 'Shopping', null, 'Canara ••3381', null]] } });

  it('puts both people’s transactions together, newest first and tagged', () => {
    const m = mergeActivity([{ owner: 'me', data: x }, { owner: 'partner', data: y }]);
    expect(m.transactions.map((t) => [t.merchant, t.owner])).toEqual([
      ['Books', 'partner'],
      ['Cafe', 'me'],
    ]);
    expect(m.from).toBe('2026-10-30');
  });
});

describe('a second person’s helpers', () => {
  it('reads "<Prefix words> Bank …" names for a two-word prefix', async () => {
    const { findFinance } = await import('./finance');
    const ent = (entity_id: string, state: string, friendly_name: string) => ({ entity_id, state, attributes: { friendly_name }, last_changed: '', last_updated: '', context: { id: '', parent_id: null, user_id: null } });
    const f = findFinance(
      {
        'input_number.partner_fold_net_worth': ent('input_number.partner_fold_net_worth', '1000', 'Partner Fold Net Worth'),
        'input_number.partner_fold_bank_canara_3381': ent('input_number.partner_fold_bank_canara_3381', '500', 'Partner Fold Bank Canara 3381'),
        'input_number.fold_net_worth': ent('input_number.fold_net_worth', '9', 'Fold Net Worth'),
      },
      'partner_fold',
    )!;
    expect(f.netWorth).toBe(1000);
    expect(f.banks.map((b) => [b.name, b.last4])).toEqual([['Canara', '3381']]);
  });
});
