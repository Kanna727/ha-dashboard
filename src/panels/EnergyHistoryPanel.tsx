import { useEffect, useState } from 'react';
import { ENERGY } from '../config/entities';
import { useHass, useHassStatus, type HassApi, type StatPoint } from '../ha/api';
import { store } from '../ha/store';
import { BarChart } from '../components/BarChart';
import { Icon } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';
import { plugLook, usePowerPlugs } from '../components/useHomePower';
import { bucketStart } from '../lib/driveHistory';
import { dailyKwh, plugKwh, type DayEnergy } from '../lib/energyHistory';

const TOTAL_DAYS = 400; // the calendar goes back a year
const PLUG_DAYS = 190; // about six months of each plug
const REFRESH_MS = 30 * 60_000;
const DAY = 86_400_000;
const LAST_DAYS = 30;
const TIMEOUT_MS = 90_000;
const RETRY_MS = 20_000;

interface EnergyStats {
  days: DayEnergy[];
  plugs: Record<string, StatPoint[]>;
}

// One fetch shared by the card and the popup (long-term statistics are slow on
// a Pi), reused for 30 min or until the plug list changes. A request that
// hasn't answered in 90 s counts as failed (a socket can stall without closing).
let cache: { key: string; at: number; promise: Promise<EnergyStats> } | null = null;
function loadEnergyStats(hass: HassApi, plugs: string[]): Promise<EnergyStats> {
  const key = plugs.join(',');
  if (!cache || cache.key !== key || Date.now() - cache.at > REFRESH_MS) {
    const totals = hass.fetchStatistics([ENERGY.total, ENERGY.legacyTotal].filter(Boolean), TOTAL_DAYS, 'day');
    const perPlug = plugs.length ? hass.fetchStatistics(plugs, PLUG_DAYS, 'day') : Promise.resolve({});
    const data = Promise.all([totals, perPlug]).then(([t, p]) => ({
      days: dailyKwh(t[ENERGY.total] ?? [], t[ENERGY.legacyTotal] ?? [], Date.now()),
      plugs: p,
    }));
    const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS));
    const promise = Promise.race([data, timeout]);
    const entry = { key, at: Date.now(), promise };
    cache = entry;
    promise.catch(() => {
      if (cache === entry) cache = null;
    });
  }
  return cache.promise;
}

// The last history this device loaded, so a reload (or a reconnect that takes a
// while) draws the card at once; mock builds keep their own copy.
const SAVED_KEY = import.meta.env.VITE_MOCK ? 'mockEnergyHistory' : 'dashEnergyHistory';
function readSaved(): EnergyStats | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null') as EnergyStats | null;
    return v && Array.isArray(v.days) && v.plugs && typeof v.plugs === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}
function writeSaved(s: EnergyStats) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: reloads wait for HA instead
  }
}

interface EnergyLoad {
  stats?: EnergyStats;
  failed: boolean; // the last try failed (it tries again by itself)
  waiting: boolean; // not connected to HA
  retry: () => void;
}

// Fetches once connected (again after each reconnect, from the 30-min cache
// when it's fresh), every 30 min, and 20 s after a failure. The owner saw the
// card stay blank while the connection was reconnecting: a failed fetch used
// to wait for the next 30-min refresh.
function useEnergyStats(): EnergyLoad {
  const hass = useHass();
  const { status } = useHassStatus();
  const plugs = usePowerPlugs();
  const [stats, setStats] = useState<EnergyStats | undefined>(readSaved);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = plugs.join(',');
  const live = status === 'live';
  useEffect(() => {
    if (!live) return;
    let alive = true;
    let again = 0;
    const load = () => {
      window.clearTimeout(again);
      loadEnergyStats(hass, key ? key.split(',') : []).then(
        (s) => {
          if (!alive) return;
          setStats(s);
          setFailed(false);
          writeSaved(s);
        },
        () => {
          if (!alive) return;
          setFailed(true);
          again = window.setTimeout(load, RETRY_MS);
        },
      );
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearTimeout(again);
    };
  }, [hass, key, live, attempt]);
  return { stats, failed, waiting: !live, retry: () => setAttempt((n) => n + 1) };
}

