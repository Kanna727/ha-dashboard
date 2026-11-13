import type { ReactNode } from 'react';
import { FINANCE } from '../config/entities';
import { useNow } from '../hooks/useNow';
import { daysUntil, dueLabel, fmtInr, fmtShort, monthSpend, netWorthRange } from '../lib/finance';
import { Amt } from './Amt';
import { withToday } from './MoneyCharts';
import { cardBackground, EyeButton, PersonSwitch, updated } from './MoneyPanels';
import { fmtPct } from './parts';
import { MONEY_SECTIONS, setMoneySection, useMoneySection, type MoneySection } from './sections';
import { useFinance } from './useFinance';
import { useMoneyHistory, useSnapshot } from './useMoneyHistory';
import { useSpendAdjust, useSpentThisMonth } from './useTxEdits';

// The Money page's landing view ("Tiles, then drill in", the owner's pick on
// 2026-11-08): a tile per section with its key number, a line under it and a
// small picture; tapping one opens the section's cards (sections.tsx). Inside a
// section, MoneyStrip switches sections or goes back to the tiles. A section
// with nothing to show has no tile. Amounts blur like the rest of the page, but
// a tap on a tile always opens it (Amt peek off).

const DAY = 86_400_000;
const COLOR: Record<MoneySection, string> = {
  overview: '#8b7cf6',
  spending: '#fbbf24',
  cards: '#f87171',
  invest: '#34d399',
  insurance: '#38bdf8',
};
// The investment parts, in the Investments card's colours.
const INVEST: [string, string][] = [
  ['EPF', '#38bdf8'],
  ['Mutual funds', '#8b7cf6'],
  ['Stocks', '#34d399'],
  ['Fixed deposits', '#fbbf24'],
  ['PPF', '#f472b6'],
  ['NPS', '#fb923c'],
];

interface Tile {
  id: MoneySection;
  value?: number;
  sub: ReactNode;
  art: ReactNode;
  warn?: boolean;
}

