// The Money page's detail data: what doesn't fit in a helper, written by the
// money-app sync once a day as the config of two hidden storage dashboards
// (FINANCE.snapshotStore, default 'dashboard-fold-data', and
// FINANCE.activityStore, default 'dashboard-fold-activity'). Both are parsed
// defensively: anything missing or malformed is left out, never thrown.
// Pure helpers, unit-tested (financeDetail.test.ts).
import { parseWhen } from './finance';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined;
const day = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{4}-\d\d-\d\d/.test(v) ? v.slice(0, 10) : undefined);
const when = (v: unknown): number | undefined => (typeof v === 'string' ? parseWhen(v) : undefined);
const defined = <T>(x: T | undefined): x is T => x !== undefined;

// "Kotak League ••4410" → name and last digits.
export function splitLast4(name: string): { name: string; last4?: string } {
  const m = name.match(/^(.*?)\s*(?:••|\*{2,}|x{2,})\s*(\d{3,6})\s*$/i);
  return m ? { name: m[1].trim(), last4: m[2] } : { name: name.trim() };
}

// ---- Snapshot ----

export interface CardBill {
  total: number;
  minDue?: number;
  due?: string;
  statementDate?: string;
  paid: boolean;
  paidAmount?: number;
  remaining?: number;
}
export interface CardDetail {
  name: string;
  last4?: string;
  limit?: number;
  outstanding?: number;
  // The current cycle: what's been spent and when it's billed.
  cycleSpent?: number;
  statementDate?: string;
  lastBill?: CardBill;
  synced?: number;
  owner?: string;
}
export interface Factor {
  name: string;
  impact?: string;
  rating?: string;
  value?: number;
  unit?: string;
}
export interface BureauDetail {
  bureau: string;
  score?: number;
  band?: string;
  rank?: string;
  refreshed?: string;
  nextRefresh?: string;
  factors: Factor[];
  summary?: { title?: string; text?: string };
  history: { month: string; score: number }[];
  owner?: string;
}
export interface CreditAccounts {
  type: string;
  active: number;
  closed: number;
  total: number;
  limit?: number;
  oldestMonths?: number;
}
export interface EpfYear {
  fy: string;
  opening: number;
  contributions: number;
  interest: number;
  withdrawals: number;
  closing: number;
}
export interface EpfDetail {
  total?: number;
  employee?: number;
  employer?: number;
  pension?: number;
  rate?: number;
  rateFy?: string;
  refreshed?: number;
  nextRefresh?: number;
  employers: number;
  // When the current job's account started (YYYY-MM-DD).
  currentSince?: string;
  // Oldest first, every employer's account of a year added up.
  years: EpfYear[];
}
export interface Fund {
  scheme: string;
  amc?: string;
  category?: string;
  plan?: string;
  risk?: string;
  invested: number;
  value: number;
  gain: number;
  gainPct?: number;
  units?: number;
  owner?: string;
}
export interface FundCategory {
  name: string;
  value: number;
  invested: number;
  gain: number;
  gainPct?: number;
  schemes?: number;
}
export interface FundsDetail {
  value?: number;
  invested?: number;
  gain?: number;
  gainPct?: number;
  count: number;
  // [name, percent], largest first.
  allocation: [string, number][];
  marketCap: [string, number][];
  sectors: [string, number][];
  categories: FundCategory[];
  // Largest first.
  holdings: Fund[];
}
export interface Holding {
  name: string;
  units: number;
  price?: number;
  value: number;
  isin?: string;
  owner?: string;
}
export interface StocksDetail {
  value?: number;
  equity?: number;
  etf?: number;
  demat?: number;
  shares?: number;
  holdings: Holding[];
}
export interface Contact {
  kind: string;
  label: string;
  value: string;
}
export interface Policy {
  name: string;
  type?: string;
  insurer?: string;
  plan?: string;
  coverType?: string;
  sumInsured?: number;
  cover?: number;
  premium?: number;
  termYears?: number;
  start?: string;
  end?: string;
  nextPremium?: string;
  insured: { relationship?: string; age?: number }[];
  // Only the add-ons that are on.
  addOns: { name: string; sumInsured?: number }[];
  waiting: [string, string][];
  roomRent?: string;
  restore?: string;
  pros: string[];
  cons: string[];
  contacts: Contact[];
  claimUrl?: string;
  hospitalsUrl?: string;
  grade?: string;
  owner?: string;
}
export interface Loan {
  name: string;
  last4?: string;
  included: boolean;
  owner?: string;
}
export interface Recurring {
  name: string;
  amount: number;
  category?: string;
  frequency?: string;
  nextDue?: string;
  variable?: boolean;
  owner?: string;
}
export interface SpendCategory {
  name: string;
  amount: number;
  count?: number;
  subs: [string, number][];
}
export interface Snapshot {
  updated?: number;
  netWorthAsOf?: number;
  cards: CardDetail[];
  closedCards: { name: string; last4?: string; closedAt?: string; owner?: string }[];
  bureaus: BureauDetail[];
  creditAccounts: CreditAccounts[];
  epf?: EpfDetail;
  funds?: FundsDetail;
  stocks?: StocksDetail;
  policies: Policy[];
  loans: Loan[];
  fds: { name: string; principal?: number; maturity?: number; rate?: number; maturityDate?: string; owner?: string }[];
  recurring: Recurring[];
  spending?: { month: string; total: number; categories: SpendCategory[]; untagged?: { amount: number; count?: number } };
  // Which sources the money app has linked (false: not connected).
  connected: { nps?: boolean; ppf?: boolean; cash?: boolean };
}

