import { useId, useState, type PointerEvent } from 'react';
import { FINANCE } from '../config/entities';
import { BarChart, type Bar } from '../components/BarChart';
import { useNow } from '../hooks/useNow';
import { daysUntil, rowColors, fmtInr, fmtShort, monthSpend, netWorthRange, type MoneyHistory } from '../lib/finance';
import { Amt } from './Amt';
import { useFinance } from './useFinance';
import { useMoneyHistory } from './useMoneyHistory';

// The Money page's charts, from the sync's daily chart data (useMoneyHistory):
// net worth over time, spending per month and by category, and what's coming up.
// Each leaves itself out until the data is there.

const RANGES: [string, number][] = [
  ['3M', 92],
  ['6M', 183],
  ['1Y', 366],
];
const DAY = 86_400_000;
const fmtDay = (t: number) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const monthLabel = (m: string, style: 'short' | 'long' = 'short') => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: style, ...(style === 'long' ? { year: 'numeric' } : {}) });
};
const thisMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// The history's daily points, ending with today's live value from the helper.
function withToday(h: MoneyHistory, live: number | undefined, now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const pts = h.netWorth.filter((p) => p.t < today);
  return live === undefined ? h.netWorth : [...pts, { t: today, v: live }];
}

function NetWorthChart({ points, picked, onPick }: { points: { t: number; v: number }[]; picked: number | null; onPick: (i: number | null) => void }) {
  const fillId = `nw${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const W = 600;
  const H = 170;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  let lo = Math.min(...points.map((p) => p.v));
  let hi = Math.max(...points.map((p) => p.v));
  const pad = Math.max((hi - lo) * 0.08, 1);
  lo -= pad;
  hi += pad;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const up = points[points.length - 1].v >= points[0].v;
  const color = up ? 'var(--ok)' : 'var(--danger)';
  // Month starts as ticks, at most six.
  const ticks: number[] = [];
  const d = new Date(t0);
  for (let m = new Date(d.getFullYear(), d.getMonth() + 1, 1); m.getTime() <= t1; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) ticks.push(m.getTime());
  const step = Math.ceil(ticks.length / 6);
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.t - t) < Math.abs(points[best].t - t)) best = i;
    });
    onPick(best);
  };
  const p = picked !== null ? points[picked] : undefined;
  return (
    <div className="nw-chart" onPointerDown={pick} onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons) && pick(e)} onPointerLeave={(e) => e.pointerType === 'mouse' && onPick(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {lo < 0 && hi > 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="nw-zero" vectorEffect="non-scaling-stroke" />}
        <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${fillId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {p && <line x1={x(p.t)} x2={x(p.t)} y1="0" y2={H} className="nw-cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
      {p && <span className="nw-dot" style={{ left: `${(x(p.t) / W) * 100}%`, top: `${(y(p.v) / H) * 100}%`, background: color }} />}
      <div className="nw-ticks" aria-hidden>
        {ticks
          .filter((_, i) => i % step === 0)
          .map((t) => (
            <span key={t} style={{ left: `${(x(t) / W) * 100}%` }}>
              {new Date(t).toLocaleDateString('en-IN', { month: 'short' })}
            </span>
          ))}
      </div>
    </div>
  );
}

export function NetWorthPanel() {
  const h = useMoneyHistory();
  const f = useFinance();
  const now = useNow(60_000);
  const [range, setRange] = useState(1);
  const [picked, setPicked] = useState<number | null>(null);
  const all = withToday(h, f?.netWorth, now);
  const r = netWorthRange(all, RANGES[range][1], now.getTime() + DAY);
  if (r.points.length < 2) return null;
  const last = r.points[r.points.length - 1];
  const shown = picked !== null && r.points[picked] ? r.points[picked] : last;
  const start = r.points[0].v;
  const pct = start !== 0 ? (r.change / Math.abs(start)) * 100 : undefined;
  const months = Math.round((last.t - r.points[0].t) / (30.4 * DAY));
  return (
    <section className="panel money-networth">
      <header className="panel-head">
        <h2 className="label">Net worth</h2>
        <span className="nw-ranges" role="group" aria-label="Range">
          {RANGES.map(([k], i) => (
            <button
              key={k}
              className={i === range ? 'on' : ''}
              onClick={() => {
                setRange(i);
                setPicked(null);
              }}
            >
              {k}
            </button>
          ))}
        </span>
      </header>
      <div className="nw-head">
        <span className={`nw-value ${shown.v < 0 ? 'neg' : ''}`}>
          <Amt>{fmtInr(shown.v)}</Amt>
        </span>
        <span className="nw-sub">
          {picked !== null && shown !== last ? (
            <span className="muted">{new Date(shown.t).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
          ) : (
            <span className={r.change < 0 ? 'neg' : 'pos'}>
              {r.change < 0 ? '−' : '+'}
              <Amt>{fmtShort(Math.abs(r.change)).replace('−', '')}</Amt>
              {pct !== undefined && ` (${r.change < 0 ? '−' : '+'}${Math.abs(pct).toFixed(0)}%)`} in {months <= 1 ? 'a month' : `${months} months`}
            </span>
          )}
        </span>
      </div>
      <NetWorthChart points={r.points} picked={picked} onPick={setPicked} />
      {r.low && r.high && (
        <div className="nw-range-line muted">
          <span>
            Low <Amt>{fmtShort(r.low.v)}</Amt> · {fmtDay(r.low.t)}
          </span>
          <span>
            High <Amt>{fmtShort(r.high.v)}</Amt> · {fmtDay(r.high.t)}
          </span>
        </div>
      )}
    </section>
  );
}

// Spending per month (card bill payments left out, FINANCE.skipCategories),
// the current month hatched, then this month by category against last month.
export function SpendingCharts() {
  const h = useMoneyHistory();
  const now = useNow(60_000);
  if (!h.months.length) return null;
  const cur = thisMonth(now);
  const months = h.months.slice(-12).map((m) => ({ m, ...monthSpend(m, FINANCE.skipCategories) }));
  const bars: Bar[] = months.map(({ m, total }) => ({
    key: m.month,
    parts: [total],
    partial: m.month === cur,
    label: `${monthLabel(m.month, 'long')}: ${fmtInr(total)}`,
  }));
  const byMonth = new Map(months.map((x) => [x.m.month, x]));
  // By category: this month (the owner asked for the current month only), with a tick at last month.
  const shownMonth = byMonth.get(cur) ?? months[months.length - 1];
  const prevKey = thisMonth(new Date(Number(shownMonth.m.month.slice(0, 4)), Number(shownMonth.m.month.slice(5)) - 2, 1));
  const prev = byMonth.get(prevKey);
  const top = shownMonth.categories.slice(0, 6);
  const rest = shownMonth.categories.slice(6).reduce((s, [, v]) => s + v, 0);
  const rows: [string, number][] = rest > 0 ? [...top, ['Other', rest]] : top;
  const prevOf = (name: string) =>
    name === 'Other' ? prev?.categories.filter(([k]) => !top.some(([t]) => t === k)).reduce((s, [, v]) => s + v, 0) : prev?.categories.find(([k]) => k === name)?.[1];
  const max = Math.max(1, ...rows.map(([k, v]) => Math.max(v, prevOf(k) ?? 0)));
  const colors = rowColors(rows.map(([k]) => k));
  const skip = FINANCE.skipCategories.map((s) => s.toLowerCase());
  const skipped = !skip.length ? '' : skip.length === 1 && skip[0] === 'credit bill' ? ' · card bill payments left out' : ` · ${skip.join(', ')} left out`;
  return (
    <div className="spend-charts">
      <div className="spend-sec">
        <span className="label">Per month{skipped}</span>
        <BarChart
          bars={bars}
          colors={['var(--accent-light)']}
          height={92}
          caption={(b) => {
            const x = byMonth.get(String(b.key));
            if (!x) return null;
            const lead = x.categories[0];
            return (
              <span className="spend-caption">
                <b>{monthLabel(x.m.month, 'long')}</b> · <Amt>{fmtInr(x.total)}</Amt>
                {x.m.month === cur && ' so far'}
                {lead && (
                  <span className="muted">
                    {' · most on '}
                    {lead[0]}
                  </span>
                )}
              </span>
            );
          }}
        />
      </div>
      {rows.length > 0 && (
        <div className="spend-sec">
          <span className="label cat-head">
            {monthLabel(shownMonth.m.month, 'long')} by category{shownMonth.m.month === cur ? ' so far' : ''}
            {prev && (
              <span className="cat-key">
                <b /> {monthLabel(prev.m.month)}
              </span>
            )}
          </span>
          <ul className="cat-bars">
            {rows.map(([name, v], i) => {
              const p = prevOf(name);
              const color = colors[i];
              return (
                <li key={name}>
                  <span className="cat-name">
                    <i style={{ background: color }} />
                    {name}
                  </span>
                  <span className="cat-track">
                    <i style={{ width: `${(v / max) * 100}%`, background: color }} />
                    {p !== undefined && p > 0 && <b className="cat-prev" style={{ left: `${(p / max) * 100}%` }} title={`${monthLabel(prev!.m.month)}: ${fmtInr(p)}`} />}
                  </span>
                  <span className="cat-v">
                    <Amt>{fmtShort(v)}</Amt>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// The next card bill and the recurring payments due in the next 45 days, by date.
export function ComingUp() {
  const h = useMoneyHistory();
  const f = useFinance();
  const now = useNow(60_000);
  const items: { date: string; name: string; amount?: number; card?: boolean }[] = h.upcoming
    .filter((u) => {
      const d = daysUntil(u.date, now);
      return d >= 0 && d <= 45;
    })
    .map((u) => ({ date: u.date, name: u.name, amount: u.amount }));
  if (f?.bill?.due && daysUntil(f.bill.due, now) >= -3) items.push({ date: f.bill.due, name: `${f.bill.card || 'Card'} bill`, amount: f.bill.amount, card: true });
  if (!items.length) return null;
  items.sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="coming-up">
      <span className="label">Coming up</span>
      <ul>
        {items.map((it) => {
          const d = daysUntil(it.date, now);
          const [y, m, dd] = it.date.split('-').map(Number);
          return (
            <li key={`${it.date}${it.name}`} className={d <= 3 ? 'soon' : ''}>
              <span className="cu-date">
                <b>{dd}</b>
                <small>{new Date(y, m - 1, dd).toLocaleDateString('en-IN', { month: 'short' })}</small>
              </span>
              <span className="cu-name">
                {it.name}
                <small className="muted">{d < 0 ? `${-d}d late` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}</small>
              </span>
              {it.amount !== undefined && (
                <span className="cu-amt">
                  <Amt>{fmtInr(it.amount)}</Amt>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
