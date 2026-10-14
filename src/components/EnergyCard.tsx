import { useEffect, useState } from 'react';
import { useHass, type HistoryPoint } from '../ha/api';
import { fmtWatts } from '../ha/format';
import { Icon } from './Icon';
import { Sparkline } from './Sparkline';
import { OfflinePlugsNote } from './OfflinePlugsNote';
import { fetchHomePowerHistory, useHomePower } from './useHomePower';
import { ENERGY } from '../config/entities';
import { averageKwh, dailyKwh, type DayEnergy } from '../lib/energyHistory';

const HOURS = 24;
const HISTORY_DAYS = 30;

const dayLabel = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

// Daily energy for the last 30 days from long-term statistics (mean W per day),
// as bars that grow in when the popup opens. Tap a bar to read its day.
function EnergyHistory() {
  const hass = useHass();
  const [days, setDays] = useState<DayEnergy[]>([]);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    hass
      .fetchStatistics([ENERGY.total, ENERGY.legacyTotal], HISTORY_DAYS, 'day')
      .then((s) => alive && setDays(dailyKwh(s[ENERGY.total] ?? [], s[ENERGY.legacyTotal] ?? [], Date.now()).slice(-HISTORY_DAYS)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hass]);

  if (!days.length) return null;
  const max = Math.max(...days.map((d) => d.kwh), 1);
  const avg = averageKwh(days);
  const shown = days[picked ?? days.length - 1];

  return (
    <div className="energy-history">
      <div className="eh-head">
        <span className="label">Last {days.length} days</span>
        <span className="muted small">{avg !== undefined ? `avg ${avg.toFixed(1)} kWh/day` : ''}</span>
      </div>
      <div className="eh-bars" role="list">
        {days.map((d, i) => (
          <button
            key={d.start}
            role="listitem"
            className={`eh-bar ${d.partial ? 'partial' : ''} ${(picked ?? days.length - 1) === i ? 'picked' : ''}`}
            style={{ ['--h' as string]: `${(d.kwh / max) * 100}%`, ['--i' as string]: i }}
            onClick={() => setPicked(i)}
            aria-label={`${dayLabel(d.start)}: ${d.kwh.toFixed(1)} kWh${d.partial ? ' so far' : ''}`}
          >
            <i />
          </button>
        ))}
      </div>
      <div className="eh-picked">
        <strong>{shown.kwh.toFixed(1)} kWh</strong>
        <span className="muted small">{dayLabel(shown.start)}{shown.partial ? ' · so far today' : ''}</span>
      </div>
    </div>
  );
}

// Every plug drawing power by default, so newly discovered plugs are listed too.
export function EnergyCard({ limit = Infinity }: { limit?: number }) {
  const hass = useHass();
  const { totalW, consumers, offline } = useHomePower();
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchHomePowerHistory(hass, HOURS).then((pts) => alive && setHistory(pts)).catch(() => undefined);
    load();
    const id = window.setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hass]);

  const rows = consumers
    .filter((r) => r.w >= 1)
    .sort((a, b) => b.w - a.w)
    .slice(0, limit);
  const peak = history.length ? history.reduce((m, p) => Math.max(m, p.v), -Infinity) : undefined;

  return (
    <section className="card energy">
      <header className="card-head">
        <Icon name="flash" size={18} />
        <h2>Power</h2>
        <span className="muted small">24h peak {fmtWatts(peak)}</span>
      </header>
      <div className="energy-now">{fmtWatts(totalW)}</div>
      <OfflinePlugsNote offline={offline} hasTotal={totalW !== undefined} />
      <Sparkline points={history} hours={HOURS} />
      <EnergyHistory />
      <ul className="consumers">
        {rows.map((r) => (
          <li key={r.entity}>
            <span className="c-name">{r.name}</span>
            <span className="c-bar"><i style={{ width: `${Math.min(100, (r.w / Math.max(totalW ?? r.w, 1)) * 100)}%` }} /></span>
            <span className="c-val">{fmtWatts(r.w)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="muted">Nothing drawing power</li>}
      </ul>
    </section>
  );
}
