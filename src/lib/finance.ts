// The Money page (money/*): personal finance from helpers that a sync from a
// money-tracking app keeps up to date, named `<prefix>_<role>` (default prefix
// `fold`), e.g. input_number.fold_net_worth or sensor.fold_net_worth. Nothing
// is listed in the config: bank accounts (`<prefix>_bank_<bank>_<last4>`),
// credit cards (`<prefix>_cc_<bank>_<product>_<last4>`) and credit scores
// (`<prefix>_credit_score_<bureau>`) are found by their names, so a new account
// shows up by itself. Pure helpers, unit-tested.
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

export interface Account {
  id: string;
  bank: string;
  product: string;
  // "Kotak League", or just the bank for an account.
  name: string;
  last4: string;
  balance: number;
  // Whose it is (FINANCE.people id), when there's more than one person.
  owner?: string;
}

export interface Score {
  id: string;
  bureau: string;
  score: number;
  owner?: string;
}

export interface Finance {
  netWorth?: number;
  liquid?: number;
  investments?: number;
  debt?: number;
  bankTotal?: number;
  cardsOutstanding?: number;
  loans?: number;
  fundsValue?: number;
  fundsInvested?: number;
  stocks?: number;
  epf?: number;
  spentThisMonth?: number;
  cardsUnpaid?: number;
  cardsLimit?: number;
  cardsAvailable?: number;
  // Percent of the card limits in use.
  cardsUtilization?: number;
  fundsGain?: number;
  fundsGainPct?: number;
  fds?: number;
  ppf?: number;
  nps?: number;
  cashOnHand?: number;
  customAssets?: number;
  customLiabilities?: number;
  healthCover?: number;
  // The next insurance premium (YYYY-MM-DD).
  premiumDue?: string;
  // When the sync last wrote the full snapshot (the hidden detail dashboards).
  snapshotAt?: number;
  // Highest balance first (an overdrawn account last).
  banks: Account[];
  // Most owed first.
  cards: Account[];
  scores: Score[];
  // The next card bill: which card, how much, when (YYYY-MM-DD).
  bill?: { card: string; last4?: string; amount?: number; due?: string; owner?: string };
  lastTransaction?: { amount?: number; merchant: string; category?: string; account?: string };
  // When the money app last fetched the bank balances (its own "as of"; banks
  // share them only a few times a day, so this lags hours behind the sync).
  asOf?: number;
  // When any of the numbers last changed in HA: the sync writes only what
  // changed, so this is when the data last moved (cards, spends, transactions).
  changedAt?: number;
}

const TOTALS = {
  net_worth: 'netWorth',
  liquid: 'liquid',
  investments: 'investments',
  debt: 'debt',
  bank_total: 'bankTotal',
  credit_card_outstanding: 'cardsOutstanding',
  loans: 'loans',
  mutual_funds_value: 'fundsValue',
  mutual_funds_invested: 'fundsInvested',
  stocks_value: 'stocks',
  epf_balance: 'epf',
  spend_this_month: 'spentThisMonth',
  cc_bills_unpaid: 'cardsUnpaid',
  // These three start like a card (cc_…) but have no last digits.
  cc_credit_limit: 'cardsLimit',
  cc_available_credit: 'cardsAvailable',
  cc_utilization: 'cardsUtilization',
  mutual_funds_gain: 'fundsGain',
  mutual_funds_gain_percent: 'fundsGainPct',
  fixed_deposits: 'fds',
  ppf_balance: 'ppf',
  nps_value: 'nps',
  cash_on_hand: 'cashOnHand',
  custom_assets: 'customAssets',
  custom_liabilities: 'customLiabilities',
  health_cover: 'healthCover',
} as const;

// An account or card helper ends in its last digits; any other bank_/cc_ name
// is a total this version doesn't know (left out, not drawn as a card).
const ACCOUNT_END = /_\d{3,6}$/;

const DOMAINS = ['input_number', 'sensor', 'input_text', 'input_datetime'];

const num = (e: HassEntity | undefined) => {
  if (!e) return undefined;
  const v = parseFloat(e.state);
  return Number.isFinite(v) ? v : undefined;
};

// "−₹1,250.00", "-₹80", "₹1,23,456" → a number.
export function parseAmount(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/([−-])?\s*₹?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return undefined;
  const v = parseFloat(m[2].replace(/,/g, ''));
  return Number.isFinite(v) ? (m[1] ? -v : v) : undefined;
}

