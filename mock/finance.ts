import type { HassEntity } from 'home-assistant-js-websocket';

// The fictional home's money helpers for the Money page (lib/finance.ts finds
// them by name): totals, bank accounts, credit cards, scores, the next bill
// (due in two days, so Home shows it too) and the last transaction.
const now = new Date();
const iso = now.toISOString();
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
const asOf = new Date(now.getTime() - 5 * 3_600_000);

function e(entity_id: string, state: string, friendly_name: string, unit = true): HassEntity {
  const attributes: Record<string, unknown> = { friendly_name };
  if (unit) attributes.unit_of_measurement = '₹';
  return { entity_id, state, attributes, last_changed: iso, last_updated: iso, context: { id: 'mock', parent_id: null, user_id: null } };
}

const BANKS: [string, string, number][] = [
  ['Kotak', '4821', 84250.4],
  ['SBI', '1907', 31480.0],
  ['Canara', '5530', 12045.75],
  ['IDFC', '7712', 2310.2],
  ['Jupiter', '3088', 0],
];
const CARDS: [string, string, string, number][] = [
  ['Kotak', 'League', '4410', 18420.5],
  ['SBI', 'Cashback', '6623', 12890.0],
  ['AU', 'LIT', '9014', 4150.25],
  ['IDFC', 'Wealth', '2286', 2245.0],
  ['Amex', 'Gold', '1009', 0],
];

const banks = BANKS.reduce((s, [, , v]) => s + v, 0);
const cards = CARDS.reduce((s, [, , , v]) => s + v, 0);
const epf = 412500;
const funds = 268400;
const stocks = 96350.6;
const loans = 185000;
const limits: Record<string, number> = { '4410': 300000, '6623': 200000, '9014': 150000, '2286': 500000, '1009': 250000 };
const limit = Object.values(limits).reduce((s, v) => s + v, 0);
const investments = epf + funds + stocks;
const debt = cards + loans;

export function financeEntities(): HassEntity[] {
  const n = (key: string, v: number, name: string) => e(`input_number.fold_${key}`, v.toFixed(2), `Fold ${name}`);
  return [
    n('net_worth', banks + investments - debt, 'Net Worth'),
    n('liquid', banks, 'Liquid'),
    n('investments', investments, 'Investments'),
    n('debt', debt, 'Debt'),
    n('bank_total', banks, 'Bank Total'),
    n('credit_card_outstanding', cards, 'Credit Card Outstanding'),
    n('loans', loans, 'Loans'),
    n('mutual_funds_value', funds, 'Mutual Funds Value'),
    n('mutual_funds_invested', 241900, 'Mutual Funds Invested'),
    n('stocks_value', stocks, 'Stocks Value'),
    n('epf_balance', epf, 'EPF Balance'),
    n('spend_this_month', 1240 * now.getDate() + 18500, 'Spend This Month'),
    n('cc_bills_unpaid', 22570.5, 'CC Bills Unpaid'),
    n('cc_credit_limit', limit, 'CC Credit Limit'),
    n('cc_available_credit', limit - cards, 'CC Available Credit'),
    e('input_number.fold_cc_utilization', ((cards / limit) * 100).toFixed(2), 'Fold CC Utilization', false),
    n('mutual_funds_gain', funds - 241900, 'Mutual Funds Gain'),
    e('input_number.fold_mutual_funds_gain_percent', (((funds - 241900) / 241900) * 100).toFixed(1), 'Fold Mutual Funds Gain Percent', false),
    n('fixed_deposits', 0, 'Fixed Deposits'),
    n('ppf_balance', 0, 'PPF Balance'),
    n('nps_value', 0, 'NPS Value'),
    n('cash_on_hand', 0, 'Cash On Hand'),
    n('custom_assets', 0, 'Custom Assets'),
    n('custom_liabilities', 0, 'Custom Liabilities'),
    n('health_cover', 1500000, 'Health Cover'),
    e('input_datetime.fold_next_premium_date', ymd(new Date(now.getFullYear() + 1, 2, 14)), 'Fold Next Premium Date', false),
    e('input_datetime.fold_snapshot_updated', `${ymd(now)} 07:45:00`, 'Fold Snapshot Updated', false),
    e('input_number.fold_credit_score_cibil', '782', 'Fold Credit Score CIBIL', false),
    e('input_number.fold_credit_score_experian', '804', 'Fold Credit Score Experian', false),
    ...BANKS.map(([b, num, v]) => n(`bank_${b.toLowerCase()}_${num}`, v, `Bank ${b} ${num}`)),
    ...CARDS.map(([b, p, num, v]) => n(`cc_${b.toLowerCase()}_${p.toLowerCase()}_${num}`, v, `CC ${b} ${p} ${num}`)),
    e('input_text.fold_next_cc_bill', `Kotak ••4410 · ₹18,420.50 due ${due.getDate()} ${due.toLocaleDateString('en-IN', { month: 'short' })}`, 'Fold Next CC Bill', false),
    e('input_datetime.fold_next_cc_due_date', ymd(due), 'Fold Next CC Due Date', false),
    e('input_text.fold_last_transaction', '−₹340.00 · Corner Cafe · Food & Drinks · SBI Cashback ••6623', 'Fold Last Transaction', false),
    e('input_datetime.fold_data_as_of', `${ymd(asOf)} ${pad(asOf.getHours())}:${pad(asOf.getMinutes())}:00`, 'Fold Data As Of', false),
  ];
}

