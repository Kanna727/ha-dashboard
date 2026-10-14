import { useEffect, useRef, useState } from 'react';
import { useHass, type HistoryPoint } from '../ha/api';
import { useEntity } from '../ha/store';
import { isUnavailable, relTime } from '../ha/format';
import { useNow } from '../hooks/useNow';
import { Icon } from './Icon';
import { Sparkline } from './Sparkline';
import { usePurifier } from './usePurifier';

const HOURS = 24 * 7;

// Water purifier section of the Appliances card (APPLIANCES.purifier): TDS,
// tank, faults, a 7-day TDS chart, the purification mode (changed with two
// taps, so a stray tap can't switch it to Vacation) and a cloud refresh.
export function PurifierRow({ showName = true }: { showName?: boolean }) {
  const hass = useHass();
  const p = usePurifier();
  const cfg = p.cfg;
  const tankFull = useEntity(cfg?.tankFull);
  const fallback = useEntity(cfg?.fallbackMode);
  const refreshBtn = useEntity(cfg?.refresh);
  const last = useEntity(cfg?.lastReported);
  useNow(60_000); // keeps "Updated Xm ago" current

  const [history, setHistory] = useState<HistoryPoint[]>([]);
  useEffect(() => {
    if (!cfg) return;
    let live = true;
    hass
      .fetchHistory([cfg.tankTds], HOURS)
      .then((h) => live && setHistory(h[cfg.tankTds] ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hass, cfg]);

  // Mode change: the first tap arms an option, a second tap within 4 s sends it.
  const [armed, setArmed] = useState<string>();
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(undefined), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const pickMode = (option: string) => {
    if (!cfg?.mode || option === p.mode?.state) return;
    if (armed !== option) return setArmed(option);
    setArmed(undefined);
    hass.callService('select', 'select_option', { option }, { entity_id: cfg.mode });
  };

  // Refresh: busy until "last reported" changes, or 60 s.
  const [refreshing, setRefreshing] = useState(false);
  const pressedAt = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (refreshing && last?.state !== pressedAt.current) setRefreshing(false);
  }, [last?.state, refreshing]);
  useEffect(() => {
    if (!refreshing) return;
    const t = window.setTimeout(() => setRefreshing(false), 60_000);
    return () => window.clearTimeout(t);
  }, [refreshing]);
  const refresh = () => {
    if (!cfg?.refresh) return;
    pressedAt.current = last?.state;
    setRefreshing(true);
    hass.callService('button', 'press', {}, { entity_id: cfg.refresh });
  };

  if (!cfg) return null;
  const offline = isUnavailable(p.tank);
  const options = (p.mode?.attributes.options as string[] | undefined) ?? [];
  const tankText = tankFull?.state === 'on' ? 'Tank full' : tankFull?.state === 'off' ? 'Tank not full' : '';
  const ago = relTime(last?.state);
  const rangeChip =
    p.inRange && p.target ? (
      <span className={`chip ${p.inRange === 'ok' ? 'ok' : 'warn'}`} title={`Target ${p.target.min}–${p.target.max} ppm`}>
        {p.inRange === 'ok' ? 'In target' : p.inRange === 'high' ? 'Above target' : 'Below target'}
      </span>
    ) : null;

  return (
    <div className={`purifier ${p.activeFaults.length ? 'fault' : ''}`}>
      {p.activeFaults.map((f) => (
        <div key={f} className="hold-banner">
          <Icon name="alert" size={18} />
          <span><strong>{f}</strong></span>
        </div>
      ))}
      <div className="appliance">
        <Icon name="purifier" size={22} />
        <div className="app-body">
          <div className="app-title">
            {showName ? p.name : 'Drinking water'}
            <span className="muted small">{offline ? 'Offline' : tankText}</span>
          </div>
          <div className="purifier-tds">
            <span className="stat-val">{offline || p.tank === undefined ? '–' : Math.round(Number(p.tank.state))}<small> ppm</small></span>
            {showName && <span className="muted small">drinking water</span>}
            {rangeChip}
          </div>
          {!offline && cfg.inputTds && (
            <div className="muted small">
              Input {isUnavailable(p.input) ? '–' : Math.round(Number(p.input!.state))} ppm
              {p.removedPct !== undefined && ` · ${p.removedPct}% removed`}
            </div>
          )}
        </div>
      </div>

      <div className="purifier-chart">
        <Sparkline points={history} hours={HOURS} height={48} color="var(--accent-fan)" />
        <div className="muted small">Drinking water TDS, last 7 days</div>
      </div>

      {cfg.mode && options.length > 0 && (
        <>
          <div className="muted small purifier-note">Purification mode</div>
          <div className="chips-row mode-chips" role="radiogroup" aria-label="Purification mode">
            {options.map((o) => (
              <button
                key={o}
                role="radio"
                aria-checked={o === p.mode?.state}
                className={`chip-btn small ${o === p.mode?.state ? 'active' : ''} ${armed === o ? 'armed' : ''}`}
                disabled={isUnavailable(p.mode)}
                onClick={() => pickMode(o)}
              >
                {armed === o ? 'Tap again' : o}
              </button>
            ))}
          </div>
          {p.mode?.state === 'Adaptive' && fallback && !isUnavailable(fallback) && (
            <div className="muted small purifier-note">Fallback: {fallback.state}</div>
          )}
        </>
      )}

      <div className="purifier-foot">
        <span className="muted small">{ago ? `Updated ${ago}` : ''}</span>
        {cfg.refresh && (
          <button
            className={`chip-btn small ${refreshing ? 'active' : ''}`}
            disabled={refreshing || (isUnavailable(refreshBtn) && refreshBtn?.state !== 'unknown')}
            onClick={refresh}
          >
            <Icon name="refresh" size={14} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
    </div>
  );
}
