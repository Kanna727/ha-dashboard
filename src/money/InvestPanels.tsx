// The investment cards built on lib/invest/: Returns (the yearly return of every
// fund and of all of them together), Gains (realised by financial year and still
// unrealised, split short and long term) and Next 60 days (the planned payments
// counted down from today's bank balance). All computed from the orders and the
// money helpers, and all labelled as such: they are figures to look at, not advice.
import { useId, useState } from 'react';
import { fmtInr, fmtShort } from '../lib/finance';
import { shortScheme } from '../lib/financeDetail';
import type { FundReport, Report } from '../lib/invest/funds';
import { Amt } from './Amt';
import { fmtPct, fmtSigned, Head, MoreButton } from './parts';
import { useForecast, useFundReport } from './useInvest';

const rate = (r: number | undefined, years: number) => (r === undefined || years < 0.25 ? '—' : fmtPct(r * 100));
const tone = (n: number | undefined) => (n === undefined ? '' : n < 0 ? 'neg' : 'pos');
const since = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '');

function FundRow({ f }: { f: FundReport }) {
  const pct = f.invested > 0 && f.gain !== undefined ? (f.gain / f.invested) * 100 : undefined;
  return (
    <li className={`inv-row ${f.incomplete ? 'dim' : ''}`} title={f.incomplete}>
      <div className="inv-row-name">
        <span>{shortScheme(f.scheme)}</span>
        <small className="muted">{f.incomplete ? f.incomplete : `${f.held ? 'since' : 'sold'} ${since(f.held ? f.first : f.last)}`}</small>
      </div>
      <div className="inv-row-nums">
        <b className={tone(f.xirr)}>{f.incomplete ? '—' : rate(f.xirr, f.years)}</b>
        <small className="muted">
          {f.value !== undefined ? <Amt>{fmtShort(f.value)}</Amt> : f.held ? '' : 'sold'}
          {pct !== undefined && !f.incomplete && <span className={tone(pct)}> {fmtPct(pct, 0)}</span>}
        </small>
      </div>
    </li>
  );
}

function ReturnsBody({ r }: { r: Report }) {
  const [all, setAll] = useState(false);
  const { overall } = r;
  const shown = all ? r.funds : r.funds.slice(0, 8);
  return (
    <>
      <div className="inv-head">
        <span className={`inv-big ${tone(overall.xirr)}`}>{rate(overall.xirr, overall.years)}</span>
        <span className="inv-sub">
          <span className="muted">a year, all funds together</span>
          <span className="muted">
            <Amt>{fmtInr(overall.invested)}</Amt> put in · <Amt>{fmtInr(overall.value)}</Amt> now
            {overall.withdrawn > 0 && (
              <>
                {' '}
                · <Amt>{fmtInr(overall.withdrawn)}</Amt> taken out
              </>
            )}
          </span>
          <span className={tone(overall.gain)}>
            <Amt>{fmtSigned(overall.gain)}</Amt> gain, counting what was sold
          </span>
        </span>
      </div>
      {overall.leftOut > 0 && <p className="inv-note">{overall.leftOut} fund{overall.leftOut === 1 ? ' is' : 's are'} left out of these figures: their orders don’t add up to what is held (grey rows).</p>}
      <ul className="inv-rows">
        {shown.map((f) => (
          <FundRow key={f.key} f={f} />
        ))}
      </ul>
      {r.funds.length > 8 && <MoreButton open={all} total={r.funds.length} onClick={() => setAll((a) => !a)} />}
      <p className="inv-note">Yearly return (XIRR) from every order and today’s value. Funds under three months old show —. Figures worked out from your orders; not investment advice.</p>
    </>
  );
}

// One card: yearly return per fund, then the short/long term gains.
export function ReturnsPanel() {
  const r = useFundReport();
  if (!r) return null;
  return (
    <section className="panel money-returns">
      <Head label="Returns & gains" summary={`${r.overall.counted} fund${r.overall.counted === 1 ? '' : 's'}`} />
      <ReturnsBody r={r} />
      <GainsBody r={r} />
    </section>
  );
}

const Row = ({ label, sub, v, plain }: { label: string; sub?: string; v: number; plain?: boolean }) => (
  <li>
    <span>
      {label}
      {sub && <small className="muted"> {sub}</small>}
    </span>
    <b className={plain ? '' : tone(v)}>
      <Amt>{fmtSigned(v)}</Amt>
    </b>
  </li>
);