// The chart data the sync writes into the hidden 'dashboard-money' dashboard
// (lib/finance.ts, parseMoneyHistory): a year of daily net worth (salary in on
// the 1st, card bills and rent out, ending at today's figure), twelve months of
// spending by category, and the recurring payments coming up.
export function mockMoneyHistory() {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days: [string, number][] = [];
  let v = banks + investments - debt - 210000;
  for (let i = 365; i >= 1; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    if (d.getDate() === 1) v += 98000;
    if (d.getDate() === 3) v -= 40000;
    if (d.getDate() === 12) v -= 26000 + rand() * 12000;
    v += (rand() - 0.47) * 2600;
    days.push([ymd(d), Math.round(v)]);
  }
  const shift = banks + investments - debt - days[days.length - 1][1];
  const net_worth = days.map(([d, x], i) => [d, Math.round(x + (shift * i) / days.length)]);
  const spending = Array.from({ length: 12 }, (_, i) => {
    const m = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    const part = i === 11 ? now.getDate() / 30 : 1;
    const c = (base: number, spread = 0.35) => Math.round(base * part * (1 - spread / 2 + rand() * spread));
    const categories = {
      'Credit Bill': c(42000),
      'Food & Drinks': c(14500),
      Groceries: c(9800),
      Transport: c(5200, 0.6),
      Bill: c(i === 11 ? 3000 : 46500, 0.05),
      Shopping: c(7000, 1.2),
      Subscription: c(1900, 0.1),
      Fitness: c(i % 6 === 2 ? 18000 : 1200, 0.2),
      Untagged: c(4200, 0.8),
    };
    const total = Object.values(categories).reduce((s, x) => s + x, 0);
    return { month: `${m.getFullYear()}-${pad(m.getMonth() + 1)}`, total, categories };
  });
  const next = (day: number) => ymd(new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= day ? 1 : 0), day));
  const upcoming = [
    { date: next(1), name: 'Rent', amount: 40000, category: 'Bill' },
    { date: next(10), name: 'Mutual fund SIP', amount: 10000, category: 'Investment' },
    { date: next(18), name: 'Streaming', amount: 649, category: 'Subscription' },
  ];
  return { version: 1, updated: iso, net_worth, spending, upcoming };
}

