import { useEffect, useState, type ReactNode } from 'react';
import { SUN, WEATHER } from '../config/entities';
import { useHass, type ForecastDay } from '../ha/api';
import { useForecast } from '../ha/forecast';
import { useEntity } from '../ha/store';
import { compass, conditionText, nightAt, rangeBar, uvLevel } from '../lib/weather';
import { Icon, type IconName } from './Icon';
import { WeatherIcon } from './WeatherIcon';
import { useWeatherNow, type WeatherNow } from './useWeather';

const r = (v: number | undefined, digits = 0) => (v === undefined ? undefined : digits ? v.toFixed(digits) : String(Math.round(v)));

// The current hour's slot: the hourly forecast starts at the top of the hour.
const thisHour = (hourly: ForecastDay[]) => {
  const now = Date.now();
  return hourly.find((h) => Date.parse(h.datetime) > now - 3_600_000);
};

interface Stat {
  key: string;
  icon: IconName;
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  tone?: string;
  rotate?: number;
}

// Every reading worth showing, best first; ones the integration lacks drop out.
function stats(n: WeatherNow, hourly: ForecastDay[]): Stat[] {
  const out: (Stat | false)[] = [];
  const rain = n.rainChance ?? thisHour(hourly)?.precipitation_probability;
  const raining = n.rainRate !== undefined && n.rainRate > 0;
  out.push(
    rain !== undefined && {
      key: 'rain',
      icon: 'umbrella',
      label: 'Rain',
      value: r(rain)!,
      unit: '%',
      sub: raining ? `${n.rainRate!.toFixed(1)} ${n.rainRateUnit} now` : 'Chance now',
      tone: rain >= 60 || raining ? 'wet' : undefined,
    },
    n.storm !== undefined && {
      key: 'storm',
      icon: 'storm',
      label: 'Storms',
      value: r(n.storm)!,
      unit: '%',
      sub: 'Thunderstorm',
      tone: n.storm >= 50 ? 'warn' : undefined,
    },
    n.windSpeed !== undefined && {
      key: 'wind',
      icon: 'wind',
      // The bearing is where the wind comes from; the arrow shows where it blows.
      rotate: n.windBearing !== undefined ? n.windBearing + 180 : undefined,
      label: 'Wind',
      value: r(n.windSpeed)!,
      unit: n.windUnit,
      sub: [n.windGust !== undefined && `Gusts ${Math.round(n.windGust)}`, n.windBearing !== undefined && compass(n.windBearing)]
        .filter(Boolean)
        .join(' · '),
    },
    n.humidity !== undefined && {
      key: 'humidity',
      icon: 'humidity',
      label: 'Humidity',
      value: r(n.humidity)!,
      unit: '%',
      sub: n.dewPoint !== undefined ? `Dew point ${Math.round(n.dewPoint)}°` : undefined,
    },
    n.uv !== undefined && {
      key: 'uv',
      icon: 'uv',
      label: 'UV index',
      value: r(n.uv)!,
      sub: uvLevel(n.uv).label,
      tone: `uv-${uvLevel(n.uv).tone}`,
    },
    n.visibility !== undefined && {
      key: 'visibility',
      icon: 'eye',
      label: 'Visibility',
      value: r(n.visibility)!,
      unit: n.visibilityUnit,
      sub: n.visibility < 2 ? 'Poor' : n.visibility < 8 ? 'Hazy' : 'Clear',
    },
    n.cloud !== undefined && { key: 'cloud', icon: 'cloud', label: 'Clouds', value: r(n.cloud)!, unit: '%', sub: 'Cover' },
    n.pressure !== undefined && { key: 'pressure', icon: 'gauge', label: 'Pressure', value: r(n.pressure)!, unit: n.pressureUnit },
  );
  return out.filter((s): s is Stat => !!s);
}