const pctPairs = (v: unknown): [string, number][] =>
  Object.entries(obj(v))
    .map(([k, x]) => [k, num(x)] as [string, number | undefined])
    .filter((p): p is [string, number] => p[1] !== undefined && p[1] > 0)
    // Largest first, "other" last.
    .sort((a, b) => Number(/^others?$/i.test(a[0])) - Number(/^others?$/i.test(b[0])) || b[1] - a[1]);

// The money app's own "others" marker becomes plain "Other".
const subName = (s: string) => (/^others?(-dashed-circle)?$/i.test(s) ? 'Other' : s);

function parseCard(v: unknown): CardDetail | undefined {
  const c = obj(v);
  const raw = str(c.name);
  if (!raw) return undefined;
  const cycle = obj(c.cycle);
  const lb = obj(c.last_bill);
  const total = num(lb.total_due);
  return {
    ...splitLast4(raw),
    limit: num(c.limit),
    outstanding: num(c.outstanding),
    cycleSpent: num(cycle.spent),
    statementDate: day(cycle.statement_date),
    lastBill:
      total === undefined
        ? undefined
        : {
            total,
            minDue: num(lb.min_due),
            due: day(lb.due_date),
            statementDate: day(lb.statement_date),
            paid: lb.paid === true || (num(lb.remaining) ?? 1) === 0,
            paidAmount: num(lb.paid_amount),
            remaining: num(lb.remaining),
          },
    synced: when(c.synced),
  };
}

