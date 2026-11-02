import type { ReactNode } from 'react';
import { FINANCE } from '../config/entities';
import { GlanceTile } from '../components/GlanceTile';
import { Icon } from '../components/Icon';
import { useNow } from '../hooks/useNow';
import { bankColor, daysUntil, dueLabel, fmtInr, fmtShort, isBillCard, scoreBand, type Account, type Finance } from '../lib/finance';
import { Amt } from './Amt';
import { ComingUp, SpendingCharts } from './MoneyCharts';
import { toggleAmounts, useAmountsHidden } from './privacy';
import { useFinance } from './useFinance';

// The Money page, "Wallet" design (the owner picked it on 2026-11-03 over a
// balance sheet, glance tiles and an own-vs-owe chart): a summary strip, every
// credit card drawn as a card, the bank accounts as a passbook, and beside them
// the next bill, credit scores, investments and this month's spending.
// Data: lib/finance.ts (found by name); amounts blur on the wall screens (privacy.ts).

// Under a lakh in full (₹84,250), above that short (₹4.13 L).
const fmtAuto = (n: number) => (Math.abs(n) < 1e5 ? fmtInr(n) : fmtShort(n));
const MONTH = (d: Date) => d.toLocaleDateString('en-IN', { month: 'short' });
const dueDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
};

function updated(asOf: number | undefined, now: number): { text: string; stale: boolean } | undefined {
  if (asOf === undefined) return undefined;
  const h = Math.max(0, (now - asOf) / 3_600_000);
  const text = h < 1 ? 'Updated just now' : h < 24 ? `Updated ${Math.round(h)}h ago` : `Updated ${Math.round(h / 24)}d ago`;
  return { text, stale: h >= 24 };
}

function Head({ label, summary, warn, children }: { label: string; summary?: ReactNode; warn?: boolean; children?: ReactNode }) {
  return (
    <header className="panel-head">
      <h2 className="label">{label}</h2>
      {summary !== undefined && <span className={`panel-summary ${warn ? 'warn' : ''}`}>{summary}</span>}
      {children}
    </header>
  );
}

function EyeButton() {
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
  if (!f) return null;
  const up = updated(f.asOf, now.getTime());
  const cash = f.liquid ?? f.bankTotal;
  const stats: [string, number | undefined][] = [
    ['Net worth', f.netWorth],
    ['Cash', cash],
    ['Invested', f.investments],
    ['Owed', f.debt],
    [`Spent · ${MONTH(now)}`, f.spentThisMonth],
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
    </section>
  );
}

function cardBackground(c: Account) {
  const [a, b] = FINANCE.cardColors[c.name] ?? [bankColor(c.bank), `color-mix(in srgb, ${bankColor(c.bank)} 38%, #0b0f17)`];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function WalletCard({ card, bill }: { card: Account; bill: Finance['bill'] }) {
  const due = bill?.due && isBillCard(card, bill) ? dueDay(bill.due) : undefined;
  return (
    <div className={`wcard ${card.balance === 0 ? 'paid' : ''}`} style={{ background: cardBackground(card) }}>
      {due && <span className="wcard-due">Due {due.getDate()} {MONTH(due)}</span>}
      <span className="wcard-bank">{card.bank}</span>
      <span className="wcard-prod">{card.product || ' '}</span>
      <span className="wcard-chip" aria-hidden />
      <span className="wcard-owed">
        {card.balance === 0 ? 'Nothing owed' : card.balance < 0 ? <Amt>{fmtInr(-card.balance)} credit</Amt> : <Amt>{fmtInr(card.balance)}</Amt>}
      </span>
      {card.last4 && <span className="wcard-num">•••• {card.last4}</span>}
    </div>
  );
}

export function CardsPanel() {
  const f = useFinance();
  if (!f?.cards.length) return null;
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
        {f.cards.map((c) => (
          <WalletCard key={c.id} card={c} bill={f.bill} />
        ))}
      </div>
    </section>
  );
}

export function PassbookPanel() {
  const f = useFinance();
  if (!f?.banks.length) return null;
  const total = f.bankTotal ?? f.banks.reduce((s, b) => s + b.balance, 0);
  const max = Math.max(1, ...f.banks.map((b) => Math.abs(b.balance)));
  return (
    <section className="panel money-passbook">
      <Head
        label="Passbook"
        summary={
          <>
            <Amt>{fmtInr(total)}</Amt> across {f.banks.length}
          </>
        }
      />
      <ul className="passbook">
        {f.banks.map((b) => (
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

export function BillPanel() {
  const f = useFinance();
  const now = useNow(60_000);
  const bill = f?.bill;
  if (!bill) return null;
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
    </section>
  );
}

const TONE_COLOR = { ok: 'var(--ok)', fair: 'var(--accent-light)', warn: 'var(--warn)', bad: 'var(--danger)' };

function Dial({ score, bureau }: { score: number; bureau: string }) {
  const band = scoreBand(score);
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
    </section>
  );
}

export function InvestmentsPanel() {
  const f = useFinance();
  if (!f || (f.investments === undefined && f.epf === undefined && f.fundsValue === undefined && f.stocks === undefined)) return null;
  const parts = (
    [
      ['EPF', f.epf, '#38bdf8'],
      ['Mutual funds', f.fundsValue, '#8b7cf6'],
      ['Stocks', f.stocks, '#34d399'],
    ] as const
  ).filter(([, v]) => v !== undefined && v > 0) as [string, number, string][];
  const total = f.investments ?? parts.reduce((s, [, v]) => s + v, 0);
  const sum = parts.reduce((s, [, v]) => s + v, 0) || 1;
  const r = 44;
  const len = 2 * Math.PI * r;
  let at = 0;
  const gain = f.fundsValue !== undefined && f.fundsInvested ? f.fundsValue - f.fundsInvested : undefined;
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
          {gain !== undefined && (
            <div>
              <dt>Fund return</dt>
              <dd className={gain < 0 ? 'neg' : 'pos'}>
                {gain < 0 ? '−' : '+'}
                {Math.abs((gain / f.fundsInvested!) * 100).toFixed(2)}%
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
    </section>
  );
}

export function SpendPanel() {
  const f = useFinance();
  const now = useNow(60_000);
  if (!f || (f.spentThisMonth === undefined && !f.lastTransaction)) return null;
  const day = now.getDate();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const month = now.toLocaleDateString('en-IN', { month: 'long' });
  const tx = f.lastTransaction;
  return (
    <section className="panel money-spend">
      <Head label={`Spent in ${month}`} summary={`day ${day} of ${days}`} />
      {f.spentThisMonth !== undefined && (
        <>
          <div className="spend-big">
            <Amt>{fmtInr(f.spentThisMonth)}</Amt>
          </div>
          <div className="muted spend-rate">
            ≈ <Amt>{fmtShort(f.spentThisMonth / day)}</Amt> a day so far
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
      {soon && f.spentThisMonth !== undefined && (
        <span>
          <small>Spent · {MONTH(now)}</small>
          <b>
            <Amt peek={false}>{fmtShort(f.spentThisMonth)}</Amt>
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
  if (f.spentThisMonth === undefined && f.netWorth === undefined) return null;
  return (
    <GlanceTile
      icon="wallet"
      label={`Spent · ${MONTH(now)}`}
      value={f.spentThisMonth !== undefined ? <Amt peek={false}>{fmtShort(f.spentThisMonth)}</Amt> : undefined}
      sub={bill?.due && days !== undefined ? `Next card bill ${dueLabel(days).toLowerCase()}` : undefined}
      art={side}
      color="var(--accent-light)"
      page="money"
      span="all"
    />
  );
}
