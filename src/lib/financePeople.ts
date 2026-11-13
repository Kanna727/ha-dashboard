// More than one person's money (FINANCE.people, 2026-11-13: the owner and their
// partner each have their own money-app account and sync). Each person's
// helpers and documents are parsed as before; these pure helpers add them up for
// the "Both" view and tag every row with whose it is (`owner`). One person's
// view is just their own parsed data, tagged. Unit-tested (financePeople.test.ts).
import type { Account, Finance, MoneyHistory, MonthSpend, Upcoming } from './finance';
import type { Activity, EpfDetail, FundsDetail, Policy, Snapshot, SpendCategory, StocksDetail } from './financeDetail';

export interface Owned<T> {
  owner: string;
  data: T;
}

const tag = <T extends object>(rows: T[], owner: string): (T & { owner: string })[] => rows.map((r) => ({ ...r, owner }));

// undefined when nobody has it, else the sum of those who do.
function sum(vals: (number | undefined)[]): number | undefined {
  const have = vals.filter((v): v is number => v !== undefined);
  return have.length ? have.reduce((a, b) => a + b, 0) : undefined;
}
const min = (vals: (number | undefined)[]) => {
  const have = vals.filter((v): v is number => v !== undefined);
  return have.length ? Math.min(...have) : undefined;
};
const max = (vals: (number | undefined)[]) => {
  const have = vals.filter((v): v is number => v !== undefined);
  return have.length ? Math.max(...have) : undefined;
};
const firstDay = (vals: (string | undefined)[]) => vals.filter((v): v is string => !!v).sort()[0];
const pct = (part: number | undefined, whole: number | undefined) => (part === undefined || !whole ? undefined : Math.round((part / whole) * 10000) / 100);

// ---- Helpers (lib/finance.ts Finance) ----

const SUMMED = [
  'netWorth', 'liquid', 'investments', 'debt', 'bankTotal', 'cardsOutstanding', 'loans', 'fundsValue', 'fundsInvested',
  'stocks', 'epf', 'spentThisMonth', 'cardsUnpaid', 'cardsLimit', 'cardsAvailable', 'fundsGain', 'fds', 'ppf', 'nps',
  'cashOnHand', 'customAssets', 'customLiabilities',
] as const;

export function tagFinance(f: Finance, owner: string): Finance {
  return { ...f, banks: tag(f.banks, owner), cards: tag(f.cards, owner), scores: tag(f.scores, owner), bill: f.bill && { ...f.bill, owner } };
}

const byBalance = (a: Account, b: Account) => b.balance - a.balance;

export function mergeFinance(list: Owned<Finance | undefined>[]): Finance | undefined {
  const have = list.filter((p): p is Owned<Finance> => !!p.data);
  if (have.length === 0) return undefined;
  if (have.length === 1) return tagFinance(have[0].data, have[0].owner);
  const fs = have.map((p) => tagFinance(p.data, p.owner));
  const out: Finance = { banks: [], cards: [], scores: [] };
  for (const k of SUMMED) out[k] = sum(fs.map((f) => f[k]));
  out.cardsUtilization = pct(out.cardsOutstanding, out.cardsLimit) ?? (out.cardsLimit ? 0 : sum(fs.map((f) => f.cardsUtilization)));
  out.fundsGainPct = pct(out.fundsGain, out.fundsInvested);
  // A family floater lists both people: the same cover twice is one policy.
  const covers = [...new Set(fs.map((f) => f.healthCover).filter((v): v is number => v !== undefined))];
  out.healthCover = covers.length ? covers.reduce((a, b) => a + b, 0) : undefined;
  out.premiumDue = firstDay(fs.map((f) => f.premiumDue));
  // The oldest of the snapshots and bank fetches: "as of" must hold for all.
  out.snapshotAt = min(fs.map((f) => f.snapshotAt));
  out.asOf = min(fs.map((f) => f.asOf));
  out.changedAt = max(fs.map((f) => f.changedAt));
  out.banks = fs.flatMap((f) => f.banks).sort(byBalance);
  out.cards = fs.flatMap((f) => f.cards).sort(byBalance);
  out.scores = fs.flatMap((f) => f.scores);
  // The bill due soonest (no date sorts last).
  const bills = fs.map((f) => f.bill).filter((b): b is NonNullable<Finance['bill']> => !!b);
  out.bill = bills.sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'))[0];
  // The newest transaction comes from whoever's data moved last.
  out.lastTransaction = [...fs].sort((a, b) => (b.changedAt ?? 0) - (a.changedAt ?? 0)).find((f) => f.lastTransaction)?.lastTransaction;
  return out;
}

