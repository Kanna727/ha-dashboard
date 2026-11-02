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
