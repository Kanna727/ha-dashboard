import { useEffect, useState } from 'react';
import { useHass, type HistoryPoint } from '../ha/api';
import { fmtWatts } from '../ha/format';
import { Icon } from './Icon';
import { Sparkline } from './Sparkline';
import { OfflinePlugsNote } from './OfflinePlugsNote';
import { fetchHomePowerHistory, useHomePower } from './useHomePower';

const HOURS = 24;

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
