import type { HassEntity } from 'home-assistant-js-websocket';
import { mockActivity, mockMoneyHistory, mockSnapshot } from './finance';

// A second person's money (FINANCE.people in the example config: id 'partner',
// prefix 'partner_fold'), all made up: smaller than the first person's, with a
// share of the same family floater (the page must count it once) and their
// own cards, scores, funds and transactions.
const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const asOf = new Date(now.getTime() - 3 * 3_600_000);

function e(entity_id: string, state: string, friendly_name: string, unit = true): HassEntity {
  return {
    entity_id,
    state,
    attributes: { friendly_name, ...(unit ? { unit_of_measurement: '₹' } : {}) },
    last_changed: asOf.toISOString(),
    last_updated: asOf.toISOString(),
    context: { id: '', parent_id: null, user_id: null },
  };
}

const BANKS: [string, string, number][] = [
  ['Canara', '3381', 84200.4],
  ['IDFC', '7720', 21560],
];
const CARDS: [string, string, string, number][] = [['AU', 'Zenith', '5152', 6240.75]];
const banks = BANKS.reduce((s, [, , v]) => s + v, 0);
const cards = CARDS.reduce((s, [, , , v]) => s + v, 0);
const funds = 118600;
const invested = 104000;
const limit = 180000;

export function partnerFinanceEntities(): HassEntity[] {
  const n = (key: string, v: number, name: string) => e(`input_number.partner_fold_${key}`, v.toFixed(2), `Partner Fold ${name}`);
  return [
    n('net_worth', banks + funds - cards, 'Net Worth'),
    n('liquid', banks, 'Liquid'),
    n('investments', funds, 'Investments'),
    n('debt', cards, 'Debt'),
    n('bank_total', banks, 'Bank Total'),
    n('credit_card_outstanding', cards, 'Credit Card Outstanding'),
    n('mutual_funds_value', funds, 'Mutual Funds Value'),
    n('mutual_funds_invested', invested, 'Mutual Funds Invested'),
    n('mutual_funds_gain', funds - invested, 'Mutual Funds Gain'),
    n('spend_this_month', 520 * now.getDate() + 6200, 'Spend This Month'),
    n('cc_bills_unpaid', 0, 'CC Bills Unpaid'),
    n('cc_credit_limit', limit, 'CC Credit Limit'),
    n('cc_available_credit', limit - cards, 'CC Available Credit'),
    e('input_number.partner_fold_cc_utilization', ((cards / limit) * 100).toFixed(2), 'Partner Fold CC Utilization', false),
    ...BANKS.map(([b, num, v]) => n(`bank_${b.toLowerCase()}_${num}`, v, `Bank ${b} ${num}`)),
    ...CARDS.map(([b, p, num, v]) => n(`cc_${b.toLowerCase()}_${p.toLowerCase()}_${num}`, v, `CC ${b} ${p} ${num}`)),
    // The same family floater as the first person's.
    n('health_cover', 1500000, 'Health Cover'),
    e('input_number.partner_fold_credit_score_cibil', '768', 'Partner Fold Credit Score CIBIL', false),
    e('input_text.partner_fold_next_cc_bill', 'No unpaid bills', 'Partner Fold Next CC Bill', false),
    e('input_text.partner_fold_last_transaction', '−₹420.00 · Green Basket · Groceries · AU Zenith ••5152', 'Partner Fold Last Transaction', false),
    e('input_datetime.partner_fold_data_as_of', `${ymd(asOf)} ${pad(asOf.getHours())}:${pad(asOf.getMinutes())}:00`, 'Partner Fold Data As Of', false),
  ];
}

type Obj = Record<string, unknown>;

// The first person's chart data, scaled down, with their own recurring payment.
export function partnerMoneyHistory() {
  const h = mockMoneyHistory() as Obj;
  const scale = (v: number, k: number) => Math.round(v * k * 100) / 100;
  const net = (h.net_worth as [string, number][]).map(([d, v]) => [d, Math.round(v * 0.32)]);
  const spending = (h.spending as { month: string; total: number; categories: Record<string, number> }[]).map((m) => ({
    month: m.month,
    total: scale(m.total, 0.45),
    categories: Object.fromEntries(Object.entries(m.categories).map(([k, v]) => [k, scale(v, 0.45)])),
  }));
  const gym = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 9);
  return { ...h, net_worth: net, spending, upcoming: [{ date: ymd(gym), name: 'Yoga studio', amount: 2500, category: 'Fitness' }] };
}

export function partnerSnapshot() {
  const s = mockSnapshot() as Obj;
  const off = (days: number) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  const score = s.credit_score as Obj;
  const cibil = (score.bureaus as Obj[]).find((b) => /cibil/i.test(String(b.bureau))) ?? (score.bureaus as Obj[])[0];
  const mf = s.mutual_funds as Obj;
  const holdings = (mf.holdings as Obj[]).slice(0, 3).map((h, i) => ({ ...h, invested: [52000, 32000, 20000][i], value: [60100, 35400, 23100][i] }));
  return {
    ...s,
    cards: {
      open: CARDS.map(([b, p, num, v]) => ({
        name: `${b} ${p} ••${num}`,
        limit,
        outstanding: v,
        cycle: { spent: v, statement_date: off(11) },
        last_bill: { total_due: 3120, min_due: 160, due_date: off(-6), statement_date: off(-24), paid: true, paid_amount: 3120, remaining: 0 },
        synced: now.toISOString(),
      })),
      closed: [],
    },
    credit_score: { ...score, bureaus: [{ ...cibil, score: 768, change: 4 }] },
    epf: { connected: false },
    mutual_funds: { ...mf, invested, value: funds, gain: funds - invested, gain_pct: Math.round(((funds - invested) / invested) * 10000) / 100, count: holdings.length, holdings },
    stocks: { value: 0, holdings: [] },
    net_worth: { ...(s.net_worth as Obj), loans: [] },
    recurring: [{ name: 'Yoga studio', status: 'ACTIVE', amount: 2500, category: 'Fitness', frequency: 'MONTHLY', next_due: off(9) }],
  };
}

const PARTNER_SPENDS: [string, string, string, string][] = [
  ['Green Basket', 'Groceries', 'Vegetables', 'AU Zenith ••5152'],
  ['Book Nook', 'Shopping', 'Books', 'Canara ••3381'],
  ['Corner Cafe', 'Food & Drinks', 'Cafe', 'AU Zenith ••5152'],
  ['RideNow', 'Transport', 'Cabs', 'IDFC ••7720'],
];

export function partnerActivity() {
  const a = mockActivity() as Obj;
  const tx = a.transactions as Obj;
  const at = (daysAgo: number, h: number, m: number) => `${ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo))} ${pad(h)}:${pad(m)}`;
  const rows: unknown[][] = [];
  for (let d = 0; d < 14; d += 2) {
    const [who, cat, sub, acct] = PARTNER_SPENDS[d % PARTNER_SPENDS.length];
    rows.push([at(d, 18, 10 + d), 180 + d * 37, 'DEBIT', who, cat, sub, acct, null]);
  }
  rows.push([at(4, 10, 0), 52000, 'CREDIT', 'Acme Studio', 'Salary', null, 'Canara ••3381', null]);
  rows.sort((x, y) => String(y[0]).localeCompare(String(x[0])));
  return { ...a, transactions: { ...tx, rows }, mf_transactions: { ...(a.mf_transactions as Obj), rows: [] }, stock_transactions: { ...(a.stock_transactions as Obj), rows: [] }, epf_transactions: { ...(a.epf_transactions as Obj), rows: [] } };
}
