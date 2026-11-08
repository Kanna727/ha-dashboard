import { FINANCE } from '../config/entities';
import { GlanceTile } from '../components/GlanceTile';
import { Icon } from '../components/Icon';
import { useNow } from '../hooks/useNow';
import { bankColor, daysUntil, dueLabel, fmtAgo, fmtInr, fmtWhen, fmtShort, isBillCard, scoreBand, type Account, type Finance } from '../lib/finance';
import { Amt } from './Amt';
import { ComingUp, SpendingCharts } from './MoneyCharts';
import { CardLimits, RecurringList, ScoreDetails, useBureauRank, useCardUse } from './MoneyDetails';
import { fmtAuto, Head } from './parts';
import { toggleAmounts, useAmountsHidden } from './privacy';
import { useFinance } from './useFinance';
import { useSpentThisMonth } from './useTxEdits';

// The Money page, "Wallet" design (the owner picked it on 2026-11-03 over a
// balance sheet, glance tiles and an own-vs-owe chart): a summary strip, every
// credit card drawn as a card, the bank accounts as a passbook, and beside them
// the next bill, credit scores, investments and this month's spending.
// Data: lib/finance.ts (found by name); amounts blur on the wall screens (privacy.ts).

const MONTH = (d: Date) => d.toLocaleDateString('en-IN', { month: 'short' });
const dueDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// "Updated" is when any number last changed (the sync writes only changes);
// orange once nothing has moved for a day. The money app's own "as of" is only
// when it last fetched the bank balances, hours behind (the owner found
// "Updated 11h ago" misleading while the sync ran every hour).
export function updated(at: number | undefined, now: number): { text: string; stale: boolean } | undefined {
  if (at === undefined) return undefined;
  return { text: `Updated ${fmtAgo(at, now)}`, stale: now - at >= 86_400_000 };
}

// Shows or hides the amounts (privacy.ts). On the summary card, the tiles and
// the section strip, so it is always on screen on the Money page.
export function EyeButton() {
  const hidden = useAmountsHidden();
  return (
    <button className="round small chevron money-eye" onClick={toggleAmounts} aria-label={hidden ? 'Show amounts' : 'Hide amounts'} title={hidden ? 'Show amounts' : 'Hide amounts'}>
      <Icon name={hidden ? 'eye' : 'eyeOff'} size={20} />
    </button>
  );
}

export function MoneySummary() {
  const f = useFinance();
  const now = useNow(60_000);
  const spent = useSpentThisMonth();
  if (!f) return null;
  const up = updated(f.changedAt ?? f.asOf, now.getTime());
  const cash = f.liquid ?? f.bankTotal;
  const stats: [string, number | undefined][] = [
    ['Net worth', f.netWorth],
    ['Cash', cash],
    ['Invested', f.investments],
    ['Owed', f.debt],
    [`Spent · ${MONTH(now)}`, spent],
  ];
  return (
    <section className="panel money-summary">
      <Head label="Money" summary={up?.text} warn={up?.stale}>
        <EyeButton />
      </Head>
      <div className="money-stats">
        {stats
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => (
            <div key={k} className="money-stat">
              <span className="label">{k}</span>
              <span className={`money-stat-v ${v! < 0 ? 'neg' : ''}`}>
                <Amt>{fmtAuto(v!)}</Amt>
              </span>
            </div>
          ))}
      </div>
      {((f.asOf !== undefined && f.changedAt !== undefined) || f.snapshotAt !== undefined) && (
        <p className="money-asof">
          {[f.asOf !== undefined && f.changedAt !== undefined && `Bank balances as of ${fmtWhen(f.asOf, now)}`, f.snapshotAt !== undefined && `details from ${fmtWhen(f.snapshotAt, now)}`]
            .filter(Boolean)
            .join(' · ')
            .replace(/^d/, 'D')}
        </p>
      )}
    </section>
  );
}

