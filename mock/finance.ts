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