function GainsBody({ r }: { r: Report }) {
  const [more, setMore] = useState(false);
  const { unrealised: u } = r;
  const fys = more ? r.realised : r.realised.slice(0, 3);
  const nothing = !r.realised.length && !u.short.cost && !u.long.cost && !u.slab.cost && !u.unsplitFunds;
  if (nothing) return null;
  return (
    <div className="money-gains">
      <span className="label inv-gains-title">Gains, short and long term</span>
      {r.realised.length > 0 && (
        <div className="money-sub">
          <span className="label">Sold, by financial year</span>
          <ul className="money-list">
            {fys.map((g) => (
              <li key={g.fy} className="inv-fy">
                <span>
                  FY {g.fy}
                  <small className="muted"> {g.sales} sale{g.sales === 1 ? '' : 's'}</small>
                </span>
                <span className="inv-split">
                  <small className="muted">
                    short <Amt>{fmtSigned(g.short)}</Amt> · long <Amt>{fmtSigned(g.long)}</Amt>
                    {g.slab !== 0 && (
                      <>
                        {' '}
                        · slab <Amt>{fmtSigned(g.slab)}</Amt>
                      </>
                    )}
                  </small>
                  <b className={tone(g.total)}>
                    <Amt>{fmtSigned(g.total)}</Amt>
                  </b>
                </span>
              </li>
            ))}
          </ul>
          {r.realised.length > 3 && <MoreButton open={more} total={r.realised.length} onClick={() => setMore((m) => !m)} />}
        </div>
      )}
      <div className="money-sub">
        <span className="label">Still held</span>
        <ul className="money-list">
          <Row label="Short term" sub={`${fmtShort(u.short.value)} now`} v={u.short.gain} />
          <Row label="Long term" sub={`${fmtShort(u.long.value)} now`} v={u.long.gain} />
          {u.slab.cost > 0 && <Row label="Taxed at slab rate" sub={`${fmtShort(u.slab.value)} now`} v={u.slab.gain} />}
          {u.unsplitFunds > 0 && <Row label="Can’t be split" sub={`${u.unsplitFunds} fund${u.unsplitFunds === 1 ? '' : 's'}, orders incomplete`} v={u.unsplitGain} />}
        </ul>
      </div>
      <p className="inv-note">
        Oldest units are sold first. Equity funds count as long term after 12 months, other funds after 24 (36 before July 2024), and debt funds bought from April 2023 are always taxed at the slab rate. A fund’s class is guessed from its category; set FINANCE.fundClasses to correct one. Worked out from your orders, not a tax computation or advice.
      </p>
    </div>
  );
}

// The balance as a line over the days, with the lowest day marked.
function BalanceChart({ days, lowest }: { days: { date: string; balance: number }[]; lowest: { date: string; balance: number } }) {
  const fill = `fc${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const W = 600;
  const H = 120;
  const lo = Math.min(...days.map((d) => d.balance), 0);
  const hi = Math.max(...days.map((d) => d.balance), 1);
  const x = (i: number) => (i / Math.max(1, days.length - 1)) * W;
  const y = (v: number) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 14);
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d.balance).toFixed(1)}`).join(' ');
  const low = days.findIndex((d) => d.date === lowest.date);
  return (
    <svg className="fc-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Planned bank balance over the next days">
      <defs>
        <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {lo < 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="fc-zero" />}
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#${fill})`} />
      <path d={line} className="fc-line" vectorEffect="non-scaling-stroke" />
      {low >= 0 && <circle cx={x(low)} cy={y(lowest.balance)} r="4.5" className={`fc-low ${lowest.balance < 0 ? 'neg' : ''}`} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function ForecastPanel() {
  const f = useForecast(60);
  const [all, setAll] = useState(false);
  const [why, setWhy] = useState(false);
  if (!f || (!f.events.length && f.days[0].balance === 0)) return null;
  const events = all ? f.events : f.events.slice(0, 7);
  const start = f.days[0].balance;
  return (
    <section className="panel money-forecast">
      <Head label="Next 60 days" summary="planned payments" />
      <div className="inv-head">
        <span className={`inv-big ${f.lowest.balance < 0 ? 'neg' : ''}`}>
          <Amt>{fmtInr(f.lowest.balance)}</Amt>
        </span>
        <span className="inv-sub">
          <span className="muted">
            lowest balance{f.in === 0 ? ' if nothing comes in' : ''}, {f.lowest.date === f.days[0].date ? 'today' : dayLabel(f.lowest.date)}
          </span>
          <span className="muted">
            <Amt>{fmtInr(start)}</Amt> in the bank now · <Amt>{fmtInr(f.out)}</Amt> going out
            {f.in > 0 && (
              <>
                {' '}
                · <Amt>{fmtInr(f.in)}</Amt> coming in
              </>
            )}
          </span>
        </span>
      </div>
      <BalanceChart days={f.days} lowest={f.lowest} />
      <ul className="money-list fc-events">
        {events.map((e, i) => (
          <li key={`${e.date}${e.name}${i}`} className={e.kind === 'income' ? 'in' : ''}>
            <span>
              {e.name}
              <small className="muted"> {dayLabel(e.date)}</small>
            </span>
            <b className={e.amount > 0 ? 'pos' : ''}>
              <Amt>{fmtSigned(e.amount)}</Amt>
            </b>
          </li>
        ))}
        {!f.events.length && <li className="dim">Nothing planned in the next 60 days.</li>}
      </ul>
      {f.events.length > 7 && <MoreButton open={all} total={f.events.length} onClick={() => setAll((a) => !a)} />}
      <button type="button" className="inv-why" onClick={() => setWhy((w) => !w)} aria-expanded={why}>
        What this counts
      </button>
      {why && (
        <ul className="inv-assume">
          {f.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
