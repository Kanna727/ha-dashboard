import { MONEY_PEOPLE } from '../config/entities';
import { useState, type ReactNode } from 'react';
import { BarChart, type Bar } from '../components/BarChart';
import { useNow } from '../hooks/useNow';
import { bankColor, daysUntil, fmtInr, fmtShort, fmtWhen, type Account } from '../lib/finance';
import {
  byDay,
  cardDetail,
  epfMonths,
  filterTx,
  flows,
  frequencyLabel,
  groupFundOrders,
  groupTrades,
  isMove,
  shortScheme,
  tidyName,
  type Policy,
  type TxFilter,
} from '../lib/financeDetail';
import { Amt } from './Amt';
import { useTxEditor } from './TxEditor';
import { useTxView } from './useTxEdits';
import type { ViewTx } from '../lib/txEdits';
import { fmtAuto, fmtDate, fmtMonth, fmtPct, fmtSigned, Head, MoreButton, OwnerTag, ratingTone, StackBar } from './parts';
import { useFinance } from './useFinance';
import { useActivity, useMoneyHistory, useSnapshot } from './useMoneyHistory';

// The Money page's detail panels (the owner asked on 2026-11-07 for everything
// the money sync puts in HA): own vs owe, every card's cycle, transactions,
// mutual funds, stocks, EPF and insurance. The helpers (useFinance) give the
// live totals; the daily snapshot and activity dashboards (useSnapshot,
// useActivity; lib/financeDetail.ts) the lists. Each part leaves itself out
// when its data isn't there.

const SEG = {
  bank: '#38bdf8',
  cash: '#22d3ee',
  epf: '#60a5fa',
  funds: '#8b7cf6',
  stocks: '#34d399',
  fds: '#fbbf24',
  ppf: '#f472b6',
  nps: '#fb923c',
  other: '#94a3b8',
  cards: '#f87171',
  loans: '#fb923c',
};

// ---- Own and owe ----