// What the card and popup show until there is history: a pulsing placeholder,
// or why there's nothing yet.
function HistoryPending({ load, height }: { load: EnergyLoad; height: number }) {
  return (
    <div className="eh-pending" style={{ minHeight: height }}>
      {load.failed ? (
        <>
          <span>Couldn&apos;t load the history. Trying again…</span>
          <button className="chip-btn" onClick={load.retry}>
            Retry now
          </button>
        </>
      ) : (
        <span className="eh-loading">{load.waiting ? 'Waiting for Home Assistant…' : 'Loading history…'}</span>
      )}
    </div>
  );
}

const kwh = (v: number | undefined, digits = v !== undefined && v < 10 ? 1 : 0) => (v === undefined ? '–' : `${v.toFixed(digits)} kWh`);
const dayLabel = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const unitFactor = (id: string) => (store.getAll()[id]?.attributes.unit_of_measurement === 'kW' ? 1000 : 1);
const dayOf = (t: number) => new Date(t).getDate();
const daysIn = (t: number) => new Date(new Date(t).getFullYear(), new Date(t).getMonth() + 1, 0).getDate();

// Daily kWh of one plug from its daily mean power (W, or kW → × 1000).
function plugDays(entity: string, pts: StatPoint[], now: number): DayEnergy[] {
  const f = unitFactor(entity);
  return pts
    .filter((p) => p.mean !== undefined && Number.isFinite(p.mean))
    .map((p) => {
      const partial = now < p.start + DAY;
      const hours = partial ? Math.max(0, (now - p.start) / 3_600_000) : 24;
      return { start: p.start, kwh: (p.mean! * f * hours) / 1000, partial };
    });
}

// Running total by day of month. Only days with data.
function runningTotal(days: DayEnergy[], from: number, to: number): { day: number; kwh: number }[] {
  let sum = 0;
  return days
    .filter((d) => d.start >= from && d.start < to)
    .map((d) => {
      sum += d.kwh;
      return { day: dayOf(d.start), kwh: sum };
    });
}

