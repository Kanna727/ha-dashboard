import { useEffect, useState, type ReactNode } from 'react';

export interface Bar {
  key: number | string;
  // Stacked from the bottom; most charts have one part.
  parts: number[];
  partial?: boolean; // still running: hatched
  muted?: boolean; // e.g. a period the data starts part-way through
  color?: string; // overrides `colors` for a one-part bar
  label: string; // read out, and shown under the chart when picked
}

// Bars that grow in, tap one to read it. The last bar is picked until another
// is tapped. `colors` per stacked part (CSS colours), `caption` renders the
// picked bar's line under the chart.
export function BarChart({
  bars,
  colors,
  height = 96,
  caption,
}: {
  bars: Bar[];
  colors: string[];
  height?: number;
  caption: (bar: Bar) => ReactNode;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  // A new set of bars (another period) starts from the latest again.
  const first = bars[0]?.key;
  useEffect(() => setPicked(null), [first, bars.length]);
  if (!bars.length) return <div className="spark-empty" style={{ height }} />;
  const total = (b: Bar) => b.parts.reduce((s, v) => s + Math.max(0, v), 0);
  const max = Math.max(...bars.map(total), 1e-9);
  const at = picked !== null && picked < bars.length ? picked : bars.length - 1;
  return (
    <div className="bar-chart">
      <div className="bc-bars" role="list" style={{ height }}>
        {bars.map((b, i) => (
          <button
            key={b.key}
            role="listitem"
            className={`bc-bar ${b.partial ? 'partial' : ''} ${b.muted ? 'muted' : ''} ${at === i ? 'picked' : ''}`}
            style={{ ['--i' as string]: i }}
            onClick={() => setPicked(i)}
            aria-label={b.label}
          >
            <span className="bc-stack" style={{ height: `${(total(b) / max) * 100}%` }}>
              {b.parts.map((v, j) => (
                <i key={j} style={{ flexGrow: Math.max(0, v), background: b.color ?? colors[j % colors.length] }} />
              ))}
            </span>
          </button>
        ))}
      </div>
      <div className="bc-caption">{caption(bars[at])}</div>
    </div>
  );
}