// "<Prefix> Bank Canara 5530" / "<Prefix> CC Kotak League 4410" → bank, product, last 4.
// Without a friendly name the object id's words are used.
export function accountName(e: HassEntity, prefix: string, kind: 'bank' | 'cc'): Omit<Account, 'id' | 'balance'> {
  const fallback = e.entity_id.split('.')[1].replace(new RegExp(`^${prefix}_${kind}_`), '').replace(/_/g, ' ');
  const raw = String(e.attributes.friendly_name ?? '');
  // A two-word prefix ("partner_fold") also matches "Partner Fold Bank …".
  const lead = new RegExp(`^\\s*${prefix.replace(/_/g, '[\\s_]+')}\\s+(${kind === 'bank' ? 'bank' : 'cc|credit card'})\\s+`, 'i');
  const words = (lead.test(raw) ? raw.replace(lead, '') : fallback).trim().split(/\s+/);
  const last4 = /^\d{3,6}$/.test(words[words.length - 1] ?? '') ? words.pop()! : '';
  const [bank = '', ...rest] = words;
  const product = rest.join(' ');
  return { bank, product, name: product ? `${bank} ${product}` : bank, last4 };
}

// The friendly name's words after "Credit Score" ("Fold Credit Score CIBIL" → "CIBIL").
function bureauName(e: HassEntity, key: string): string {
  const raw = String(e.attributes.friendly_name ?? '');
  const m = raw.match(/credit score\s+(.+)$/i);
  return m ? m[1].trim() : key.replace(/_/g, ' ').toUpperCase();
}

// "Kotak ••4410 · ₹1,250.00 due 05 Nov" → card, its last digits and the amount.
// Anything without an amount ("No unpaid bills") is no bill.
export function parseBill(text: string | undefined) {
  if (!text || text === 'unknown' || text === 'unavailable') return undefined;
  const [card, rest = ''] = text.split(' · ');
  const amount = parseAmount(rest.split(/\s+due\s+/i)[0]);
  if (amount === undefined) return undefined;
  const last4 = card.match(/(\d{3,6})\s*$/)?.[1];
  return { card: card.trim(), last4, amount };
}

// "−₹80.00 · Corner Cafe · Food & Drinks · Kotak ••4410".
export function parseTransaction(text: string | undefined): Finance['lastTransaction'] {
  if (!text || text === 'unknown' || text === 'unavailable') return undefined;
  const [amount, merchant, category, account] = text.split(' · ').map((s) => s.trim());
  if (!merchant) return undefined;
  return { amount: parseAmount(amount), merchant, category, account };
}

// "2026-11-02 15:18:12" (an input_datetime, local time) or an ISO timestamp.
export function parseWhen(s: string | undefined): number | undefined {
  if (!s || s === 'unknown' || s === 'unavailable') return undefined;
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isFinite(t) ? t : undefined;
}

// The ids of every finance helper (for a store memo: rescan only when one changes).
export function financeIds(states: HassEntities, prefix: string): string[] {
  const p = `${prefix}_`;
  return Object.keys(states)
    .filter((id) => {
      const [domain, obj] = id.split('.');
      return DOMAINS.includes(domain) && obj.startsWith(p) && !obj.startsWith(`${p}sync_`);
    })
    .sort();
}

export function findFinance(states: HassEntities, prefix = 'fold'): Finance | undefined {
  const ids = financeIds(states, prefix);
  if (!ids.length) return undefined;
  const f: Finance = { banks: [], cards: [], scores: [] };
  const byKey = new Map<string, HassEntity>();
  for (const id of ids) {
    const key = id.split('.')[1].slice(prefix.length + 1);
    // A sensor and a helper of the same name: the first wins (sorted ids: input_* before sensor).
    if (!byKey.has(key)) byKey.set(key, states[id]);
  }
  for (const [key, e] of byKey) {
    const total = TOTALS[key as keyof typeof TOTALS];
    if (total) {
      f[total] = num(e);
    } else if (key.startsWith('bank_') && ACCOUNT_END.test(key)) {
      const balance = num(e);
      if (balance !== undefined) f.banks.push({ id: e.entity_id, balance, ...accountName(e, prefix, 'bank') });
    } else if (key.startsWith('cc_') && ACCOUNT_END.test(key)) {
      const balance = num(e);
      if (balance !== undefined) f.cards.push({ id: e.entity_id, balance, ...accountName(e, prefix, 'cc') });
    } else if (key.startsWith('credit_score_')) {
      const score = num(e);
      if (score !== undefined) f.scores.push({ id: e.entity_id, bureau: bureauName(e, key.slice(13)), score });
    }
  }
  f.banks.sort((a, b) => b.balance - a.balance);
  f.cards.sort((a, b) => b.balance - a.balance);
  f.scores.sort((a, b) => a.bureau.localeCompare(b.bureau));
  const bill = parseBill(byKey.get('next_cc_bill')?.state);
  const due = byKey.get('next_cc_due_date')?.state;
  // The sync leaves the due date as it was when the last bill is paid, so a
  // date alone is no bill; nor is one when nothing is unpaid.
  if (bill && f.cardsUnpaid !== 0) f.bill = { ...bill, due: due && /^\d{4}-\d\d-\d\d/.test(due) ? due.slice(0, 10) : undefined };
  f.lastTransaction = parseTransaction(byKey.get('last_transaction')?.state);
  f.asOf = parseWhen(byKey.get('data_as_of')?.state);
  f.snapshotAt = parseWhen(byKey.get('snapshot_updated')?.state);
  const premium = byKey.get('next_premium_date')?.state;
  if (premium && /^\d{4}-\d\d-\d\d/.test(premium)) f.premiumDue = premium.slice(0, 10);
  const changed = [...byKey.values()].map((e) => Date.parse(e.last_changed)).filter(Number.isFinite);
  if (changed.length) f.changedAt = Math.max(...changed);
  return f;
}

