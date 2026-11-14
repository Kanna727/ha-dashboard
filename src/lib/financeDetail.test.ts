import { describe, expect, it } from 'vitest';
import {
  byDay,
  cardDetail,
  epfMonths,
  filterTx,
  flows,
  frequencyLabel,
  groupFundOrders,
  parseActivity,
  parseSnapshot,
  shortScheme,
  splitLast4,
  tableRows,
  tidyName,
} from './financeDetail';

describe('splitLast4', () => {
  it('splits the last digits off a name', () => {
    expect(splitLast4('Kotak League ••4410')).toEqual({ name: 'Kotak League', last4: '4410' });
    expect(splitLast4('Canara Bank ••0028')).toEqual({ name: 'Canara Bank', last4: '0028' });
    expect(splitLast4('Plain name')).toEqual({ name: 'Plain name' });
  });
});

describe('parseSnapshot', () => {
  const doc = {
    version: 1,
    updated: '2026-11-07T07:45:25+05:30',
    cards: {
      open: [
        {
          name: 'Kotak League ••4410',
          limit: 200000,
          outstanding: 18420.5,
          cycle: { spent: 3200, statement_date: '2026-11-12' },
          last_bill: { total_due: 15220.5, min_due: 761, due_date: '2026-11-05', statement_date: '2026-10-12', paid: false, remaining: 15220.5 },
          synced: '2026-11-04 10:35',
        },
        { name: 'Amex Gold ••1009', limit: 100000, outstanding: 0, cycle: {}, last_bill: { total_due: 900, paid: true, remaining: 0 } },
        { limit: 5 },
      ],
      closed: [{ name: 'SBI Old ••1111', closed_at: '2026-11-02 15:19' }],
    },
    credit_score: {
      accounts: [{ type: 'Credit Card', active: 5, closed: 1, total: 6, limit: 900000, oldest_months: 80 }],
      bureaus: [
        {
          bureau: 'CIBIL',
          score: 782,
          band: 'Excellent',
          rank: 'TOP 40%',
          refreshed: '2026-11-01',
          next_refresh: '2026-12-15',
          factors: [{ impact: 'high', name: 'Payment history', rating: 'Good', unit: '%', value: 99.1 }, { bad: true }],
          history: [['2026-11', 782], ['2026-10', 775]],
          summary: { title: 'Great', text: 'Keep it up.' },
        },
      ],
    },
    epf: {
      connected: true,
      total: 500000,
      employee: 220000,
      employer: 200000,
      pension: 80000,
      rate: 8.25,
      rate_fy: 'FY 2025-26',
      employers: [
        { current: true, joined: '2024-08-05' },
        { current: false, joined: '2020-01-01' },
      ],
      yearly: [
        { financial_year: 'FY 2023-24', opening_balance: 100, contributions_total: 50, interest_credited: 10, withdrawals_total: 0, closing_balance: 160 },
        { financial_year: 'FY 2023-24', opening_balance: 0, contributions_total: 20, interest_credited: 1, withdrawals_total: 0, closing_balance: 21 },
        { financial_year: 'FY 2024-25', opening_balance: 181, contributions_total: 60, interest_credited: 12, withdrawals_total: 0, closing_balance: 253 },
      ],
    },
    mutual_funds: {
      value: 3000,
      invested: 2900,
      gain: 100,
      gain_pct: 3.4,
      count: 2,
      allocation: { equity: 60, debt: 40, other: 0 },
      by_category: [{ category: 'Equity', value: 1000, invested: 950, gain: 50, gain_pct: 5.2, schemes: 1 }],
      holdings: [
        { scheme: 'Small Fund', value: 1000, invested: 950, gain: 50, gain_pct: 5.2, category: 'Equity' },
        { scheme: 'Big Fund', value: 2000, invested: 1950 },
      ],
      top_sectors: [{ name: 'Banks', pct: 13.1 }],
    },
    stocks: { value: 500, holdings: [{ name: 'ACME', units: 2, price: 100, value: 200 }, { name: 'Zeta', units: 3, price: 100 }] },
    insurance: [
      {
        name: 'Family Shield',
        type: 'health',
        insurer_name: 'Acme Health',
        sum_insured: 1000000,
        effective_cover: 2000000,
        premium: 30000,
        start: '2026-04-29',
        end: '2029-04-28',
        next_premium_date: '2029-04-28',
        insured: [{ relationship: 'Self', age: 30, name: 'X' }],
        features: {
          plan_variant: 'Plus',
          cover_type: 'Family Floater',
          policy_term_years: 3,
          add_on_covers: [
            { name: 'Booster', status: 'Opted', sum_insured: 500000 },
            { name: 'Other', status: 'Not Opted' },
          ],
          waiting_periods: { initial: '30 days', pre_existing: '3 Years', specific: null },
        },
        insurer: { contacts: [{ kind: 'phone', label: 'Helpline', value: '1800-000' }], grade: 'A' },
        pros: ['Good'],
        cons: ['Bad'],
      },
    ],
    net_worth: { as_of: '2026-11-06 10:17', loans: [{ name: 'Canara Personal Loan ••0001', included: true }, { name: 'Old Loan ••0002', included: false }] },
    recurring: [
      { name: 'Rent', amount: 40000, category: 'Bill', frequency: 'EVERY_MONTH', next_due: '2026-12-01', status: 'ACTIVE' },
      { name: 'Gone', amount: 10, status: 'PAUSED' },
    ],
    spending_month: {
      month: '2026-11',
      total: 5000,
      categories: [{ name: 'Food & Drinks', amount: 900, count: 4, subcategories: [{ name: 'others-dashed-circle', amount: 100 }, { name: 'Cafe', amount: 800 }] }],
      untagged: { amount: 120, count: 2 },
    },
    nps: { connected: false },
  };
  const s = parseSnapshot(doc);

  it('reads the cards, matched by their last digits', () => {
    expect(s.cards).toHaveLength(2);
    expect(s.cards[0]).toMatchObject({ name: 'Kotak League', last4: '4410', limit: 200000, cycleSpent: 3200, statementDate: '2026-11-12' });
    expect(s.cards[0].lastBill).toMatchObject({ total: 15220.5, due: '2026-11-05', paid: false });
    expect(s.cards[1].lastBill?.paid).toBe(true);
    expect(s.closedCards).toEqual([{ name: 'SBI Old', last4: '1111', closedAt: '2026-11-02' }]);
    expect(cardDetail(s.cards, { last4: '1009', name: 'Amex Gold' })?.limit).toBe(100000);
    expect(cardDetail(s.cards, { last4: '9999', name: 'Nope' })).toBeUndefined();
  });

  it('reads bureaus with their factors, oldest history first', () => {
    expect(s.bureaus[0].factors).toHaveLength(1);
    expect(s.bureaus[0].history.map((h) => h.month)).toEqual(['2026-10', '2026-11']);
    expect(s.bureaus[0]).toMatchObject({ rank: 'TOP 40%', nextRefresh: '2026-12-15', summary: { title: 'Great' } });
    expect(s.creditAccounts[0]).toMatchObject({ type: 'Credit Card', active: 5 });
  });

  it('adds up EPF years across employers', () => {
    expect(s.epf?.years).toEqual([
      { fy: 'FY 2023-24', opening: 100, contributions: 70, interest: 11, withdrawals: 0, closing: 181 },
      { fy: 'FY 2024-25', opening: 181, contributions: 60, interest: 12, withdrawals: 0, closing: 253 },
    ]);
    expect(s.epf).toMatchObject({ employers: 2, currentSince: '2024-08-05', rate: 8.25 });
  });

  it('sorts funds and stocks largest first and drops zero allocations', () => {
    expect(s.funds?.holdings.map((h) => h.scheme)).toEqual(['Big Fund', 'Small Fund']);
    expect(s.funds?.holdings[0].gain).toBe(50);
    expect(s.funds?.allocation).toEqual([
      ['equity', 60],
      ['debt', 40],
    ]);
    expect(s.stocks?.holdings.map((h) => [h.name, h.value])).toEqual([
      ['Zeta', 300],
      ['ACME', 200],
    ]);
  });

  it('keeps only the opted add-ons and no names of the insured', () => {
    const p = s.policies[0];
    expect(p.addOns).toEqual([{ name: 'Booster', sumInsured: 500000 }]);
    expect(p.insured).toEqual([{ relationship: 'Self', age: 30 }]);
    expect(p.waiting).toEqual([
      ['Any illness', '30 days'],
      ['Pre-existing', '3 Years'],
    ]);
    expect(p).toMatchObject({ coverType: 'Family Floater', termYears: 3, cover: 2000000, contacts: [{ kind: 'phone', value: '1800-000' }] });
  });

  it('reads loans, active recurring payments and the month by subcategory', () => {
    expect(s.loans).toEqual([
      { name: 'Canara Personal Loan', last4: '0001', included: true },
      { name: 'Old Loan', last4: '0002', included: false },
    ]);
    expect(s.recurring.map((r) => r.name)).toEqual(['Rent']);
    expect(s.spending?.categories[0].subs).toEqual([
      ['Cafe', 800],
      ['Other', 100],
    ]);
    expect(s.connected).toEqual({ nps: false, ppf: undefined, cash: undefined });
  });

  it('survives anything malformed', () => {
    expect(parseSnapshot(null)).toMatchObject({ cards: [], bureaus: [], policies: [], recurring: [] });
    expect(parseSnapshot({ cards: 'x', credit_score: [1], epf: { connected: false } }).epf).toBeUndefined();
  });
});

