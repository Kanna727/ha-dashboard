// Building blocks shared by the commute card and popup designs.
import { Icon } from '../components/Icon';
import { bestLeave, type Commute, type LeaveOption } from './useCommute';
import { clock, kmText, mins, SPEED_COLORS, TRAFFIC_TEXT, type Route, type SpeedSegment, type TrafficLevel } from './routes';
import { PlaceSearch } from './views';

const LEVEL_CLASS: Record<TrafficLevel, string> = { light: 'ok', moderate: 'amber', heavy: 'warn' };

export function LevelChip({ level, short }: { level: TrafficLevel; short?: boolean }) {
  return (
    <span className={`chip ${LEVEL_CLASS[level]}`}>
      <span className="cm-dot" /> {short ? level[0].toUpperCase() + level.slice(1) : TRAFFIC_TEXT[level]}
    </span>
  );
}

// The route as one bar, coloured by live speed along its length.
export function TrafficStrip({ segs, ends = true }: { segs: SpeedSegment[]; ends?: boolean }) {
  return (
    <div className="cm-strip">
      {ends && <span className="cm-end home"><Icon name="home" size={14} /></span>}
      <div className="cm-strip-bar">
        {segs.map((s, i) => (
          <i key={i} style={{ left: `${s.from * 100}%`, width: `${(s.to - s.from) * 100}%`, background: SPEED_COLORS[s.speed] }} />
        ))}
      </div>
      {ends && <span className="cm-end dest"><Icon name="pin" size={14} /></span>}
    </div>
  );
}

// Trip time if you leave now or later, as bars; the quickest is highlighted.
export function LeaveLaterBars({ options, now, compact }: { options: LeaveOption[]; now: Date; compact?: boolean }) {
  const best = bestLeave(options);
  const hi = Math.max(...options.map((o) => o.seconds));
  // Bars start from 60 % of the quickest, so a few minutes' difference shows.
  const base = Math.min(...options.map((o) => o.seconds)) * 0.6;
  return (
    <div className={`cm-bars ${compact ? 'compact' : ''}`}>
      {options.map((o) => {
        const isBest = o === best;
        const f = (o.seconds - base) / (hi - base || 1);
        const leave = now.getTime() + o.offset * 60_000;
        return (
          <div key={o.offset} className={`cm-bar ${isBest ? 'best' : ''}`}>
            <span className="cm-bar-val">{mins(o.seconds)}<small>m</small></span>
            <div className="cm-bar-track"><i style={{ height: `${Math.min(1, f) * 100}%` }} /></div>
            <span className="cm-bar-label">{o.offset ? `+${o.offset}` : 'Now'}</span>
            {!compact && <span className="cm-bar-sub">{clock(leave)} → {clock(leave + o.seconds * 1000)}</span>}
          </div>
        );
      })}
    </div>
  );
}

// "Leave at 9:40 to save 8 min" or "Leaving now is quickest".
export function leaveAdvice(options: LeaveOption[] | null, now: Date): string | undefined {
  const best = bestLeave(options);
  if (!options || !best) return undefined;
  if (!best.offset) return 'Leaving now is quickest';
  return `Leave at ${clock(now.getTime() + best.offset * 60_000)} to save ${mins(options[0].seconds - best.seconds)} min`;
}

export function RouteList({ c }: { c: Commute }) {
  if (!c.routes) return null;
  return (
    <div className="cm-routes">
      {c.routes.map((r, i) => (
        <button key={i} className={`cm-route ${i === c.selected ? 'active' : ''}`} onClick={() => c.select(i)}>
          <div className="cm-route-top">
            <strong>{mins(r.seconds)}<small> min</small></strong>
            <span className="cm-route-meta">
              {kmText(r.meters)}
              {r.description ? ` · via ${r.description}` : ''}
            </span>
            {i === c.fastest ? (
              c.routes!.length > 1 && <span className="chip ok">Fastest</span>
            ) : (
              <span className="muted small">+{mins(r.seconds - c.routes![c.fastest].seconds)} min</span>
            )}
          </div>
          <TrafficStrip segs={r.segs} ends={false} />
        </button>
      ))}
    </div>
  );
}

export function SpeedLegend() {
  return (
    <div className="cm-legend">
      <span><i style={{ background: SPEED_COLORS.NORMAL }} />Moving</span>
      <span><i style={{ background: SPEED_COLORS.SLOW }} />Slow</span>
      <span><i style={{ background: SPEED_COLORS.TRAFFIC_JAM }} />Jam</span>
    </div>
  );
}

export function VehicleSeg({ c }: { c: Commute }) {
  return (
    <div className="dh-seg cm-seg" role="group" aria-label="Vehicle">
      <button className={c.mode === 'DRIVE' ? 'active' : ''} onClick={() => c.setMode('DRIVE')}><Icon name="car" size={16} /> Car</button>
      <button className={c.mode === 'TWO_WHEELER' ? 'active' : ''} onClick={() => c.setMode('TWO_WHEELER')}><Icon name="motorbike" size={16} /> Bike</button>
    </div>
  );
}

export function Updated({ c }: { c: Commute }) {
  const ago = c.lastUpdate ? Math.floor((c.now.getTime() - c.lastUpdate) / 60_000) : 0;
  return (
    <span className={`cm-updated ${c.stale ? 'stale-data' : ''}`}>
      {c.error ? 'Not updated' : c.lastUpdate ? (c.stale ? `Updated ${ago} min ago` : `Updated ${clock(c.lastUpdate)}`) : 'Checking traffic…'}
      <button
        className={`round small ${c.busy ? 'pending' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          c.refresh();
        }}
        aria-label="Refresh commute"
      >
        <Icon name="refresh" size={18} />
      </button>
    </span>
  );
}

// Destination search with recent places and the "routing to …" note.
export function SearchBox({ c }: { c: Commute }) {
  return (
    <div className="cm-search">
      <div className="cm-search-field">
        <Icon name="search" size={18} />
        <PlaceSearch config={c.config} onPlace={c.choosePlace} />
        {c.override && (
          <button className="chip-btn small" onClick={c.clearPlace}>
            Reset
          </button>
        )}
      </div>
      {c.recents.length > 0 && (
        <div className="chips-row">
          {c.recents.map((r) => (
            <button key={r.label} className={`chip-btn small ${c.override?.label === r.label ? 'active' : ''}`} onClick={() => c.choosePlace(r)}>
              {r.label}
            </button>
          ))}
        </div>
      )}
      {c.override && <div className="muted small ellipsis" title={c.override.full}>To {c.override.full} · back to {c.config.title} in 5 min</div>}
    </div>
  );
}

export function Notices({ c }: { c: Commute }) {
  return (
    <>
      {c.error && (
        <div className="notice-banner">
          <Icon name="alert" size={18} />
          <span><strong>Route unavailable.</strong> {c.error}</span>
        </div>
      )}
      {c.alert && c.route && (
        <div className="notice-banner">
          <Icon name="alert" size={18} />
          <span><strong>Heavy traffic: {mins(c.route.seconds)} min.</strong> {leaveAdvice(c.leaveLater, c.now) ?? 'Consider leaving early.'}</span>
        </div>
      )}
    </>
  );
}

export const arrival = (r: Route | undefined, now: Date) => (r ? clock(now.getTime() + r.seconds * 1000) : '–');