export function BalanceSheetPanel() {
  const f = useFinance();
  const snap = useSnapshot();
  if (!f) return null;
  const own: [string, number | undefined, string][] = [
    ['Bank', f.bankTotal ?? f.liquid, SEG.bank],
    ['Cash on hand', f.cashOnHand, SEG.cash],
    ['EPF', f.epf, SEG.epf],
    ['Mutual funds', f.fundsValue, SEG.funds],
    ['Stocks', f.stocks, SEG.stocks],
    ['Fixed deposits', f.fds, SEG.fds],
    ['PPF', f.ppf, SEG.ppf],
    ['NPS', f.nps, SEG.nps],
    ['Other assets', f.customAssets, SEG.other],
  ];
  const owe: [string, number | undefined, string][] = [
    ['Credit cards', f.cardsOutstanding, SEG.cards],
    ['Loans', f.loans, SEG.loans],
    ['Other debts', f.customLiabilities, SEG.other],
  ];
  const has = (list: typeof own) => list.filter((p): p is [string, number, string] => p[1] !== undefined && p[1] !== 0);
  const ownParts = has(own);
  const oweParts = has(owe);
  if (!ownParts.length && !oweParts.length) return null;
  const empty = [...own, ...owe].filter(([, v]) => v === 0).map(([k]) => k);
  const ownSum = ownParts.reduce((s, [, v]) => s + v, 0);
  const oweSum = oweParts.reduce((s, [, v]) => s + v, 0);
  const max = Math.max(ownSum, oweSum, 1);
  const net = f.netWorth ?? ownSum - oweSum;
  const row = (label: string, sum: number, parts: [string, number, string][]) => (
    <div className="bs-row">
      <span className="bs-label">
        <span className="label">{label}</span>
        <b>
          <Amt>{fmtAuto(sum)}</Amt>
        </b>
      </span>
      <div className="bs-track" aria-hidden>
        <div className="stackbar-bar" style={{ width: `${(Math.max(0, sum) / max) * 100}%` }}>
          {parts
            .filter(([, v]) => v > 0)
            .map(([k, v, c]) => (
              <i key={k} style={{ flexGrow: v, background: c }} />
            ))}
        </div>
      </div>
      <ul className="stackbar-key">
        {parts.map(([k, v, c]) => (
          <li key={k} className={v < 0 ? 'neg' : ''}>
            <i style={{ background: c }} />
            {k}{' '}
            <b>
              <Amt>{fmtAuto(v)}</Amt>
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section className="panel money-balance">
      <Head
        label="Own and owe"
        summary={
          <>
            Net <Amt>{fmtAuto(net)}</Amt>
          </>
        }
      />
      {row('Own', ownSum, ownParts)}
      {row('Owe', oweSum, oweParts)}
      {snap.loans.length > 0 && (
        <div className="money-sub">
          <span className="label">Loans</span>
          <ul className="money-list">
            {snap.loans.map((l) => (
              <li key={`${l.name}${l.last4}`} className={l.included ? '' : 'dim'}>
                <span>
                  {l.name}
                  {l.last4 && <small> ••{l.last4}</small>}
                </span>
                <small className="muted">{l.included ? 'counted' : 'left out of net worth'}</small>
              </li>
            ))}
          </ul>
          {f.loans !== undefined && <p className="money-note">The money app gives only the total owed on loans, not each loan's balance.</p>}
        </div>
      )}
      {empty.length > 0 && <p className="money-note">Nothing in: {empty.join(' · ')}</p>}
    </section>
  );
}

// ---- Card cycles (inside the Credit cards card) ----

const statementLabel = (date: string, now: Date) => {
  const d = daysUntil(date, now);
  return d < 0 ? `billed ${fmtDate(date, now)}` : d === 0 ? 'bills today' : d === 1 ? 'bills tomorrow' : `bills in ${d} days`;
};

export function CardLimits({ cards }: { cards: Account[] }) {
  const f = useFinance();
  const snap = useSnapshot();
  const now = useNow(60_000);
  if (!f) return null;
  const used = f.cardsUtilization ?? (f.cardsLimit && f.cardsOutstanding !== undefined ? (f.cardsOutstanding / f.cardsLimit) * 100 : undefined);
  const rows = cards
    .map((c) => ({ c, d: cardDetail(snap.cards, c) }))
    .filter((x) => x.d)
    .sort((a, b) => (a.d!.statementDate ?? '9').localeCompare(b.d!.statementDate ?? '9'));
  if (used === undefined && !rows.length) return null;
  const tone = (pct: number) => (pct >= 50 ? 'bad' : pct >= 30 ? 'warn' : 'ok');
  return (
    <div className="card-limits">
      {used !== undefined && (
        <div className="limit-total">
          <div className="limit-line">
            <b className={`tone-${tone(used)}`}>{used.toFixed(1)}%</b>
            <span className="muted">
              of limits used
              {f.cardsLimit !== undefined && (
                <>
                  {' · '}
                  <Amt>{fmtShort(f.cardsLimit)}</Amt> limit
                </>
              )}
              {f.cardsAvailable !== undefined && (
                <>
                  {' · '}
                  <Amt>{fmtShort(f.cardsAvailable)}</Amt> free
                </>
              )}
            </span>
          </div>
          <div className="limit-bar" aria-hidden>
            <i className={`tone-${tone(used)}`} style={{ width: `${Math.min(100, used)}%` }} />
            <b style={{ left: '30%' }} title="30%: keep under this for a good score" />
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <div className="money-sub">
          <span className="label">Billing cycles</span>
          <ul className="cycles">
            {rows.map(({ c, d }) => {
              const pct = d!.limit ? (Math.max(0, d!.outstanding ?? c.balance) / d!.limit) * 100 : undefined;
              const lb = d!.lastBill;
              const unpaid = lb && !lb.paid && (lb.remaining ?? lb.total) > 0;
              return (
                <li key={c.id}>
                  <span className="cy-name">
                    <i style={{ background: bankColor(c.bank) }} />
                    <span>
                      {c.name}
                      <small> ••{c.last4}</small>
                      <OwnerTag owner={c.owner} />
                    </span>
                  </span>
                  <span className="cy-cycle">
                    {d!.cycleSpent !== undefined && (
                      <b>
                        <Amt>{fmtInr(d!.cycleSpent)}</Amt>
                      </b>
                    )}
                    <small className="muted">{d!.statementDate ? `this cycle · ${statementLabel(d!.statementDate, now)}` : 'this cycle'}</small>
                  </span>
                  <span className={`cy-bill ${unpaid ? 'warn' : ''}`}>
                    {lb ? (
                      lb.total === 0 ? (
                        <small className="muted">Last bill nil</small>
                      ) : unpaid ? (
                        <>
                          <b>
                            <Amt>{fmtInr(lb.remaining ?? lb.total)}</Amt>
                          </b>
                          <small>{lb.due ? `due ${fmtDate(lb.due, now)}` : 'unpaid'}</small>
                        </>
                      ) : (
                        <>
                          <b>
                            <Amt>{fmtInr(lb.total)}</Amt>
                          </b>
                          <small className="muted">last bill · paid</small>
                        </>
                      )
                    ) : null}
                  </span>
                  {pct !== undefined && (
                    <span className="cy-limit" title={`${pct.toFixed(0)}% of ${fmtInr(d!.limit!)}`}>
                      <span className="cy-bar" aria-hidden>
                        <i className={`tone-${tone(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </span>
                      <small className="muted">
                        {pct.toFixed(0)}% of <Amt>{fmtShort(d!.limit!)}</Amt>
                      </small>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {snap.closedCards.length > 0 && (
        <p className="money-note">
          Closed: {snap.closedCards.map((c) => `${c.name}${c.last4 ? ` ••${c.last4}` : ''}`).join(' · ')}
        </p>
      )}
    </div>
  );
}

// The thin limit bar along the bottom of a wallet card.
export function useCardUse(card: Account): number | undefined {
  const snap = useSnapshot();
  const d = cardDetail(snap.cards, card);
  return d?.limit ? Math.min(100, (Math.max(0, d.outstanding ?? card.balance) / d.limit) * 100) : undefined;
}

// ---- Recurring payments (inside the bills card) ----

export function RecurringList() {
  const snap = useSnapshot();
  const now = useNow(60_000);
  const h = useMoneyHistory();
  // Those already in Coming up (the chart data lists them too) show their frequency there.
  const soon = new Set(h.upcoming.filter((u) => { const d = daysUntil(u.date, now); return d >= 0 && d <= 45; }).map((u) => u.name.toLowerCase()));
  const list = snap.recurring.filter((r) => !soon.has(r.name.toLowerCase()));
  if (!list.length) return null;
  return (
    <div className="money-sub">
      <span className="label">Recurring</span>
      <ul className="money-list">
        {list.map((r) => (
          <li key={`${r.owner}${r.name}`}>
            <span>
              {r.name}
              <OwnerTag owner={r.owner} />
              <small className="muted">
                {' '}
                {[frequencyLabel(r.frequency), r.category, r.nextDue && `next ${fmtDate(r.nextDue, now)}`].filter(Boolean).join(' · ')}
              </small>
            </span>
            <b>
              {r.variable && '~'}
              <Amt>{fmtInr(r.amount)}</Amt>
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Credit score details (inside the Credit score card) ----

export function ScoreDetails() {
  const snap = useSnapshot();
  const now = useNow(60_000);
  const bureaus = snap.bureaus.filter((b) => b.factors.length);
  if (!bureaus.length && !snap.creditAccounts.length) return null;
  const names = [...new Set(bureaus.flatMap((b) => b.factors.map((x) => x.name)))];
  // The summary of the lower score: the one with something to fix.
  const low = [...snap.bureaus].filter((b) => b.summary?.text).sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
  const next = snap.bureaus.map((b) => b.nextRefresh).filter(Boolean).sort()[0];
  const fmtVal = (v: number | undefined, unit: string | undefined) =>
    v === undefined ? '–' : unit === '%' ? `${v.toFixed(v < 10 ? 1 : 0)}%` : unit === 'months' ? `${Math.floor(v / 12)}y ${v % 12}m` : String(v);
  return (
    <div className="score-details">
      {bureaus.length > 0 && (
        <table className="factors">
          <thead>
            <tr>
              <th />
              {bureaus.map((b) => (
                <th key={`${b.owner}${b.bureau}`}>
                  {b.bureau}
                  <OwnerTag owner={b.owner} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((n) => {
              const impact = bureaus.map((b) => b.factors.find((x) => x.name === n)?.impact).find(Boolean);
              return (
                <tr key={n}>
                  <th>
                    {n}
                    {impact && <small> {impact} impact</small>}
                  </th>
                  {bureaus.map((b) => {
                    const x = b.factors.find((y) => y.name === n);
                    return (
                      <td key={`${b.owner}${b.bureau}`}>
                        <b>{fmtVal(x?.value, x?.unit)}</b>
                        {x?.rating && <span className={`rating ${ratingTone(x.rating)}`}>{x.rating}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {low?.summary && (
        <div className="score-summary">
          <b>
            {low.summary.title ?? 'Summary'}
            {snap.bureaus.length > 1 && <small className="muted"> · {low.bureau}</small>}
          </b>
          {low.summary.text && <p>{low.summary.text}</p>}
        </div>
      )}
      {snap.creditAccounts.length > 0 && (
        <ul className="money-list">
          {snap.creditAccounts.map((a) => (
            <li key={a.type}>
              <span>
                {a.type}
                <small className="muted">
                  {' '}
                  {a.active} active · {a.closed} closed{a.oldestMonths !== undefined && ` · oldest ${Math.round(a.oldestMonths / 12)} yrs`}
                </small>
              </span>
              {a.limit !== undefined && (
                <b>
                  <Amt>{fmtShort(a.limit)}</Amt>
                </b>
              )}
            </li>
          ))}
        </ul>
      )}
      {next && <p className="money-note">Next score update {fmtDate(next, now)}</p>}
    </div>
  );
}

// The rank under a dial ("Top 57%").
export function useBureauRank(bureau: string, owner?: string): string | undefined {
  const snap = useSnapshot();
  const r = snap.bureaus.find((b) => b.bureau.toLowerCase() === bureau.toLowerCase() && (!owner || b.owner === owner))?.rank;
  return r ? r.charAt(0) + r.slice(1).toLowerCase() : undefined;
}

// ---- Transactions ----

const CAT_COLORS: Record<string, string> = {
  'food & drinks': '#fbbf24',
  groceries: '#34d399',
  shopping: '#f472b6',
  transport: '#38bdf8',
  bill: '#a78bfa',
  emi: '#fb923c',
  'credit bill': '#64748b',
  'self transfer': '#64748b',
  investment: '#8b7cf6',
  subscription: '#2dd4bf',
  services: '#60a5fa',
  salary: '#34d399',
  earnings: '#34d399',
  interest: '#34d399',
  cashback: '#34d399',
  'hidden charges': '#f87171',
};
const SPARE = ['#fbbf24', '#38bdf8', '#34d399', '#a78bfa', '#f472b6', '#fb923c', '#2dd4bf', '#60a5fa'];
export function categoryColor(name: string | undefined): string {
  if (!name) return '#475569';
  const known = CAT_COLORS[name.toLowerCase()];
  if (known) return known;
  const h = [...name.toLowerCase()].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return SPARE[h % SPARE.length];
}

const FILTERS: [TxFilter, string][] = [
  ['all', 'All'],
  ['spends', 'Spends'],
  ['income', 'Income'],
  ['moves', 'Transfers'],
];
const FIRST = 12;
const timeOf = (t: number) => {
  const d = new Date(t);
  if (!d.getHours() && !d.getMinutes()) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
};

function TxRow({ t, onOpen }: { t: ViewTx; onOpen: (t: ViewTx) => void }) {
  const raw = t.merchant ? tidyName(t.merchant) : t.notes ? t.notes.split('/').slice(0, 2).join(' ') : 'Unknown';
  const who = t.note ?? raw;
  const move = isMove(t);
  return (
    <li className={`tx ${move ? 'move' : ''} ${t.hidden ? 'is-hidden' : ''}`} onClick={() => onOpen(t)} role="button" tabIndex={0}>
      <i style={{ background: categoryColor(t.category) }} />
      <span className="tx-who">
        <b>
          {who}
          {t.source === 'added' && <span className="tx-tag">added</span>}
          {t.edited && <span className="tx-tag">edited</span>}
          {t.hidden && <span className="tx-tag">hidden</span>}
          <OwnerTag owner={t.owner ?? MONEY_PEOPLE[0].id} />
        </b>
        <small className="muted">{[t.note && t.merchant ? raw : '', t.category ? [t.category, t.sub].filter(Boolean).join(' · ') : 'Untagged', t.account, timeOf(t.t)].filter(Boolean).join(' · ')}</small>
      </span>
      <span className={`tx-amt ${t.amount > 0 && !move ? 'pos' : ''}`}>
        <Amt>{t.amount > 0 ? `+${fmtInr(t.amount, t.amount % 1 ? 2 : 0)}` : fmtInr(t.amount, t.amount % 1 ? 2 : 0)}</Amt>
      </span>
    </li>
  );
}

export function TransactionsPanel() {
  const a = useActivity();
  const view = useTxView();
  const edit = useTxEditor();
  const now = useNow(60_000);
  const [filter, setFilter] = useState<TxFilter>('all');
  const [all, setAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  // Changed transactions older than the activity window still count in totals but aren't listed.
  const listed = view.filter((t) => !t.gone);
  if (!listed.length) return null;
  const hiddenCount = listed.filter((t) => t.hidden).length;
  const live = listed.filter((t) => showHidden || !t.hidden);
  // Daily interest credits of a few paise would fill the list.
  const tiny = live.filter((t) => Math.abs(t.amount) < 1);
  const real = live.filter((t) => Math.abs(t.amount) >= 1);
  const list = filterTx(real, filter);
  const shown = all ? list : list.slice(0, FIRST);
  const total = flows(real.filter((t) => !t.hidden));
  const from = a.from ?? real[real.length - 1]?.date;
  return (
    <section className="panel money-txs">
      <Head label="Transactions" summary={from ? `since ${fmtDate(from, now)}` : undefined}>
        <button className="chip-btn small active" onClick={() => edit()}>
          + Add
        </button>
      </Head>
      <div className="tx-flows">
        <span>
          <small className="label">In</small>
          <b className="pos">
            <Amt>{fmtAuto(total.in)}</Amt>
          </b>
        </span>
        <span>
          <small className="label">Out</small>
          <b>
            <Amt>{fmtAuto(total.out)}</Amt>
          </b>
        </span>
        <span className="tx-filters" role="group" aria-label="Show">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              className={k === filter ? 'on' : ''}
              onClick={() => {
                setFilter(k);
                setAll(false);
              }}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      {byDay(shown).map((d) => {
        // Hidden ones are listed (when shown) but not counted.
        const daySpent = flows(d.txs.filter((t) => !t.hidden)).out;
        return (
        <div key={d.date} className="tx-day">
          <div className="tx-day-head">
            <span>{fmtDate(d.date, now, true)}</span>
            {daySpent > 0 && (
              <small className="muted">
                <Amt>{fmtAuto(daySpent)}</Amt> spent
              </small>
            )}
          </div>
          <ul className="tx-list">
            {d.txs.map((t) => (
              <TxRow key={t.key} t={t} onOpen={edit} />
            ))}
          </ul>
        </div>
        );
      })}
      {hiddenCount > 0 && (
        <button className="money-more" onClick={() => setShowHidden(!showHidden)}>
          {showHidden ? 'Leave hidden ones out' : `Show ${hiddenCount} hidden`}
        </button>
      )}
      {!list.length && <p className="money-note">Nothing here in these two weeks.</p>}
      {list.length > FIRST && <MoreButton open={all} total={list.length} onClick={() => setAll(!all)} />}
      <p className="money-note">
        Tap a transaction to change it. Transfers between your own accounts and card bill payments aren't counted in or out.
        {tiny.length > 0 && ` ${tiny.length} credits under ₹1 (interest) not shown.`}
        {a.updated !== undefined && ` Updated ${fmtWhen(a.updated, now)}.`}
      </p>
    </section>
  );
}

// ---- Mutual funds ----

const FUND_COLORS: Record<string, string> = { equity: '#8b7cf6', debt: '#38bdf8', 'fixed income': '#38bdf8', hybrid: '#2dd4bf', commodity: '#fbbf24', other: '#64748b' };
const CAP_COLORS: Record<string, string> = { large: '#60a5fa', mid: '#a78bfa', small: '#f472b6', other: '#64748b' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function FundsPanel() {
  const f = useFinance();
  const snap = useSnapshot();
  const act = useActivity();
  const now = useNow(60_000);
  const [all, setAll] = useState(false);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const m = snap.funds;
  const value = f?.fundsValue ?? m?.value;
  if (!m && value === undefined) return null;
  const invested = f?.fundsInvested ?? m?.invested;
  const gain = f?.fundsGain ?? m?.gain ?? (value !== undefined && invested !== undefined ? value - invested : undefined);
  const gainPct = f?.fundsGainPct ?? m?.gainPct ?? (gain !== undefined && invested ? (gain / invested) * 100 : undefined);
  const holdings = m?.holdings ?? [];
  const shown = all ? holdings : holdings.slice(0, 8);
  const orders = groupFundOrders(act.funds).slice(0, 6);
  return (
    <section className="panel money-funds">
      <Head label="Mutual funds" summary={m?.count ? `${m.count} funds` : undefined} />
      <div className="inv-head">
        {value !== undefined && (
          <span className="inv-big">
            <Amt>{fmtInr(value)}</Amt>
          </span>
        )}
        <span className="inv-sub">
          {invested !== undefined && (
            <span className="muted">
              <Amt>{fmtInr(invested)}</Amt> put in
            </span>
          )}
          {gain !== undefined && (
            <span className={gain < 0 ? 'neg' : 'pos'}>
              <Amt>{fmtSigned(gain)}</Amt>
              {gainPct !== undefined && ` (${fmtPct(gainPct)})`}
            </span>
          )}
        </span>
      </div>
      {m && m.allocation.length > 0 && (
        <div className="money-sub">
          <span className="label">Asset mix</span>
          <StackBar money={false} parts={m.allocation.map(([k, v]) => [cap(k), v, FUND_COLORS[k.toLowerCase()] ?? '#64748b'])} />
        </div>
      )}
      {m && m.marketCap.length > 0 && (
        <div className="money-sub">
          <span className="label">Market cap</span>
          <StackBar money={false} parts={m.marketCap.map(([k, v]) => [cap(k), v, CAP_COLORS[k.toLowerCase()] ?? '#64748b'])} />
        </div>
      )}
      {m && m.categories.length > 0 && (
        <div className="money-sub">
          <span className="label">By category</span>
          <ul className="money-list">
            {m.categories.map((c) => (
              <li key={c.name}>
                <span>
                  <i className="dot" style={{ background: FUND_COLORS[c.name.toLowerCase()] ?? '#64748b' }} />
                  {c.name}
                  {c.schemes !== undefined && <small className="muted"> {c.schemes} fund{c.schemes === 1 ? '' : 's'}</small>}
                </span>
                <span className="ml-v">
                  <b>
                    <Amt>{fmtAuto(c.value)}</Amt>
                  </b>
                  {c.gainPct !== undefined && <small className={c.gainPct < 0 ? 'neg' : 'pos'}>{fmtPct(c.gainPct)}</small>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {holdings.length > 0 && (
        <div className="money-sub">
          <span className="label">Holdings</span>
          <ul className="money-list holdings">
            {shown.map((h) => (
              <li key={`${h.owner}${h.scheme}`}>
                <span className="hl-name">
                  <span>
                    {shortScheme(h.scheme)}
                    <OwnerTag owner={h.owner} />
                  </span>
                  <small className="muted">{[h.category, h.plan, h.risk].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="ml-v">
                  <b>
                    <Amt>{fmtAuto(h.value)}</Amt>
                  </b>
                  <small className={h.gain < 0 ? 'neg' : 'pos'}>{h.gainPct !== undefined ? fmtPct(h.gainPct) : <Amt>{fmtSigned(h.gain)}</Amt>}</small>
                </span>
              </li>
            ))}
          </ul>
          {holdings.length > 8 && <MoreButton open={all} total={holdings.length} onClick={() => setAll(!all)} />}
        </div>
      )}
      {m && m.sectors.length > 0 && (
        <div className="money-sub">
          <span className="label">Top sectors</span>
          <div className="sector-chips">
            {m.sectors.map(([n, p]) => (
              <span key={n}>
                {n} <b>{p.toFixed(0)}%</b>
              </span>
            ))}
          </div>
        </div>
      )}
      {orders.length > 0 && (
        <div className="money-sub">
          <span className="label">Recent orders</span>
          <ul className="money-list orders">
            {orders.map((o) => {
              const key = `${o.date}${o.type}`;
              const many = o.orders.length > 1;
              return (
                <li key={key} className="order">
                  <button className="order-row" onClick={() => many && setOpenOrder(openOrder === key ? null : key)} disabled={!many}>
                    <span>
                      <span className={`order-type ${o.type === 'SELL' ? 'sell' : ''}`}>{o.type === 'SELL' ? 'Sold' : 'Bought'}</span>
                      {many ? `${o.orders.length} funds` : shortScheme(o.orders[0].scheme)}
                      <small className="muted"> {fmtDate(o.date, now)}</small>
                    </span>
                    <b>
                      <Amt>{fmtInr(o.amount)}</Amt>
                    </b>
                  </button>
                  {openOrder === key && (
                    <ul className="order-items">
                      {o.orders.map((x, i) => (
                        <li key={i}>
                          <span>{shortScheme(x.scheme)}</span>
                          <Amt>{fmtInr(x.amount)}</Amt>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---- Stocks ----

export function StocksPanel() {
  const f = useFinance();
  const snap = useSnapshot();
  const act = useActivity();
  const now = useNow(60_000);
  const [openTrade, setOpenTrade] = useState<string | null>(null);
  const s = snap.stocks;
  const value = f?.stocks ?? s?.value;
  if (!s && value === undefined) return null;
  const holdings = s?.holdings ?? [];
  const max = Math.max(1, ...holdings.map((h) => h.value));
  const trades = groupTrades(act.stocks).slice(0, 6);
  return (
    <section className="panel money-stocks">
      <Head
        label="Stocks"
        summary={[holdings.length ? `${holdings.length} holdings` : '', s?.demat ? `${s.demat} demat` : ''].filter(Boolean).join(' · ') || undefined}
      />
      <div className="inv-head">
        {value !== undefined && (
          <span className="inv-big">
            <Amt>{fmtInr(value)}</Amt>
          </span>
        )}
        {s && (s.equity !== undefined || s.etf !== undefined) && (
          <span className="inv-sub muted">
            {s.equity !== undefined && (
              <span>
                Shares <Amt>{fmtAuto(s.equity)}</Amt>
              </span>
            )}
            {s.etf !== undefined && s.etf > 0 && (
              <span>
                ETFs <Amt>{fmtAuto(s.etf)}</Amt>
              </span>
            )}
          </span>
        )}
      </div>
      {holdings.length > 0 && (
        <ul className="money-list stock-list">
          {holdings.map((h) => (
            <li key={h.isin ?? h.name}>
              <span className="hl-name">
                <span>{tidyName(h.name)}</span>
                <small className="muted">
                  {h.units} × {h.price !== undefined ? fmtInr(h.price, 2) : '–'}
                </small>
              </span>
              <b>
                <Amt>{fmtAuto(h.value)}</Amt>
              </b>
              <span className="pass-bar" aria-hidden>
                <i style={{ width: `${(h.value / max) * 100}%`, background: SEG.stocks }} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {trades.length > 0 && (
        <div className="money-sub">
          <span className="label">Recent trades</span>
          <ul className="money-list orders">
            {trades.map((g) => {
              const key = `${g.date}${g.type}`;
              const many = g.trades.length > 1;
              return (
                <li key={key} className="order">
                  <button className="order-row" onClick={() => many && setOpenTrade(openTrade === key ? null : key)} disabled={!many}>
                    <span>
                      <span className={`order-type ${g.type === 'SELL' ? 'sell' : ''}`}>{g.type === 'SELL' ? 'Sold' : 'Bought'}</span>
                      {many ? `${g.trades.length} stocks` : `${g.trades[0].units} ${tidyName(g.trades[0].name)}`}
                      <small className="muted"> {fmtDate(g.date, now)}</small>
                    </span>
                    {g.amount > 0 && (
                      <b>
                        <Amt>{fmtInr(g.amount)}</Amt>
                      </b>
                    )}
                  </button>
                  {openTrade === key && (
                    <ul className="order-items">
                      {g.trades.map((x, i) => (
                        <li key={i}>
                          <span>
                            {x.units} × {tidyName(x.name)}
                          </span>
                          {x.amount > 0 ? <Amt>{fmtInr(x.amount)}</Amt> : <small className="muted">no cost</small>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---- EPF ----

const EPF_COLORS = ['#60a5fa', '#a78bfa', '#2dd4bf'];

export function EpfPanel() {
  const f = useFinance();
  const snap = useSnapshot();
  const act = useActivity();
  const now = useNow(60_000);
  const e = snap.epf;
  const total = f?.epf ?? e?.total;
  if (!e && total === undefined) return null;
  const months = epfMonths(act.epf, 12);
  const monthBars: Bar[] = months.map((m) => ({
    key: m.month,
    parts: [m.employee, m.employer, m.pension],
    label: `${fmtMonth(m.month, true)}: ${fmtInr(m.employee + m.employer + m.pension)}`,
  }));
  const years = e?.years.slice(-8) ?? [];
  const yearBars: Bar[] = years.map((y) => ({ key: y.fy, parts: [y.closing], label: `${y.fy}: ${fmtInr(y.closing)}` }));
  const withdrawals = act.epf.filter((t) => !t.credit);
  return (
    <section className="panel money-epf">
      <Head label="EPF" summary={e?.rate !== undefined ? `${e.rate}% interest${e.rateFy ? ` · ${e.rateFy}` : ''}` : undefined} />
      <div className="inv-head">
        {total !== undefined && (
          <span className="inv-big">
            <Amt>{fmtInr(total)}</Amt>
          </span>
        )}
      </div>
      {e && (e.employee !== undefined || e.employer !== undefined) && (
        <StackBar
          parts={[
            ['Your share', e.employee ?? 0, EPF_COLORS[0]],
            ["Employer's", e.employer ?? 0, EPF_COLORS[1]],
            ['Pension (EPS)', e.pension ?? 0, EPF_COLORS[2]],
          ]}
        />
      )}
      {monthBars.length > 1 && (
        <div className="money-sub">
          <span className="label">Monthly contributions</span>
          <BarChart
            bars={monthBars}
            colors={EPF_COLORS}
            height={76}
            caption={(b) => {
              const m = months.find((x) => x.month === b.key)!;
              return (
                <span className="spend-caption">
                  <b>{fmtMonth(m.month, true)}</b> · <Amt>{fmtInr(m.employee + m.employer + m.pension)}</Amt>
                  <span className="muted">
                    {' '}
                    (you <Amt>{fmtInr(m.employee)}</Amt>, employer <Amt>{fmtInr(m.employer)}</Amt>
                    {m.pension > 0 && (
                      <>
                        , pension <Amt>{fmtInr(m.pension)}</Amt>
                      </>
                    )}
                    )
                  </span>
                </span>
              );
            }}
          />
        </div>
      )}
      {yearBars.length > 1 && (
        <div className="money-sub">
          <span className="label">Balance by year</span>
          <BarChart
            bars={yearBars}
            colors={[EPF_COLORS[0]]}
            height={76}
            caption={(b) => {
              const y = years.find((x) => x.fy === b.key)!;
              return (
                <span className="spend-caption">
                  <b>{y.fy}</b> · closed at <Amt>{fmtAuto(y.closing)}</Amt>
                  <span className="muted">
                    {' · '}
                    <Amt>{fmtAuto(y.contributions)}</Amt> in, <Amt>{fmtAuto(y.interest)}</Amt> interest
                    {y.withdrawals > 0 && (
                      <>
                        , <Amt>{fmtAuto(y.withdrawals)}</Amt> withdrawn
                      </>
                    )}
                  </span>
                </span>
              );
            }}
          />
        </div>
      )}
      {withdrawals.length > 0 && (
        <div className="money-sub">
          <span className="label">Withdrawals</span>
          <ul className="money-list">
            {withdrawals.map((w) => (
              <li key={`${w.date}${w.amount}`}>
                <span>{fmtDate(w.date, now)}</span>
                <b>
                  <Amt>{fmtInr(w.amount)}</Amt>
                </b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {e && (
        <p className="money-note">
          {[
            e.employers > 0 && `${e.employers} employer${e.employers === 1 ? '' : 's'}`,
            e.currentSince && `this job since ${fmtMonth(e.currentSince.slice(0, 7), true)}`,
            e.refreshed !== undefined && `updated ${fmtWhen(e.refreshed, now)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </section>
  );
}

// ---- Insurance ----

function contactHref(kind: string, value: string): string | undefined {
  const k = kind.toLowerCase();
  if (k === 'phone') return `tel:${value.replace(/[^\d+]/g, '')}`;
  if (k === 'whatsapp') return `https://wa.me/${value.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`;
  if (k === 'email') return `mailto:${value}`;
  if (k === 'website' || /^https?:/.test(value)) return value;
  return undefined;
}

function PolicyView({ p, cover, renews }: { p: Policy; cover?: number; renews?: string }) {
  const now = useNow(60_000);
  const shownCover = cover ?? p.cover ?? p.sumInsured;
  const next = renews ?? p.nextPremium ?? p.end;
  const days = next ? daysUntil(next, now) : undefined;
  const facts: [string, ReactNode][] = [];
  if (p.coverType || p.type) facts.push(['Type', [p.coverType, p.type && cap(p.type)].filter(Boolean).join(' · ')]);
  if (p.insured.length)
    facts.push(['Covers', p.insured.map((x) => [x.relationship, x.age !== undefined && `(${x.age})`].filter(Boolean).join(' ')).join(', ')]);
  if (p.sumInsured !== undefined && shownCover !== undefined && p.sumInsured !== shownCover) facts.push(['Base cover', <Amt key="b">{fmtShort(p.sumInsured)}</Amt>]);
  if (p.premium !== undefined)
    facts.push([
      'Premium',
      <span key="p">
        <Amt>{fmtInr(p.premium)}</Amt>
        {p.termYears ? ` for ${p.termYears} year${p.termYears === 1 ? '' : 's'}` : ''}
      </span>,
    ]);
  if (p.start && p.end) facts.push(['Policy', `${fmtDate(p.start, now)} – ${fmtDate(p.end, now)}`]);
  if (p.roomRent) facts.push(['Room rent', p.roomRent]);
  if (p.restore) facts.push(['Restore', p.restore]);
  for (const [k, v] of p.waiting) facts.push([`Wait · ${k}`, v]);
  return (
    <div className="policy">
      <div className="policy-head">
        <span className="policy-name">
          <b>{p.plan ? `${p.name.split(' - ')[0]} ${p.plan}`.replace(/(.+?)\s+\1/, '$1') : p.name}</b>
          <small className="muted">
            {p.insurer}
            {p.grade && <span className="rating ok">{p.grade}</span>}
          </small>
        </span>
        {shownCover !== undefined && (
          <span className="policy-cover">
            <b>
              <Amt>{fmtShort(shownCover)}</Amt>
            </b>
            <small className="muted">cover</small>
          </span>
        )}
      </div>
      {next && days !== undefined && (
        <div className={`policy-renew ${days <= 30 ? 'warn' : ''}`}>
          Next premium {fmtDate(next, now)} · {days < 0 ? `${-days} days ago` : days === 0 ? 'today' : `in ${days} days`}
        </div>
      )}
      <dl className="money-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {p.addOns.length > 0 && (
        <div className="money-sub">
          <span className="label">Add-ons</span>
          <div className="sector-chips">
            {p.addOns.map((a) => (
              <span key={a.name}>
                {a.name}
                {a.sumInsured !== undefined && (
                  <b>
                    {' '}
                    <Amt>{fmtShort(a.sumInsured)}</Amt>
                  </b>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      {(p.pros.length > 0 || p.cons.length > 0) && (
        <div className="pros-cons">
          {p.pros.length > 0 && (
            <ul className="pros">
              {p.pros.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          {p.cons.length > 0 && (
            <ul className="cons">
              {p.cons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(p.contacts.length > 0 || p.claimUrl || p.hospitalsUrl) && (
        <div className="money-sub">
          <span className="label">Help and claims</span>
          <ul className="contacts">
            {p.contacts.map((c) => {
              const href = contactHref(c.kind, c.value);
              return (
                <li key={`${c.kind}${c.value}`}>
                  <small className="muted">{c.label}</small>
                  {href ? (
                    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                      {c.kind === 'website' ? c.value.replace(/^https?:\/\/(www\.)?/, '') : c.value}
                    </a>
                  ) : (
                    <span>{c.value}</span>
                  )}
                </li>
              );
            })}
            {p.claimUrl && (
              <li>
                <small className="muted">Claim status</small>
                <a href={p.claimUrl} target="_blank" rel="noreferrer">
                  Track a claim
                </a>
              </li>
            )}
            {p.hospitalsUrl && (
              <li>
                <small className="muted">Cashless hospitals</small>
                <a href={p.hospitalsUrl} target="_blank" rel="noreferrer">
                  Find one
                </a>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export function InsurancePanel() {
  const f = useFinance();
  const snap = useSnapshot();
  const policies = snap.policies;
  if (!policies.length && f?.healthCover === undefined) return null;
  return (
    <section className="panel money-insurance">
      <Head label="Insurance" summary={policies.length > 1 ? `${policies.length} policies` : undefined} />
      {policies.length ? (
        policies.map((p, i) => <PolicyView key={`${p.owner}${p.name}`} p={p} cover={i === 0 && p.type === 'health' ? f?.healthCover : undefined} renews={i === 0 ? f?.premiumDue : undefined} />)
      ) : (
        <div className="inv-head">
          <span className="inv-big">
            <Amt>{fmtShort(f!.healthCover!)}</Amt>
          </span>
          <span className="inv-sub muted">health cover{f?.premiumDue && ` · next premium ${fmtDate(f.premiumDue)}`}</span>
        </div>
      )}
    </section>
  );
}

// ---- Subcategories (inside Spending's by-category rows) ----

export function useMonthSubs(month: string): { subs: Map<string, { count?: number; subs: [string, number][] }>; untagged?: { amount: number; count?: number } } | undefined {
  const snap = useSnapshot();
  const s = snap.spending;
  if (!s || s.month !== month) return undefined;
  return { subs: new Map(s.categories.map((c) => [c.name, { count: c.count, subs: c.subs }])), untagged: s.untagged };
}

