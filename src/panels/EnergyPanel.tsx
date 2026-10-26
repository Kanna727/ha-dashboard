import { useEffect, useRef, useState } from 'react';
import { useHass } from '../ha/api';
import { EnergyCard } from '../components/EnergyCard';
import { OfflinePlugsNote } from '../components/OfflinePlugsNote';
import { fetchHomePowerHistory, useHomePower } from '../components/useHomePower';
import { GlanceTile } from '../components/GlanceTile';
import { Icon } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';
import { useTweenedNumber } from '../hooks/useTweenedNumber';
import { flowDensity, flowDuration, flowLevel } from '../lib/energyFlow';

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

// The home circle's rim, split into each consumer's share of the total (grey
// for the plugs not listed), clockwise from the top, biggest first. Sized to
// sit on .ef-home's 4 px border (112 px circle).
const RIM_R = 54;
const RIM_C = 2 * Math.PI * RIM_R;
const RIM_GAP = 5;
const OTHER_COLOR = '#64748b';

function SplitRim({ parts }: { parts: { key: string; color: string; w: number }[] }) {
  const sum = parts.reduce((s, p) => s + p.w, 0);
  const gap = parts.length > 1 ? RIM_GAP : 0;
  let at = 0;
  return (
    <svg className="ef-rim" viewBox="0 0 112 112" aria-hidden="true">
      <g transform="rotate(-90 56 56)">
        {parts.map((p) => {
          const len = sum ? (p.w / sum) * RIM_C : 0;
          const start = at;
          at += len;
          return (
            <circle
              key={p.key}
              cx="56"
              cy="56"
              r={RIM_R}
              style={{ stroke: p.color, strokeDasharray: `${Math.max(0.5, len - gap)} ${RIM_C}`, strokeDashoffset: -start }}
            />
          );
        })}
      </g>
    </svg>
  );
}

export function EnergyPanel() {
  const hass = useHass();
  const modal = useModal();
  const { totalW, consumers, offline } = useHomePower();
  const [peak, setPeak] = useState<number>();
  // Each plug's particle level, kept between renders for its hysteresis.
  const levels = useRef(new Map<string, number>());

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
  const flows = top.map((c) => {
    const level = flowLevel(c.w, levels.current.get(c.entity));
    levels.current.set(c.entity, level);
    return level;
  });

  const topW = top.reduce((s, c) => s + c.w, 0);
  const otherW = Math.max(0, (totalW ?? topW) - topW);
  const rim = [
    ...top.map((c) => ({ key: c.entity, color: c.color, w: c.w })),
    ...(otherW >= 5 ? [{ key: 'other', color: OTHER_COLOR, w: otherW }] : []),
  ];

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
              Speed and density come from that plug's own watts (see lib/energyFlow.ts). */}
          {top.map((c, i) => (
            <g key={c.entity} style={{ stroke: c.color }}>
              <line x1={HOME_X} y1={height / 2} x2={ROWS_X} y2={rowY(i)} className="flow-track" />
              <line
                x1={HOME_X}
                y1={height / 2}
                x2={ROWS_X}
                y2={rowY(i)}
                className={`flow-particles ${flowDensity(flows[i])}`}
                style={{ animationDuration: `${flowDuration(flows[i]).toFixed(2)}s` }}
              />
            </g>
          ))}
        </svg>
        {/* With nothing drawing, the plain blue ring stays. Otherwise the rim is
            split by share and the circle glows in the biggest consumer's colour. */}
        <div
          className={`ef-home${rim.length ? ' split' : ''}`}
          style={{ top: height / 2, ...(top[0] ? { ['--home-glow' as string]: top[0].color } : {}) }}
        >
          {rim.length > 0 && <SplitRim parts={rim} />}
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

// Home page tile (GlancePanel): the home's power now, filled against 4 kW and
// green, amber (1.5 kW+) or red (3 kW+); the biggest user under it.
export function EnergyTile() {
  const { totalW, consumers } = useHomePower();
  const [v, u] = splitWatts(totalW);
  const top = [...consumers].filter((c) => !c.offline && c.w >= 5).sort((a, b) => b.w - a.w)[0];
  const w = totalW ?? 0;
  return (
    <GlanceTile
      icon="flash"
      label="Power now"
      page="energy"
      color="var(--accent-energy)"
      level={totalW === undefined ? undefined : (w / 4000) * 100}
      fill={w >= 3000 ? 'var(--danger)' : w >= 1500 ? 'var(--accent-light)' : 'var(--accent-energy)'}
      value={v}
      unit={u}
      sub={top ? `${top.name} ${splitWatts(top.w).join(' ')}` : undefined}
    />
  );
}