describe('parseActivity', () => {
  const doc = {
    updated: '2026-11-07T07:45:25+05:30',
    transactions: {
      columns: ['date', 'amount', 'type', 'merchant', 'category', 'subcategory', 'account', 'notes'],
      from: '2026-10-24',
      rows: [
        ['2026-11-05 10:20', 133.39, 'DEBIT', 'Cafe', 'Food & Drinks', null, 'Kotak League ••4410', null],
        ['2026-11-05 22:45', 500, 'DEBIT', 'Me', 'Self Transfer', null, 'SBI ••1907', null],
        ['2026-11-04 19:58', 9000, 'CREDIT', 'Employer', 'Salary', null, 'SBI ••1907', null],
        ['bad', 1, 'DEBIT'],
      ],
    },
    mf_transactions: {
      columns: ['date', 'type', 'scheme', 'amount', 'units'],
      rows: [
        ['2026-09-07', 'BUY', 'A', 1000, 1],
        ['2026-09-07', 'BUY', 'B', 1000, 1],
        ['2026-10-22', 'SELL', 'C', 3000, 2],
      ],
    },
    stock_transactions: { columns: ['date', 'type', 'name', 'units', 'rate'], rows: [['2026-10-29 15:41', 'SELL', 'ACME', 12, 10]] },
    epf_transactions: {
      columns: ['date', 'type', 'amount', 'employee', 'employer', 'pension', 'description'],
      rows: [
        ['2026-10-14', 'credit', 300, 150, 120, 30, 'Wage month 2026-09'],
        ['2026-08-15', 'credit', 300, 150, 120, 30, 'Wage month 2026-06'],
        ['2026-08-15', 'credit', 300, 150, 120, 30, 'Wage month 2026-07'],
        ['2025-08-14', 'debit', 6000, 3000, 3000, 0, 'Wage month 2025-07'],
      ],
    },
  };
  const a = parseActivity(doc);

  it('reads tables by column name', () => {
    expect(tableRows({ columns: ['a', 'b'], rows: [[1, 2], 'x'] })).toEqual([{ a: 1, b: 2 }]);
  });

  it('groups investments, and the owner can regroup any transaction', () => {
    const base = { t: 1, date: '2026-11-05' };
    const inv = { ...base, amount: -5000, category: 'Investment' };
    const cafe = { ...base, amount: -100, category: 'Food' };
    expect(filterTx([inv, cafe], 'invests')).toEqual([inv]);
    expect(filterTx([inv, cafe], 'spends')).toEqual([cafe]);
    expect(flows([inv, cafe])).toEqual({ in: 0, out: 100 });
    const moved = { ...cafe, group: 'invest' as const };
    expect(filterTx([moved], 'invests')).toEqual([moved]);
    expect(filterTx([{ ...inv, group: 'spend' as const }], 'spends')).toHaveLength(1);
  });

  it('signs transactions (money out negative), newest first', () => {
    expect(a.transactions.map((t) => t.amount)).toEqual([-500, -133.39, 9000]);
    expect(a.from).toBe('2026-10-24');
  });

  it('leaves moves out of in and out', () => {
    expect(flows(a.transactions)).toEqual({ in: 9000, out: 133.39 });
    expect(filterTx(a.transactions, 'moves')).toHaveLength(1);
    expect(filterTx(a.transactions, 'spends').map((t) => t.merchant)).toEqual(['Cafe']);
    expect(filterTx(a.transactions, 'income').map((t) => t.merchant)).toEqual(['Employer']);
    expect(byDay(a.transactions).map((d) => [d.date, d.spent, d.txs.length])).toEqual([
      ['2026-11-05', 133.39, 2],
      ['2026-11-04', 0, 1],
    ]);
  });

  it('groups a day of fund orders', () => {
    const g = groupFundOrders(a.funds);
    expect(g.map((x) => [x.date, x.type, x.amount, x.orders.length])).toEqual([
      ['2026-10-22', 'SELL', 3000, 1],
      ['2026-09-07', 'BUY', 2000, 2],
    ]);
    expect(a.stocks[0]).toMatchObject({ amount: 120, type: 'SELL' });
  });

  it('adds EPF credits up by wage month and skips withdrawals', () => {
    expect(epfMonths(a.epf).map((m) => [m.month, m.employee])).toEqual([
      ['2026-06', 150],
      ['2026-07', 150],
      ['2026-09', 150],
    ]);
    expect(a.epf.find((t) => !t.credit)?.amount).toBe(6000);
  });
});

describe('labels', () => {
  it('names frequencies', () => {
    expect(frequencyLabel('EVERY_MONTH')).toBe('monthly');
    expect(frequencyLabel('FREQUENCY_EVERY_YEAR')).toBe('yearly');
    expect(frequencyLabel('EVERY_TWO_MONTHS')).toBe('every two months');
  });
  it('shortens fund names and tidies all-caps ones', () => {
    expect(shortScheme('Northwind Flexi Cap Fund - Direct Plan Growth')).toBe('Northwind Flexi Cap Fund');
    expect(shortScheme('Acme Liquid Fund Direct Growth')).toBe('Acme Liquid Fund');
    expect(shortScheme('Acme Gilt Fund Growth')).toBe('Acme Gilt Fund');
    expect(tidyName('ACME METALS LTD')).toBe('Acme Metals Ltd');
    expect(tidyName('Acme ETF')).toBe('Acme ETF');
  });
});
