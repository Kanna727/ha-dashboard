import { useState } from 'react';
import { SUN, WEATHER } from '../config/entities';
import { useHass } from '../ha/api';
import { useForecast } from '../ha/forecast';
import { useEntity } from '../ha/store';
import { WeatherDetail } from '../components/WeatherDetail';
import { DESIGN_BODIES, WX_DESIGNS, type WxDesign } from '../components/WeatherDesigns';
import { useWeatherNow } from '../components/useWeather';
import { PanelHead, useModal } from '../components/Modal';

export { hoursForToday, nightAt, rainNote } from '../lib/weather';

const DESIGN_KEY = 'dashWxDesign';
const isDesign = (v: string | null): v is WxDesign => WX_DESIGNS.some((d) => d.id === v);

// Which card design to show while the owner chooses: ?wx=<id> (any build) wins,
// then this device's pick from the mock-build picker, then Tiles.
function useWeatherDesign(): [WxDesign, (d: WxDesign) => void] {
  const [design, setDesign] = useState<WxDesign>(() => {
    const q = new URLSearchParams(window.location.search).get('wx');
    if (isDesign(q)) return q;
    try {
      const saved = localStorage.getItem(DESIGN_KEY);
      if (isDesign(saved)) return saved;
    } catch {
      /* storage blocked */
    }
    return 'tiles';
  });
  const pick = (d: WxDesign) => {
    setDesign(d);
    try {
      localStorage.setItem(DESIGN_KEY, d);
    } catch {
      /* storage blocked: this visit only */
    }
  };
  return [design, pick];
}

function DesignPicker({ value, onPick }: { value: WxDesign; onPick: (d: WxDesign) => void }) {
  return (
    <div className="wx-picker" role="radiogroup" aria-label="Weather card design">
      <span className="wx-picker-label">Design</span>
      {WX_DESIGNS.map((d) => (
        <button key={d.id} role="radio" aria-checked={value === d.id} className={`chip-btn ${value === d.id ? 'active' : ''}`} onClick={() => onPick(d.id)}>
          {d.label}
        </button>
      ))}
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
  const [design, setDesign] = useWeatherDesign();
  const Body = DESIGN_BODIES[design];
  const today = daily[0];

  return (
    <section className={`panel weather-panel wx-design-${design}`}>
      {import.meta.env.VITE_MOCK && <DesignPicker value={design} onPick={setDesign} />}
      <PanelHead
        label="Weather"
        summary={today ? `H ${Math.round(today.temperature)}°${today.templow !== undefined ? ` · L ${Math.round(today.templow)}°` : ''}` : undefined}
        onMore={() =>
          modal.open({ title: 'Weather', icon: 'weather', accent: 'var(--accent-fan)', wide: true, subtitle: now.label, body: <WeatherDetail /> })
        }
      />
      <Body now={now} sun={sun} hourly={hourly} daily={daily} days={days} />
    </section>
  );
}
