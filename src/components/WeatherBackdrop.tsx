import { useMemo } from 'react';

// Animated sky behind the weather card, driven by the live condition.
// Everything animates via transform/opacity only (GPU-composited), and
// particle counts are capped so a kiosk can run it all day.

type Kind = 'clear' | 'partly' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow' | 'wind';

const KIND: Record<string, Kind> = {
  sunny: 'clear',
  'clear-night': 'clear',
  partlycloudy: 'partly',
  cloudy: 'cloudy',
  rainy: 'rain',
  pouring: 'rain',
  lightning: 'storm',
  'lightning-rainy': 'storm',
  hail: 'rain',
  fog: 'fog',
  snowy: 'snow',
  'snowy-rainy': 'snow',
  windy: 'wind',
  'windy-variant': 'wind',
};

// Deterministic pseudo-random so particles don't jump on every re-render.
function rand(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// axis 'y' particles fall from a random column; axis 'x' ones blow across at a random height.
function Particles({ count, className, minDur, maxDur, axis = 'y' }: { count: number; className: string; minDur: number; maxDur: number; axis?: 'x' | 'y' }) {
  const items = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        pos: `${(rand(i, 1) * 104 - 2).toFixed(2)}%`,
        delay: `${(-rand(i, 2) * maxDur).toFixed(2)}s`,
        dur: `${(minDur + rand(i, 3) * (maxDur - minDur)).toFixed(2)}s`,
        scale: (0.6 + rand(i, 4) * 0.7).toFixed(2),
      })),
    [count, minDur, maxDur],
  );
  return (
    <>
      {items.map((p, i) => (
        <span
          key={i}
          className={className}
          style={{ [axis === 'y' ? 'left' : 'top']: p.pos, animationDelay: p.delay, animationDuration: p.dur, ['--s' as string]: p.scale }}
        />
      ))}
    </>
  );
}

export function WeatherBackdrop({ condition, night }: { condition: string | undefined; night: boolean }) {
  const kind = KIND[condition ?? ''] ?? 'partly';
  const heavy = condition === 'pouring' || condition === 'lightning-rainy';
  const stormRain = condition !== 'lightning'; // dry thunderstorm: flashes only
  const showClouds = kind === 'partly' || kind === 'cloudy' || kind === 'rain' || kind === 'storm' || kind === 'snow';

  return (
    <div className={`wx-bg ${kind} ${night ? 'night' : 'day'} ${heavy ? 'heavy' : ''}`} aria-hidden="true">
      <div className="wx-sky" />
      {kind === 'clear' && !night && (
        <>
          <div className="wx-rays" />
          <div className="wx-sunglow" />
        </>
      )}
      {(kind === 'clear' || kind === 'partly') && night && (
        <>
          <div className="wx-stars a" />
          <div className="wx-stars b" />
          <div className="wx-moonglow" />
        </>
      )}
      {kind === 'partly' && !night && <div className="wx-sunglow soft" />}
      {showClouds && (
        <>
          <div className="wx-clouds far" />
          <div className="wx-clouds near" />
        </>
      )}
      {kind === 'fog' && (
        <>
          <div className="wx-fog a" />
          <div className="wx-fog b" />
        </>
      )}
      {(kind === 'rain' || (kind === 'storm' && stormRain)) && (
        <Particles count={heavy ? 70 : 38} className="wx-drop" minDur={heavy ? 0.45 : 0.7} maxDur={heavy ? 0.75 : 1.1} />
      )}
      {kind === 'storm' && <div className="wx-flash" />}
      {kind === 'snow' && <Particles count={32} className="wx-flake" minDur={6} maxDur={11} />}
      {kind === 'wind' && <Particles count={10} className="wx-gust" minDur={1.6} maxDur={2.8} axis="x" />}
      <div className="wx-scrim" />
    </div>
  );
}
