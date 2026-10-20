// The commute popup (the owner picked the "map stage" layout on 2026-10-20 from
// three trial layouts): the map as the hero, like the car's 3D stage, with the
// ETA and controls on it; the routes and the leave-later times below.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { COMMUTE } from '../config/entities';
import { Icon } from '../components/Icon';
import { arrival, LeaveLaterBars, leaveAdvice, Notices, RouteList, SearchBox, SpeedLegend, TrafficStrip, VehicleSeg } from './parts';
import { clock, kmText, mins, TRAFFIC_TEXT, type CommuteConfig } from './routes';
import { useCommute, type Commute } from './useCommute';
import { CommuteMapView } from './views';

// The popup's header (subtitle, pill) follows the body's live state.
let live: Commute | null = null;
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
const useLive = () => useSyncExternalStore(subscribe, () => live);

export function CommuteSubtitle({ title }: { title: string }) {
  const c = useLive();
  if (!c) return <span>{title}</span>;
  return (
    <>
      <span>{c.from} → {c.to}</span>
      <span className="muted">· {c.mode === 'TWO_WHEELER' ? 'by bike' : 'by car'}</span>
    </>
  );
}

export function CommuteAside() {
  const c = useLive();
  const level = c?.route?.level;
  return (
    <span className="pill small-pill">
      <span className={`dot ${level === 'heavy' || c?.error ? 'warn' : level === 'moderate' ? 'amber' : c?.route ? '' : 'off'}`} />
      {c?.error ? 'Route unavailable' : level ? TRAFFIC_TEXT[level] : 'Checking…'}
    </span>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hour = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
const windowText = () => `${COMMUTE.windowDays.map((d) => DAYS[d]).join(', ')} · ${hour(COMMUTE.windowStartHour)}–${hour(COMMUTE.windowEndHour)}`;

function LeaveLaterCard({ c }: { c: Commute }) {
  return (
    <div className="card cm-later-card">
      <header className="panel-head">
        <h2 className="label">Leave later</h2>
        {c.leaveLater && <span className="panel-summary">{leaveAdvice(c.leaveLater, c.now)}</span>}
      </header>
      {c.leaveLater ? (
        <LeaveLaterBars options={c.leaveLater} now={c.now} />
      ) : (
        <p className="muted small">
          {c.override ? 'Not checked for a searched destination.' : `Checked during the commute window (${windowText()}).`}
        </p>
      )}
    </div>
  );
}

function RoutesCard({ c }: { c: Commute }) {
  return (
    <div className="card cm-routes-card">
      <header className="panel-head">
        <h2 className="label">Routes</h2>
        <SpeedLegend />
      </header>
      {c.routes ? <RouteList c={c} /> : <p className="muted small">{c.error ? 'No routes.' : 'Finding routes…'}</p>}
    </div>
  );
}

const STAGE_PAD = { top: 40, right: 200, bottom: 70, left: 210 };

export function CommuteDetail({ config }: { config: CommuteConfig }) {
  const c = useCommute(config, { alternatives: true, leaveLater: true });
  const [search, setSearch] = useState(false);
  useEffect(() => {
    live = c;
    subs.forEach((f) => f());
  });
  useEffect(
    () => () => {
      live = null;
    },
    [],
  );
  const r = c.route;
  return (
    <div className="cm-detail">
      <div className="cm-stage">
        <CommuteMapView config={c.config} routes={c.routes} origin={c.origin} dest={c.dest} selected={c.selected} onSelect={c.select} height="100%" padding={STAGE_PAD} />
        <div className="cm-stage-eta">
          <strong>{r ? mins(r.seconds) : '–'}<sup>min</sup></strong>
          <div>
            <span>Arrive {arrival(r, c.now)}</span>
            <small>{r ? `${kmText(r.meters)}${r.description ? ` · via ${r.description}` : ''}` : 'Checking traffic…'}</small>
          </div>
        </div>
        <div className="cm-stage-left">
          <VehicleSeg c={c} />
          <button className={`stage-btn ${c.swapped ? 'on' : ''}`} onClick={() => c.setSwapped(!c.swapped)}>
            <Icon name="swap" size={20} />
            <span className="stage-btn-text">Reverse<small>{c.to} → {c.from}</small></span>
          </button>
          <button className={`stage-btn ${search ? 'on' : ''}`} onClick={() => setSearch((s) => !s)}>
            <Icon name="search" size={20} />
            <span className="stage-btn-text">Search<small>{c.override ? c.override.label : 'Another place'}</small></span>
          </button>
        </div>
        <div className="cm-stage-right">
          <button className={`stage-btn ${c.busy ? 'pending' : ''}`} onClick={c.refresh}>
            <Icon name="refresh" size={20} />
            <span className="stage-btn-text">Refresh<small>{c.lastUpdate ? `Updated ${clock(c.lastUpdate)}` : 'Checking…'}</small></span>
          </button>
        </div>
        {search && (
          <div className="cm-stage-search">
            <SearchBox c={c} />
          </div>
        )}
        {r && (
          <div className="cm-stage-strip">
            <TrafficStrip segs={r.segs} />
          </div>
        )}
      </div>
      <Notices c={c} />
      <div className="cm-two">
        <RoutesCard c={c} />
        <LeaveLaterCard c={c} />
      </div>
    </div>
  );
}