// The card ("Month race", the owner's pick on 2026-10-26 over day/week/month
// bars and a calendar): this month's running total against last month's, a
// dotted projection to the month's end, and a bar of where the energy went.
function RaceCard({ days, plugs }: EnergyStats) {
  const now = Date.now();
  const start = bucketStart(now, 'month');
  const prevStart = bucketStart(start - 1, 'month');
  const cur = runningTotal(days, start, Infinity);
  const prev = runningTotal(days, prevStart, start);
  const n = daysIn(now);
  const elapsed = (now - start) / DAY;
  const so = cur.length ? cur[cur.length - 1].kwh : 0;
  const projected = elapsed > 0.5 ? (so / elapsed) * n : undefined;
  const prevTotal = prev.length ? prev[prev.length - 1].kwh : undefined;
  const max = Math.max(so, projected ?? 0, prevTotal ?? 0, 1) * 1.08;
  const W = 300;
  const H = 120;
  const x = (day: number) => (day / 31) * W;
  const y = (v: number) => H - 4 - (v / max) * (H - 10);
  const line = (pts: { day: number; kwh: number }[]) => pts.map((p) => `L ${x(p.day)} ${y(p.kwh)}`).join(' ');
  const curPath = cur.length ? `M ${x(0)} ${y(0)} ${line(cur)}` : '';
  const last = cur[cur.length - 1];
  const rows = plugKwh(plugs, start, Infinity, now, unitFactor);
  const plugSum = rows.reduce((s, r) => s + r.kwh, 0);
  const top = rows.slice(0, 4);
  const other = plugSum - top.reduce((s, r) => s + r.kwh, 0);
  const diff = projected !== undefined && prevTotal ? Math.round(((projected - prevTotal) / prevTotal) * 100) : undefined;
  return (
    <>
      <div className="eh-race-head">
        <div>
          <strong>{kwh(so)}</strong>
          <span className="muted small"> so far this month</span>
        </div>
        {projected !== undefined && (
          <span className={`chip ${diff !== undefined && diff > 0 ? 'warn' : 'ok'}`}>
            On track for {kwh(projected)}
            {diff !== undefined ? ` · ${diff > 0 ? '+' : ''}${diff}%` : ''}
          </span>
        )}
      </div>
      <svg className="eh-race" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        {prev.length > 1 && <path d={`M ${x(0)} ${y(0)} ${line(prev)}`} className="eh-race-prev" vectorEffect="non-scaling-stroke" />}
        {curPath && <path d={`${curPath} L ${x(last.day)} ${H} L ${x(0)} ${H} Z`} className="eh-race-area" />}
        {curPath && <path d={curPath} className="eh-race-cur" vectorEffect="non-scaling-stroke" />}
        {last && projected !== undefined && <path d={`M ${x(last.day)} ${y(last.kwh)} L ${x(n)} ${y(projected)}`} className="eh-race-proj" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="eh-race-legend">
        <span>
          <i className="cur" />
          This month
        </span>
        <span>
          <i className="prev" />
          Last month{prevTotal !== undefined ? ` · ${kwh(prevTotal)}` : ''}
        </span>
        <span>
          <i className="proj" />
          Projection
        </span>
      </div>
      {top.length > 0 && (
        <>
          <div className="label eh-top">Where it went</div>
          <span className="eh-share" aria-hidden>
            {top.map((r) => (
              <i key={r.entity} style={{ flexGrow: r.kwh, background: plugLook(r.entity, store.getAll()[r.entity]).color }} />
            ))}
            {other > 0.05 && <i style={{ flexGrow: other, background: 'var(--tile-hover)' }} />}
          </span>
          <div className="eh-share-legend">
            {top.map((r) => {
              const look = plugLook(r.entity, store.getAll()[r.entity]);
              return (
                <span key={r.entity}>
                  <i style={{ background: look.color }} />
                  {look.name} {Math.round((r.kwh / plugSum) * 100)}%
                </span>
              );
            })}
            {other > 0.05 && (
              <span>
                <i style={{ background: 'var(--tile-hover)' }} />
                Other {Math.round((other / plugSum) * 100)}%
              </span>
            )}
          </div>
        </>
      )}
    </>
  );
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// A month's days as a heat map (stronger = more kWh, in the source's colour),
// Monday first; tap a day to read it, arrows step through the months with data.
function DayCalendar({ days, color }: { days: DayEnergy[]; color: string }) {
  const now = Date.now();
  const thisMonth = bucketStart(now, 'month');
  const firstMonth = days.length ? bucketStart(days[0].start, 'month') : thisMonth;
  const [month, setMonth] = useState(thisMonth);
  const [picked, setPicked] = useState<number | null>(null);
  const shownMonth = Math.max(firstMonth, Math.min(month, thisMonth));
  const next = new Date(shownMonth);
  next.setMonth(next.getMonth() + 1);
  const prevMonth = bucketStart(shownMonth - 1, 'month');
  const byDay = new Map(days.filter((d) => d.start >= shownMonth && d.start < next.getTime()).map((d) => [dayOf(d.start), d]));
  const full = [...byDay.values()].filter((d) => !d.partial);
  const lo = full.length ? Math.min(...full.map((d) => d.kwh)) : 0;
  const hi = full.length ? Math.max(...full.map((d) => d.kwh)) : 1;
  const lead = (new Date(shownMonth).getDay() + 6) % 7;
  const total = [...byDay.values()].reduce((s, d) => s + d.kwh, 0);
  const peak = [...full].sort((a, b) => b.kwh - a.kwh)[0];
  const latest = [...byDay.keys()].pop();
  const shown = byDay.get(picked ?? latest ?? 0);
  const go = (m: number) => {
    setMonth(m);
    setPicked(null);
  };
  return (
    <div className="eh-calendar" style={{ ['--c' as string]: color }}>
      <div className="eh-cal-nav">
        <button className="round small" onClick={() => go(prevMonth)} disabled={shownMonth <= firstMonth} aria-label="Previous month">
          <Icon name="back" size={18} />
        </button>
        <strong>{new Date(shownMonth).toLocaleDateString([], { month: 'long', year: 'numeric' })}</strong>
        <button className="round small" onClick={() => go(next.getTime())} disabled={shownMonth >= thisMonth} aria-label="Next month">
          <Icon name="chevronRight" size={18} />
        </button>
      </div>
      <div className="eh-cal">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="eh-cal-wd">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {Array.from({ length: daysIn(shownMonth) }, (_, i) => {
          const d = byDay.get(i + 1);
          const f = d && !d.partial ? (hi > lo ? (d.kwh - lo) / (hi - lo) : 0.5) : 0;
          return (
            <button
              key={i}
              className={`eh-cal-day ${d ? '' : 'empty'} ${d?.partial ? 'today' : ''} ${shown && shown === d ? 'picked' : ''}`}
              style={d ? { ['--f' as string]: `${Math.round(18 + f * 70)}%` } : undefined}
              onClick={() => d && setPicked(i + 1)}
              aria-label={d ? `${i + 1}: ${kwh(d.kwh)}` : `${i + 1}`}
            >
              <span>{i + 1}</span>
              {d && <small>{d.kwh < 10 ? d.kwh.toFixed(1) : Math.round(d.kwh)}</small>}
            </button>
          );
        })}
      </div>
      <div className="bc-caption">
        {shown && (
          <>
            <strong>{kwh(shown.kwh)}</strong>
            <span className="muted small">
              {dayLabel(shown.start)}
              {shown.partial ? ' · so far today' : ''}
            </span>
          </>
        )}
      </div>
      <div className="chips-row">
        <span className="chip">
          {kwh(total)}
          {shownMonth === thisMonth ? ' so far' : ' in the month'}
        </span>
        {full.length > 0 && <span className="chip">avg {kwh(full.reduce((s, d) => s + d.kwh, 0) / full.length)}/day</span>}
        {peak && (
          <span className="chip warn">
            Peak {new Date(peak.start).toLocaleDateString([], { day: 'numeric', month: 'short' })} · {kwh(peak.kwh)}
          </span>
        )}
      </div>
    </div>
  );
}

// The popup ("Plug explorer", the owner's pick on 2026-10-26 over a dashboard
// and a one-column story): the whole home and every plug in a list; the picked
// one's last 30 days as bars, its total, daily average and share, and a
// day-by-day calendar.
function EnergyHistoryDetail() {
  const load = useEnergyStats();
  const { stats } = load;
  const [picked, setPicked] = useState<string>('home');
  if (!stats) return <HistoryPending load={load} height={240} />;
  const now = Date.now();
  const from = new Date(now).setHours(0, 0, 0, 0) - (LAST_DAYS - 1) * DAY;
  const ranked = plugKwh(stats.plugs, from, Infinity, now, unitFactor);
  const plugTotal = ranked.reduce((s, r) => s + r.kwh, 0);
  const all = picked === 'home' ? stats.days : plugDays(picked, stats.plugs[picked] ?? [], now);
  const days = all.filter((d) => d.start >= from);
  const total = days.reduce((s, d) => s + d.kwh, 0);
  const full = days.filter((d) => !d.partial);
  const avg = full.length ? full.reduce((s, d) => s + d.kwh, 0) / full.length : undefined;
  const busiest = [...full].sort((a, b) => b.kwh - a.kwh)[0];
  const look = picked === 'home' ? { name: 'Whole home', color: 'var(--accent-energy)', icon: 'home' as const } : plugLook(picked, store.getAll()[picked]);
  const share = picked === 'home' ? undefined : ranked.find((r) => r.entity === picked)?.kwh;

  return (
    <div className="eh-explorer">
      <ul className="eh-ex-list">
        <li>
          <button className={picked === 'home' ? 'active' : ''} onClick={() => setPicked('home')} style={{ ['--c' as string]: 'var(--accent-energy)' }}>
            <Icon name="home" size={18} />
            <span>Whole home</span>
            <strong>{kwh(stats.days.filter((d) => d.start >= from).reduce((s, d) => s + d.kwh, 0))}</strong>
          </button>
        </li>
        {ranked.map((r) => {
          const l = plugLook(r.entity, store.getAll()[r.entity]);
          return (
            <li key={r.entity}>
              <button className={picked === r.entity ? 'active' : ''} onClick={() => setPicked(r.entity)} style={{ ['--c' as string]: l.color }}>
                <Icon name={l.icon} size={18} />
                <span>{l.name}</span>
                <strong>{kwh(r.kwh)}</strong>
                <i style={{ width: `${(r.kwh / Math.max(ranked[0].kwh, 1e-9)) * 100}%` }} />
              </button>
            </li>
          );
        })}
        <li className="muted small eh-ex-note">Last {LAST_DAYS} days. Plugs only: anything not on a smart plug isn't counted.</li>
      </ul>
      <div className="eh-ex-main" style={{ ['--c' as string]: look.color }}>
        <section className="card">
          <header className="card-head">
            <Icon name={look.icon} size={18} />
            <h2>{look.name}</h2>
            <span className="muted small">last {LAST_DAYS} days</span>
          </header>
          <div className="stat-tiles three eh-ex-tiles">
            <div className="stat-tile">
              <div className="label">Total</div>
              <div className="stat-val">{kwh(total)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Per day</div>
              <div className="stat-val">{kwh(avg)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">{share !== undefined ? 'Of the plugs' : 'Busiest'}</div>
              <div className="stat-val">
                {share !== undefined
                  ? `${Math.round((share / Math.max(plugTotal, 1e-9)) * 100)}%`
                  : busiest
                    ? new Date(busiest.start).toLocaleDateString([], { day: 'numeric', month: 'short' })
                    : '–'}
              </div>
            </div>
          </div>
          <BarChart
            bars={days.map((d) => ({ key: d.start, parts: [d.kwh], partial: d.partial, label: `${dayLabel(d.start)}: ${kwh(d.kwh)}` }))}
            colors={[look.color]}
            height={150}
            caption={(b) => (
              <>
                <strong>{kwh(b.parts[0])}</strong>
                <span className="muted small">
                  {dayLabel(b.key as number)}
                  {b.partial ? ' · so far today' : ''}
                </span>
              </>
            )}
          />
        </section>
        <section className="card">
          <header className="card-head">
            <Icon name="calendar" size={18} />
            <h2>Day by day</h2>
          </header>
          <DayCalendar key={picked} days={all} color={look.color} />
        </section>
      </div>
    </div>
  );
}

// This month so far, and where it's heading, for the full panel's header.
function monthSummary(days: DayEnergy[]): string {
  const now = Date.now();
  const start = bucketStart(now, 'month');
  const cur = runningTotal(days, start, Infinity);
  const so = cur.length ? cur[cur.length - 1].kwh : 0;
  const elapsed = (now - start) / DAY;
  const projected = elapsed > 0.5 ? (so / elapsed) * daysIn(now) : undefined;
  return `${kwh(so)} this month${projected !== undefined ? ` · on track for ${kwh(projected)}` : ''}`;
}

// `full` (tablet and desktop Energy page, where there's room): the popup's
// plug explorer and calendar on the page itself, this month's total in the
// header. Otherwise the "Month race" card with the explorer in a popup.
export function EnergyHistoryPanel({ full = false }: { full?: boolean }) {
  const modal = useModal();
  const load = useEnergyStats();
  const { stats } = load;

  if (full) {
    return (
      <section className="panel energy-history-panel full">
        <PanelHead label="Energy history" summary={stats?.days.length ? monthSummary(stats.days) : undefined} />
        <EnergyHistoryDetail />
      </section>
    );
  }
  return (
    <section className="panel energy-history-panel">
      <PanelHead
        label="Energy history"
        onMore={() => modal.open({ title: 'Energy history', icon: 'chart', accent: 'var(--accent-energy)', wide: true, body: <EnergyHistoryDetail /> })}
      />
      {!stats ? (
        <HistoryPending load={load} height={190} />
      ) : !stats.days.length ? (
        <p className="muted">No energy statistics recorded yet.</p>
      ) : (
        <RaceCard days={stats.days} plugs={stats.plugs} />
      )}
    </section>
  );
}