function parseBureau(v: unknown): BureauDetail | undefined {
  const b = obj(v);
  const bureau = str(b.bureau);
  if (!bureau) return undefined;
  const summary = obj(b.summary);
  return {
    bureau,
    score: num(b.score),
    band: str(b.band),
    rank: str(b.rank),
    refreshed: day(b.refreshed),
    nextRefresh: day(b.next_refresh),
    factors: arr(b.factors)
      .map((f) => {
        const o = obj(f);
        const name = str(o.name);
        return name ? { name, impact: str(o.impact), rating: str(o.rating), value: num(o.value), unit: str(o.unit) } : undefined;
      })
      .filter(defined),
    summary: str(summary.title) || str(summary.text) ? { title: str(summary.title), text: str(summary.text) } : undefined,
    history: arr(b.history)
      .map((h) => (Array.isArray(h) && typeof h[0] === 'string' && num(h[1]) !== undefined ? { month: h[0], score: num(h[1])! } : undefined))
      .filter(defined)
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}

function parseEpf(v: unknown): EpfDetail | undefined {
  const e = obj(v);
  if (e.connected === false || !Object.keys(e).length) return undefined;
  const employers = arr(e.employers).map(obj);
  const current = employers.find((x) => x.current === true);
  const byFy = new Map<string, EpfYear>();
  for (const y of arr(e.yearly).map(obj)) {
    const fy = str(y.financial_year);
    if (!fy) continue;
    const row = byFy.get(fy) ?? { fy, opening: 0, contributions: 0, interest: 0, withdrawals: 0, closing: 0 };
    row.opening += num(y.opening_balance) ?? 0;
    row.contributions += num(y.contributions_total) ?? 0;
    row.interest += num(y.interest_credited) ?? 0;
    row.withdrawals += num(y.withdrawals_total) ?? 0;
    row.closing += num(y.closing_balance) ?? 0;
    byFy.set(fy, row);
  }
  return {
    total: num(e.total),
    employee: num(e.employee),
    employer: num(e.employer),
    pension: num(e.pension),
    rate: num(e.rate),
    rateFy: str(e.rate_fy),
    refreshed: when(e.refreshed),
    nextRefresh: when(e.next_refresh),
    employers: employers.length,
    currentSince: day(current?.joined),
    years: [...byFy.values()].sort((a, b) => a.fy.localeCompare(b.fy)),
  };
}

function parseFunds(v: unknown): FundsDetail | undefined {
  const m = obj(v);
  if (!Object.keys(m).length) return undefined;
  const holdings = arr(m.holdings)
    .map((h): Fund | undefined => {
      const o = obj(h);
      const scheme = str(o.scheme);
      const value = num(o.value);
      if (!scheme || value === undefined) return undefined;
      const invested = num(o.invested) ?? value;
      return {
        scheme,
        amc: str(o.amc),
        category: str(o.category),
        plan: str(o.plan),
        risk: str(o.risk),
        invested,
        value,
        gain: num(o.gain) ?? value - invested,
        gainPct: num(o.gain_pct),
        units: num(o.units),
      };
    })
    .filter(defined)
    .sort((a, b) => b.value - a.value);
  const categories = arr(m.by_category)
    .map((c): FundCategory | undefined => {
      const o = obj(c);
      const name = str(o.category);
      const value = num(o.value);
      if (!name || value === undefined) return undefined;
      const invested = num(o.invested) ?? value;
      return { name, value, invested, gain: num(o.gain) ?? value - invested, gainPct: num(o.gain_pct), schemes: num(o.schemes) };
    })
    .filter(defined)
    .sort((a, b) => b.value - a.value);
  const named = (list: unknown) =>
    arr(list)
      .map((x) => {
        const o = obj(x);
        const name = str(o.name);
        const pct = num(o.pct);
        return name && pct !== undefined ? ([name, pct] as [string, number]) : undefined;
      })
      .filter(defined);
  return {
    value: num(m.value),
    invested: num(m.invested),
    gain: num(m.gain),
    gainPct: num(m.gain_pct),
    count: num(m.count) ?? holdings.length,
    allocation: pctPairs(m.allocation),
    marketCap: pctPairs(m.market_cap),
    sectors: named(m.top_sectors),
    categories,
    holdings,
  };
}

function parseStocks(v: unknown): StocksDetail | undefined {
  const s = obj(v);
  if (!Object.keys(s).length) return undefined;
  return {
    value: num(s.value),
    equity: num(s.equity_value),
    etf: num(s.etf_value),
    demat: num(s.demat_accounts),
    shares: num(s.shares),
    holdings: arr(s.holdings)
      .map((h): Holding | undefined => {
        const o = obj(h);
        const name = str(o.name);
        const units = num(o.units) ?? 0;
        const price = num(o.price);
        const value = num(o.value) ?? (price !== undefined ? price * units : undefined);
        return name && value !== undefined ? { name, units, price, value, isin: str(o.isin) } : undefined;
      })
      .filter(defined)
      .sort((a, b) => b.value - a.value),
  };
}

function parsePolicy(v: unknown): Policy | undefined {
  const p = obj(v);
  const name = str(p.name);
  if (!name) return undefined;
  const f = obj(p.features);
  const ins = obj(p.insurer);
  const waits = obj(f.waiting_periods);
  const WAIT_LABELS: Record<string, string> = { initial: 'Any illness', pre_existing: 'Pre-existing', specific: 'Specific illnesses' };
  return {
    name,
    type: str(p.type),
    insurer: str(p.insurer_name),
    plan: str(f.plan_variant),
    coverType: str(f.cover_type),
    sumInsured: num(p.sum_insured),
    cover: num(p.effective_cover),
    premium: num(p.premium),
    termYears: num(f.policy_term_years),
    start: day(p.start) ?? day(p.inception),
    end: day(p.end),
    nextPremium: day(p.next_premium_date),
    insured: arr(p.insured).map((x) => {
      const o = obj(x);
      return { relationship: str(o.relationship), age: num(o.age) };
    }),
    addOns: arr(f.add_on_covers)
      .map(obj)
      .filter((a) => /^opted$/i.test(String(a.status ?? '')) && str(a.name))
      .map((a) => ({ name: str(a.name)!, sumInsured: num(a.sum_insured) })),
    waiting: Object.entries(WAIT_LABELS)
      .map(([k, label]) => (str(waits[k]) ? ([label, str(waits[k])!] as [string, string]) : undefined))
      .filter(defined),
    roomRent: str(f.room_rent_limit),
    restore: str(f.restore_benefit),
    pros: arr(p.pros).map(str).filter(defined),
    cons: arr(p.cons).map(str).filter(defined),
    contacts: arr(ins.contacts)
      .map((c) => {
        const o = obj(c);
        const kind = str(o.kind);
        const value = str(o.value);
        return kind && value ? { kind, label: str(o.label) ?? kind, value } : undefined;
      })
      .filter(defined),
    claimUrl: str(ins.claim_status_url),
    hospitalsUrl: str(ins.hospital_locator_url),
    grade: str(ins.grade),
  };
}

export function parseSnapshot(doc: unknown): Snapshot {
  const d = obj(doc);
  const cards = obj(d.cards);
  const score = obj(d.credit_score);
  const nw = obj(d.net_worth);
  const sm = obj(d.spending_month);
  const smMonth = typeof sm.month === 'string' && /^\d{4}-\d\d$/.test(sm.month) ? sm.month : undefined;
  const untagged = obj(sm.untagged);
  const fdList = obj(d.fixed_deposits);
  return {
    updated: when(d.updated),
    netWorthAsOf: when(nw.as_of),
    cards: arr(cards.open).map(parseCard).filter(defined),
    closedCards: arr(cards.closed)
      .map((c) => {
        const o = obj(c);
        const raw = str(o.name);
        return raw ? { ...splitLast4(raw), closedAt: day(o.closed_at) } : undefined;
      })
      .filter(defined),
    bureaus: arr(score.bureaus).map(parseBureau).filter(defined),
    creditAccounts: arr(score.accounts)
      .map((a): CreditAccounts | undefined => {
        const o = obj(a);
        const type = str(o.type);
        return type ? { type, active: num(o.active) ?? 0, closed: num(o.closed) ?? 0, total: num(o.total) ?? 0, limit: num(o.limit), oldestMonths: num(o.oldest_months) } : undefined;
      })
      .filter(defined),
    epf: parseEpf(d.epf),
    funds: parseFunds(d.mutual_funds),
    stocks: parseStocks(d.stocks),
    policies: arr(d.insurance).map(parsePolicy).filter(defined),
    loans: arr(nw.loans)
      .map((l) => {
        const o = obj(l);
        const raw = str(o.name);
        return raw ? { ...splitLast4(raw), included: o.included !== false } : undefined;
      })
      .filter(defined),
    fds: arr(fdList.deposits)
      .map((x) => {
        const o = obj(x);
        const name = str(o.name) ?? str(o.bank) ?? 'Fixed deposit';
        return { name, principal: num(o.principal) ?? num(o.amount), maturity: num(o.maturity_amount) ?? num(o.maturity), rate: num(o.interest_rate) ?? num(o.rate), maturityDate: day(o.maturity_date) };
      }),
    recurring: arr(d.recurring)
      .map((r): Recurring | undefined => {
        const o = obj(r);
        const name = str(o.name);
        const amount = num(o.amount) ?? num(o.average_paid);
        if (!name || amount === undefined || (str(o.status) && !/^active$/i.test(String(o.status)))) return undefined;
        return { name, amount, category: str(o.category), frequency: str(o.frequency), nextDue: day(o.next_due), variable: o.variable === true };
      })
      .filter(defined),
    spending: smMonth
      ? {
          month: smMonth,
          total: num(sm.total) ?? 0,
          categories: arr(sm.categories)
            .map((c): SpendCategory | undefined => {
              const o = obj(c);
              const name = str(o.name);
              const amount = num(o.amount);
              if (!name || amount === undefined) return undefined;
              const subs = arr(o.subcategories)
                .map((x) => {
                  const s = obj(x);
                  const n = str(s.name);
                  const a = num(s.amount);
                  return n && a !== undefined && a > 0 ? ([subName(n), a] as [string, number]) : undefined;
                })
                .filter(defined)
                .sort((a, b) => b[1] - a[1]);
              return { name, amount, count: num(o.count), subs };
            })
            .filter(defined),
          untagged: num(untagged.amount) !== undefined ? { amount: num(untagged.amount)!, count: num(untagged.count) } : undefined,
        }
      : undefined,
    connected: {
      nps: typeof obj(d.nps).connected === 'boolean' ? (obj(d.nps).connected as boolean) : undefined,
      ppf: typeof obj(d.ppf).connected === 'boolean' ? (obj(d.ppf).connected as boolean) : undefined,
      cash: typeof obj(d.cash_on_hand).is_set_up === 'boolean' ? (obj(d.cash_on_hand).is_set_up as boolean) : undefined,
    },
  };
}

// "FREQUENCY_EVERY_MONTH" / "EVERY_MONTH" → "monthly".
export function frequencyLabel(f: string | undefined): string | undefined {
  if (!f) return undefined;
  const k = f.toUpperCase().replace(/^FREQUENCY_/, '');
  const known: Record<string, string> = {
    DAILY: 'daily',
    EVERY_DAY: 'daily',
    EVERY_WEEK: 'weekly',
    WEEKLY: 'weekly',
    EVERY_MONTH: 'monthly',
    MONTHLY: 'monthly',
    EVERY_QUARTER: 'quarterly',
    QUARTERLY: 'quarterly',
    EVERY_YEAR: 'yearly',
    YEARLY: 'yearly',
  };
  return known[k] ?? k.toLowerCase().replace(/_/g, ' ');
}

// ---- Activity ----

export interface Tx {
  t: number;
  // YYYY-MM-DD (local), for grouping by day.
  date: string;
  // Money out is negative.
  amount: number;
  merchant?: string;
  category?: string;
  sub?: string;
  account?: string;
  notes?: string;
  // Whose it is (FINANCE.people id), when there's more than one person.
  owner?: string;
}
export interface FundTx {
  date: string;
  type: string;
  scheme: string;
  amount: number;
  units?: number;
  owner?: string;
}
export interface StockTx {
  t: number;
  date: string;
  type: string;
  name: string;
  units: number;
  rate?: number;
  amount: number;
  owner?: string;
}
export interface EpfTx {
  date: string;
  credit: boolean;
  amount: number;
  employee: number;
  employer: number;
  pension: number;
  wageMonth?: string;
  owner?: string;
}
export interface Activity {
  updated?: number;
  from?: string;
  // Newest first, all four.
  transactions: Tx[];
  funds: FundTx[];
  stocks: StockTx[];
  epf: EpfTx[];
}

// A `{ columns: [...], rows: [[...], ...] }` table as records by column name.
export function tableRows(v: unknown): Obj[] {
  const t = obj(v);
  const cols = arr(t.columns).map((c) => String(c));
  return arr(t.rows)
    .filter(Array.isArray)
    .map((r) => Object.fromEntries(cols.map((c, i) => [c, (r as unknown[])[i]])));
}

const isDebit = (type: unknown) => /^(debit|dr|sell|withdrawal)$/i.test(String(type ?? ''));

export function parseActivity(doc: unknown): Activity {
  const d = obj(doc);
  const tx = obj(d.transactions);
  const byNewest = <T extends { t: number }>(a: T, b: T) => b.t - a.t;
  return {
    updated: when(d.updated),
    from: day(tx.from),
    transactions: tableRows(tx)
      .map((r): Tx | undefined => {
        const t = when(r.date);
        const amount = num(r.amount);
        if (t === undefined || amount === undefined) return undefined;
        const signed = /^credit$/i.test(String(r.type ?? '')) ? Math.abs(amount) : -Math.abs(amount);
        return { t, date: String(r.date).slice(0, 10), amount: signed, merchant: str(r.merchant), category: str(r.category), sub: str(r.subcategory), account: str(r.account), notes: str(r.notes) };
      })
      .filter(defined)
      .sort(byNewest),
    funds: tableRows(d.mf_transactions)
      .map((r): FundTx | undefined => {
        const date = day(r.date);
        const scheme = str(r.scheme);
        const amount = num(r.amount);
        return date && scheme && amount !== undefined ? { date, type: String(r.type ?? 'BUY').toUpperCase(), scheme, amount, units: num(r.units) } : undefined;
      })
      .filter(defined)
      .sort((a, b) => b.date.localeCompare(a.date)),
    stocks: tableRows(d.stock_transactions)
      .map((r): StockTx | undefined => {
        const t = when(r.date);
        const name = str(r.name);
        const units = num(r.units);
        if (t === undefined || !name || units === undefined) return undefined;
        const rate = num(r.rate);
        return { t, date: String(r.date).slice(0, 10), type: String(r.type ?? '').toUpperCase(), name, units, rate, amount: (rate ?? 0) * units };
      })
      .filter(defined)
      .sort(byNewest),
    epf: tableRows(d.epf_transactions)
      .map((r): EpfTx | undefined => {
        const date = day(r.date);
        const amount = num(r.amount);
        if (!date || amount === undefined) return undefined;
        const wage = String(r.description ?? '').match(/(\d{4}-\d\d)/)?.[1];
        return { date, credit: !isDebit(r.type), amount, employee: num(r.employee) ?? 0, employer: num(r.employer) ?? 0, pension: num(r.pension) ?? 0, wageMonth: wage };
      })
      .filter(defined)
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}

// ---- Derived ----

// Money moved between your own accounts and card bill payments aren't income
// or spending (the card spends were counted when the card was used).
const MOVES = /^(self transfer|credit bill|transfer)$/i;
export const isMove = (t: Tx) => !!t.category && MOVES.test(t.category);

// What came in and went out over the transactions, without moves.
export function flows(txs: Tx[]): { in: number; out: number } {
  let inn = 0;
  let out = 0;
  for (const t of txs) {
    if (isMove(t)) continue;
    if (t.amount > 0) inn += t.amount;
    else out -= t.amount;
  }
  return { in: inn, out };
}

export type TxFilter = 'all' | 'spends' | 'income' | 'moves';
export function filterTx<T extends Tx>(txs: T[], f: TxFilter): T[] {
  if (f === 'spends') return txs.filter((t) => t.amount < 0 && !isMove(t));
  if (f === 'income') return txs.filter((t) => t.amount > 0 && !isMove(t));
  if (f === 'moves') return txs.filter(isMove);
  return txs;
}

// Transactions by day, newest day first, with each day's spending (moves left out).
export function byDay<T extends Tx>(txs: T[]): { date: string; spent: number; txs: T[] }[] {
  const days = new Map<string, T[]>();
  for (const t of txs) days.set(t.date, [...(days.get(t.date) ?? []), t]);
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({ date, spent: flows(list).out, txs: list }));
}

// Fund orders on one day of one kind, together ("7 Sep · 30 buys · ₹30,000").
export function groupFundOrders(list: FundTx[]): { date: string; type: string; amount: number; orders: FundTx[] }[] {
  const out: { date: string; type: string; amount: number; orders: FundTx[] }[] = [];
  for (const t of list) {
    const last = out[out.length - 1];
    if (last && last.date === t.date && last.type === t.type) {
      last.orders.push(t);
      last.amount += t.amount;
    } else out.push({ date: t.date, type: t.type, amount: t.amount, orders: [t] });
  }
  return out;
}

// The same for stock trades (a day's batch of sells reads as one line).
export function groupTrades(list: StockTx[]): { date: string; type: string; amount: number; trades: StockTx[] }[] {
  const out: { date: string; type: string; amount: number; trades: StockTx[] }[] = [];
  for (const t of list) {
    const last = out[out.length - 1];
    if (last && last.date === t.date && last.type === t.type) {
      last.trades.push(t);
      last.amount += t.amount;
    } else out.push({ date: t.date, type: t.type, amount: t.amount, trades: [t] });
  }
  return out;
}

// EPF credits per wage month, oldest first, the last `n` months that had one.
export function epfMonths(list: EpfTx[], n = 12): { month: string; employee: number; employer: number; pension: number }[] {
  const m = new Map<string, { month: string; employee: number; employer: number; pension: number }>();
  for (const t of list) {
    if (!t.credit) continue;
    const month = t.wageMonth ?? t.date.slice(0, 7);
    const row = m.get(month) ?? { month, employee: 0, employer: 0, pension: 0 };
    row.employee += t.employee;
    row.employer += t.employer;
    row.pension += t.pension;
    m.set(month, row);
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-n);
}

// A card's detail by its last digits, else by name.
export function cardDetail(details: CardDetail[], card: { last4: string; name: string }): CardDetail | undefined {
  return details.find((d) => (card.last4 && d.last4 ? d.last4 === card.last4 : d.name.toLowerCase() === card.name.toLowerCase()));
}

// "Northwind Flexi Cap Fund - Direct Plan Growth" → "Northwind Flexi Cap Fund".
export function shortScheme(s: string): string {
  const cut = s
    .replace(/\s*[-–]\s*(direct|regular)\b.*$/i, '')
    .replace(/\s+(direct\s+)?(plan\s+)?(growth|grth)(\s+(direct|option|plan))*\s*$/i, '')
    .replace(/\s+direct(\s+plan)?\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cut || s;
}

// The money app's all-caps names ("ACME METALS LTD") in title case; mixed-case
// names stay as they are.
export function tidyName(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Ltd|Etf|Mf|Amc)\b/g, (w) => (w === 'Ltd' ? 'Ltd' : w.toUpperCase()));
}
