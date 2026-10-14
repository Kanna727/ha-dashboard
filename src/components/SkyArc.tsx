import type { HassEntity } from 'home-assistant-js-websocket';
import { useNow } from '../hooks/useNow';
import { arcPoint, moonIllumination, moonLitPath, moonPhase, skyProgress, skyWindow } from '../lib/sky';

const W = 300;
const H = 70;
const LEFT = 14;
const RIGHT = W - 14;
const BASE = H - 8;
const ARC_H = 52;

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

// The sun's path from sunrise to sunset by day, the moon's (with its phase)
// from sunset to sunrise by night, with a dot for where it is now. Updates once
// a minute; the dot glides between positions.
export function SkyArc({ sun, className }: { sun: HassEntity | undefined; className?: string }) {
  const now = useNow(60_000).getTime();
  const win = skyWindow(sun?.state === 'above_horizon', sun?.attributes.next_rising as string, sun?.attributes.next_setting as string);
  if (!win) return null;

  const p = skyProgress(win, now);
  const pos = arcPoint(p, LEFT, RIGHT, BASE, ARC_H);
  const steps = 48;
  const path = (to: number) =>
    Array.from({ length: Math.round(steps * to) + 1 }, (_, i) => {
      const pt = arcPoint(i / steps, LEFT, RIGHT, BASE, ARC_H);
      return `${i ? 'L' : 'M'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    }).join(' ');
  const phase = moonPhase(now);
  const day = win.body === 'sun';

  return (
    <div className={`sky-arc ${day ? 'day' : 'night'} ${className ?? ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax meet" aria-hidden="true">
        <line x1={4} x2={W - 4} y1={BASE} y2={BASE} className="sky-horizon" />
        <path d={path(1)} className="sky-track" />
        <path d={path(p)} className="sky-done" />
        <g className="sky-body" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
          {day ? (
            <>
              <circle r={11} className="sun-halo" />
              <circle r={6.5} className="sun-disc" />
            </>
          ) : (
            <>
              <circle r={9} className="moon-dark" />
              <path d={moonLitPath(0, 0, 9, phase)} className="moon-lit" />
            </>
          )}
        </g>
      </svg>
      <div className="sky-labels">
        <span>{day ? 'Sunrise' : 'Sunset'} {hhmm(win.start)}</span>
        {!day && <span className="sky-phase">{Math.round(moonIllumination(phase) * 100)}% moon</span>}
        <span>{day ? 'Sunset' : 'Sunrise'} {hhmm(win.end)}</span>
      </div>
    </div>
  );
}
