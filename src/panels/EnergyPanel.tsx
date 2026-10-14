import { useEffect, useState } from 'react';
import { useHass } from '../ha/api';
import { EnergyCard } from '../components/EnergyCard';
import { OfflinePlugsNote } from '../components/OfflinePlugsNote';
import { fetchHomePowerHistory, useHomePower } from '../components/useHomePower';
import { Icon } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';
import { useTweenedNumber } from '../hooks/useTweenedNumber';
import { flowDensity, flowDuration } from '../lib/energyFlow';

function splitWatts(w: number | undefined): [string, string] {
  if (w === undefined) return ['–', ''];
  if (w >= 1000) return [(w / 1000).toFixed(w >= 10_000 ? 0 : 1), 'kW'];
  return [String(Math.round(w)), 'W'];
}

// A watt value that glides to new readings instead of jumping. Its own tiny
// component, so the per-frame re-render during a glide stays local.
function Watts({ w, className }: { w: number | undefined; className: string }) {
  const [v, u] = splitWatts(useTweenedNumber(w));
  return (
    <span className={className}>
      {v}
      <small>{u}</small>
    </span>
  );
}

// Tree layout: home on the left, one branch per live consumer on the right.
// Height follows the number of consumers, so the card never has gaps.
const ROW_H = 52;
const ROW_GAP = 10;
const MIN_H = 136;
const HOME_X = '18%'; // centre of the home circle (see .ef-home in CSS)
const ROWS_X = '40%'; // left edge of the consumer rows

export function EnergyPanel() {
  const hass = useHass();
  const modal = useModal();
  const { totalW, consumers, offline } = useHomePower();
  const [peak, setPeak] = useState<number>();

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchHomePowerHistory(hass, 24)
        .then((pts) => {
          // reduce, not Math.max(...): a day of 5 s samples can exceed the spread arg limit
          if (alive && pts.length) setPeak(pts.reduce((m, p) => Math.max(m, p.v), -Infinity));
        })
        .catch(() => undefined);
    load();
    const id = window.setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hass]);

  const drawing = consumers
    .filter((c) => c.w >= 5)
    .sort((a, b) => b.w - a.w);
  const top = drawing.slice(0, 4);
  const [pv, pu] = splitWatts(peak);
  const maxW = top.reduce((m, c) => Math.max(m, c.w), 0);

  const rowsH = top.length ? top.length * ROW_H + (top.length - 1) * ROW_GAP : 0;
  const height = Math.max(rowsH, MIN_H);
  const offset = (height - rowsH) / 2;
  const rowY = (i: number) => offset + i * (ROW_H + ROW_GAP) + ROW_H / 2;

  return (
    <section className="panel energy-panel">
      <PanelHead
        label="Home energy"
        summary={peak !== undefined ? `24h peak ${pv} ${pu}` : `${drawing.length} drawing power`}
        onMore={() => modal.open({ title: 'Power', icon: 'flash', accent: 'var(--accent-energy)', body: <EnergyCard /> })}
      />
      <div className="ef" style={{ height }}>
        <svg className="ef-lines" width="100%" height={height} aria-hidden="true">
          {/* Each branch: a faint track plus round particles flowing home → consumer.
              Faster for bigger draws; denser in three buckets (see lib/energyFlow.ts). */}
          {top.map((c, i) => (
            <g key={c.entity} style={{ stroke: c.color }}>
              <line x1={HOME_X} y1={height / 2} x2={ROWS_X} y2={rowY(i)} className="flow-track" />
              <line
                x1={HOME_X}
                y1={height / 2}
                x2={ROWS_X}
                y2={rowY(i)}
                className={`flow-particles ${flowDensity(c.w)}`}
                style={{ animationDuration: `${flowDuration(c.w, maxW).toFixed(2)}s` }}
              />
            </g>
          ))}
        </svg>
        <div className="ef-home" style={{ top: height / 2 }}>
          <Icon name="homePower" size={22} />
          <Watts w={totalW} className="ef-home-val" />
          <div className="flow-label">Home</div>
        </div>
        <ul className="ef-rows" style={{ top: offset }}>
          {top.map((c) => {
            const share = totalW ? Math.min(100, (c.w / totalW) * 100) : 0;
            return (
              <li key={c.entity} style={{ ['--ring' as string]: c.color, height: ROW_H }}>
                <span className="ef-dot"><Icon name={c.icon} size={18} /></span>
                <span className="ef-text">
                  <span className="ef-name">{c.name}</span>
                  <span className="ef-bar"><i style={{ width: `${share}%` }} /></span>
                </span>
                <Watts w={c.w} className="ef-val" />
              </li>
            );
          })}
          {top.length === 0 && <li className="ef-empty muted">Nothing else drawing power</li>}
        </ul>
      </div>
      <OfflinePlugsNote offline={offline} hasTotal={totalW !== undefined} compact />
    </section>
  );
}