// ---- Chart data (lib/finance.ts MoneyHistory) ----

export function tagHistory(h: MoneyHistory, owner: string): MoneyHistory {
  return { ...h, upcoming: tag(h.upcoming, owner) };
}

// Net worth: from the first day everyone has a point, each day the sum of
// everyone's latest value on or before it.
function addSeries(series: { t: number; v: number }[][]): { t: number; v: number }[] {
  const live = series.filter((s) => s.length);
  if (live.length === 0) return [];
  if (live.length === 1) return live[0];
  const start = Math.max(...live.map((s) => s[0].t));
  const days = [...new Set(live.flatMap((s) => s.map((p) => p.t)))].filter((t) => t >= start).sort((a, b) => a - b);
  const idx = live.map(() => 0);
  return days.map((t) => {
    let v = 0;
    live.forEach((s, i) => {
      while (idx[i] + 1 < s.length && s[idx[i] + 1].t <= t) idx[i]++;
      v += s[idx[i]].v;
    });
    return { t, v };
  });
}

function addMonths(lists: MonthSpend[][]): MonthSpend[] {
  const by = new Map<string, { total: number; cats: Map<string, number> }>();
  for (const m of lists.flat()) {
    const e = by.get(m.month) ?? { total: 0, cats: new Map() };
    e.total += m.total;
    for (const [k, v] of m.categories) e.cats.set(k, (e.cats.get(k) ?? 0) + v);
    by.set(m.month, e);
  }
  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, e]) => ({ month, total: e.total, categories: [...e.cats.entries()].sort((a, b) => b[1] - a[1]) }));
}

export function mergeHistory(list: Owned<MoneyHistory>[]): MoneyHistory {
  if (list.length === 1) return tagHistory(list[0].data, list[0].owner);
  const hs = list.map((p) => tagHistory(p.data, p.owner));
  return {
    updated: min(hs.map((h) => h.updated)),
    netWorth: addSeries(hs.map((h) => h.netWorth)),
    months: addMonths(hs.map((h) => h.months)),
    upcoming: hs.flatMap((h) => h.upcoming).sort((a: Upcoming, b: Upcoming) => a.date.localeCompare(b.date)),
  };
}

// ---- Details (lib/financeDetail.ts Snapshot, Activity) ----

export function tagSnapshot(s: Snapshot, owner: string): Snapshot {
  return {
    ...s,
    cards: tag(s.cards, owner),
    closedCards: tag(s.closedCards, owner),
    bureaus: tag(s.bureaus, owner),
    policies: tag(s.policies, owner),
    loans: tag(s.loans, owner),
    fds: tag(s.fds, owner),
    recurring: tag(s.recurring, owner),
    funds: s.funds && { ...s.funds, holdings: tag(s.funds.holdings, owner) },
    stocks: s.stocks && { ...s.stocks, holdings: tag(s.stocks.holdings, owner) },
  };
}

// Percent splits weighted by each person's value.
function weighted(parts: { w: number; pairs: [string, number][] }[]): [string, number][] {
  const total = parts.reduce((s, p) => s + p.w, 0);
  if (!total) return parts.find((p) => p.pairs.length)?.pairs ?? [];
  const m = new Map<string, number>();
  for (const p of parts) for (const [k, v] of p.pairs) m.set(k, (m.get(k) ?? 0) + (v * p.w) / total);
  return [...m.entries()]
    .map(([k, v]) => [k, Math.round(v * 100) / 100] as [string, number])
    .sort((a, b) => Number(/^others?$/i.test(a[0])) - Number(/^others?$/i.test(b[0])) || b[1] - a[1]);
}

