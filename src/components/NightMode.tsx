import { useEffect, useRef, useState } from 'react';
import { NIGHT_MODE, SUN } from '../config/entities';
import { useEntity } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { driftAt, nightActive } from '../lib/night';
import { useIssues } from '../panels/useIssues';
import { useScreenExtension, useScreenOn } from './ScreenPower';
import { useWeatherNow } from './useWeather';
import { SkyArc } from './SkyArc';
import { WeatherIcon } from './WeatherIcon';

// ?nightTest=1 (any build): 5 s idle, any time of day, any layout, for checking it.
const TEST = new URLSearchParams(window.location.search).has('nightTest');

// Dim night screen for the kiosk: after NIGHT_MODE.idleMinutes without input
// (and, with nightOnly, only while the sun is down) it fades to a black screen
// with a big clock, the weather, the moon arc and any issues. The block drifts a
// little each minute against burn-in. A touch wakes it; that touch is swallowed
// so it can't press something underneath. Other animations pause meanwhile.
// While the wall screen may turn off (ScreenPower) it comes up after a minute at
// any time of day, and what's under it is hidden so nothing repaints. On the
// wall screen (the extension answered) that holds on any layout, and the screen
// going back on (someone walked in) closes it.
export function NightMode({ layout }: { layout: string }) {
  const sun = useEntity(SUN);
  const screenOn = useScreenOn();
  const wallScreen = useScreenExtension();
  const lastInput = useRef(Date.now());
  const [on, setOn] = useState(false);
  const now = useNow(on ? 1000 : 15_000);

  useEffect(() => {
    const mark = () => {
      lastInput.current = Date.now();
    };
    const opts = { capture: true, passive: true } as const;
    ['pointerdown', 'keydown', 'wheel'].forEach((t) => window.addEventListener(t, mark, opts));
    return () => ['pointerdown', 'keydown', 'wheel'].forEach((t) => window.removeEventListener(t, mark, opts));
  }, []);

  const shouldBeOn = nightActive({
    enabled: NIGHT_MODE.enabled,
    layoutAllowed: TEST || NIGHT_MODE.layouts.includes(layout) || (wallScreen && !screenOn),
    idleMs: now.getTime() - lastInput.current,
    idleMinutes: TEST ? 5 / 60 : NIGHT_MODE.idleMinutes,
    nightOnly: TEST ? false : NIGHT_MODE.nightOnly,
    sunDown: sun?.state === 'below_horizon',
    screenOff: !screenOn,
  });

  // On the wall screen, someone walking in (the screen goes back on) opens the
  // dashboard straight away, as a touch would. Before the effect below, so its
  // stale shouldBeOn can't bring the night screen straight back.
  const wasScreenOn = useRef(screenOn);
  useEffect(() => {
    if (wallScreen && screenOn && !wasScreenOn.current) {
      lastInput.current = Date.now();
      setOn(false);
    }
    wasScreenOn.current = screenOn;
  }, [wallScreen, screenOn]);

  useEffect(() => {
    if (shouldBeOn && !on) setOn(true);
  }, [shouldBeOn, on]);

  useEffect(() => {
    document.documentElement.classList.toggle('night', on);
    return () => document.documentElement.classList.remove('night');
  }, [on]);

  if (!on) return null;
  const wake = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // The screen is gone by pointerup, so the click that follows would land on
    // whatever is underneath: swallow that one click.
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 700);
    lastInput.current = Date.now();
    setOn(false);
  };
  return <NightScreen now={now} onWake={wake} />;
}

function NightScreen({ now, onWake }: { now: Date; onWake: (e: React.PointerEvent) => void }) {
  const weather = useWeatherNow();
  const sun = useEntity(SUN);
  const issues = useIssues();
  const temp = weather.temp;
  const drift = driftAt(Math.floor(now.getTime() / 60_000));

  return (
    <div className="night-screen" onPointerDown={onWake} onClick={(e) => e.stopPropagation()} role="button" aria-label="Wake the dashboard">
      <div className="night-block" style={{ transform: `translate(${drift.x}px, ${drift.y}px)` }}>
        <div className="night-clock">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
        <div className="night-date">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <div className="night-weather">
          <WeatherIcon condition={weather.condition} night={sun?.state === 'below_horizon'} size={44} />
          <span>{temp !== undefined ? `${Math.round(temp)}°` : '–'} · {weather.label}</span>
        </div>
        <SkyArc sun={sun} className="night-sky" />
        {issues.length > 0 && (
          <ul className="night-issues">
            {issues.map((i) => (
              <li key={i.id} className={i.severity}>{i.text}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