// The daily detail snapshot the sync writes into the hidden 'dashboard-fold-data'
// dashboard (lib/financeDetail.ts, parseSnapshot): every card's limit and cycle,
// score factors, EPF, funds, stocks, insurance, loans, recurring payments and
// this month by subcategory. All fictional.
export function mockSnapshot() {
  const off = (days: number) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  const renew = ymd(new Date(now.getFullYear() + 1, 2, 14));
  const cardsOpen = CARDS.map(([b, p, num, v], i) => ({
    name: `${b} ${p} ••${num}`,
    limit: limits[num],
    outstanding: v,
    cycle: { spent: Math.round(v * 0.4), statement_date: off(3 + i * 4) },
    last_bill:
      num === '4410'
        ? { total_due: v, min_due: Math.round(v * 0.05), due_date: ymd(due), statement_date: off(-18), paid: false, paid_amount: 0, remaining: v }
        : { total_due: Math.round(v * 0.6), min_due: 200, due_date: off(-6 - i), statement_date: off(-26 + i), paid: true, paid_amount: Math.round(v * 0.6), remaining: 0 },
    synced: iso,
  }));
  const fund = (scheme: string, category: string, invested: number, gainPct: number, risk: string) => ({
    amc: `${scheme.split(' ')[0]} Mutual Fund`,
    category,
    invested,
    value: Math.round(invested * (1 + gainPct / 100)),
    gain: Math.round((invested * gainPct) / 100),
    gain_pct: gainPct,
    plan: 'Direct',
    risk,
    scheme: `${scheme} - Direct Plan Growth`,
    units: Math.round(invested / 37),
  });
  const holdings = [
    fund('Northwind Flexi Cap Fund', 'Equity', 62000, 14.2, 'Aggressive'),
    fund('Bluebird Large Cap Fund', 'Equity', 48000, 9.8, 'Moderately Aggressive'),
    fund('Harbor Short Term Debt Fund', 'Fixed Income', 36000, 6.1, 'Conservative'),
    fund('Meadow Balanced Advantage Fund', 'Hybrid', 28000, 7.4, 'Balanced'),
    fund('Summit Midcap Opportunities Fund', 'Equity', 22000, 18.6, 'Aggressive'),
    fund('Riverside Liquid Fund', 'Fixed Income', 18000, 3.2, 'Conservative'),
    fund('Lantern Gold Savings Fund', 'Commodity', 12000, -2.4, 'Aggressive'),
    fund('Orchard Arbitrage Fund', 'Hybrid', 9900, 3.9, 'Balanced'),
    fund('Cedar Small Cap Fund', 'Equity', 6000, 22.5, 'Aggressive'),
  ];
  const factors = (util: number, inquiries: number, rating: string) => [
    { impact: 'high', name: 'Payment history', rating: 'Excellent', unit: '%', value: 100 },
    { impact: 'high', name: 'Credit utilization', rating: 'Good', unit: '%', value: util },
    { impact: 'medium', name: 'Credit history', rating: 'Good', unit: 'months', value: 74 },
    { impact: 'medium', name: 'Credit mix', rating: 'Excellent', unit: 'count', value: 7 },
    { impact: 'low', name: 'Recent inquiries', rating, unit: 'count', value: inquiries },
    { impact: 'low', name: 'Disputes', rating: 'Excellent', unit: 'count', value: 0 },
  ];
  const years: [string, number, number, number][] = [
    ['FY 2019-20', 32000, 900, 0],
    ['FY 2020-21', 58000, 3100, 0],
    ['FY 2021-22', 61000, 7400, 0],
    ['FY 2022-23', 64000, 12100, 40000],
    ['FY 2023-24', 78000, 15800, 0],
    ['FY 2024-25', 84000, 22600, 0],
    ['FY 2025-26', 13600, 0, 0],
  ];
  let opening = 0;
  const yearly = years.map(([financial_year, contributions_total, interest_credited, withdrawals_total]) => {
    const closing_balance = opening + contributions_total + interest_credited - withdrawals_total;
    const row = { financial_year, opening_balance: opening, contributions_total, interest_credited, withdrawals_total, closing_balance };
    opening = closing_balance;
    return row;
  });
  const month = mockMoneyHistory().spending[11];
  const subsOf: Record<string, [string, number][]> = {
    'Food & Drinks': [
      ['Restaurants', 0.45],
      ['Delivery', 0.4],
      ['Cafe', 0.15],
    ],
    Groceries: [
      ['Staples', 0.45],
      ['Vegetables', 0.35],
      ['Fruits', 0.2],
    ],
    Transport: [
      ['Fuel', 0.7],
      ['Cabs', 0.3],
    ],
    Shopping: [
      ['Electronics', 0.6],
      ['Clothes', 0.4],
    ],
    Bill: [
      ['Electricity', 0.5],
      ['Internet', 0.3],
      ['Mobile', 0.2],
    ],
  };
  return {
    version: 1,
    updated: iso,
    cards: { open: cardsOpen, closed: [{ name: 'Canara Classic ••3302', closed_at: off(-40) }] },
    credit_score: {
      accounts_bureau: 'Experian',
      accounts: [
        { type: 'Credit Card', active: 5, closed: 1, total: 6, limit, oldest_months: 74 },
        { type: 'Home', active: 1, closed: 0, total: 1, limit: 2500000, oldest_months: 30 },
      ],
      bureaus: [
        {
          bureau: 'CIBIL',
          score: 782,
          band: 'Excellent',
          rank: 'TOP 30%',
          refreshed: off(-6),
          next_refresh: off(38),
          history: [[ymd(now).slice(0, 7), 782]],
          factors: factors(13.1, 3, 'Fair'),
          summary: { title: 'Very good score', text: 'Payments are always on time and card use is low. A few recent credit enquiries hold the score back a little: space out new applications.' },
        },
        {
          bureau: 'Experian',
          score: 804,
          band: 'Excellent',
          rank: 'TOP 18%',
          refreshed: off(-6),
          next_refresh: off(38),
          history: [[ymd(now).slice(0, 7), 804]],
          factors: factors(12.4, 1, 'Good'),
          summary: { title: 'Excellent score', text: 'Keep card use under 30% of the limits and pay in full.' },
        },
      ],
    },
    epf: {
      connected: true,
      total: epf,
      employee: 196000,
      employer: 168500,
      pension: 48000,
      rate: 8.25,
      rate_fy: 'FY 2025-26',
      refreshed: `${off(-5)} 21:00`,
      next_refresh: `${off(2)} 21:00`,
      employers: [
        { current: true, joined: '2023-04-03', exited: null },
        { current: false, joined: '2019-07-01', exited: '2023-03-31' },
      ],
      yearly,
    },
    mutual_funds: {
      value: funds,
      invested: 241900,
      gain: funds - 241900,
      gain_pct: +(((funds - 241900) / 241900) * 100).toFixed(2),
      count: holdings.length,
      allocation: { equity: 58.4, debt: 24.9, other: 16.7 },
      market_cap: { large: 41.2, mid: 18.5, small: 12.1, other: 28.2 },
      by_category: ['Equity', 'Fixed Income', 'Hybrid', 'Commodity'].map((category) => {
        const hs = holdings.filter((h) => h.category === category);
        const value = hs.reduce((a, h) => a + h.value, 0);
        const invested = hs.reduce((a, h) => a + h.invested, 0);
        return { category, value, invested, gain: value - invested, gain_pct: +(((value - invested) / invested) * 100).toFixed(2), schemes: hs.length };
      }),
      holdings,
      top_sectors: [
        { name: 'Banks', pct: 16.2 },
        { name: 'Govt-Sec', pct: 11.4 },
        { name: 'IT - Software', pct: 8.8 },
        { name: 'Finance', pct: 7.1 },
        { name: 'Others', pct: 56.5 },
      ],
    },
    stocks: {
      demat_accounts: 1,
      value: stocks,
      equity_value: stocks - 4210.6,
      etf_value: 4210.6,
      shares: 92,
      holdings: [
        { name: 'Acme Infra Ltd', units: 40, price: 1180.5, value: 47220, isin: 'MOCK0001' },
        { name: 'Bluefin Bank Ltd', units: 25, price: 1365.2, value: 34130, isin: 'MOCK0002' },
        { name: 'GLOBEX POWER LTD', units: 22, price: 490.0, value: 10780, isin: 'MOCK0003' },
        { name: 'Nifty Index ETF', units: 5, price: 842.12, value: 4210.6, isin: 'MOCK0004' },
      ],
    },
    insurance: [
      {
        type: 'health',
        name: 'Family Shield - Plus',
        insurer_name: 'Acme Health Insurance Ltd',
        sum_insured: 1000000,
        effective_cover: 1500000,
        premium: 31800,
        start: `${now.getFullYear()}-03-15`,
        end: renew,
        next_premium_date: renew,
        insured: [
          { relationship: 'Self', age: 34 },
          { relationship: 'Spouse', age: 32 },
        ],
        features: {
          plan_variant: 'Plus',
          cover_type: 'Family Floater',
          policy_term_years: 1,
          room_rent_limit: 'Single private room',
          restore_benefit: '100% of the base cover, once a year',
          add_on_covers: [
            { name: 'Cover Booster', status: 'Opted', sum_insured: 500000 },
            { name: 'Critical Illness', status: 'Not Opted' },
          ],
          waiting_periods: { initial: '30 days', pre_existing: '2 Years', specific: '24 months' },
        },
        pros: ['Cover refills once a year', 'No cap on intensive care charges'],
        cons: ['Pre-existing conditions are covered only after 2 years'],
        insurer: {
          grade: 'A',
          contacts: [
            { kind: 'phone', label: 'Helpline (24×7)', value: '1800-000-0000' },
            { kind: 'email', label: 'Claims', value: 'claims@example.com' },
            { kind: 'website', label: 'Website', value: 'https://www.example.com' },
          ],
          claim_status_url: 'https://www.example.com/claims',
        },
      },
    ],
    net_worth: {
      as_of: `${ymd(asOf)} ${pad(asOf.getHours())}:${pad(asOf.getMinutes())}`,
      loans: [
        { name: 'SBI Home Loan ••0451', included: true },
        { name: 'Canara Car Loan ••1203', included: false },
      ],
    },
    fixed_deposits: { deposits: [] },
    recurring: [
      { name: 'Rent', amount: 40000, category: 'Bill', frequency: 'EVERY_MONTH', next_due: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1)), status: 'ACTIVE' },
      { name: 'Mutual fund SIP', amount: 10000, category: 'Investment', frequency: 'EVERY_MONTH', next_due: off(10), status: 'ACTIVE' },
      { name: 'Streaming', amount: 649, category: 'Subscription', frequency: 'EVERY_MONTH', next_due: off(18), status: 'ACTIVE' },
    ],
    spending_month: {
      month: month.month,
      total: month.total,
      categories: Object.entries(month.categories).map(([name, amount]) => ({
        name,
        amount,
        count: Math.max(1, Math.round(amount / 900)),
        subcategories: (subsOf[name] ?? [['others-dashed-circle', 1]]).map(([k, f]) => ({ name: k, amount: Math.round(amount * f) })),
      })),
      untagged: { amount: month.categories.Untagged, count: 4 },
    },
    nps: { connected: false },
    ppf: { connected: false },
    cash_on_hand: { is_set_up: false, balance: 0 },
  };
}