function mergeFunds(list: FundsDetail[]): FundsDetail | undefined {
  if (list.length <= 1) return list[0];
  const parts = (pick: (f: FundsDetail) => [string, number][]) => list.map((f) => ({ w: f.value ?? 0, pairs: pick(f) }));
  const cats = new Map<string, { value: number; invested: number; gain: number; schemes: number }>();
  for (const c of list.flatMap((f) => f.categories)) {
    const e = cats.get(c.name) ?? { value: 0, invested: 0, gain: 0, schemes: 0 };
    e.value += c.value;
    e.invested += c.invested;
    e.gain += c.gain;
    e.schemes += c.schemes ?? 0;
    cats.set(c.name, e);
  }
  const invested = sum(list.map((f) => f.invested));
  const gain = sum(list.map((f) => f.gain));
  return {
    value: sum(list.map((f) => f.value)),
    invested,
    gain,
    gainPct: pct(gain, invested),
    count: list.reduce((s, f) => s + f.count, 0),
    allocation: weighted(parts((f) => f.allocation)),
    marketCap: weighted(parts((f) => f.marketCap)),
    sectors: weighted(parts((f) => f.sectors)),
    categories: [...cats.entries()]
      .map(([name, e]) => ({ name, ...e, gainPct: pct(e.gain, e.invested), schemes: e.schemes || undefined }))
      .sort((a, b) => b.value - a.value),
    holdings: list.flatMap((f) => f.holdings).sort((a, b) => b.value - a.value),
  };
}

function mergeStocks(list: StocksDetail[]): StocksDetail | undefined {
  if (list.length <= 1) return list[0];
  return {
    value: sum(list.map((s) => s.value)),
    equity: sum(list.map((s) => s.equity)),
    etf: sum(list.map((s) => s.etf)),
    demat: sum(list.map((s) => s.demat)),
    shares: sum(list.map((s) => s.shares)),
    holdings: list.flatMap((s) => s.holdings).sort((a, b) => b.value - a.value),
  };
}

function mergeEpf(list: EpfDetail[]): EpfDetail | undefined {
  if (list.length <= 1) return list[0];
  const years = new Map<string, EpfDetail['years'][number]>();
  for (const y of list.flatMap((e) => e.years)) {
    const e = years.get(y.fy);
    years.set(
      y.fy,
      e
        ? { fy: y.fy, opening: e.opening + y.opening, contributions: e.contributions + y.contributions, interest: e.interest + y.interest, withdrawals: e.withdrawals + y.withdrawals, closing: e.closing + y.closing }
        : { ...y },
    );
  }
  return {
    total: sum(list.map((e) => e.total)),
    employee: sum(list.map((e) => e.employee)),
    employer: sum(list.map((e) => e.employer)),
    pension: sum(list.map((e) => e.pension)),
    rate: list.find((e) => e.rate !== undefined)?.rate,
    rateFy: list.find((e) => e.rateFy)?.rateFy,
    refreshed: min(list.map((e) => e.refreshed)),
    nextRefresh: min(list.map((e) => e.nextRefresh)),
    employers: list.reduce((s, e) => s + e.employers, 0),
    currentSince: undefined,
    years: [...years.values()].sort((a, b) => a.fy.localeCompare(b.fy)),
  };
}

// A family floater shows up in both people's data: keep it once.
const policyKey = (p: Policy) => [p.insurer ?? '', p.name, p.sumInsured ?? '', p.start ?? ''].join('|').toLowerCase();
function mergePolicies(list: Policy[]): Policy[] {
  const seen = new Map<string, Policy>();
  for (const p of list) {
    const k = policyKey(p);
    const had = seen.get(k);
    // Shared: no single owner.
    if (had) seen.set(k, { ...had, owner: undefined });
    else seen.set(k, p);
  }
  return [...seen.values()];
}

