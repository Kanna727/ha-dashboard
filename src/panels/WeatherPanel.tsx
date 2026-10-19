import { SUN, WEATHER } from '../config/entities';
import { useHass, type ForecastDay } from '../ha/api';
import { useForecast } from '../ha/forecast';
import { useEntity } from '../ha/store';
import { WeatherIcon } from '../components/WeatherIcon';
import { Icon } from '../components/Icon';
import { WeatherDetail, WeatherStats } from '../components/WeatherDetail';
import { useWeatherNow } from '../components/useWeather';
import { PanelHead, useModal } from '../components/Modal';
import { sunTimes } from '../lib/sky';
import { nightAt, showRainChance } from '../lib/weather';

export { nightAt };

const MIN_HOURS = 6; // late evening: spill into tomorrow so the strip isn't nearly empty

// Rest of today's hourly forecast (from the current hour), at least MIN_HOURS long.
export function hoursForToday(hourly: ForecastDay[], now = new Date()) {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const upcoming = hourly.filter((h) => new Date(h.datetime).getTime() >= start.getTime());
  const today = upcoming.filter((h) => new Date(h.datetime) < midnight);
  return today.length >= MIN_HOURS ? today : upcoming.slice(0, MIN_HOURS);
}

// An hour's or day's rain line: the chance when the forecast has one, else millimetres.
export function rainNote(f: ForecastDay): string {
  if (f.precipitation_probability !== undefined) return showRainChance(f.precipitation_probability) ? `${Math.round(f.precipitation_probability)}%` : '';
  return f.precipitation ? `${f.precipitation.toFixed(1)}mm` : '';
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

// Today's sunrise and sunset (the page sky shows where the sun and moon are).
function SunTimes({ sun }: { sun: ReturnType<typeof useEntity> }) {
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

export function WeatherPanel({ days = 5 }: { days?: number }) {
  const hass = useHass();
  const modal = useModal();
  const now = useWeatherNow();
  const sun = useEntity(SUN);
  const forecast = useForecast(hass, WEATHER, 'daily');
  const hourly = useForecast(hass, WEATHER, 'hourly');

  const today = forecast[0];
  const night = sun?.state === 'below_horizon';
  const feels = now.feelsLike !== undefined && now.temp !== undefined && Math.round(now.feelsLike) !== Math.round(now.temp);

  return (
    <section className="panel weather-panel">
      <PanelHead
        label="Weather"
        summary={today ? `H ${Math.round(today.temperature)}°${today.templow !== undefined ? ` · L ${Math.round(today.templow)}°` : ''}` : undefined}
        onMore={() =>
          modal.open({ title: 'Weather', icon: 'weather', accent: 'var(--accent-fan)', wide: true, subtitle: now.label, body: <WeatherDetail /> })
        }
      />
      <div className="wx-now">
        <WeatherIcon condition={now.condition} night={night} size={96} animated className="wx-now-img" />
        <div>
          <div className="wx-temp">{now.temp !== undefined ? Math.round(now.temp) : '–'}<sup>°</sup></div>
          <div className="wx-cond">{now.label}</div>
          {feels && <div className="muted">Feels like {Math.round(now.feelsLike!)}°</div>}
          <SunTimes sun={sun} />
        </div>
      </div>
      <WeatherStats now={now} hourly={hourly} compact />
      {hourly.length > 0 && (
        <div className="wx-hours" aria-label="Hourly forecast">
          {hoursForToday(hourly).map((h, i, all) => {
            const t = new Date(h.datetime);
            const newDay = i > 0 && t.getDate() !== new Date(all[i - 1].datetime).getDate();
            return (
              <div key={h.datetime} className={`wx-hour ${i === 0 ? 'now' : ''}`}>
                <span className="wx-htime">{i === 0 ? 'Now' : newDay ? t.toLocaleDateString([], { weekday: 'short' }) : t.toLocaleTimeString([], { hour: '2-digit', hour12: false })}</span>
                <WeatherIcon condition={h.condition} night={nightAt(t.getTime(), sun?.attributes.next_rising as string, sun?.attributes.next_setting as string)} size={36} />
                <span className="wx-htemp">{Math.round(h.temperature)}°</span>
                <span className="wx-hrain">{rainNote(h)}</span>
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
            {rainNote(d) && <div className="wx-rain">{rainNote(d)}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
