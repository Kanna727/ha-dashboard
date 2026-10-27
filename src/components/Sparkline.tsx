import { useId } from 'react';
import type { HistoryPoint } from '../ha/api';

// Area sparkline. Points are resampled onto the time axis so gaps in
// HA's state history (no change = no row) render as flat steps; a single
// point is a flat line up to now. `start` (epoch ms) overrides the left edge,
// e.g. to fit an entity whose history is shorter than `hours`. `fit` scales
// the line to the readings' own range instead of from zero (body weight).
export function Sparkline({
  points,
  height = 56,
  hours,
  start: startAt,
  color = 'var(--accent-energy)',
  fit = false,
}: {
  points: HistoryPoint[];
  height?: number;
  hours: number;
  start?: number;
  color?: string;
  fit?: boolean;
}) {
  // useId() contains ":" or "«»", which break url(#…); keep it to safe characters.
  const fillId = `spark${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const width = 300;
  if (!points.length) return <div className="spark-empty" style={{ height }} />;
  const end = Date.now();
  const start = startAt ?? end - hours * 3600_000;
  const hi = Math.max(...points.map((p) => p.v), fit ? -Infinity : 1);
  const lo = fit ? Math.min(...points.map((p) => p.v)) : 0;
  const pad = fit ? Math.max((hi - lo) * 0.15, 0.1) : 0;
  const [min, max] = [lo - pad, hi + pad];
  const x = (t: number) => ((Math.max(t, start) - start) / (end - start)) * width;
  const y = (v: number) => height - 2 - ((v - min) / (max - min)) * (height - 6);

  let d = `M ${x(points[0].t)} ${y(points[0].v)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H ${x(points[i].t)} V ${y(points[i].v)}`;
  }
  d += ` H ${width}`;
  const area = `${d} V ${height} H ${x(points[0].t)} Z`;

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${fillId})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
