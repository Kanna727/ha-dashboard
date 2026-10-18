import { useEffect, useState } from 'react';
import type { SkyScene } from '../lib/skyScene';
import { CONDITIONS, fmtHour, moonName } from '../lib/skySim';

// ?skyTest (any build): a floating panel to preview the page sky at any hour,
// in any weather, wind, humidity and moon phase. Only the page sky follows it;
// nothing is sent to HA.
export const SKY_TEST = new URLSearchParams(window.location.search).has('skyTest');

export interface SkySim {
  hour: number | null; // each null = live
  condition: string | null;
  wind: number | null; // km/h
  humidity: number | null; // %
  moon: number | null; // phase 0–1
}

const DAY_SECONDS = 60; // ▶ runs a whole day in a minute
const TICK_MS = 100;

function Row({
  label,
  min,
  max,
  step,
  value,
  live,
  text,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  live: boolean;
  text: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="sky-test-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <span className="sky-test-val">{live ? 'Live' : text}</span>
      <button className="sky-test-live" onClick={() => onChange(null)} disabled={live} aria-label={`${label}: live`}>
        ⟲
      </button>
    </div>
  );
}

export function SkyTestPanel({ sim, onChange, live, scene }: { sim: SkySim; onChange: (s: SkySim) => void; live: string | undefined; scene: SkyScene }) {
  const [open, setOpen] = useState(true);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      onChange({ ...sim, hour: ((sim.hour ?? new Date().getHours()) + (24 * TICK_MS) / (DAY_SECONDS * 1000)) % 24 });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, sim, onChange]);

  if (!open) {
    return (
      <button className="sky-test sky-test-chip" onClick={() => setOpen(true)}>
        Sky test
      </button>
    );
  }

  const hour = sim.hour ?? new Date().getHours() + new Date().getMinutes() / 60;
  return (
    <div className="sky-test" role="group" aria-label="Sky test">
      <div className="sky-test-head">
        <strong>Sky test</strong>
        <span className="muted">
          sun {scene.elevation.toFixed(0)}° · {moonName(scene.moon.phase)}
        </span>
        <button onClick={() => setOpen(false)} aria-label="Minimise">
          –
        </button>
      </div>
      <Row
        label="Time"
        min={0}
        max={24}
        step={0.25}
        value={hour}
        live={sim.hour === null}
        text={fmtHour(hour)}
        onChange={(v) => {
          setPlaying(false);
          onChange({ ...sim, hour: v === null ? null : v % 24 });
        }}
      />
      <div className="sky-test-row">
        <span />
        <button
          className="sky-test-btn"
          onClick={() => {
            if (sim.hour === null) onChange({ ...sim, hour });
            setPlaying((p) => !p);
          }}
        >
          {playing ? 'Pause' : 'Play day'}
        </button>
      </div>
      <div className="sky-test-row">
        <span>Weather</span>
        <select value={sim.condition ?? ''} onChange={(e) => onChange({ ...sim, condition: e.target.value || null })} aria-label="Weather">
          <option value="">Live ({live ?? 'unknown'})</option>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <Row
        label="Wind"
        min={0}
        max={80}
        step={1}
        value={sim.wind ?? scene.wind.kmh}
        live={sim.wind === null}
        text={`${sim.wind} km/h`}
        onChange={(v) => onChange({ ...sim, wind: v })}
      />
      <Row
        label="Humidity"
        min={0}
        max={100}
        step={1}
        value={sim.humidity ?? 60}
        live={sim.humidity === null}
        text={`${sim.humidity}%`}
        onChange={(v) => onChange({ ...sim, humidity: v })}
      />
      <Row
        label="Moon"
        min={0}
        max={1}
        step={0.01}
        value={sim.moon ?? scene.moon.phase}
        live={sim.moon === null}
        text={moonName(sim.moon ?? 0)}
        onChange={(v) => onChange({ ...sim, moon: v })}
      />
    </div>
  );
}