// "12 min ago", "3h ago", "2d ago".
export function fmtAgo(t: number, now: number): string {
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// A time of day today ("10:26 am"), "yesterday 10:17 am", or a date ("2 Nov").
export function fmtWhen(t: number, now: Date): string {
  const d = new Date(t);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return time;
  if (diff === 1) return `yesterday ${time}`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// Whole days from today to a YYYY-MM-DD date (local), negative once it has passed.
export function daysUntil(date: string, now: Date): number {
  const [y, m, d] = date.split('-').map(Number);
  const due = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((due - today) / 86_400_000);
}

export const dueLabel = (days: number) =>
  days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days`;

// The card whose bill is next (by its last digits, else its name).
export const isBillCard = (card: Account, bill: Finance['bill']) =>
  !!bill && (bill.last4 ? card.last4 === bill.last4 : !!bill.card && bill.card.toLowerCase().startsWith(card.name.toLowerCase()));

const MINUS = '−';

// Indian grouping: ₹1,23,456 (dp decimals).
export function fmtInr(n: number, dp = 0): string {
  const s = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${n < 0 ? MINUS : ''}₹${s}`;
}

// Short: ₹1.23 Cr, ₹4.13 L, ₹22.2K, ₹640.
export function fmtShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}K`;
  return `${sign}₹${Math.round(a)}`;
}

// Credit score bands (300–900, as Indian bureaus report them).
export function scoreBand(score: number): { label: string; tone: 'ok' | 'fair' | 'warn' | 'bad' } {
  if (score >= 800) return { label: 'Excellent', tone: 'ok' };
  if (score >= 750) return { label: 'Very good', tone: 'ok' };
  if (score >= 700) return { label: 'Good', tone: 'fair' };
  if (score >= 650) return { label: 'Fair', tone: 'warn' };
  return { label: 'Poor', tone: 'bad' };
}

// A bank's colour, for its dot, bar and card. Well-known Indian and global
// banks by name; anything else gets a steady colour from its name.
const BANKS: [RegExp, string][] = [
  [/^icici/i, '#f37e20'],
  [/^hdfc/i, '#3b82f6'],
  [/^(sbi|state bank)/i, '#38bdf8'],
  [/^axis/i, '#d0457a'],
  [/^kotak/i, '#ef4444'],
  [/^yes/i, '#60a5fa'],
  [/^indusind/i, '#e0526a'],
  [/^federal/i, '#eab308'],
  [/^(boi|bank of india)/i, '#f59e0b'],
  [/^(bob|bank of baroda)/i, '#f97316'],
  [/^(pnb|punjab)/i, '#f43f5e'],
  [/^canara/i, '#0ea5e9'],
  [/^union/i, '#e11d48'],
  [/^idfc/i, '#b91c1c'],
  [/^idbi/i, '#10b981'],
  [/^au\b/i, '#f97316'],
  [/^rbl/i, '#2563eb'],
  [/^hsbc/i, '#ef4444'],
  [/^(sc|standard chartered)/i, '#22c55e'],
  [/^citi/i, '#2563eb'],
  [/^(amex|american express)/i, '#60a5fa'],
  [/^dbs/i, '#ef4444'],
  [/^bandhan/i, '#dc2626'],
  [/^onecard/i, '#94a3b8'],
  [/^slice/i, '#a78bfa'],
  [/^jupiter/i, '#fb7185'],
  [/^fi\b/i, '#22d3ee'],
  [/^scapia/i, '#8b5cf6'],
  [/^equitas/i, '#7c3aed'],
];
const SPARE = ['#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#fb923c', '#60a5fa', '#2dd4bf'];

export function bankColor(bank: string): string {
  const hit = BANKS.find(([re]) => re.test(bank));
  if (hit) return hit[1];
  const h = [...bank.toLowerCase()].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return SPARE[h % SPARE.length];
}

// ---- Chart data ----
// A sync writes longer series than HA keeps for helpers into a hidden storage
// dashboard (FINANCE.store, default 'dashboard-money'), once a day:
//   { version: 1, updated: ISO,
//     net_worth: [["YYYY-MM-DD", value], ...]          daily, up to a year
//     spending: [{ month: "YYYY-MM", total, categories: { name: amount } }, ...]
//     upcoming: [{ date: "YYYY-MM-DD", name, amount, category? }, ...] }
export interface MonthSpend {
  month: string;
  total: number;
  categories: [string, number][];
}
export interface Upcoming {
  date: string;
  name: string;
  amount: number;
  category?: string;
  owner?: string;
}
export interface MoneyHistory {
  updated?: number;
  netWorth: { t: number; v: number }[];
  months: MonthSpend[];
  upcoming: Upcoming[];
}

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d\d-\d\d/.test(s);
const dayMs = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};
const fin = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && Number.isFinite(parseFloat(v)) ? parseFloat(v) : undefined);

// Anything malformed is dropped rather than failing the page.
export function parseMoneyHistory(doc: unknown): MoneyHistory {
  const d = (doc && typeof doc === 'object' ? doc : {}) as Record<string, unknown>;
  const netWorth = (Array.isArray(d.net_worth) ? d.net_worth : [])
    .map((p) => (Array.isArray(p) && isDay(p[0]) && fin(p[1]) !== undefined ? { t: dayMs(p[0]), v: fin(p[1])! } : undefined))
    .filter((p): p is { t: number; v: number } => !!p)
    .sort((a, b) => a.t - b.t);
  const months = (Array.isArray(d.spending) ? d.spending : [])
    .map((m) => {
      const r = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
      if (typeof r.month !== 'string' || !/^\d{4}-\d\d$/.test(r.month)) return undefined;
      const cats = r.categories && typeof r.categories === 'object' ? Object.entries(r.categories as Record<string, unknown>) : [];
      const categories = cats.map(([k, v]) => [k, fin(v) ?? 0] as [string, number]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      return { month: r.month, total: fin(r.total) ?? categories.reduce((s, [, v]) => s + v, 0), categories };
    })
    .filter((m): m is MonthSpend => !!m)
    .sort((a, b) => a.month.localeCompare(b.month));
  const upcoming = (Array.isArray(d.upcoming) ? d.upcoming : [])
    .map((u): Upcoming | undefined => {
      const r = (u && typeof u === 'object' ? u : {}) as Record<string, unknown>;
      const amount = fin(r.amount);
      if (!isDay(r.date) || typeof r.name !== 'string' || amount === undefined) return undefined;
      return { date: r.date.slice(0, 10), name: r.name, amount, category: typeof r.category === 'string' ? r.category : undefined };
    })
    .filter((u): u is Upcoming => !!u)
    .sort((a, b) => a.date.localeCompare(b.date));
  const updated = typeof d.updated === 'string' ? parseWhen(d.updated) : undefined;
  return { updated, netWorth, months, upcoming };
}

// A month's spending without the skipped categories (card bill payments are
// money moving to your own cards, already counted when the card was used).
export function monthSpend(m: MonthSpend, skip: string[]): { total: number; categories: [string, number][] } {
  const drop = new Set(skip.map((s) => s.toLowerCase()));
  const categories = m.categories.filter(([k]) => !drop.has(k.toLowerCase()));
  const skipped = m.categories.filter(([k]) => drop.has(k.toLowerCase())).reduce((s, [, v]) => s + v, 0);
  return { total: Math.max(0, m.total - skipped), categories };
}

// The net-worth points of the last `days` days, and the change over them.
export function netWorthRange(points: { t: number; v: number }[], days: number, now: number) {
  const from = now - days * 86_400_000;
  const pts = points.filter((p) => p.t >= from);
  if (pts.length < 2) return { points: pts, change: 0, low: pts[0], high: pts[0] };
  const low = pts.reduce((a, b) => (b.v < a.v ? b : a));
  const high = pts.reduce((a, b) => (b.v > a.v ? b : a));
  return { points: pts, change: pts[pts.length - 1].v - pts[0].v, low, high };
}

// The category rows' colours: each its own (a colour by name hash put three
// rows in one yellow), Untagged and Other grey.
const CATEGORY_COLORS = ['#fbbf24', '#38bdf8', '#34d399', '#a78bfa', '#f472b6', '#fb923c', '#2dd4bf', '#f87171', '#a3e635', '#60a5fa'];
export function rowColors(names: string[]): string[] {
  let i = 0;
  return names.map((n) => (/^(untagged|other)$/i.test(n) ? '#64748b' : CATEGORY_COLORS[i++ % CATEGORY_COLORS.length]));
}