function mergeSpending(list: NonNullable<Snapshot['spending']>[]): Snapshot['spending'] {
  if (list.length <= 1) return list[0];
  const cats = new Map<string, { amount: number; count: number; subs: Map<string, number> }>();
  for (const c of list.flatMap((s) => s.categories)) {
    const e = cats.get(c.name) ?? { amount: 0, count: 0, subs: new Map() };
    e.amount += c.amount;
    e.count += c.count ?? 0;
    for (const [k, v] of c.subs) e.subs.set(k, (e.subs.get(k) ?? 0) + v);
    cats.set(c.name, e);
  }
  const untagged = list.map((s) => s.untagged).filter((u): u is NonNullable<typeof u> => !!u);
  // Only months that match add up; otherwise the newest.
  const month = list.map((s) => s.month).sort().pop()!;
  const same = list.filter((s) => s.month === month);
  if (same.length < list.length) return same[0];
  return {
    month,
    total: list.reduce((s, x) => s + x.total, 0),
    categories: [...cats.entries()]
      .map(([name, e]): SpendCategory => ({ name, amount: e.amount, count: e.count || undefined, subs: [...e.subs.entries()].sort((a, b) => b[1] - a[1]) }))
      .sort((a, b) => b.amount - a.amount),
    untagged: untagged.length ? { amount: untagged.reduce((s, u) => s + u.amount, 0), count: sum(untagged.map((u) => u.count)) } : undefined,
  };
}

export function mergeSnapshot(list: Owned<Snapshot>[]): Snapshot {
  if (list.length === 1) return tagSnapshot(list[0].data, list[0].owner);
  const ss = list.map((p) => tagSnapshot(p.data, p.owner));
  const defined = <T,>(xs: (T | undefined)[]) => xs.filter((x): x is T => x !== undefined);
  const accounts = new Map<string, Snapshot['creditAccounts'][number]>();
  for (const a of ss.flatMap((s) => s.creditAccounts)) {
    const e = accounts.get(a.type);
    accounts.set(
      a.type,
      e ? { type: a.type, active: e.active + a.active, closed: e.closed + a.closed, total: e.total + a.total, limit: sum([e.limit, a.limit]), oldestMonths: max([e.oldestMonths, a.oldestMonths]) } : { ...a },
    );
  }
  return {
    updated: min(ss.map((s) => s.updated)),
    netWorthAsOf: min(ss.map((s) => s.netWorthAsOf)),
    cards: ss.flatMap((s) => s.cards).sort((a, b) => (b.outstanding ?? 0) - (a.outstanding ?? 0)),
    closedCards: ss.flatMap((s) => s.closedCards),
    bureaus: ss.flatMap((s) => s.bureaus),
    creditAccounts: [...accounts.values()],
    epf: mergeEpf(defined(ss.map((s) => s.epf))),
    funds: mergeFunds(defined(ss.map((s) => s.funds))),
    stocks: mergeStocks(defined(ss.map((s) => s.stocks))),
    policies: mergePolicies(ss.flatMap((s) => s.policies)),
    loans: ss.flatMap((s) => s.loans),
    fds: ss.flatMap((s) => s.fds),
    recurring: ss.flatMap((s) => s.recurring),
    spending: mergeSpending(defined(ss.map((s) => s.spending))),
    connected: {
      nps: ss.some((s) => s.connected.nps) || (ss.every((s) => s.connected.nps === undefined) ? undefined : false),
      ppf: ss.some((s) => s.connected.ppf) || (ss.every((s) => s.connected.ppf === undefined) ? undefined : false),
      cash: ss.some((s) => s.connected.cash) || (ss.every((s) => s.connected.cash === undefined) ? undefined : false),
    },
  };
}

export function tagActivity(a: Activity, owner: string): Activity {
  return { ...a, transactions: tag(a.transactions, owner), funds: tag(a.funds, owner), stocks: tag(a.stocks, owner), epf: tag(a.epf, owner) };
}

export function mergeActivity(list: Owned<Activity>[]): Activity {
  if (list.length === 1) return tagActivity(list[0].data, list[0].owner);
  const as = list.map((p) => tagActivity(p.data, p.owner));
  const desc = <T extends { date: string; t?: number }>(rows: T[]) => rows.sort((a, b) => (b.t ?? 0) - (a.t ?? 0) || b.date.localeCompare(a.date));
  return {
    updated: min(as.map((a) => a.updated)),
    from: firstDay(as.map((a) => a.from)),
    transactions: desc(as.flatMap((a) => a.transactions)),
    funds: desc(as.flatMap((a) => a.funds)),
    stocks: desc(as.flatMap((a) => a.stocks)),
    epf: desc(as.flatMap((a) => a.epf)),
  };
}