export function cardBackground(c: Account) {
  const [a, b] = FINANCE.cardColors[c.name] ?? [bankColor(c.bank), `color-mix(in srgb, ${bankColor(c.bank)} 38%, #0b0f17)`];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function WalletCard({ card, bill }: { card: Account; bill: Finance['bill'] }) {
  const due = bill?.due && isBillCard(card, bill) ? dueDay(bill.due) : undefined;
  const use = useCardUse(card);
  return (
    <div className={`wcard ${card.balance === 0 ? 'paid' : ''} ${due ? 'due' : ''}`} style={{ background: cardBackground(card) }}>
      {due && <span className="wcard-due">Due {due.getDate()} {MONTH(due)}</span>}
      <span className="wcard-bank">{card.bank}</span>
      <span className="wcard-prod">{card.product || ' '}</span>
      {!due && <span className="wcard-chip" aria-hidden />}
      <span className="wcard-owed">
        {card.balance === 0 ? 'Nothing owed' : card.balance < 0 ? <Amt>{fmtInr(-card.balance)} credit</Amt> : <Amt>{fmtInr(card.balance)}</Amt>}
      </span>
      {card.last4 && <span className="wcard-num">•••• {card.last4}</span>}
      {use !== undefined && (
        <span className="wcard-use" title={`${use.toFixed(0)}% of the limit used`} aria-hidden>
          <i style={{ width: `${Math.max(use, 1)}%` }} />
        </span>
      )}
    </div>
  );
}

export function CardsPanel() {
  const f = useFinance();
  const cards = f?.cards.filter((c) => !FINANCE.hideAccounts.includes(c.id)) ?? [];
  if (!f || !cards.length) return null;
  const owed = f.cardsOutstanding ?? f.cards.reduce((s, c) => s + Math.max(0, c.balance), 0);
  return (
    <section className="panel money-cards">
      <Head
        label="Credit cards"
        summary={
          <>
            <Amt>{fmtInr(owed)}</Amt>
            {f.cardsUnpaid !== undefined && (
              <>
                {' · '}
                <Amt>{fmtInr(f.cardsUnpaid)}</Amt> billed
              </>
            )}
          </>
        }
      />
      <div className="wallet-cards">
        {cards.map((c) => (
          <WalletCard key={c.id} card={c} bill={f.bill} />
        ))}
      </div>
      <CardLimits cards={cards} />
    </section>
  );
}

export function PassbookPanel() {
  const f = useFinance();
  const banks = f?.banks.filter((b) => !FINANCE.hideAccounts.includes(b.id)) ?? [];
  if (!banks.length) return null;
  // With accounts hidden, the total is of the ones shown.
  const total = banks.length === f!.banks.length && f!.bankTotal !== undefined ? f!.bankTotal : banks.reduce((s, b) => s + b.balance, 0);
  const max = Math.max(1, ...banks.map((b) => Math.abs(b.balance)));
  return (
    <section className="panel money-passbook">
      <Head
        label="Passbook"
        summary={
          <>
            <Amt>{fmtInr(total)}</Amt> across {banks.length}
          </>
        }
      />
      <ul className="passbook">
        {banks.map((b) => (
          <li key={b.id} className={`pass-row ${b.balance === 0 ? 'zero' : ''}`}>
            <span className="pass-dot" style={{ background: bankColor(b.bank) }} />
            <span className="pass-name">
              {b.name}
              {b.last4 && <small>••{b.last4}</small>}
              {b.balance < 0 && <span className="money-chip bad">Overdrawn</span>}
            </span>
            <span className={`pass-v ${b.balance < 0 ? 'neg' : ''}`}>
              <Amt>{fmtInr(b.balance)}</Amt>
            </span>
            <span className="pass-bar" aria-hidden>
              <i style={{ width: `${(Math.abs(b.balance) / max) * 100}%`, background: b.balance < 0 ? 'var(--danger)' : bankColor(b.bank) }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// With no unpaid bill it stays as "Bills": all paid, what's coming up and the
// recurring payments (it used to vanish, taking Coming up with it).
export function BillPanel() {
  const f = useFinance();
  const now = useNow(60_000);
  const bill = f?.bill;
  if (!f) return null;
  if (!bill)
    return (
      <section className="panel money-bill">
        <Head label="Bills" summary={f.cardsUnpaid === 0 ? 'All card bills paid' : undefined} />
        {f.cardsOutstanding !== undefined && (
          <dl className="money-well">
            <dt>Card balances incl. unbilled</dt>
            <dd>
              <Amt>{fmtInr(f.cardsOutstanding)}</Amt>
            </dd>
          </dl>
        )}
        <ComingUp />
        <RecurringList />
      </section>
    );
  const days = bill.due ? daysUntil(bill.due, now) : undefined;
  const tone = days === undefined ? '' : days < 0 ? 'bad' : days <= 3 ? 'warn' : '';
  const date = bill.due ? dueDay(bill.due).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : undefined;
  return (
    <section className={`panel money-bill ${tone}`}>
      <Head label="Next card bill" summary={days !== undefined ? dueLabel(days) : undefined} warn={!!tone} />
      <div className="bill-main">
        <div className="bill-what">
          {bill.amount !== undefined && (
            <span className="bill-amount">
              <Amt>{fmtInr(bill.amount, 2)}</Amt>
            </span>
          )}
          <span className="muted">{[bill.card, date].filter(Boolean).join(' · ')}</span>
        </div>
        {days !== undefined && (
          <div className={`bill-days ${tone}`}>
            <span>{Math.abs(days)}</span>
            <small>{days < 0 ? 'days late' : days === 1 ? 'day left' : 'days left'}</small>
          </div>
        )}
      </div>
      {(f.cardsUnpaid !== undefined || f.cardsOutstanding !== undefined) && (
        <dl className="money-well">
          {f.cardsUnpaid !== undefined && (
            <>
              <dt>All unpaid card bills</dt>
              <dd>
                <Amt>{fmtInr(f.cardsUnpaid)}</Amt>
              </dd>
            </>
          )}
          {f.cardsOutstanding !== undefined && (
            <>
              <dt>Card balances incl. unbilled</dt>
              <dd>
                <Amt>{fmtInr(f.cardsOutstanding)}</Amt>
              </dd>
            </>
          )}
        </dl>
      )}
      <ComingUp />
      <RecurringList />
    </section>
  );
}

const TONE_COLOR = { ok: 'var(--ok)', fair: 'var(--accent-light)', warn: 'var(--warn)', bad: 'var(--danger)' };

function Dial({ score, bureau }: { score: number; bureau: string }) {
  const band = scoreBand(score);
  const rank = useBureauRank(bureau);
  const color = TONE_COLOR[band.tone];
  const r = 50;
  const len = 2 * Math.PI * r * 0.75; // a 270° arc
  const frac = Math.max(0, Math.min(1, (score - 300) / 600));
  return (
    <div className="score-dial">
      <svg viewBox="0 0 120 120" aria-hidden>
        <circle cx="60" cy="60" r={r} className="dial-track" strokeDasharray={`${len} 999`} transform="rotate(135 60 60)" />
        <circle cx="60" cy="60" r={r} className="dial-arc" style={{ stroke: color }} strokeDasharray={`${len * frac} 999`} transform="rotate(135 60 60)" />
      </svg>
      <span className="dial-text">
        <b>
          <Amt>{score}</Amt>
        </b>
        <small style={{ color }}>{band.label}</small>
      </span>
      <span className="dial-name">{bureau}</span>
      {rank && <small className="dial-rank muted">{rank}</small>}
    </div>
  );
}

export function ScoresPanel() {
  const f = useFinance();
  if (!f?.scores.length) return null;
  return (
    <section className="panel money-scores">
      <Head label="Credit score" />
      <div className="score-dials">
        {f.scores.map((s) => (
          <Dial key={s.id} score={s.score} bureau={s.bureau} />
        ))}
      </div>
      <ScoreDetails />
    </section>
  );
}

export function InvestmentsPanel() {
  const f = useFinance();
  if (!f || (f.investments === undefined && f.epf === undefined && f.fundsValue === undefined && f.stocks === undefined)) return null;
  const all = [
    ['EPF', f.epf, '#38bdf8'],
    ['Mutual funds', f.fundsValue, '#8b7cf6'],
    ['Stocks', f.stocks, '#34d399'],
    ['Fixed deposits', f.fds, '#fbbf24'],
    ['PPF', f.ppf, '#f472b6'],
    ['NPS', f.nps, '#fb923c'],
  ] as const;
  const parts = all.filter(([, v]) => v !== undefined && v > 0) as unknown as [string, number, string][];
  const none = all.filter(([, v]) => v === 0).map(([k]) => k);
  const total = f.investments ?? parts.reduce((s, [, v]) => s + v, 0);
  const sum = parts.reduce((s, [, v]) => s + v, 0) || 1;
  const r = 44;
  const len = 2 * Math.PI * r;
  let at = 0;
  const gain = f.fundsGain ?? (f.fundsValue !== undefined && f.fundsInvested ? f.fundsValue - f.fundsInvested : undefined);
  const gainPct = f.fundsGainPct ?? (gain !== undefined && f.fundsInvested ? (gain / f.fundsInvested) * 100 : undefined);
  return (
    <section className="panel money-invest">
      <Head label="Investments" />
      <div className="invest-body">
        <div className="invest-donut">
          <svg viewBox="0 0 120 120" aria-hidden>
            <circle cx="60" cy="60" r={r} className="dial-track" />
            {parts.map(([k, v, c]) => {
              const share = v / sum;
              const el = <circle key={k} cx="60" cy="60" r={r} className="donut-part" style={{ stroke: c }} strokeDasharray={`${Math.max(0, len * share - 2)} ${len}`} strokeDashoffset={-len * at} transform="rotate(-90 60 60)" />;
              at += share;
              return el;
            })}
          </svg>
          <span className="dial-text">
            <small className="muted">Invested</small>
            <b>
              <Amt>{fmtShort(total)}</Amt>
            </b>
          </span>
        </div>
        <dl className="invest-rows">
          {parts.map(([k, v, c]) => (
            <div key={k}>
              <dt>
                <i style={{ background: c }} />
                {k}
              </dt>
              <dd>
                <Amt>{fmtAuto(v)}</Amt>
              </dd>
            </div>
          ))}
          {gainPct !== undefined && (
            <div>
              <dt>Fund return</dt>
              <dd className={gainPct < 0 ? 'neg' : 'pos'}>
                {gainPct < 0 ? '−' : '+'}
                {Math.abs(gainPct).toFixed(2)}%
                {gain !== undefined && (
                  <small>
                    {' '}
                    <Amt>{fmtAuto(Math.abs(gain))}</Amt>
                  </small>
                )}
              </dd>
            </div>
          )}
        </dl>
      </div>
      {f.loans !== undefined && (
        <dl className="money-well">
          <dt>Loans</dt>
          <dd>
            <Amt>{fmtInr(f.loans)}</Amt>
          </dd>
        </dl>
      )}
      {none.length > 0 && <p className="money-note">Nothing in: {none.join(' · ')}</p>}
    </section>
  );
}

export function SpendPanel() {
  const f = useFinance();
  const now = useNow(60_000);
  const spent = useSpentThisMonth();
  if (!f || (f.spentThisMonth === undefined && !f.lastTransaction)) return null;
  const day = now.getDate();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const month = now.toLocaleDateString('en-IN', { month: 'long' });
  const tx = f.lastTransaction;
  return (
    <section className="panel money-spend">
      <Head label={`Spent in ${month}`} summary={`day ${day} of ${days}`} />
      {spent !== undefined && (
        <>
          <div className="spend-big">
            <Amt>{fmtInr(spent)}</Amt>
          </div>
          <div className="muted spend-rate">
            ≈ <Amt>{fmtShort(spent / day)}</Amt> a day so far
          </div>
          <div className="spend-month" aria-hidden>
            <i style={{ width: `${(day / days) * 100}%` }} />
          </div>
        </>
      )}
      <SpendingCharts />
      {tx && (
        <div className="money-tx">
          <span className="label">Last transaction</span>
          <div className="money-tx-row">
            <span className="money-tx-who">
              <b>{tx.merchant}</b>
              <small className="muted">{[tx.category, tx.account].filter(Boolean).join(' · ')}</small>
            </span>
            {tx.amount !== undefined && (
              <span className={`money-tx-amt ${tx.amount > 0 ? 'pos' : ''}`}>
                <Amt>{tx.amount > 0 ? `+${fmtInr(tx.amount, 2)}` : fmtInr(tx.amount, 2)}</Amt>
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// Home's "At a glance" tile, a whole row: the days to the next card bill when
// one is due within a week (orange from 3 days, red when late), else this
// month's spending; net worth beside it.
export function MoneyTile() {
  const f = useFinance();
  const now = useNow(60_000);
  const spent = useSpentThisMonth();
  if (!f) return null;
  const bill = f.bill;
  const days = bill?.due ? daysUntil(bill.due, now) : undefined;
  const soon = days !== undefined && days <= 7;
  const tone = soon ? (days! < 0 ? 'bad' : days! <= 3 ? 'warn' : undefined) : undefined;
  const side = (
    <span className="money-tile-side">
      {f.netWorth !== undefined && (
        <span>
          <small>Net worth</small>
          <b className={f.netWorth < 0 ? 'neg' : ''}>
            <Amt peek={false}>{fmtShort(f.netWorth)}</Amt>
          </b>
        </span>
      )}
      {soon && spent !== undefined && (
        <span>
          <small>Spent · {MONTH(now)}</small>
          <b>
            <Amt peek={false}>{fmtShort(spent)}</Amt>
          </b>
        </span>
      )}
    </span>
  );
  if (soon)
    return (
      <GlanceTile
        icon="creditCard"
        label="Card bill"
        value={days! < 0 ? `${-days!}d late` : days === 0 ? 'Today' : `${days}d`}
        sub={
          <>
            {bill!.card}
            {bill!.amount !== undefined && (
              <>
                {' · '}
                <Amt peek={false}>{fmtInr(bill!.amount)}</Amt>
              </>
            )}
          </>
        }
        art={side}
        tone={tone}
        color="var(--warn)"
        page="money"
        span="all"
      />
    );
  if (spent === undefined && f.netWorth === undefined) return null;
  return (
    <GlanceTile
      icon="wallet"
      label={`Spent · ${MONTH(now)}`}
      value={spent !== undefined ? <Amt peek={false}>{fmtShort(spent)}</Amt> : undefined}
      sub={bill?.due && days !== undefined ? `Next card bill ${dueLabel(days).toLowerCase()}` : undefined}
      art={side}
      color="var(--accent-light)"
      page="money"
      span="all"
    />
  );
}
