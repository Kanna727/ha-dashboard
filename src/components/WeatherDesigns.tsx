// Weather card bodies: the owner is choosing between these designs (picker in
// mock builds, ?wx=<id> anywhere). The panel frame and header live in
// panels/WeatherPanel.tsx; everything below the header is a design.
import type { HassEntity } from 'home-assistant-js-websocket';
import type { ForecastDay } from '../ha/api';
import { compass, hoursForToday, nightAt, rainNote, rainOutlook, uvLevel } from '../lib/weather';
import { sunTimes } from '../lib/sky';
import { useNow } from '../hooks/useNow';
import { Icon } from './Icon';
import { WeatherIcon } from './WeatherIcon';
import { DailyList, HourlyChart, WeatherStats, stats } from './WeatherDetail';
import type { WeatherNow } from './useWeather';

export const WX_DESIGNS = [
  { id: 'tiles', label: 'Tiles' },
  { id: 'instruments', label: 'Instruments' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'glance', label: 'Glance' },
] as const;
export type WxDesign = (typeof WX_DESIGNS)[number]['id'];

export interface DesignProps {
  now: WeatherNow;
  sun: HassEntity | undefined;
  hourly: ForecastDay[];
  daily: ForecastDay[];
  days: number;
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const isNight = (sun: HassEntity | undefined) => sun?.state === 'below_horizon';
const nightOf = (h: ForecastDay, sun: HassEntity | undefined) =>
  h.is_daytime !== undefined ? !h.is_daytime : nightAt(Date.parse(h.datetime), sun?.attributes.next_rising as string, sun?.attributes.next_setting as string);

// Today's sunrise and sunset (the page sky shows where the sun and moon are).
function SunTimes({ sun }: { sun: HassEntity | undefined }) {
  const times = sunTimes(sun?.state === 'above_horizon', sun?.attributes.next_rising as string, sun?.attributes.next_setting as string);
  if (!times.length) return null;
  return (
    <div className="wx-sun">
      {times.map(({ kind, at }) => (
        <span key={kind} title={kind === 'sunrise' ? 'Sunrise' : 'Sunset'}>
          <Icon name={kind} size={16} />
          {hhmm(at)}
        </span>
      ))}
    </div>
  );
}

const showFeels = (n: WeatherNow) => n.feelsLike !== undefined && n.temp !== undefined && Math.round(n.feelsLike) !== Math.round(n.temp);

// Big icon, temperature, condition, feels-like and sun times.
function NowBlock({ now, sun, small }: { now: WeatherNow; sun: HassEntity | undefined; small?: boolean }) {
  return (
    <div className={`wx-now ${small ? 'small' : ''}`}>
      <WeatherIcon condition={now.condition} night={isNight(sun)} size={small ? 68 : 96} animated className="wx-now-img" />
      <div>
        <div className="wx-temp">{now.temp !== undefined ? Math.round(now.temp) : '–'}<sup>°</sup></div>
        <div className="wx-cond">{now.label}</div>
        {showFeels(now) && <div className="muted">Feels like {Math.round(now.feelsLike!)}°</div>}
        <SunTimes sun={sun} />
      </div>
    </div>
  );
}

function HourStrip({ hourly, sun }: { hourly: ForecastDay[]; sun: HassEntity | undefined }) {
  if (!hourly.length) return null;
  return (
    <div className="wx-hours" aria-label="Hourly forecast">
      {hoursForToday(hourly).map((h, i, all) => {
        const t = new Date(h.datetime);
        const newDay = i > 0 && t.getDate() !== new Date(all[i - 1].datetime).getDate();
        return (
          <div key={h.datetime} className={`wx-hour ${i === 0 ? 'now' : ''}`}>
            <span className="wx-htime">{i === 0 ? 'Now' : newDay ? t.toLocaleDateString([], { weekday: 'short' }) : t.toLocaleTimeString([], { hour: '2-digit', hour12: false })}</span>
            <WeatherIcon condition={h.condition} night={nightOf(h, sun)} size={36} />
            <span className="wx-htemp">{Math.round(h.temperature)}°</span>
            <span className="wx-hrain">{rainNote(h)}</span>
          </div>
        );
      })}
    </div>
  );
}

function DayTiles({ daily, days }: { daily: ForecastDay[]; days: number }) {
  return (
    <div className="wx-days">
      {daily.slice(0, days).map((d, i) => (
        <div key={d.datetime} className="wx-day">
          <div className="wx-dname">{i === 0 ? 'Today' : new Date(d.datetime).toLocaleDateString([], { weekday: 'short' })}</div>
          <WeatherIcon condition={d.condition} size={44} />
          <div className="wx-hi">{Math.round(d.temperature)}°</div>
          {d.templow !== undefined && <div className="muted small">{Math.round(d.templow)}°</div>}
          {rainNote(d) && <div className="wx-rain">{rainNote(d)}</div>}
        </div>
      ))}
    </div>
  );
}

/* ---------- 1. Tiles: reading tiles, hourly strip, day tiles ---------- */

function Tiles({ now, sun, hourly, daily, days }: DesignProps) {
  return (
    <>
      <NowBlock now={now} sun={sun} />
      <WeatherStats now={now} hourly={hourly} compact />
      <HourStrip hourly={hourly} sun={sun} />
      <DayTiles daily={daily} days={days} />
    </>
  );
}

/* ---------- 2. Instruments: dials for wind, rain, humidity and UV ---------- */

const C = 32;
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
  const ticks = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg className="wx-dial-svg" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx={C} cy={C} r={R} className="wx-dial-track thin" />
      {ticks.map((a) => (
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

// 0–12 on a half circle, coloured by WHO band.
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

function Instruments({ now, sun, hourly, daily, days }: DesignProps) {
  const rain = now.rainChance ?? hourly[0]?.precipitation_probability;
  const dials = [
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
  ].filter((d): d is { key: string; svg: JSX.Element; label: string; sub: string; tone?: string } => !!d);

  return (
    <>
      <NowBlock now={now} sun={sun} />
      {dials.length > 0 && (
        <div className="wx-dials">
          {dials.map((d) => (
            <div key={d.key} className={`wx-dial ${d.tone ?? ''}`}>
              {d.svg}
              <div className="wx-dial-label">{d.label}</div>
              {d.sub && <div className="wx-dial-sub">{d.sub}</div>}
            </div>
          ))}
        </div>
      )}
      <HourStrip hourly={hourly} sun={sun} />
      <DayTiles daily={daily} days={days} />
    </>
  );
}

/* ---------- 3. Timeline: what the rain will do, then the next 12 hours ---------- */

function RainBars({ hourly, sun }: { hourly: ForecastDay[]; sun: HassEntity | undefined }) {
  const start = Date.now() - 3_600_000;
  const hours = hourly.filter((h) => Date.parse(h.datetime) > start).slice(0, 12);
  if (!hours.length) return null;
  const maxMm = Math.max(1, ...hours.map((h) => h.precipitation ?? 0));
  return (
    <div className="wx-rbars" aria-label="Rain chance, next 12 hours">
      {hours.map((h, i) => {
        const p = h.precipitation_probability !== undefined ? h.precipitation_probability : Math.min(100, ((h.precipitation ?? 0) / maxMm) * 100);
        const t = new Date(h.datetime);
        return (
          <div key={h.datetime} className={`wx-rbar ${i === 0 ? 'now' : ''}`}>
            {i % 3 === 0 ? <WeatherIcon condition={h.condition} night={nightOf(h, sun)} size={26} /> : <span className="wx-rbar-icon" />}
            <span className="wx-rbar-temp">{Math.round(h.temperature)}°</span>
            <span className="wx-rbar-pct">{h.precipitation_probability !== undefined && p >= 10 ? Math.round(p) : ''}</span>
            <span className="wx-rbar-track">
              <i style={{ height: `${Math.max(p > 0 ? 6 : 0, p)}%`, opacity: 0.35 + 0.65 * (p / 100) }} />
            </span>
            <span className="wx-rbar-time">{i === 0 ? 'Now' : i % 3 === 0 ? t.toLocaleTimeString([], { hour: '2-digit', hour12: false }) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function Timeline({ now, sun, hourly, daily, days }: DesignProps) {
  const time = useNow(60_000).getTime();
  const raining = (now.rainRate ?? 0) > 0 || ['rainy', 'pouring', 'lightning-rainy'].includes(now.condition ?? '');
  const outlook = rainOutlook(hourly, time, raining);
  const chips = stats(now, hourly).filter((s) => s.key !== 'rain' && s.key !== 'cloud' && s.key !== 'pressure');
  return (
    <>
      <NowBlock now={now} sun={sun} small />
      {outlook.text && (
        <div className={`wx-outlook ${outlook.tone}`}>
          <Icon name={outlook.tone === 'storm' ? 'storm' : outlook.tone === 'dry' ? 'uv' : 'umbrella'} size={18} />
          <span>{outlook.text}</span>
        </div>
      )}
      <RainBars hourly={hourly} sun={sun} />
      {chips.length > 0 && (
        <div className="wx-chips">
          {chips.map((s) => (
            <span key={s.key} className={`wx-chip ${s.tone ?? ''}`} title={s.label}>
              {s.rotate !== undefined ? (
                <span className="wx-wind-arrow" style={{ transform: `rotate(${s.rotate}deg)` }}><Icon name="arrow" size={14} /></span>
              ) : (
                <Icon name={s.icon} size={14} />
              )}
              <b>{s.value}{s.unit && <small>{s.unit}</small>}</b>
              <span className="muted">{s.key === 'uv' ? `UV ${s.sub}` : s.key === 'wind' && now.windBearing !== undefined ? compass(now.windBearing) : s.label}</span>
            </span>
          ))}
        </div>
      )}
      <DailyList days={daily.slice(0, days)} compact />
    </>
  );
}

/* ---------- 4. Glance: hero beside the key readings, a 12 h chart, day tiles ---------- */

function Glance({ now, sun, hourly, daily, days }: DesignProps) {
  const list = stats(now, hourly).slice(0, 5);
  return (
    <>
      <div className="wx-glance">
        <div className="wx-glance-hero">
          <WeatherIcon condition={now.condition} night={isNight(sun)} size={72} animated className="wx-now-img" />
          <div className="wx-temp">{now.temp !== undefined ? Math.round(now.temp) : '–'}<sup>°</sup></div>
          <div className="wx-cond">{now.label}</div>
          {showFeels(now) && <div className="muted small">Feels like {Math.round(now.feelsLike!)}°</div>}
          <SunTimes sun={sun} />
        </div>
        <ul className="wx-glance-list">
          {list.map((s) => (
            <li key={s.key} className={s.tone ?? ''}>
              <Icon name={s.icon} size={16} />
              <span className="wx-glance-label">{s.label}</span>
              <span className="wx-glance-val">
                {s.rotate !== undefined && (
                  <span className="wx-wind-arrow" style={{ transform: `rotate(${s.rotate}deg)` }}><Icon name="arrow" size={12} /></span>
                )}
                {s.value}
                {s.unit && <small>{s.unit}</small>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <HourlyChart hourly={hourly} count={12} minSlot={22} />
      <DayTiles daily={daily} days={days} />
    </>
  );
}

export const DESIGN_BODIES: Record<WxDesign, (p: DesignProps) => JSX.Element> = { tiles: Tiles, instruments: Instruments, timeline: Timeline, glance: Glance };
