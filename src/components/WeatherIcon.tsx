// Full-colour weather illustrations (Meteocons by Bas Milius, MIT,
// https://meteocons.com). Rendered as <img> data URIs: the SVGs reuse
// gradient ids like "a"/"b", which would clash if inlined into the DOM.
import clearDay from '@bybas/weather-icons/production/fill/all/clear-day.svg?raw';
import clearNight from '@bybas/weather-icons/production/fill/all/clear-night.svg?raw';
import partlyDay from '@bybas/weather-icons/production/fill/all/partly-cloudy-day.svg?raw';
import partlyNight from '@bybas/weather-icons/production/fill/all/partly-cloudy-night.svg?raw';
import overcast from '@bybas/weather-icons/production/fill/all/overcast.svg?raw';
import fogDay from '@bybas/weather-icons/production/fill/all/fog-day.svg?raw';
import fogNight from '@bybas/weather-icons/production/fill/all/fog-night.svg?raw';
import hail from '@bybas/weather-icons/production/fill/all/hail.svg?raw';
import thunderDay from '@bybas/weather-icons/production/fill/all/thunderstorms-day.svg?raw';
import thunderNight from '@bybas/weather-icons/production/fill/all/thunderstorms-night.svg?raw';
import thunderRainDay from '@bybas/weather-icons/production/fill/all/thunderstorms-day-rain.svg?raw';
import thunderRainNight from '@bybas/weather-icons/production/fill/all/thunderstorms-night-rain.svg?raw';
import rain from '@bybas/weather-icons/production/fill/all/rain.svg?raw';
import snow from '@bybas/weather-icons/production/fill/all/snow.svg?raw';
import sleet from '@bybas/weather-icons/production/fill/all/sleet.svg?raw';
import wind from '@bybas/weather-icons/production/fill/all/wind.svg?raw';
import unknown from '@bybas/weather-icons/production/fill/all/not-available.svg?raw';

type Pair = [day: string, night: string];

// Thicker raindrops: at 36-44 px the stock 2-unit strokes almost vanish.
const boldDrops = (svg: string, width = 3.6) =>
  svg.replace(/(<path fill="none" stroke="url\(#\w+\)" stroke-linecap="round"[^>]*?)stroke-width="2"/g, `$1stroke-width="${width}"`);

// "Cloudy" should look grey, not white: recolour the front cloud of the overcast art.
const greyClouds = (svg: string) =>
  svg.replace(/#f3f7fe/g, '#d4d8de').replace(/#deeafb/g, '#a3a9b3').replace(/#e6effc/g, '#9aa1ac');

const rainBold = boldDrops(rain);
// Heavy rain: fatter drops under a grey cloud, so it reads differently from plain rain.
const pouringArt = greyClouds(boldDrops(rain, 4.6));
const thunderRainDayBold = boldDrops(thunderRainDay);
const thunderRainNightBold = boldDrops(thunderRainNight);
const overcastGrey = greyClouds(overcast);

// HA weather conditions -> illustration. Cloudy uses the grey "overcast"
// art so it reads differently from partly cloudy at a glance.
const ART: Record<string, Pair> = {
  sunny: [clearDay, clearNight],
  'clear-night': [clearNight, clearNight],
  partlycloudy: [partlyDay, partlyNight],
  cloudy: [overcastGrey, overcastGrey],
  fog: [fogDay, fogNight],
  hail: [hail, hail],
  lightning: [thunderDay, thunderNight],
  'lightning-rainy': [thunderRainDayBold, thunderRainNightBold],
  pouring: [pouringArt, pouringArt],
  rainy: [rainBold, rainBold],
  snowy: [snow, snow],
  'snowy-rainy': [sleet, sleet],
  windy: [wind, wind],
  'windy-variant': [wind, wind],
  exceptional: [unknown, unknown],
};

const stripAnimation = (svg: string) => svg.replace(/<animate(?:Transform|Motion)?\b[^>]*\/>/g, '');
const toUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const cache = new Map<string, string>();
function uriFor(svg: string, animated: boolean) {
  // Key on the full markup: recoloured variants share length and suffix with their source.
  const key = (animated ? 'a:' : 's:') + svg;
  let uri = cache.get(key);
  if (!uri) {
    uri = toUri(animated ? svg : stripAnimation(svg));
    cache.set(key, uri);
  }
  return uri;
}

const LABELS: Record<string, string> = {
  sunny: 'Sunny',
  'clear-night': 'Clear',
  partlycloudy: 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  hail: 'Hail',
  lightning: 'Thunderstorm',
  'lightning-rainy': 'Thunderstorm with rain',
  pouring: 'Heavy rain',
  rainy: 'Rain',
  snowy: 'Snow',
  'snowy-rainy': 'Sleet',
  windy: 'Windy',
  'windy-variant': 'Windy',
  exceptional: 'Unusual weather',
};

// Only the big "now" icon animates; strips and pills use static art so a
// kiosk isn't running a dozen animations all day.
export function WeatherIcon({ condition, night = false, size = 32, animated = false, className }: {
  condition: string | undefined;
  night?: boolean;
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  const pair = ART[condition ?? ''] ?? [unknown, unknown];
  const svg = night ? pair[1] : pair[0];
  const label = LABELS[condition ?? ''] ?? 'Weather';
  return (
    <img
      className={`wx-img ${className ?? ''}`}
      src={uriFor(svg, animated)}
      width={size}
      height={size}
      alt={label}
      title={label}
      draggable={false}
    />
  );
}