function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const W = 300;
  const H = 100;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const pad = (hi - lo) * 0.08 || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - lo + pad) / (hi - lo + 2 * pad)) * H;
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = points[points.length - 1] >= points[0];
  const c = up ? 'var(--ok)' : 'var(--danger)';
  return (
    <svg className="mt-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="mtSparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.3" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${W},${H} L0,${H} Z`} fill="url(#mtSparkFill)" />
      <path d={d} fill="none" stroke={c} strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Bars({ values, partialLast }: { values: number[]; partialLast: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <div className="mt-bars" aria-hidden>
      {values.map((v, i) => (
        <i key={i} className={partialLast && i === values.length - 1 ? 'partial' : ''} style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

// The investments donut with its key: each colour named, with its share.
function Donut({ parts }: { parts: [string, number, string][] }) {
  const sum = parts.reduce((s, [, v]) => s + v, 0) || 1;
  const r = 44;
  const len = 2 * Math.PI * r;
  let at = 0;
  return (
    <div className="mt-donut">
      <svg viewBox="0 0 120 120" aria-hidden>
        <circle cx="60" cy="60" r={r} className="dial-track" style={{ strokeWidth: 16 }} />
        {parts.map(([k, v, c]) => {
          const share = v / sum;
          const el = <circle key={k} cx="60" cy="60" r={r} fill="none" style={{ stroke: c, strokeWidth: 16 }} strokeDasharray={`${Math.max(0, len * share - 2)} ${len}`} strokeDashoffset={-len * at} transform="rotate(-90 60 60)" />;
          at += share;
          return el;
        })}
      </svg>
      <ul className="mt-key">
        {parts.map(([k, v, c]) => (
          <li key={k}>
            <i style={{ background: c }} />
            <span>{k}</span>
            <b>{Math.round((v / sum) * 100)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

const Shield = () => (
  <svg className="mt-shield" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5z" fill="currentColor" />
    <path d="M10.5 15.5 7.5 12.5l1.4-1.4 1.6 1.6 4.6-4.6 1.4 1.4z" fill="#10141d" />
  </svg>
);

function useTiles(): Tile[] {
  const f = useFinance();
  const h = useMoneyHistory();
  const snap = useSnapshot();
  const now = useNow(60_000);
  const spent = useSpentThisMonth();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const curAdj = useSpendAdjust(cur, FINANCE.skipCategories);
  if (!f) return [];
  const tiles: Tile[] = [];

  // Overview: net worth over the last six months.
  const r = netWorthRange(withToday(h, f.netWorth, now), 183, now.getTime() + DAY);
  const start = r.points[0]?.v;
  const pct = r.points.length > 1 && start ? (r.change / Math.abs(start)) * 100 : undefined;
  if (f.netWorth !== undefined || r.points.length > 1)
    tiles.push({
      id: 'overview',
      value: f.netWorth,
      sub: (
        <>
          Net worth
          {pct !== undefined && (
            <>
              {' · '}
              <span className={pct < 0 ? 'neg' : 'pos'}>{fmtPct(pct, 0)}</span> in 6 months
            </>
          )}
        </>
      ),
      art: <Spark points={r.points.map((p) => p.v)} />,
    });

  // Spending: this month, and the months before as bars.
  const months = h.months.slice(-12);
  if (spent !== undefined || months.length)
    tiles.push({
      id: 'spending',
      value: spent,
      sub: `Spent in ${now.toLocaleDateString('en-IN', { month: 'long' })} · day ${now.getDate()} of ${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`,
      art: months.length > 1 ? <Bars values={months.map((m) => monthSpend(m, FINANCE.skipCategories).total + (m.month === cur ? curAdj.total : 0))} partialLast={months[months.length - 1].month === cur} /> : null,
    });

  // Cards: what's owed, the next bill (orange) or how much of the limits is used.
  const cards = f.cards.filter((c) => !FINANCE.hideAccounts.includes(c.id));
  if (cards.length || f.cardsOutstanding !== undefined) {
    const days = f.bill?.due ? daysUntil(f.bill.due, now) : undefined;
    const soon = days !== undefined && days <= 7;
    const fan = [...cards].sort((a, b) => b.balance - a.balance).slice(0, 4);
    tiles.push({
      id: 'cards',
      value: f.cardsOutstanding ?? cards.reduce((s, c) => s + Math.max(0, c.balance), 0),
      warn: soon,
      sub: soon
        ? `${f.bill!.card} bill ${dueLabel(days!).toLowerCase()}`
        : f.cardsUtilization !== undefined
          ? `Owed · ${f.cardsUtilization.toFixed(1)}% of limits used`
          : f.cardsUnpaid === 0
            ? 'Owed · all card bills paid'
            : 'Owed on cards',
      art: (
        <div className="mt-fan" aria-hidden>
          {fan.map((c, i) => (
            <i key={c.id} style={{ background: cardBackground(c), left: `${i * 15}%`, bottom: `${i * 5}px`, transform: `rotate(${-8 + i * 5}deg)`, opacity: c.balance > 0 ? 1 : 0.55 }} />
          ))}
        </div>
      ),
    });
  }

  // Investments: the total and its parts, the donut with a key.
  const vals: Record<string, number | undefined> = { EPF: f.epf, 'Mutual funds': f.fundsValue, Stocks: f.stocks, 'Fixed deposits': f.fds, PPF: f.ppf, NPS: f.nps };
  const parts = INVEST.map(([k, c]) => [k, vals[k] ?? 0, c] as [string, number, string]).filter(([, v]) => v > 0);
  if (f.investments !== undefined || parts.length) {
    const gain = f.fundsGainPct ?? (f.fundsValue !== undefined && f.fundsInvested ? ((f.fundsValue - f.fundsInvested) / f.fundsInvested) * 100 : undefined);
    tiles.push({
      id: 'invest',
      value: f.investments ?? parts.reduce((s, [, v]) => s + v, 0),
      sub: (
        <>
          Invested
          {gain !== undefined && (
            <>
              {' · funds '}
              <span className={gain < 0 ? 'neg' : 'pos'}>{fmtPct(gain)}</span>
            </>
          )}
        </>
      ),
      art: parts.length ? <Donut parts={parts} /> : null,
    });
  }

  // Insurance: the health cover and the next premium.
  const policy = snap.policies[0];
  const cover = f.healthCover ?? policy?.cover ?? policy?.sumInsured;
  if (cover !== undefined || policy) {
    const next = f.premiumDue ?? policy?.nextPremium;
    const d = next ? daysUntil(next, now) : undefined;
    const when =
      next && d !== undefined
        ? d < 0
          ? 'premium overdue'
          : d <= 60
            ? `next premium in ${d} day${d === 1 ? '' : 's'}`
            : `next premium ${new Date(`${next}T00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
        : undefined;
    tiles.push({ id: 'insurance', value: cover, warn: d !== undefined && d <= 30, sub: ['Health cover', when].filter(Boolean).join(' · '), art: <Shield /> });
  }
  return tiles;
}

const nameOf = (id: MoneySection) => MONEY_SECTIONS.find((s) => s.id === id)!.label;
const big = (v: number) => (Math.abs(v) < 1e5 ? fmtInr(v) : fmtShort(v));

export function MoneyTiles() {
  const tiles = useTiles();
  const f = useFinance();
  const now = useNow(60_000);
  const up = updated(f?.changedAt ?? f?.asOf, now.getTime());
  return (
    <>
    <div className="money-tiles-bar">
      <h2 className="label">Money</h2>
      {up && <span className={`panel-summary ${up.stale ? 'warn' : ''}`}>{up.text}</span>}
      <PersonSwitch />
      <EyeButton />
    </div>
    <div className={`money-tiles n${tiles.length}`}>
      {tiles.map((t) => (
        <button key={t.id} className={`mt-tile mt-${t.id}`} style={{ ['--c' as string]: COLOR[t.id] }} onClick={() => setMoneySection(t.id)} aria-label={`Open ${nameOf(t.id)}`}>
          <span className="mt-go" aria-hidden>
            ›
          </span>
          <span className="label">{nameOf(t.id)}</span>
          {t.value !== undefined && (
            <b className="mt-value">
              <Amt peek={false}>{big(t.value)}</Amt>
            </b>
          )}
          <small className={`mt-sub ${t.warn ? 'warn' : ''}`}>{t.sub}</small>
          {t.art && <div className="mt-art">{t.art}</div>}
        </button>
      ))}
    </div>
    </>
  );
}

// Inside a section: back to the tiles, and a small tile per section to switch.
export function MoneyStrip() {
  const tiles = useTiles();
  const section = useMoneySection();
  return (
    <nav className="money-strip" aria-label="Money sections">
      <button className="ms-back" onClick={() => setMoneySection(null)}>
        ‹ Money
      </button>
      {tiles.map((t) => (
        <button
          key={t.id}
          className={`ms-tile ${t.id === section ? 'on' : ''}`}
          style={{ ['--c' as string]: COLOR[t.id] }}
          onClick={() => setMoneySection(t.id)}
          aria-current={t.id === section ? 'page' : undefined}
        >
          <span className="label">{nameOf(t.id)}</span>
          {t.value !== undefined && (
            <b>
              <Amt peek={false}>{fmtShort(t.value)}</Amt>
            </b>
          )}
        </button>
      ))}
      <span className="ms-eye">
        <PersonSwitch />
        <EyeButton />
      </span>
    </nav>
  );
}