// Every current reading, as tiles (the popup).
export function WeatherStats({ now, hourly }: { now: WeatherNow; hourly: ForecastDay[] }) {
  const list = stats(now, hourly);
  if (!list.length) return null;
  return (
    <div className="wx-stats">
      {list.map((s) => (
        <div key={s.key} className={`wx-stat ${s.tone ?? ''}`}>
          <div className="wx-stat-head">
            <Icon name={s.icon} size={15} className="wx-stat-icon" />
            <span>{s.label}</span>
          </div>
          <div className="wx-stat-val">
            {s.rotate !== undefined && (
              <span className="wx-wind-arrow" style={{ transform: `rotate(${s.rotate}deg)` }} aria-hidden="true">
                <Icon name="arrow" size={14} />
              </span>
            )}
            {s.value}
            {s.unit && <small>{s.unit}</small>}
          </div>
          {s.sub && <div className="wx-stat-sub">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

const MIN_SLOT = 30; // px per hour; wider popups stretch it, narrow ones scroll
const ICON_Y = 0;
const TEMP_TOP = 50;
const TEMP_BOTTOM = 96;
const BAR_BOTTOM = 150;
const BAR_H = 32;
const CHART_H = 172;

// Width of an element, kept current. A callback ref, because the element only
// appears once the forecast has loaded (a mount-time effect would miss it).
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

// Next `count` hours: icons on top, the temperature line, then rain-chance bars
// (mm when the forecast has no chance) above a label for every hour.
export function HourlyChart({ hourly, count = 24, minSlot = MIN_SLOT }: { hourly: ForecastDay[]; count?: number; minSlot?: number }) {
  const sun = useEntity(SUN);
  const [wrap, wrapWidth] = useWidth<HTMLDivElement>();
  const start = Date.now() - 3_600_000;
  const hours = hourly.filter((h) => Date.parse(h.datetime) > start).slice(0, count);
  if (hours.length < 2) return null;

  const slot = Math.max(minSlot, wrapWidth / hours.length);
  const width = hours.length * slot;
  const temps = hours.map((h) => h.temperature);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const y = (t: number) => TEMP_BOTTOM - ((t - lo) / (hi - lo || 1)) * (TEMP_BOTTOM - TEMP_TOP);
  const x = (i: number) => i * slot + slot / 2;
  const maxMm = Math.max(1, ...hours.map((h) => h.precipitation ?? 0));
  const share = (h: ForecastDay) =>
    h.precipitation_probability !== undefined ? h.precipitation_probability / 100 : Math.min(1, (h.precipitation ?? 0) / maxMm);
  const line = hours.map((h, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(h.temperature).toFixed(1)}`).join(' ');
  const night = (h: ForecastDay) =>
    h.is_daytime !== undefined
      ? !h.is_daytime
      : nightAt(Date.parse(h.datetime), sun?.attributes.next_rising as string, sun?.attributes.next_setting as string);

  return (
    <div className="wx-chart-wrap" ref={wrap}>
      <svg className="wx-chart" width={width} height={CHART_H} viewBox={`0 0 ${width} ${CHART_H}`} role="img" aria-label={`Temperature and rain chance, next ${hours.length} hours`}>
        <line className="wx-chart-base" x1={0} x2={width} y1={BAR_BOTTOM + 0.5} y2={BAR_BOTTOM + 0.5} />
        <path className="wx-chart-line" d={line} />
        {hours.map((h, i) => {
          const t = new Date(h.datetime);
          const label = i % 3 === 0;
          const p = share(h);
          const barTop = BAR_BOTTOM - Math.max(2, p * BAR_H);
          return (
            <g key={h.datetime}>
              {p > 0 && <rect className="wx-chart-bar" x={x(i) - 8} y={barTop} width={16} height={BAR_BOTTOM - barTop} rx={4} style={{ opacity: 0.35 + 0.65 * p }} />}
              {h.precipitation_probability !== undefined && h.precipitation_probability >= 10 && (
                <text className="wx-chart-pct" x={x(i)} y={barTop - 4}>{Math.round(h.precipitation_probability)}</text>
              )}
              <circle className="wx-chart-dot" cx={x(i)} cy={y(h.temperature)} r={label ? 3 : 1.8} />
              {label && (
                <>
                  <foreignObject x={x(i) - 14} y={ICON_Y} width={28} height={28}>
                    <WeatherIcon condition={h.condition} size={28} night={night(h)} />
                  </foreignObject>
                  <text className="wx-chart-temp" x={x(i)} y={y(h.temperature) - 9}>{Math.round(h.temperature)}°</text>
                </>
              )}
              <text className={`wx-chart-time ${i === 0 ? 'now' : ''}`} x={x(i)} y={CHART_H - 4}>{i === 0 ? 'Now' : t.toLocaleTimeString([], { hour: '2-digit', hour12: false })}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// The coming days: icon, rain chance and amount, wind, and low–high on a shared scale.
export function DailyList({ days, compact }: { days: ForecastDay[]; compact?: boolean }) {
  if (!days.length) return null;
  const min = Math.min(...days.map((d) => d.templow ?? d.temperature));
  const max = Math.max(...days.map((d) => d.temperature));
  return (
    <ul className={`wx-week ${compact ? 'compact' : ''}`}>
      {days.map((d, i) => {
        const lo = d.templow ?? d.temperature;
        const bar = rangeBar(lo, d.temperature, min, max);
        const rain = d.precipitation_probability;
        return (
          <li key={d.datetime}>
            <span className="wx-week-day">{i === 0 ? 'Today' : new Date(d.datetime).toLocaleDateString([], { weekday: 'short' })}</span>
            <WeatherIcon condition={d.condition} size={34} />
            <span className="wx-week-cond">{conditionText(d.condition)}</span>
            <span className={`wx-week-rain ${rain !== undefined && rain >= 50 ? 'wet' : ''}`}>
              {rain !== undefined && rain >= 10 ? `${Math.round(rain)}%` : ''}
              {d.precipitation ? <small>{d.precipitation >= 10 ? Math.round(d.precipitation) : d.precipitation.toFixed(1)} mm</small> : null}
            </span>
            <span className="wx-week-wind muted">{d.wind_speed !== undefined ? `${Math.round(d.wind_speed)} km/h` : ''}</span>
            <span className="wx-week-lo muted">{Math.round(lo)}°</span>
            <span className="wx-week-bar"><i style={{ left: `${bar.left}%`, width: `${bar.width}%` }} /></span>
            <span className="wx-week-hi">{Math.round(d.temperature)}°</span>
          </li>
        );
      })}
    </ul>
  );
}

// The Weather card's popup: every current reading, the next 24 hours and the coming days.
export function WeatherDetail() {
  const hass = useHass();
  const now = useWeatherNow();
  const daily = useForecast(hass, WEATHER, 'daily');
  const hourly = useForecast(hass, WEATHER, 'hourly');
  const attribution = now.weather?.attributes.attribution as string | undefined;
  const feels = [
    now.feelsLike !== undefined && `Feels like ${Math.round(now.feelsLike)}°`,
    // Heat index and wind chill only when they say something the feels-like doesn't.
    now.heatIndex !== undefined && now.temp !== undefined && Math.round(now.heatIndex) > Math.round(now.temp) && Math.round(now.heatIndex) !== Math.round(now.feelsLike ?? NaN) && `Heat index ${Math.round(now.heatIndex)}°`,
    now.windChill !== undefined && now.temp !== undefined && Math.round(now.windChill) < Math.round(now.temp) && Math.round(now.windChill) !== Math.round(now.feelsLike ?? NaN) && `Wind chill ${Math.round(now.windChill)}°`,
  ].filter(Boolean);

  return (
    <div className="wx-detail">
      <section className="card">
        <header className="card-head">
          <Icon name="thermometer" size={18} />
          <h2>Now · {now.temp !== undefined ? `${Math.round(now.temp)}°` : '–'}</h2>
          {feels.length > 0 && <span className="muted small">{feels.join(' · ')}</span>}
        </header>
        <WeatherStats now={now} hourly={hourly} />
      </section>
      {hourly.length > 1 && (
        <section className="card">
          <header className="card-head">
            <Icon name="umbrella" size={18} />
            <h2>Next 24 hours</h2>
            <span className="muted small">Temperature · rain chance %</span>
          </header>
          <HourlyChart hourly={hourly} />
        </section>
      )}
      {daily.length > 0 && (
        <section className="card">
          <header className="card-head">
            <Icon name="weather" size={18} />
            <h2>Next {daily.length} days</h2>
          </header>
          <DailyList days={daily} />
        </section>
      )}
      {attribution && <p className="muted small wx-attrib">{attribution}</p>}
    </div>
  );
}
