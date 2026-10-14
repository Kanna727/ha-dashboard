import { useEffect, useState } from 'react';
import { OUTDOOR_TEMP, SUN, WEATHER } from '../config/entities';
import { useHass, type ForecastDay } from '../ha/api';
import { useEntity } from '../ha/store';
import { num } from '../ha/format';
import { Icon } from '../components/Icon';
import { WeatherIcon } from '../components/WeatherIcon';
import { WeatherBackdrop } from '../components/WeatherBackdrop';
import { PanelHead } from '../components/Modal';
import { conditionLabel } from './TopBar';

const MIN_HOURS = 6; // late evening: spill into tomorrow so the strip isn't nearly empty

// Rest of today's hourly forecast (from the current hour), at least MIN_HOURS long.
function hoursForToday(hourly: ForecastDay[], now = new Date()) {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const upcoming = hourly.filter((h) => new Date(h.datetime).getTime() >= start.getTime());
  const today = upcoming.filter((h) => new Date(h.datetime) < midnight);
  return today.length >= MIN_HOURS ? today : upcoming.slice(0, MIN_HOURS);
}

// Night for an hour, from sun.sun's next rising/setting (works either side of sunset).
function nightAt(t: number, rising?: string, setting?: string) {
  if (!rising || !setting) {
    const h = new Date(t).getHours();
    return h < 6 || h >= 18;
  }
  const r = new Date(rising).getTime();
  const s = new Date(setting).getTime();
  if (s < r) return t >= s && t < r; // currently day: night runs sunset -> next sunrise
  return t < r || t >= s; // currently night: until sunrise, and again after the next sunset
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function WeatherPanel({ days = 5 }: { days?: number }) {
  const hass = useHass();
  const weather = useEntity(WEATHER);
  const outdoor = useEntity(OUTDOOR_TEMP);
  const sun = useEntity(SUN);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [hourly, setHourly] = useState<ForecastDay[]>([]);

  useEffect(() => hass.subscribeForecast(WEATHER, 'daily', setForecast), [hass]);
  useEffect(() => hass.subscribeForecast(WEATHER, 'hourly', setHourly), [hass]);

  const a = weather?.attributes ?? {};
  const temp = num(outdoor) ?? (a.temperature as number | undefined);
  const today = forecast[0];
  const night = sun?.state === 'below_horizon';
  const sunEvent = night
    ? { icon: 'sunrise' as const, text: `Sunrise ${sun?.attributes.next_rising ? hhmm(sun.attributes.next_rising as string) : '–'}` }
    : { icon: 'sunset' as const, text: `Sunset ${sun?.attributes.next_setting ? hhmm(sun.attributes.next_setting as string) : '–'}` };

  return (
    <section className="panel weather-panel">
      <WeatherBackdrop condition={weather?.state} night={night} />
      <PanelHead
        label="Weather"
        summary={`${a.humidity ?? '–'}% humidity · wind ${a.wind_speed !== undefined ? Math.round(a.wind_speed as number) : '–'} ${a.wind_speed_unit ?? 'km/h'}`}
      />
      <div className="wx-now">
        <WeatherIcon condition={weather?.state} night={night} size={96} animated className="wx-now-img" />
        <div>
          <div className="wx-temp">{temp !== undefined ? Math.round(temp) : '–'}<sup>°</sup></div>
          <div className="wx-cond cap">{conditionLabel(weather?.state)}</div>
          {today && (
            <div className="muted">
              High {Math.round(today.temperature)}°{today.templow !== undefined && ` · Low ${Math.round(today.templow)}°`}
            </div>
          )}
        </div>
        <span className="chip sun-chip"><Icon name={sunEvent.icon} size={14} /> {sunEvent.text}</span>
      </div>
      {hourly.length > 0 && (
        <div className="wx-hours" aria-label="Hourly forecast">
          {hoursForToday(hourly).map((h, i, all) => {
            const t = new Date(h.datetime);
            const newDay = i > 0 && t.getDate() !== new Date(all[i - 1].datetime).getDate();
            const rain = h.precipitation ?? 0;
            return (
              <div key={h.datetime} className={`wx-hour ${i === 0 ? 'now' : ''}`}>
                <span className="wx-htime">{i === 0 ? 'Now' : newDay ? t.toLocaleDateString([], { weekday: 'short' }) : t.toLocaleTimeString([], { hour: '2-digit', hour12: false })}</span>
                <WeatherIcon condition={h.condition} night={nightAt(t.getTime(), sun?.attributes.next_rising as string, sun?.attributes.next_setting as string)} size={36} />
                <span className="wx-htemp">{Math.round(h.temperature)}°</span>
                <span className="wx-hrain">{rain > 0 ? `${rain.toFixed(1)}mm` : ''}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="wx-days">
        {forecast.slice(0, days).map((d, i) => (
          <div key={d.datetime} className="wx-day">
            <div className="wx-dname">{i === 0 ? 'Today' : new Date(d.datetime).toLocaleDateString([], { weekday: 'short' })}</div>
            <WeatherIcon condition={d.condition} size={44} />
            <div className="wx-hi">{Math.round(d.temperature)}°</div>
            {d.templow !== undefined && <div className="muted small">{Math.round(d.templow)}°</div>}
            {!!d.precipitation && d.precipitation > 0 && <div className="wx-rain">{d.precipitation.toFixed(1)} mm</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
