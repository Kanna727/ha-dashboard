import type { HassEntity } from 'home-assistant-js-websocket';
import { SUN, WEATHER } from '../config/entities';
import { useHass } from '../ha/api';
import { useForecast } from '../ha/forecast';
import { useEntity } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { Icon } from '../components/Icon';
import { WeatherIcon } from '../components/WeatherIcon';
import { DailyList, HourlyChart, WeatherDetail } from '../components/WeatherDetail';
import { WeatherDials } from '../components/WeatherDials';
import { useWeatherNow, type WeatherNow } from '../components/useWeather';
import { PanelHead, useModal } from '../components/Modal';
import { sunTimes } from '../lib/sky';
import { rainOutlook } from '../lib/weather';

const RAINING = ['rainy', 'pouring', 'lightning-rainy'];
const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

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

// When rain or storms are likely in the next 12 hours (or that none are).
function Outlook({ now, hourly }: { now: WeatherNow; hourly: Parameters<typeof rainOutlook>[0] }) {
  const time = useNow(60_000).getTime();
  const raining = (now.rainRate ?? 0) > 0 || RAINING.includes(now.condition ?? '');
  const o = rainOutlook(hourly, time, raining);
  if (!o.text) return null;
  return (
    <div className={`wx-outlook ${o.tone}`}>
      <Icon name={o.tone === 'storm' ? 'storm' : o.tone === 'dry' ? 'uv' : 'umbrella'} size={18} />
      <span>{o.text}</span>
    </div>
  );
}

export function WeatherPanel({ days = 5 }: { days?: number }) {
  const hass = useHass();
  const modal = useModal();
  const now = useWeatherNow();
  const sun = useEntity(SUN);
  const daily = useForecast(hass, WEATHER, 'daily');
  const hourly = useForecast(hass, WEATHER, 'hourly');
  const today = daily[0];
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
        <WeatherIcon condition={now.condition} night={sun?.state === 'below_horizon'} size={96} animated className="wx-now-img" />
        <div>
          <div className="wx-temp">{now.temp !== undefined ? Math.round(now.temp) : '–'}<sup>°</sup></div>
          <div className="wx-cond">{now.label}</div>
          {feels && <div className="muted">Feels like {Math.round(now.feelsLike!)}°</div>}
          <SunTimes sun={sun} />
        </div>
      </div>
      <Outlook now={now} hourly={hourly} />
      <WeatherDials now={now} hourly={hourly} />
      <HourlyChart hourly={hourly} count={12} minSlot={22} />
      <DailyList days={daily.slice(0, days)} compact />
    </section>
  );
}
