import { COMMUTE } from '../config/entities';
import type { LovelaceCard, LovelaceConfig } from '../ha/api';

export type TravelMode = 'DRIVE' | 'TWO_WHEELER';
export type Speed = 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface CommuteConfig {
  title: string;
  apiKey: string;
  origin: LatLng;
  dest: LatLng;
  center: LatLng;
  height: number;
  compactHeight: number;
  defaultVehicle: TravelMode;
  alertThresholdMin: number;
}

export interface Route {
  seconds: number;
  // Travel time without traffic (Routes API staticDuration), when given.
  staticSeconds?: number;
  meters: number;
  // Google's short route name, e.g. "NH 48" or "Ring Rd".
  description?: string;
  encodedPolyline: string;
  intervals: { start: number; end?: number; speed: Speed }[];
}

// Speed colours in the dashboard's palette (blue = moving freely, amber, red).
export const SPEED_COLORS: Record<Speed, string> = { NORMAL: '#60a5fa', SLOW: '#fbbf24', TRAFFIC_JAM: '#f87171' };
export const ALT_ROUTE_COLOR = '#8a93a6';

// The mock's test panel can pin the window open or shut (null = follow the clock).
let forcedWindow: boolean | null = null;
export const forceCommuteWindow = (v: boolean | null) => {
  forcedWindow = v;
};

export function inCommuteWindow(now = new Date()): boolean {
  if (forcedWindow !== null) return forcedWindow;
  const h = now.getHours();
  return COMMUTE.windowDays.includes(now.getDay()) && h >= COMMUTE.windowStartHour && h < COMMUTE.windowEndHour;
}

function px(v: unknown, fallback: number): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function findCard(cards: LovelaceCard[] | undefined, type: string): LovelaceCard | undefined {
  for (const c of cards ?? []) {
    if (c.type === type) return c;
    const nested = findCard(c.cards as LovelaceCard[] | undefined, type) ?? (c.card ? findCard([c.card as LovelaceCard], type) : undefined);
    if (nested) return nested;
  }
  return undefined;
}

// Pull the commute card out of the Lovelace dashboard config. Accepts the
// same keys as the custom:commute-traffic-map card.
export function extractCommuteConfig(lovelace: LovelaceConfig): CommuteConfig | null {
  let card: LovelaceCard | undefined;
  for (const view of lovelace.views ?? []) {
    card = findCard(view.cards, COMMUTE.cardType) ?? findCard(view.sections?.flatMap((s) => s.cards ?? []), COMMUTE.cardType);
    if (card) break;
  }
  if (!card || typeof card.api_key !== 'string') return null;
  const n = (k: string) => Number(card![k]);
  const origin = { lat: n('origin_lat'), lng: n('origin_lng') };
  const dest = { lat: n('dest_lat'), lng: n('dest_lng') };
  if (![origin.lat, origin.lng, dest.lat, dest.lng].every(Number.isFinite)) return null;
  return {
    title: (card.title as string) || 'Commute',
    apiKey: card.api_key,
    origin,
    dest,
    center: {
      lat: Number.isFinite(n('center_lat')) ? n('center_lat') : (origin.lat + dest.lat) / 2,
      lng: Number.isFinite(n('center_lng')) ? n('center_lng') : (origin.lng + dest.lng) / 2,
    },
    height: px(card.height, 320),
    compactHeight: px(card.compact_height, 200),
    defaultVehicle: card.default_vehicle === 'TWO_WHEELER' ? 'TWO_WHEELER' : 'DRIVE',
    alertThresholdMin: Number(card.alert_threshold_minutes) || 20,
  };
}

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

function parseSeconds(d: string | undefined): number {
  return d ? parseInt(d.replace('s', ''), 10) : Infinity;
}

export interface RoutesRequest {
  apiKey: string;
  origin: LatLng;
  dest: LatLng;
  mode: TravelMode;
  alternatives: boolean;
  departureOffsetMin?: number;
  signal?: AbortSignal;
}

// Google Routes API v2, traffic-aware, with per-segment speed readings.
export async function googleComputeRoutes(req: RoutesRequest): Promise<Route[]> {
  const detailed = req.departureOffsetMin === undefined;
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: req.origin.lat, longitude: req.origin.lng } } },
    destination: { location: { latLng: { latitude: req.dest.lat, longitude: req.dest.lng } } },
    travelMode: req.mode,
    routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    computeAlternativeRoutes: req.alternatives,
    languageCode: 'en-US',
    units: 'METRIC',
  };
  if (detailed) body.extraComputations = ['TRAFFIC_ON_POLYLINE'];
  else body.departureTime = new Date(Date.now() + req.departureOffsetMin! * 60_000).toISOString();

  const resp = await fetch(ROUTES_URL, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': req.apiKey,
      'X-Goog-FieldMask': detailed
        ? 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.description,routes.polyline.encodedPolyline,routes.travelAdvisory.speedReadingIntervals'
        : 'routes.duration',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok || !data.routes?.length) {
    // computeRoutes returns a bare 403 for several causes; in practice it has
    // been billing being off on the key's Cloud project.
    if (data.error?.status === 'PERMISSION_DENIED') {
      throw new Error('Google refused the request. Check billing is enabled on the API key\'s Cloud project, and that Routes API is enabled and allowed for the key.');
    }
    throw new Error(data.error?.message ?? `Routes API ${resp.status}`);
  }
  return data.routes.map(
    (r: {
      duration?: string;
      staticDuration?: string;
      distanceMeters?: number;
      description?: string;
      polyline?: { encodedPolyline?: string };
      travelAdvisory?: { speedReadingIntervals?: { startPolylinePointIndex?: number; endPolylinePointIndex?: number; speed?: Speed }[] };
    }) => ({
      seconds: parseSeconds(r.duration),
      staticSeconds: r.staticDuration ? parseSeconds(r.staticDuration) : undefined,
      meters: r.distanceMeters ?? 0,
      description: r.description || undefined,
      encodedPolyline: r.polyline?.encodedPolyline ?? '',
      intervals: (r.travelAdvisory?.speedReadingIntervals ?? []).map((i) => ({
        start: i.startPolylinePointIndex ?? 0,
        end: i.endPolylinePointIndex,
        speed: i.speed ?? 'NORMAL',
      })),
    }),
  );
}

