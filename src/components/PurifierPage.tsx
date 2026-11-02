import type { ReactNode } from 'react';
import type { HistoryPoint } from '../ha/api';
import { isUnavailable, relTime } from '../ha/format';
import { useNow } from '../hooks/useNow';
import { Icon } from './Icon';
import { sinceLabel } from './PurifierRow';
import { PURIFIER_HOURS as HOURS, usePurifier, usePurifierControls } from './usePurifier';

// The water purifier's Water tab on the Clean page ("Flow", picked by the owner
// on 2026-11-02 over a dial and a strip above the vacuum): the water's path
// from the tap through the purifier to the tank, fault checks, a 7-day TDS
// chart with the mode's target band, the mode (two taps) and a refresh.
type Controls = ReturnType<typeof usePurifierControls>;

const ppm = (e: { state: string } | undefined) => (e === undefined || Number.isNaN(Number(e.state)) ? undefined : Math.round(Number(e.state)));

// "No water" -> "Water", "Filter choked" -> "Filter": the thing each fault
// sensor watches, shown with a tick while it's fine.
function checkLabel(fault: string) {
  const s = fault.replace(/\b(no|fault|choked|error|problem)\b/gi, '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : fault;
}
function rangeText(p: Controls) {
  return p.inRange === 'ok' ? 'In target' : p.inRange === 'high' ? 'Above target' : p.inRange === 'low' ? 'Below target' : '';
}

// Status line for the Water tab.
export function purifierTabStatus(p: ReturnType<typeof usePurifier>): { text: string; tone: string } {
  if (p.activeFaults.length) return { text: p.activeFaults[0], tone: 'warn' };
  if (isUnavailable(p.tank)) return { text: 'Offline', tone: 'idle' };
  const v = ppm(p.tank);
  const r = p.inRange === 'ok' ? 'in target' : p.inRange === 'high' ? 'above target' : p.inRange === 'low' ? 'below target' : '';
  return { text: v === undefined ? '–' : `${v} ppm${r ? ` · ${r}` : ''}`, tone: p.inRange === 'ok' ? 'fine' : 'idle' };
}

function Faults({ p }: { p: Controls }) {
  return (
    <>
      {p.activeFaults.map((f) => (
        <div key={f} className="hold-banner">
          <Icon name="alert" size={18} />
          <span><strong>{f}</strong></span>
        </div>
      ))}
    </>
  );
}

function Card({ label, aside, className = '', children }: { label: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`pw-card ${className}`}>
      <div className="pw-card-head">
        <span className="label">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

// TDS over the last 7 days with the mode's target band behind the line.
function TdsChart({ history, since, target, height = 120 }: { history: HistoryPoint[] | undefined; since?: number; target?: { min: number; max: number }; height?: number }) {
  if (history && history.length === 0) return <div className="muted small">No readings recorded yet</div>;
  const pts = history ?? [];
  const width = 300;
  const end = Date.now();
  const start = since ?? end - HOURS * 3600_000;
  const max = Math.max(...pts.map((q) => q.v), target ? target.max * 1.25 : 1, 1);
  const x = (t: number) => ((Math.max(t, start) - start) / (end - start)) * width;
  const y = (v: number) => height - 2 - (v / max) * (height - 8);
  let d = '';
  if (pts.length) {
    d = `M ${x(pts[0].t)} ${y(pts[0].v)}`;
    for (let i = 1; i < pts.length; i++) d += ` H ${x(pts[i].t)} V ${y(pts[i].v)}`;
    d += ` H ${width}`;
  }
  return (
    <div className="pw-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }}>
        {target && <rect className="pw-band" x={0} width={width} y={y(target.max)} height={y(target.min) - y(target.max)} />}
        {d && <path d={`${d} V ${height} H ${x(pts[0].t)} Z`} className="pw-area" />}
        {d && <path d={d} className="pw-line" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="pw-chart-foot muted small">
        <span>{p7Caption(history, since)}</span>
        {target && <span className="pw-band-key">Target {target.min}–{target.max}</span>}
      </div>
    </div>
  );
}
function p7Caption(history: HistoryPoint[] | undefined, since: number | undefined) {
  const base = since !== undefined ? `Since ${sinceLabel(since)}` : 'Last 7 days';
  return history?.length === 1 ? `${base} · no change yet` : base;
}

function ModeChips({ p }: { p: Controls }) {
  if (!p.cfg?.mode || p.options.length === 0) return null;
  return (
    <>
      <div className="chips-row mode-chips pw-mode-chips" role="radiogroup" aria-label="Purification mode">
        {p.options.map((o) => {
          const on = o === p.mode?.state;
          const armed = p.armed === o;
          return (
            <button
              key={o}
              role="radio"
              aria-checked={on}
              aria-label={o}
              className={`chip-btn small ${on ? 'active' : ''} ${armed ? 'armed' : ''}`}
              disabled={p.offline}
              onClick={() => p.pickMode(o)}
            >
              {armed ? 'Tap again' : o}
            </button>
          );
        })}
      </div>
      {p.mode?.state === 'Adaptive' && p.fallback && !p.offline && <div className="muted small pw-note">Fallback: {p.fallback.state}</div>}
    </>
  );
}

function Checks({ p }: { p: Controls }) {
  if (!p.faults.length) return null;
  return (
    <div className="pw-checks">
      {p.faults.map((f) => {
        const label = checkLabel(f.name);
        return (
          <span key={f.name} className={`pw-check ${f.on ? 'bad' : f.known ? 'good' : 'unknown'}`} title={f.on ? f.name : `${label}: OK`}>
            <Icon name={f.on ? 'alert' : 'tick'} size={14} />
            <span>{f.on ? f.name : label}</span>
          </span>
        );
      })}
    </div>
  );
}

function Foot({ p }: { p: Controls }) {
  useNow(60_000); // keeps "Updated Xm ago" current
  const ago = relTime(p.last?.state);
  return (
    <div className="purifier-foot pw-foot">
      <span className="muted small">{ago ? `Updated ${ago}` : ''}</span>
      {p.cfg?.refresh && (
        <button className={`chip-btn small ${p.refreshing ? 'active' : ''}`} disabled={!p.canRefresh} onClick={p.refresh}>
          <Icon name="refresh" size={14} />
          {p.refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      )}
    </div>
  );
}

export function PurifierPage() {
  const p = usePurifierControls();
  if (!p.cfg) return null;
  const tank = ppm(p.tank);
  const input = ppm(p.input);
  const full = p.tankFull?.state === 'on';
  const tankKnown = p.tankFull?.state === 'on' || p.tankFull?.state === 'off';
  const moving = !p.offline && !p.activeFaults.length;
  return (
    <section className={`panel clean-water pw-flow ${p.activeFaults.length ? 'fault' : ''}`}>
      <Faults p={p} />
      <div className="pw-grid">
        <Card label="Purification" aside={rangeText(p) && <span className={`chip ${p.inRange === 'ok' ? 'ok' : 'warn'}`}>{rangeText(p)}</span>} className="pw-diagram">
          <div className={`pw-path ${moving ? 'moving' : ''}`}>
            {p.cfg.inputTds && (
              <>
                <div className="pw-node">
                  <Icon name="tap" size={26} />
                  <span className="muted small">Tap water</span>
                  <b className="pw-num">{p.offline || input === undefined ? '–' : input}</b>
                  <span className="muted small">ppm</span>
                </div>
                <div className="pw-pipe" aria-hidden="true" />
                <div className="pw-node pw-ro">
                  <Icon name="purifier" size={26} />
                  <span className="muted small">Purifier</span>
                  <b className="pw-num">{p.removedPct ?? '–'}<small>%</small></b>
                  <span className="muted small">removed</span>
                </div>
                <div className="pw-pipe" aria-hidden="true" />
              </>
            )}
            <div className={`pw-tank ${full ? 'full' : ''} ${tankKnown ? '' : 'unknown'}`}>
              <div className="pw-water" />
              <div className="pw-tank-text">
                <span className="small">Drinking</span>
                <b className="pw-num">{p.offline || tank === undefined ? '–' : tank}</b>
                <span className="small">ppm</span>
              </div>
              {tankKnown && <span className="pw-tank-label small">{full ? 'Tank full' : 'Filling'}</span>}
            </div>
          </div>
          <Checks p={p} />
        </Card>
        <div className="pw-side">
          <Card label="Drinking water · 7 days">
            <TdsChart history={p.history} since={p.since} target={p.target} />
          </Card>
          {p.cfg.mode && p.options.length > 0 && (
            <Card label="Mode" aside={<span className="muted small">Tap twice to change</span>}>
              <ModeChips p={p} />
            </Card>
          )}
          <Foot p={p} />
        </div>
      </div>
    </section>
  );
}
