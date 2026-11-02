import { isUnavailable, relTime } from '../ha/format';
import { useNow } from '../hooks/useNow';
import { Icon } from './Icon';
import { Sparkline } from './Sparkline';
import { PURIFIER_HOURS as HOURS, usePurifierControls } from './usePurifier';

// "1:05 AM" today, else "Mon 1:05 AM".
export function sinceLabel(t: number) {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

// Water purifier section of the Appliances card (APPLIANCES.purifier): TDS,
// tank, faults, a 7-day TDS chart, the purification mode (changed with two
// taps, so a stray tap can't switch it to Vacation) and a cloud refresh.
export function PurifierRow({ showName = true }: { showName?: boolean }) {
  const p = usePurifierControls();
  const { cfg, tankFull, fallback, last, history, since, offline, options, armed, pickMode, refreshing, refresh } = p;
  useNow(60_000); // keeps "Updated Xm ago" current

  if (!cfg) return null;
  const tankText = tankFull?.state === 'on' ? 'Tank full' : tankFull?.state === 'off' ? 'Tank not full' : '';
  const ago = relTime(last?.state);
  const sinceText = since === undefined ? '' : sinceLabel(since);
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

      {/* Hidden once loaded if the recorder has no readings at all. */}
      {(!history || history.length > 0) && (
        <div className="purifier-chart">
          <Sparkline points={history ?? []} hours={HOURS} start={since} height={48} color="var(--accent-fan)" />
          <div className="muted small">
            {sinceText ? `Drinking water TDS since ${sinceText}` : 'Drinking water TDS, last 7 days'}
            {history?.length === 1 && ' · no change yet'}
          </div>
        </div>
      )}

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
            disabled={!p.canRefresh}
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
