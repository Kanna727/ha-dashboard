// Low-precision sun and moon positions (about a degree), from the formulas on
// Astronomy Answers (aa.quae.nl), the same ones SunCalc uses. Plenty for
// placing a glow on the page sky. Pure, unit-tested.

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

export interface Horizontal {
  altitude: number; // degrees above the horizon
  azimuth: number; // compass degrees: 0 north, 90 east, 180 south, 270 west
}

const toDays = (ms: number) => ms / DAY_MS - 0.5 + J1970 - J2000;
const rightAscension = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
const siderealTime = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw;

function horizontal(d: number, lat: number, lng: number, ra: number, dec: number): Horizontal {
  const phi = RAD * lat;
  const H = siderealTime(d, RAD * -lng) - ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const fromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitude: altitude / RAD, azimuth: (fromSouth / RAD + 540) % 360 };
}

export function sunPosition(ms: number, lat: number, lng: number): Horizontal {
  const d = toDays(ms);
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return horizontal(d, lat, lng, rightAscension(L, 0), declination(L, 0));
}

export function moonPosition(ms: number, lat: number, lng: number): Horizontal {
  const d = toDays(ms);
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return horizontal(d, lat, lng, rightAscension(l, b), declination(l, b));
}

// A plain day (sunrise 06:00 due east, noon due south, sunset 18:00 due west)
// for when there is no location, and for the ?skyTest panel. `hour` is solar time.
export function modelBody(hour: number): Horizontal {
  const h = ((hour % 24) + 24) % 24;
  const day = h >= 6 && h < 18;
  const altitude = day ? 70 * Math.sin((Math.PI * (h - 6)) / 12) : -50 * Math.sin((Math.PI * ((h + 6) % 24)) / 12);
  return { altitude, azimuth: (90 + 15 * (h - 6) + 720) % 360 };
}

// Where a body appears on the page, as fractions of the viewport. East is on
// the right (things rise there and set on the left); higher is further up.
export function toScreen({ altitude, azimuth }: Horizontal) {
  const x = 0.5 + 0.42 * Math.sin(azimuth * RAD);
  const y = 0.88 - 0.78 * Math.sin(Math.max(-25, altitude) * RAD);
  return { x: +x.toFixed(3), y: +y.toFixed(3) };
}