// The route source: Google in the app; the mock swaps in fake routes.
let routesImpl = googleComputeRoutes;
export const setRoutesImpl = (fn: typeof googleComputeRoutes) => {
  routesImpl = fn;
};
export const computeRoutes = (req: RoutesRequest) => routesImpl(req);

export const fmtMin = (seconds: number) => `${Math.round(seconds / 60)} min`;
export const mins = (seconds: number) => Math.round(seconds / 60);
export const kmText = (meters: number) => `${(meters / 1000).toFixed(1)} km`;
// "8:21", without AM/PM (like the room chips; the dashboard's clock is 24 h).
export const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');

// Google's encoded polyline format (precision 5).
export function decodePolyline(encoded: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i <= encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lng += next();
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

function metersBetween(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6_371_000;
}

export interface SpeedSegment {
  from: number; // 0..1 along the route, by distance
  to: number;
  speed: Speed;
}

// The route's speed readings as stretches of its length, merged where the
// speed repeats. Gaps between readings count as NORMAL, as Google means them.
export function speedSegments(route: Pick<Route, 'encodedPolyline' | 'intervals'>, path = decodePolyline(route.encodedPolyline)): SpeedSegment[] {
  if (path.length < 2) return [{ from: 0, to: 1, speed: 'NORMAL' }];
  const cum = [0];
  for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + metersBetween(path[k - 1], path[k]));
  const total = cum[cum.length - 1] || 1;
  const at = (idx: number) => cum[Math.max(0, Math.min(path.length - 1, idx))] / total;
  const speedAt: Speed[] = new Array(path.length - 1).fill('NORMAL');
  for (const iv of route.intervals) {
    for (let k = iv.start; k < (iv.end ?? path.length - 1) && k < speedAt.length; k++) speedAt[k] = iv.speed;
  }
  const segs: SpeedSegment[] = [];
  speedAt.forEach((speed, k) => {
    const last = segs[segs.length - 1];
    if (last && last.speed === speed) last.to = at(k + 1);
    else segs.push({ from: at(k), to: at(k + 1), speed });
  });
  return segs.filter((s) => s.to > s.from);
}

// Share of the route's length at each speed.
export function speedShares(segs: SpeedSegment[]): Record<Speed, number> {
  const out: Record<Speed, number> = { NORMAL: 0, SLOW: 0, TRAFFIC_JAM: 0 };
  for (const s of segs) out[s.speed] += s.to - s.from;
  return out;
}

export type TrafficLevel = 'light' | 'moderate' | 'heavy';
export const TRAFFIC_TEXT: Record<TrafficLevel, string> = { light: 'Light traffic', moderate: 'Moderate traffic', heavy: 'Heavy traffic' };

// How bad the traffic is: from the delay over the no-traffic time when Google
// gives it, else from how much of the route is slow or jammed.
export function trafficLevel(route: Route, segs?: SpeedSegment[]): TrafficLevel {
  if (route.staticSeconds && Number.isFinite(route.staticSeconds) && route.staticSeconds > 0) {
    const ratio = route.seconds / route.staticSeconds;
    const delay = route.seconds - route.staticSeconds;
    if (ratio < 1.15 || delay < 180) return 'light';
    return ratio < 1.4 ? 'moderate' : 'heavy';
  }
  const sh = speedShares(segs ?? speedSegments(route));
  if (sh.TRAFFIC_JAM > 0.1 || sh.SLOW + sh.TRAFFIC_JAM > 0.4) return 'heavy';
  return sh.SLOW + sh.TRAFFIC_JAM > 0.12 ? 'moderate' : 'light';
}

// Minutes lost to traffic, when Google says how long the trip takes without it.
export const delayMin = (route: Route) =>
  route.staticSeconds && Number.isFinite(route.staticSeconds) ? Math.max(0, Math.round((route.seconds - route.staticSeconds) / 60)) : undefined;

// Minutes until you need to leave to arrive by `arriveBy` ("HH:MM", today),
// given the trip time now; negative once it's too late. Undefined without a
// valid time.
export function leaveIn(arriveBy: string | undefined, tripSeconds: number, now: Date): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(arriveBy ?? '');
  if (!m) return undefined;
  const target = new Date(now);
  target.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return Math.floor((target.getTime() - tripSeconds * 1000 - now.getTime()) / 60_000);
}
