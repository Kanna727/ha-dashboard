// The Weather card's instruments: wind compass, rain/storm rings, humidity
// ring and UV gauge. Plain SVG; values come from useWeatherNow().
import type { ForecastDay } from '../ha/api';
import { compass, uvLevel } from '../lib/weather';
import type { WeatherNow } from './useWeather';

const C = 32; // centre of the 64×64 view box
const R = 24;

function Ring({ pct, r = R, className }: { pct: number; r?: number; className: string }) {
  const circ = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct)) / 100;
  return (
    <>
      <circle cx={C} cy={C} r={r} className="wx-dial-track" />
      {p > 0 && <circle cx={C} cy={C} r={r} className={`wx-dial-ring ${className}`} strokeDasharray={`${p * circ} ${circ}`} transform={`rotate(-90 ${C} ${C})`} />}
    </>
  );
}

function WindDial({ now }: { now: WeatherNow }) {
  return (
    <svg className="wx-dial-svg" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx={C} cy={C} r={R} className="wx-dial-track thin" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} className={`wx-dial-tick ${a === 0 ? 'north' : ''}`} x1={C} y1={C - R + 1} x2={C} y2={C - R + (a % 90 ? 4 : 6)} transform={`rotate(${a} ${C} ${C})`} />
      ))}
      <text className="wx-dial-n" x={C} y={5.5}>N</text>
      {now.windBearing !== undefined && (
        // Points where the wind blows (the bearing is where it comes from).
        <g className="wx-dial-needle" style={{ transform: `rotate(${now.windBearing + 180}deg)` }}>
          <path d={`M${C} ${C - R + 2} l5 9 l-5 -2.5 l-5 2.5 z`} />
        </g>
      )}
      <text className="wx-dial-val" x={C} y={C + 4}>{now.windSpeed !== undefined ? Math.round(now.windSpeed) : '–'}</text>
      <text className="wx-dial-unit" x={C} y={C + 13}>{now.windUnit}</text>
    </svg>
  );
}

// 0–12 on a half circle, coloured by WHO band, with a dot at the current index.
function UvGauge({ uv }: { uv: number }) {
  const cy = 40;
  const pt = (v: number) => {
    const a = Math.PI * (1 - Math.min(12, v) / 12);
    return [C + R * Math.cos(a), cy - R * Math.sin(a)];
  };
  const arc = (a: number, b: number) => {
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const bands: [number, number, string][] = [[0, 3, 'low'], [3, 6, 'moderate'], [6, 8, 'high'], [8, 11, 'very-high'], [11, 12, 'extreme']];
  const [mx, my] = pt(uv);
  return (
    <svg className="wx-dial-svg" viewBox="0 0 64 64" aria-hidden="true">
      {bands.map(([a, b, tone]) => (
        <path key={tone} className={`wx-uv-band uv-${tone}`} d={arc(a + 0.12, b - 0.12)} />
      ))}
      <circle className="wx-uv-dot" cx={mx} cy={my} r={4.5} />
      <text className="wx-dial-val" x={C} y={cy + 2}>{Math.round(uv)}</text>
      <text className="wx-dial-unit" x={C} y={cy + 12}>UV</text>
    </svg>
  );
}

interface Dial {
  key: string;
  svg: JSX.Element;
  label: string;
  sub: string;
  tone?: string;
}

// Wind, rain, humidity and UV; dials the integration has no data for drop out.
export function WeatherDials({ now, hourly }: { now: WeatherNow; hourly: ForecastDay[] }) {
  const rain = now.rainChance ?? hourly[0]?.precipitation_probability;
  const dials: (Dial | false)[] = [
    now.windSpeed !== undefined && {
      key: 'wind',
      svg: <WindDial now={now} />,
      label: 'Wind',
      sub: [now.windGust !== undefined && `Gusts ${Math.round(now.windGust)}`, now.windBearing !== undefined && compass(now.windBearing)].filter(Boolean).join(' · '),
    },
    rain !== undefined && {
      key: 'rain',
      svg: (
        <svg className="wx-dial-svg" viewBox="0 0 64 64" aria-hidden="true">
          <Ring pct={rain} className="rain" />
          {now.storm !== undefined && <Ring pct={now.storm} r={R - 7} className="storm" />}
          <text className="wx-dial-val" x={C} y={C + 4}>{Math.round(rain)}<tspan className="wx-dial-pct">%</tspan></text>
        </svg>
      ),
      label: 'Rain',
      sub: now.rainRate ? `${now.rainRate.toFixed(1)} ${now.rainRateUnit}` : now.storm !== undefined ? `Storms ${Math.round(now.storm)}%` : 'Chance now',
      tone: rain >= 60 || !!now.rainRate ? 'wet' : undefined,
    },
    now.humidity !== undefined && {
      key: 'humidity',
      svg: (
        <svg className="wx-dial-svg" viewBox="0 0 64 64" aria-hidden="true">
          <Ring pct={now.humidity} className="humidity" />
          <text className="wx-dial-val" x={C} y={C + 4}>{Math.round(now.humidity)}<tspan className="wx-dial-pct">%</tspan></text>
        </svg>
      ),
      label: 'Humidity',
      sub: now.dewPoint !== undefined ? `Dew point ${Math.round(now.dewPoint)}°` : '',
    },
    now.uv !== undefined && { key: 'uv', svg: <UvGauge uv={now.uv} />, label: 'UV index', sub: uvLevel(now.uv).label, tone: `uv-${uvLevel(now.uv).tone}` },
  ];
  const shown = dials.filter((d): d is Dial => !!d);
  if (!shown.length) return null;
  return (
    <div className="wx-dials">
      {shown.map((d) => (
        <div key={d.key} className={`wx-dial ${d.tone ?? ''}`}>
          {d.svg}
          <div className="wx-dial-label">{d.label}</div>
          {d.sub && <div className="wx-dial-sub">{d.sub}</div>}
        </div>
      ))}
    </div>
  );
}