// The last two weeks' activity the sync writes into 'dashboard-fold-activity'
// (parseActivity): transactions, fund orders, stock trades, EPF credits.
export function mockActivity() {
  let seed = 11;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const at = (daysAgo: number, h: number, m: number) => `${ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo))} ${pad(h)}:${pad(m)}`;
  const ago = (days: number) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  const SPENDS: [string, string, string, string][] = [
    ['Corner Cafe', 'Food & Drinks', 'Cafe', 'SBI Cashback ••6623'],
    ['Green Basket', 'Groceries', 'Vegetables', 'Kotak League ••4410'],
    ['QuickMart', 'Groceries', 'Staples', 'AU LIT ••9014'],
    ['City Fuels', 'Transport', 'Fuel', 'IDFC Wealth ••2286'],
    ['Spice Route', 'Food & Drinks', 'Restaurants', 'Kotak League ••4410'],
    ['ShopKart', 'Shopping', 'Electronics', 'SBI Cashback ••6623'],
    ['RideNow', 'Transport', 'Cabs', 'Kotak ••4821'],
  ];
  const rows: unknown[][] = [];
  for (let d = 0; d < 14; d++) {
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const [who, cat, sub, acct] = SPENDS[Math.floor(rand() * SPENDS.length)];
      rows.push([at(d, 9 + Math.floor(rand() * 12), Math.floor(rand() * 60)), Math.round(80 + rand() * 1800), 'DEBIT', who, cat, sub, acct, null]);
    }
    rows.push([at(d, 1, 30), 0.04, 'CREDIT', 'Jupiter Bank', 'Interest', null, 'Jupiter ••3088', null]);
  }
  rows.push([at(6, 10, 2), 98000, 'CREDIT', 'ACME CORP', 'Salary', null, 'Kotak ••4821', null]);
  rows.push([at(6, 21, 25), 40000, 'DEBIT', 'Landlord', 'Bill', 'Rent', 'Kotak ••4821', null]);
  rows.push([at(5, 20, 3), 15600, 'DEBIT', 'CardPay', 'Credit Bill', 'Credit card', 'SBI ••1907', null]);
  rows.push([at(5, 19, 40), 20000, 'DEBIT', 'Myself', 'Self Transfer', null, 'Kotak ••4821', null]);
  rows.push([at(5, 19, 41), 20000, 'CREDIT', 'Myself', 'Self Transfer', null, 'SBI ••1907', null]);
  rows.push([at(9, 7, 10), 10000, 'DEBIT', 'MUTUAL F', 'Investment', null, 'SBI ••1907', null]);
  rows.push([at(11, 12, 0), 640, 'DEBIT', null, null, null, 'Canara ••5530', 'UPI/5512/DR/STALL']);
  const epfRows: unknown[][] = [];
  for (let i = 1; i <= 14; i++) {
    const wm = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const paid = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const emp = i <= 7 ? 7800 : 7200;
    epfRows.push([ymd(paid), 'credit', emp * 2, emp, emp - 1250, 1250, `Wage month ${wm.getFullYear()}-${pad(wm.getMonth() + 1)}`]);
  }
  epfRows.push(['2022-11-14', 'debit', 40000, 22000, 18000, 0, 'Wage month 2022-10']);
  return {
    version: 1,
    updated: iso,
    transactions: { columns: ['date', 'amount', 'type', 'merchant', 'category', 'subcategory', 'account', 'notes'], from: ago(14), rows },
    mf_transactions: {
      columns: ['date', 'type', 'scheme', 'amount', 'units'],
      rows: [
        [ago(9), 'BUY', 'Northwind Flexi Cap Fund - Direct Plan Growth', 4000, 42.1],
        [ago(9), 'BUY', 'Bluebird Large Cap Fund - Direct Plan Growth', 3000, 31.7],
        [ago(9), 'BUY', 'Harbor Short Term Debt Fund - Direct Plan Growth', 3000, 75.2],
        [ago(24), 'SELL', 'Riverside Liquid Fund - Direct Plan Growth', 5000, 1.6],
        [ago(40), 'BUY', 'Northwind Flexi Cap Fund - Direct Plan Growth', 4000, 43.5],
        [ago(40), 'BUY', 'Bluebird Large Cap Fund - Direct Plan Growth', 3000, 32.2],
      ],
    },
    stock_transactions: {
      columns: ['date', 'type', 'name', 'units', 'rate'],
      rows: [
        [`${ago(12)} 11:20`, 'BUY', 'Bluefin Bank Ltd', 5, 1342.0],
        [`${ago(47)} 14:05`, 'SELL', 'Initech Ltd', 10, 512.4],
        [`${ago(47)} 14:04`, 'SELL', 'Umbrella Pharma Ltd', 4, 1890.0],
        [`${ago(80)} 10:15`, 'BUY', 'GLOBEX POWER LTD', 22, 455.0],
      ],
    },
    epf_transactions: { columns: ['date', 'type', 'amount', 'employee', 'employer', 'pension', 'description'], rows: epfRows },
    ppf_transactions: { columns: ['date', 'kind', 'amount', 'notes'], rows: [] },
  };
}
