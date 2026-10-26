// The full-page sky behind the dashboard (components/SkyBackdrop.tsx): colours
// from the sun's elevation, dulled by the weather, plus where the sun and moon
// are, how the clouds are lit, the wind and the moisture. Pure, unit-tested.
import { modelBody, moonPosition, toScreen, type Horizontal } from './astro';
import { moonIllumination, moonPhase, skyProgress, skyWindow } from './sky';

export type Kind = 'clear' | 'partly' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow' | 'wind';

// HA weather conditions → scene.
export const KIND: Record<string, Kind> = {
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

export const kindOf = (condition: string | undefined): Kind => KIND[condition ?? ''] ?? 'partly';

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// Clear-sky colours by sun elevation (degrees): zenith, middle and horizon,
// and the clouds' shaded and lit sides. The `dusk` variants replace them in
// the evening, which runs redder than dawn. At night the lit side is moonlight.
interface Stop {
  e: number;
  top: Rgb;
  mid: Rgb;
  low: Rgb;
  shade: Rgb;
  lit: Rgb;
  dusk?: Rgb;
  litDusk?: Rgb;
}
const STOPS: Stop[] = [
  { e: -18, top: hex('#03050d'), mid: hex('#060a1a'), low: hex('#0b1229'), shade: hex('#0c101b'), lit: hex('#a3b3da') },
  // blue hour
  { e: -10, top: hex('#050a1e'), mid: hex('#0f1840'), low: hex('#232c5c'), dusk: hex('#2b2858'), shade: hex('#141a30'), lit: hex('#a6b0da') },
  // civil twilight
  {
    e: -4,
    top: hex('#0f1a48'),
    mid: hex('#353f7c'),
    low: hex('#b0607a'),
    dusk: hex('#a04a6e'),
    shade: hex('#2a2950'),
    lit: hex('#e49aa6'),
    litDusk: hex('#e0889a'),
  },
  // sunrise / sunset
  {
    e: 0,
    top: hex('#22407e'),
    mid: hex('#7a6aa0'),
    low: hex('#ff9058'),
    dusk: hex('#ff6c46'),
    shade: hex('#594a72'),
    lit: hex('#ffb07a'),
    litDusk: hex('#ff9566'),
  },
  // golden hour
  {
    e: 5,
    top: hex('#2c60b0'),
    mid: hex('#86a4d6'),
    low: hex('#ffc47a'),
    dusk: hex('#ffad66'),
    shade: hex('#7a7592'),
    lit: hex('#ffdcb0'),
    litDusk: hex('#ffcc98'),
  },
  { e: 15, top: hex('#2a72d4'), mid: hex('#68a8ec'), low: hex('#bcdcf7'), shade: hex('#8e9aad'), lit: hex('#ffffff') },
  { e: 45, top: hex('#1d68d6'), mid: hex('#55a0f0'), low: hex('#cfe7fb'), shade: hex('#9ba6b8'), lit: hex('#ffffff') },
];

// How each kind of weather changes the clear sky: grey = desaturate (0–1),
// dark = darken (negative lightens towards haze), clouds = default cover (0–1),
// lit = how much direct light reaches the cloud tops.
const WEATHER: Record<Kind, { grey: number; dark: number; clouds: number; lit: number }> = {
  clear: { grey: 0, dark: 0, clouds: 0, lit: 1 },
  wind: { grey: 0.1, dark: 0, clouds: 0.2, lit: 1 },
  partly: { grey: 0.15, dark: 0, clouds: 0.45, lit: 1 },
  cloudy: { grey: 0.65, dark: 0.12, clouds: 0.85, lit: 0.55 },
  fog: { grey: 0.75, dark: -0.15, clouds: 1, lit: 0.3 },
  snow: { grey: 0.6, dark: -0.08, clouds: 0.9, lit: 0.5 },
  rain: { grey: 0.7, dark: 0.3, clouds: 1, lit: 0.35 },
  storm: { grey: 0.75, dark: 0.45, clouds: 1, lit: 0.3 },
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function luminance([r, g, b]: Rgb) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function weathered(c: Rgb, w: { grey: number; dark: number }): Rgb {
  const l = luminance(c) * 255;
  let out = mix(c, [l * 0.96, l * 0.98, l * 1.04], w.grey); // a cool grey, never warm
  out = w.dark >= 0 ? mix(out, [0, 0, 0], w.dark) : mix(out, [205, 210, 218], -w.dark);
  return out.map((v) => Math.round(Math.min(255, Math.max(0, v)))) as Rgb;
}

// Clear-sky (and cloud) colours at an elevation, interpolated between the stops.
export function clearSky(elevation: number, rising: boolean) {
  const pick = (s: Stop) => ({
    top: s.top,
    mid: s.mid,
    low: !rising && s.dusk ? s.dusk : s.low,
    shade: s.shade,
    lit: !rising && s.litDusk ? s.litDusk : s.lit,
  });
  let a = pick(STOPS[0]);
  let b = a;
  let t = 0;
  if (elevation > STOPS[0].e) {
    const i = STOPS.findIndex((s) => elevation <= s.e);
    if (i === -1) a = b = pick(STOPS[STOPS.length - 1]);
    else {
      a = pick(STOPS[i - 1]);
      b = pick(STOPS[i]);
      t = (elevation - STOPS[i - 1].e) / (STOPS[i].e - STOPS[i - 1].e);
    }
  }
  return { top: mix(a.top, b.top, t), mid: mix(a.mid, b.mid, t), low: mix(a.low, b.low, t), shade: mix(a.shade, b.shade, t), lit: mix(a.lit, b.lit, t) };
}

export interface SunInput {
  aboveHorizon: boolean;
  elevation?: number; // sun.sun attribute, degrees
  azimuth?: number; // sun.sun attribute, compass degrees
  rising?: boolean; // sun.sun attribute: true from solar midnight to solar noon
  nextRising?: string;
  nextSetting?: string;
}

// Elevation, rising and the solar hour from sun.sun, estimated from the rise/set
// times when the attributes are missing (a sine over the day, and over the night).
export function sunAt(sun: SunInput, now: number) {
  const w = skyWindow(sun.aboveHorizon, sun.nextRising, sun.nextSetting);
  const p = w ? skyProgress(w, now) : undefined;
  const elevation = sun.elevation ?? (p === undefined ? (sun.aboveHorizon ? 40 : -30) : (sun.aboveHorizon ? 60 : -50) * Math.sin(Math.PI * p));
  // By day the sun climbs until noon; by night it sinks until midnight, then climbs.
  const rising = sun.rising ?? (p === undefined ? true : sun.aboveHorizon ? p < 0.5 : p >= 0.5);
  const d = new Date(now);
  // Solar hour: from the day/night progress, else the azimuth (on the plain-day model), else the clock.
  const hour =
    p !== undefined
      ? sun.aboveHorizon
        ? 6 + 12 * p
        : (18 + 12 * p) % 24
      : sun.azimuth !== undefined
        ? ((sun.azimuth - 90) / 15 + 30) % 24
        : d.getHours() + d.getMinutes() / 60;
  return { elevation, rising, progress: p, hour, azimuth: sun.azimuth ?? modelBody(hour).azimuth };
}

const KMH: Record<string, number> = { 'km/h': 1, 'm/s': 3.6, mph: 1.609, kn: 1.852, 'ft/s': 1.097 };
export const windKmh = (speed: number, unit = 'km/h') => speed * (KMH[unit] ?? 1);

export interface SkyInput {
  sun: SunInput;
  now: number;
  condition?: string;
  coverage?: number; // weather attribute cloud_coverage, %
  wind?: number; // km/h
  windBearing?: number; // degrees the wind comes from
  humidity?: number; // %
  location?: { lat: number; lng: number }; // for the real moon position
  moonPhase?: number; // 0–1 override (?skyTest)
  modelMoon?: boolean; // place the moon on the plain-day model (?skyTest, or no location)
}

export interface SkyScene {
  kind: Kind;
  heavy: boolean;
  elevation: number;
  day: number; // 0 night … 1 full daylight
  top: string;
  mid: string;
  low: string;
  stars: number; // 0–1 opacity of the star field
  sun: number; // 0–1 strength of the sun's glow
  disc: number; // 0–1 the sun's disc, hidden behind overcast
  horizon: number; // 0–1 strength of the dawn/dusk glow along the bottom
  clouds: number; // 0–1 cloud cover, in steps of 0.1
  x: number; // where the sun is across the screen, 0–1 left to right
  y: number; // and down it, 0–1 top to bottom
  moon: { x: number; y: number; phase: number; angle: number; opacity: number; glow: number };
  cloud: { shade: string; lit: string; litAlpha: number; lightAz: number };
  wind: { kmh: number; dir: 1 | -1; level: number };
  haze: number; // 0–1 low moist haze
  hazeColor: string; // pale by day, sky-dark at night
  dew: number; // 0–1 condensation on the glass
  // The city's layers, far to near (lib/city.ts): far skyline, near skyline,
  // viaduct and canopy, the tree's rise.
  land: { far: string; mid: string; hills: string; fore: string };
  lights: number; // 0–1 city lights: on from sunset (and on a dark rainy day)
}

const css = ([r, g, b]: Rgb) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
const deg = (rad: number) => (rad * 180) / Math.PI;

export function skyScene(input: SkyInput): SkyScene {
  const { sun: sunIn, now, condition } = input;
  const kind = kindOf(condition);
  const w = WEATHER[kind];
  const { elevation, rising, hour, azimuth } = sunAt(sunIn, now);
  const sky = clearSky(elevation, rising);
  // A measured cover refines the default, but rain or fog always hides the sky.
  const clouds = Math.round((input.coverage !== undefined && w.clouds < 1 ? clamp01(input.coverage / 100) : w.clouds) * 10) / 10;
  // The glows only fade with heavy cover; partly cloudy still shows the sun.
  const open = 1 - 0.85 * clamp01((clouds - 0.3) / 0.7);
  const clearView = clamp01((1 - clouds) / 0.3); // discs vanish behind overcast
  const night = clamp01(-elevation / 6);
  const day = clamp01((elevation + 6) / 16);
  const sunPos = toScreen({ altitude: elevation, azimuth });

  // Moon: the real position when the location is known, else trailing the sun
  // by its phase (new moon with the sun, full moon opposite it).
  const phase = input.moonPhase ?? moonPhase(now);
  const fraction = moonIllumination(phase);
  const moonAt: Horizontal = input.location && !input.modelMoon ? moonPosition(now, input.location.lat, input.location.lng) : modelBody(hour - phase * 24);
  const moonPos = toScreen(moonAt);
  const up = clamp01((moonAt.altitude + 3) / 5);
  // The lit limb faces the sun on the page (the page is wider than tall, hence 1.6).
  const angle = Math.round(deg(Math.atan2(sunPos.y - moonPos.y, (sunPos.x - moonPos.x) * 1.6)));
  const moonGlow = up * night * fraction * open;

  // Clouds: lit by the sun by day, by the moon at night (by its phase and height).
  const moonLight = Math.max(0.12, clamp01(moonAt.altitude / 10 + 0.3) * (0.2 + 0.8 * fraction)); // never quite dark: skyglow
  const lightDay = clamp01((elevation + 6) / 8);
  const source = lightDay > 0.3 ? sunPos : moonPos;
  const lightAz = (Math.round(deg(Math.atan2(source.y - 0.25, (source.x - 0.5) * 1.6)) / 30) * 30 + 360) % 360;

  const kmh = Math.max(0, input.wind ?? 8);
  const windLevel = clamp01(kmh / 50);
  // Wind blows towards bearing + 180°; east is on the right of the page.
  const east = input.windBearing === undefined ? 0 : -Math.sin((input.windBearing * Math.PI) / 180);

  // The city: layers fade into the sky with distance (aerial perspective) and
  // darken towards night. (There is no dark veil over the sky any more: the
  // owner wanted only the live sky and the city behind the pages, 2026-10-26.)
  const skyLow = weathered(sky.low, w);
  const skyRef = mix(skyLow, weathered(sky.mid, w), 0.35);
  const ground = mix([2, 3, 6], [30, 44, 36], day); // near black at night, so ridges stay darker than the sky
  const landAt = (k: number, from: Rgb = skyRef) => css(mix(from, ground, k));
  const hum = input.humidity ?? 60;
  const wet = kind === 'rain' || kind === 'storm' || kind === 'fog';

  return {
    kind,
    heavy: condition === 'pouring' || condition === 'lightning-rainy',
    elevation: +elevation.toFixed(1),
    day: +day.toFixed(2),
    top: css(weathered(sky.top, w)),
    mid: css(weathered(sky.mid, w)),
    low: css(weathered(sky.low, w)),
    stars: +(clamp01((-elevation - 4) / 8) * (1 - clouds) * (1 - 0.5 * moonGlow)).toFixed(2),
    sun: +(clamp01((elevation + 3) / 8) * open).toFixed(2),
    disc: +(clamp01((elevation + 1) / 3) * clearView).toFixed(2),
    horizon: +(Math.max(0, 1 - Math.abs(elevation - 1) / 9) * open).toFixed(2),
    clouds,
    x: sunPos.x,
    y: sunPos.y,
    moon: {
      x: moonPos.x,
      y: moonPos.y,
      phase: +phase.toFixed(3),
      angle,
      // Faint by day, like the real thing, and hidden by thick cloud.
      opacity: +(up * (0.3 + 0.7 * night) * clearView).toFixed(2),
      glow: +moonGlow.toFixed(2),
    },
    cloud: {
      shade: css(weathered(sky.shade, w)),
      lit: css(weathered(sky.lit, { grey: w.grey * 0.6, dark: Math.max(0, w.dark) * 0.5 })),
      litAlpha: +((lightDay + (1 - lightDay) * moonLight) * w.lit).toFixed(2),
      lightAz,
    },
    wind: { kmh: Math.round(kmh), dir: east > 0.15 ? 1 : -1, level: +windLevel.toFixed(2) },
    hazeColor: css(mix(weathered(sky.low, w), [201, 209, 220], 0.1 + 0.5 * day)),
    // Only in rain, storms and fog: on a dry day humidity alone left a pale
    // band over the city that read as a grey film behind the pages.
    haze: wet ? +clamp01((hum - 55) / 45 + 0.25).toFixed(2) : 0,
    dew: +clamp01((hum - 75) / 25 + (kind === 'rain' || kind === 'storm' ? 0.5 : 0)).toFixed(2),
    land: {
      far: landAt(0.5),
      mid: landAt(0.7),
      hills: landAt(0.84),
      fore: landAt(0.95),
    },
    lights: +clamp01((2 - elevation) / 8 + (wet && clouds >= 0.9 ? 0.25 : 0)).toFixed(2),
  };
}
